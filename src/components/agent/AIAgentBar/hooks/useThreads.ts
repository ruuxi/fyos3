import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { ChatThread } from '@/lib/agent/agentTypes';
import { api as convexApi } from '../../../../../convex/_generated/api';

type ChatMode = 'agent' | 'persona';

type UseThreadsState = {
  openThreads: ChatThread[];
  historyThreads: ChatThread[];
  threadsLoading: boolean;
  threadsError: string | null;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null, opts?: { ensureOpen?: boolean }) => void;
  initialChatMessages: any[] | undefined;
  chatSessionKey: string;
  refreshThreads: () => Promise<void>;
  startBlankThread: () => void;
  ensureActiveThread: (opts?: { titleHint?: string }) => Promise<string | null>;
  closeThread: (id: string) => void;
  deleteThread: (id: string) => Promise<void>;
  isAuthenticated: boolean;
};

const OPEN_THREADS_STORAGE_KEY = 'FYOS_AGENT_OPEN_THREADS_V1';

function normalizeTitle(title?: string) {
  if (!title) return 'New Chat';
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'New Chat';
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function mapThread(doc: any): ChatThread {
  return {
    _id: String(doc._id ?? doc.id),
    title: doc.title ?? 'Chat',
    updatedAt: doc.updatedAt ?? doc.lastMessageAt ?? 0,
    lastMessageAt: doc.lastMessageAt,
  };
}

function mapMessage(doc: any) {
  const parts = [{ type: 'text', text: String(doc.content ?? '') }];
  const mode: ChatMode | undefined = doc.mode === 'persona' ? 'persona' : (doc.mode === 'agent' ? 'agent' : undefined);
  return {
    id: String(doc._id ?? doc.id ?? Math.random().toString(36).slice(2)),
    role: doc.role === 'assistant' ? 'assistant' : 'user',
    metadata: mode ? { mode } : undefined,
    parts,
  };
}

export function useThreads(): UseThreadsState {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(null);
  const [initialChatMessages, setInitialChatMessages] = useState<any[] | undefined>(undefined);
  const [chatSessionKey, setChatSessionKey] = useState<string>('agent-chat');
  const [openThreadIds, setOpenThreadIds] = useState<string[]>([]);
  const openIdsLoadedRef = useRef(false);

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const createThreadMutation = useMutation(convexApi.chat.createThread as any);
  const deleteThreadMutation = useMutation(convexApi.chat.deleteThread as any);

  const threadsData = useQuery(
    convexApi.chat.listThreads as any,
    isAuthenticated ? ({ limit: 100 } as any) : 'skip'
  ) as any[] | 'skip' | undefined;

  const messagesData = useQuery(
    convexApi.chat.listMessages as any,
    isAuthenticated && activeThreadIdState ? ({ threadId: activeThreadIdState as any, limit: 200 } as any) : 'skip'
  ) as any[] | 'skip' | undefined;

  // Load open thread ids from localStorage once per auth session
  useEffect(() => {
    if (!isAuthenticated) {
      openIdsLoadedRef.current = false;
      setOpenThreadIds([]);
      return;
    }
    if (openIdsLoadedRef.current) return;
    if (typeof window === 'undefined') return;
    openIdsLoadedRef.current = true;
    try {
      const raw = window.localStorage.getItem(OPEN_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((id) => typeof id === 'string');
        if (filtered.length) setOpenThreadIds(filtered);
      }
    } catch (error) {
      console.warn('[threads] Failed to load open thread ids', error);
    }
  }, [isAuthenticated]);

  // Persist open thread ids whenever they change
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!openIdsLoadedRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(OPEN_THREADS_STORAGE_KEY, JSON.stringify(openThreadIds));
    } catch (error) {
      console.warn('[threads] Failed to persist open thread ids', error);
    }
  }, [openThreadIds, isAuthenticated]);

  // React to server thread updates
  useEffect(() => {
    if (!isAuthenticated) return;
    if (threadsData === undefined) return; // Loading
    if (threadsData === 'skip') return;
    if (!Array.isArray(threadsData)) return;

    const converted = (threadsData as any[]).map(mapThread);
    setThreads(converted);

    const availableIds = new Set(converted.map((t) => t._id));
    const filteredOpen = openThreadIds.filter((id) => availableIds.has(id));
    const openChanged = filteredOpen.length !== openThreadIds.length || filteredOpen.some((id, idx) => id !== openThreadIds[idx]);
    if (openChanged) {
      setOpenThreadIds(filteredOpen);
    }

    if (activeThreadIdState && !availableIds.has(activeThreadIdState)) {
      const fallback = filteredOpen[0] ?? (converted[0]?. _id ?? null);
      setActiveThreadIdState(fallback ?? null);
    }
  }, [isAuthenticated, threadsData, openThreadIds, activeThreadIdState]);

  // Seed initial messages when the active thread changes
  useEffect(() => {
    if (activeThreadIdState) {
      setInitialChatMessages(undefined);
      setChatSessionKey(`${activeThreadIdState}:${Date.now()}`);
    } else {
      setInitialChatMessages([]);
      setChatSessionKey(`ephemeral:${Date.now()}`);
    }
  }, [activeThreadIdState]);

  // Populate messages for the active thread
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!activeThreadIdState) return;
    if (messagesData === undefined || messagesData === 'skip') return;
    if (!Array.isArray(messagesData)) return;
    try {
      const converted = (messagesData as any[]).map(mapMessage);
      setInitialChatMessages(converted);
    } catch (error) {
      console.warn('[threads] Failed to map messages', error);
    }
  }, [isAuthenticated, activeThreadIdState, messagesData]);

  // Handle unauthenticated mode
  useEffect(() => {
    if (!isAuthenticated && !authLoading) {
      setThreads([]);
      setActiveThreadIdState(null);
      setInitialChatMessages([]);
      setChatSessionKey(`ephemeral:${Date.now()}`);
    }
  }, [isAuthenticated, authLoading]);

  const threadsLoading = Boolean(isAuthenticated && threadsData === undefined);

  const openThreads = useMemo(() => {
    if (openThreadIds.length === 0) return [];
    const byId = new Map(threads.map((t) => [t._id, t]));
    return openThreadIds.map((id) => byId.get(id)).filter(Boolean) as ChatThread[];
  }, [openThreadIds, threads]);

  const historyThreads = useMemo(() => {
    return [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [threads]);

  const setActiveThreadId = useCallback((id: string | null, opts?: { ensureOpen?: boolean }) => {
    setActiveThreadIdState(id);
    if (id) {
      const ensureOpen = opts?.ensureOpen !== false;
      if (ensureOpen) {
        setOpenThreadIds((prev) => {
          const filtered = prev.filter((tid) => tid !== id);
          return [id, ...filtered];
        });
      }
    }
  }, []);

  const startBlankThread = useCallback(() => {
    setActiveThreadIdState(null);
    setInitialChatMessages([]);
    setChatSessionKey(`ephemeral:${Date.now()}`);
  }, []);

  const ensureActiveThread = useCallback(async ({ titleHint }: { titleHint?: string } = {}) => {
    if (!isAuthenticated) return null;
    if (activeThreadIdState) return activeThreadIdState;
    try {
      const title = normalizeTitle(titleHint);
      const now = Date.now();
      const tid = await createThreadMutation({ title } as any);
      const id = String(tid);
      const optimistic: ChatThread = { _id: id, title, updatedAt: now, lastMessageAt: now };
      setThreads((prev) => {
        if (prev.some((t) => t._id === id)) return prev;
        return [optimistic, ...prev];
      });
      setOpenThreadIds((prev) => [id, ...prev.filter((existing) => existing !== id)]);
      setActiveThreadIdState(id);
      return id;
    } catch (error) {
      console.error('Failed to create thread', error);
      setThreadsError((error as Error)?.message ?? 'Failed to create thread');
      return null;
    }
  }, [isAuthenticated, activeThreadIdState, createThreadMutation]);

  const closeThread = useCallback((id: string) => {
    setOpenThreadIds((prev) => {
      if (!prev.includes(id)) return prev;
      const filtered = prev.filter((tid) => tid !== id);
      if (activeThreadIdState === id) {
        const fallback = filtered[0] ?? null;
        setActiveThreadIdState(fallback);
      }
      return filtered;
    });
  }, [activeThreadIdState]);

  const deleteThread = useCallback(async (id: string) => {
    if (!isAuthenticated) return;
    try {
      await deleteThreadMutation({ threadId: id as any } as any);
      closeThread(id);
      setThreads((prev) => prev.filter((t) => t._id !== id));
    } catch (error) {
      console.error('Delete thread failed', error);
      setThreadsError((error as Error)?.message ?? 'Failed to delete thread');
    }
  }, [closeThread, deleteThreadMutation, isAuthenticated]);

  const refreshThreads = useCallback(async () => {
    try {
      setThreadsError(null);
      if (!isAuthenticated) {
        setThreads([]);
        return;
      }
      if (Array.isArray(threadsData)) {
        setThreads((threadsData as any[]).map(mapThread));
      }
    } catch (error) {
      setThreadsError((error as Error)?.message ?? 'Failed to refresh threads');
    }
  }, [isAuthenticated, threadsData]);

  return {
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId: activeThreadIdState,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    startBlankThread,
    ensureActiveThread,
    closeThread,
    deleteThread,
    isAuthenticated,
  };
}
