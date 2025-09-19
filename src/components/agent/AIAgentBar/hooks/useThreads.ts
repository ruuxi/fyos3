import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { UIMessage } from 'ai';
import type { ChatThread } from '@/lib/agent/agentTypes';
import { api as convexApi } from '../../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../../convex/_generated/dataModel';

type ChatMode = 'agent' | 'persona';

type UseThreadsState = {
  openThreads: ChatThread[];
  historyThreads: ChatThread[];
  threadsLoading: boolean;
  threadsError: string | null;
  activeThreadId: string | null;
  activeThreadConvexId: Id<'chat_threads'> | null;
  setActiveThreadId: (id: string | null, opts?: { ensureOpen?: boolean }) => void;
  initialChatMessages: UIMessage[] | undefined;
  chatSessionKey: string;
  refreshThreads: () => Promise<void>;
  startBlankThread: () => void;
  ensureActiveThread: (opts?: { titleHint?: string; bootstrap?: boolean }) => Promise<string | null>;
  closeThread: (id: string) => void;
  deleteThread: (id: string) => Promise<void>;
  isAuthenticated: boolean;
};

const OPEN_THREADS_STORAGE_KEY = 'FYOS_AGENT_OPEN_THREADS_V1';
const DEFAULT_THREAD_TITLE = 'New Chat';
const DEFAULT_WELCOME_MESSAGE = "Hello! I'm your AI assistant. I can help you create apps, modify files, and manage your WebContainer workspace.";

function normalizeTitle(title?: string) {
  if (!title) return DEFAULT_THREAD_TITLE;
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (!trimmed) return DEFAULT_THREAD_TITLE;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

type ThreadDoc = Pick<Doc<'chat_threads'>, '_id' | 'title' | 'updatedAt' | 'lastMessageAt' | 'createdAt'> & { id?: string };

type MessageDoc = Pick<Doc<'chat_messages'>,
  '_id'
  | 'role'
  | 'content'
  | 'mode'
  | 'createdAt'
  | 'contentHash'
> & { id?: string };

function mapThread(doc: ThreadDoc): ChatThread {
  return {
    _id: String(doc._id ?? doc.id ?? ''),
    title: doc.title ?? 'Chat',
    updatedAt: doc.updatedAt ?? doc.lastMessageAt ?? doc.createdAt ?? 0,
    lastMessageAt: doc.lastMessageAt,
  };
}

function mapMessage(doc: MessageDoc): UIMessage {
  const parts: UIMessage['parts'] = [{ type: 'text', text: String(doc.content ?? '') }];
  const mode: ChatMode | undefined = doc.mode === 'persona' ? 'persona' : doc.mode === 'agent' ? 'agent' : undefined;
  const metadata: Record<string, unknown> = {};
  if (mode) metadata.mode = mode;

  return {
    id: String(doc._id ?? doc.id ?? Math.random().toString(36).slice(2)),
    role: doc.role === 'assistant' ? 'assistant' : 'user',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    parts,
  };
}

export function useThreads(): UseThreadsState {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(null);
  const [activeThreadConvexId, setActiveThreadConvexId] = useState<Id<'chat_threads'> | null>(null);
  const [initialChatMessages, setInitialChatMessages] = useState<UIMessage[] | undefined>(undefined);
  const [chatSessionKey, setChatSessionKey] = useState<string>('agent-chat');
  const [openThreadIds, setOpenThreadIds] = useState<string[]>([]);
  const openIdsLoadedRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadIdMapRef = useRef<Map<string, Id<'chat_threads'>>>(new Map());

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const createThreadMutation = useMutation(convexApi.chat.createThread);
  const deleteThreadMutation = useMutation(convexApi.chat.deleteThread);
  const appendMessageMutation = useMutation(convexApi.chat.appendMessage);
  const pendingThreadPromiseRef = useRef<Promise<string | null> | null>(null);

  const threadsData = useQuery(
    convexApi.chat.listThreads,
    isAuthenticated ? { limit: 100 } : 'skip'
  );

  const activeThreadIdForQuery = activeThreadIdState ? threadIdMapRef.current.get(activeThreadIdState) : undefined;

  const messagesData = useQuery(
    convexApi.chat.listMessages,
    isAuthenticated && activeThreadIdForQuery ? { threadId: activeThreadIdForQuery, limit: 200 } : 'skip'
  );

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
    if (!Array.isArray(threadsData)) return;

    const nextMap = new Map<string, Id<'chat_threads'>>();
    const converted = threadsData.map((doc) => {
      const mapped = mapThread(doc);
      nextMap.set(mapped._id, doc._id);
      return mapped;
    });
    threadIdMapRef.current = nextMap;
    setThreads(converted);

    const resolvedActive = activeThreadIdState ? nextMap.get(activeThreadIdState) ?? null : null;
    setActiveThreadConvexId(resolvedActive ?? null);

    const availableIds = new Set(converted.map((t) => t._id));
    const filteredOpen = openThreadIds.filter((id) => availableIds.has(id));
    const openChanged = filteredOpen.length !== openThreadIds.length || filteredOpen.some((id, idx) => id !== openThreadIds[idx]);
    if (openChanged) {
      setOpenThreadIds(filteredOpen);
    }

    if (activeThreadIdState && !availableIds.has(activeThreadIdState)) {
      const fallback = filteredOpen[0] ?? converted[0]?._id ?? null;
      setActiveThreadIdState(fallback ?? null);
    }
  }, [isAuthenticated, threadsData, openThreadIds, activeThreadIdState]);

  useEffect(() => {
    const resolved = activeThreadIdState ? threadIdMapRef.current.get(activeThreadIdState) ?? null : null;
    setActiveThreadConvexId(resolved ?? null);
  }, [activeThreadIdState, threadsData]);

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
    if (messagesData === undefined) return;
    if (!Array.isArray(messagesData)) return;
    try {
      const converted = messagesData.map(mapMessage);
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
      setActiveThreadConvexId(null);
    }
  }, [isAuthenticated, authLoading]);

  const threadsLoading = Boolean(isAuthenticated && threadsData === undefined);

  const openThreads = useMemo(() => {
    if (openThreadIds.length === 0) return [];
    const byId = new Map(threads.map((t) => [t._id, t]));
    return openThreadIds
      .map((id) => byId.get(id))
      .filter((thread): thread is ChatThread => Boolean(thread));
  }, [openThreadIds, threads]);

  const historyThreads = useMemo(() => {
    return [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [threads]);

  const setActiveThreadId = useCallback((id: string | null, opts?: { ensureOpen?: boolean }) => {
    activeThreadIdRef.current = id;
    setActiveThreadIdState(id);
    const resolved = id ? threadIdMapRef.current.get(id) ?? null : null;
    setActiveThreadConvexId(resolved ?? null);
    if (id && opts?.ensureOpen !== false) {
      setOpenThreadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
  }, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadIdState;
  }, [activeThreadIdState]);

  const ensureActiveThread = useCallback(async ({ titleHint, bootstrap }: { titleHint?: string; bootstrap?: boolean } = {}) => {
    if (!isAuthenticated) return null;
    if (activeThreadIdRef.current) return activeThreadIdRef.current;
    if (pendingThreadPromiseRef.current) {
      return pendingThreadPromiseRef.current;
    }

    const promise = (async () => {
      try {
        const title = normalizeTitle(titleHint ?? DEFAULT_THREAD_TITLE);
        const now = Date.now();
        const tid = await createThreadMutation({ title });
        const id = String(tid);
        threadIdMapRef.current.set(id, tid);
        const optimistic: ChatThread = { _id: id, title, updatedAt: now, lastMessageAt: now };
        setThreads((prev) => (prev.some((t) => t._id === id) ? prev : [...prev, optimistic]));
        setOpenThreadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        activeThreadIdRef.current = id;
        setActiveThreadIdState(id);
        setActiveThreadConvexId(tid);

        if (bootstrap) {
          const welcomeMessage: UIMessage = {
            id: `welcome_${id}`,
            role: 'assistant' as const,
            parts: [{ type: 'text', text: DEFAULT_WELCOME_MESSAGE }],
            metadata: { mode: 'persona' as const },
          };
          setInitialChatMessages([welcomeMessage]);
          try {
            await appendMessageMutation({
              threadId: tid,
              role: 'assistant',
              content: DEFAULT_WELCOME_MESSAGE,
              mode: 'persona',
            });
          } catch (error) {
            console.warn('[threads] Failed to store welcome message', error);
          }
        }

        return id;
      } catch (error) {
        console.error('Failed to create thread', error);
        setThreadsError((error as Error)?.message ?? 'Failed to create thread');
        return null;
      } finally {
        pendingThreadPromiseRef.current = null;
      }
    })();

    pendingThreadPromiseRef.current = promise;
    return promise;
  }, [appendMessageMutation, createThreadMutation, isAuthenticated]);

  const startBlankThread = useCallback(() => {
    if (!isAuthenticated) {
      activeThreadIdRef.current = null;
      setActiveThreadIdState(null);
      setInitialChatMessages([]);
      setChatSessionKey(`ephemeral:${Date.now()}`);
      return;
    }

    activeThreadIdRef.current = null;
    setActiveThreadIdState(null);
    setInitialChatMessages([]);
    setChatSessionKey(`draft:${Date.now()}`);
    void ensureActiveThread({ bootstrap: true });
  }, [ensureActiveThread, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    if (threadsLoading) return;

    if (threads.length === 0 && !activeThreadIdState) {
      void ensureActiveThread({ bootstrap: true });
      return;
    }

    if (!activeThreadIdRef.current && openThreadIds.length > 0) {
      const fallback = openThreadIds[0];
      activeThreadIdRef.current = fallback;
      setActiveThreadIdState(fallback);
    }
  }, [isAuthenticated, authLoading, threadsLoading, threads, openThreadIds, activeThreadIdState, ensureActiveThread]);

  const closeThread = useCallback((id: string) => {
    setOpenThreadIds((prev) => {
      if (!prev.includes(id)) return prev;
      const filtered = prev.filter((tid) => tid !== id);
      if (activeThreadIdRef.current === id) {
        const fallback = filtered[0] ?? null;
        activeThreadIdRef.current = fallback;
        setActiveThreadIdState(fallback);
      }
      return filtered;
    });
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    if (!isAuthenticated) return;
    const threadId = threadIdMapRef.current.get(id);
    if (!threadId) return;
    try {
      await deleteThreadMutation({ threadId });
      closeThread(id);
      setThreads((prev) => prev.filter((t) => t._id !== id));
      threadIdMapRef.current.delete(id);
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
        const nextMap = new Map<string, Id<'chat_threads'>>();
        const mapped = threadsData.map((doc) => {
          const converted = mapThread(doc);
          nextMap.set(converted._id, doc._id);
          return converted;
        });
        threadIdMapRef.current = nextMap;
        setThreads(mapped);
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
    activeThreadConvexId,
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
