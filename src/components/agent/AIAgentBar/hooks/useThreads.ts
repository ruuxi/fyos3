import { useEffect, useRef, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { ChatThread } from '@/lib/agent/agentTypes';
// Note: convex generated API is at repo root under convex/_generated
import { api as convexApi } from '../../../../../convex/_generated/api';

type UseThreadsState = {
  threads: ChatThread[];
  threadsLoading: boolean;
  threadsError: string | null;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  initialChatMessages: any[] | undefined;
  chatSessionKey: string;
  refreshThreads: (selectFirstIfAny?: boolean) => Promise<void>;
  createNewThread: (title?: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  loadMessagesForThread: (id: string) => Promise<void>;
};

export function useThreads(): UseThreadsState {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [initialChatMessages, setInitialChatMessages] = useState<any[] | undefined>(undefined);
  const [chatSessionKey, setChatSessionKey] = useState<string>('agent-chat');

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const createThreadMutation = useMutation(convexApi.chat.createThread as any);
  const deleteThreadMutation = useMutation(convexApi.chat.deleteThread as any);

  const threadsData = useQuery(
    convexApi.chat.listThreads as any,
    isAuthenticated ? ({ limit: 100 } as any) : 'skip'
  ) as any[] | undefined;

  const messagesData = useQuery(
    convexApi.chat.listMessages as any,
    isAuthenticated && activeThreadId ? ({ threadId: activeThreadId as any, limit: 200 } as any) : 'skip'
  ) as any[] | undefined;

  const defaultCreatedRef = useRef(false);

  async function refreshThreads(selectFirstIfAny = true) {
    try {
      setThreadsError(null);
      if (!isAuthenticated) {
        setThreads([]);
        if (selectFirstIfAny) setActiveThreadId(null);
        return;
      }
      const list = threadsData || [];
      setThreads(list as ChatThread[]);
      if (selectFirstIfAny) {
        if (list.length > 0) {
          setActiveThreadId(String((list[0] as any)._id));
        } else {
          if (!defaultCreatedRef.current) {
            defaultCreatedRef.current = true;
            await createNewThread('Default');
          }
          return;
        }
      }
    } catch (e: any) {
      setThreadsError(e?.message || 'Failed to load threads');
    }
  }

  async function loadMessagesForThread(tid: string) {
    try {
      setInitialChatMessages(undefined);
      if (!isAuthenticated) { setInitialChatMessages([]); setChatSessionKey(`ephemeral:${Date.now()}`); return; }
      // For react hooks, set active thread and let the messagesData effect seed initial messages
      setActiveThreadId(tid);
    } catch {
      setInitialChatMessages(undefined);
    }
  }

  async function createNewThread(title = 'New Chat') {
    try {
      if (!isAuthenticated) {
        setActiveThreadId(null);
        setInitialChatMessages([]);
        setChatSessionKey(`ephemeral:${Date.now()}`);
        return;
      }
      const tid = await createThreadMutation({ title } as any);
      setActiveThreadId(String(tid));
      // messages seeding handled by effects
    } catch (e) {
      console.error('Failed to create thread', e);
    }
  }

  async function deleteThread(id: string) {
    try {
      if (isAuthenticated) {
        await deleteThreadMutation({ threadId: id as any } as any);
      }
      // Pick a new active thread locally for snappy UX
      const remaining = (threads || []).filter(t => String((t as any)._id) !== id);
      if (activeThreadId === id) {
        const idx = threads.findIndex(th => String((th as any)._id) === id);
        const candidate = remaining[Math.min(idx, Math.max(remaining.length - 1, 0))] || remaining[idx - 1] || remaining[0];
        setActiveThreadId(candidate ? String((candidate as any)._id) : null);
        if (candidate) await loadMessagesForThread(String((candidate as any)._id));
      }
    } catch (e) {
      console.error('Delete thread failed', e);
    }
  }

  // Keep local threads list in sync with query data
  useEffect(() => {
    if (threadsData !== undefined) {
      setThreads((threadsData as ChatThread[]) || []);
    }
  }, [threadsData]);

  // Initial selection and default thread creation when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    if (threadsData === undefined) return; // loading
    if (activeThreadId) return;
    const list = threadsData as any[];
    if (list.length > 0) {
      setActiveThreadId(String((list[0] as any)._id));
    } else if (!defaultCreatedRef.current) {
      defaultCreatedRef.current = true;
      void createNewThread('Default');
    }
  }, [isAuthenticated, threadsData, activeThreadId]);

  // Handle unauthenticated mode: ephemeral
  useEffect(() => {
    if (!isAuthenticated && !authLoading) {
      setThreads([]);
      setActiveThreadId(null);
      setInitialChatMessages([]);
      setChatSessionKey(`ephemeral:${Date.now()}`);
    }
  }, [isAuthenticated, authLoading]);

  // When active thread changes, reset seeding state and chat session key
  useEffect(() => {
    if (activeThreadId) {
      setInitialChatMessages(undefined);
      setChatSessionKey(`${activeThreadId}:${Date.now()}`);
    }
  }, [activeThreadId]);

  // Seed initial messages from reactive query for the active thread
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!activeThreadId) return;
    if (!messagesData) return; // loading or skipped
    try {
      const converted = (messagesData as any[]).map((m: any) => ({
        id: String(m._id || m.id || Math.random().toString(36).slice(2)),
        role: m.role === 'assistant' ? 'assistant' : 'user',
        parts: [{ type: 'text', text: String(m.content || '') }],
      }));
      setInitialChatMessages(converted);
    } catch {
      // ignore
    }
  }, [isAuthenticated, activeThreadId, messagesData]);

  // When active thread changes, load its messages
  useEffect(() => { if (activeThreadId) { void loadMessagesForThread(activeThreadId); } }, [activeThreadId]);

  // Refresh threads when window gains focus
  useEffect(() => {
    const threadsLoadingComputed = Boolean(isAuthenticated && threadsData === undefined);
    const onFocus = () => { if (!threadsLoadingComputed) { void refreshThreads(false); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isAuthenticated, threadsData]);

  return {
    threads,
    threadsLoading: Boolean(isAuthenticated && threadsData === undefined),
    threadsError,
    activeThreadId,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    createNewThread,
    deleteThread,
    loadMessagesForThread,
  };
}


