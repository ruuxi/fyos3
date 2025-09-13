import { useEffect, useState } from 'react';
import { useConvexClient } from '@/lib/useConvexClient';
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
  const [threadsLoading, setThreadsLoading] = useState<boolean>(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [initialChatMessages, setInitialChatMessages] = useState<any[] | undefined>(undefined);
  const [chatSessionKey, setChatSessionKey] = useState<string>('agent-chat');

  const { client: convexClient, ready: convexReady } = useConvexClient();

  async function refreshThreads(selectFirstIfAny = true) {
    setThreadsLoading(true); setThreadsError(null);
    try {
      if (!convexReady || !convexClient) {
        setThreads([]);
        if (selectFirstIfAny) setActiveThreadId(null);
        return;
      }
      const list = await convexClient.query(convexApi.chat.listThreads as any, { limit: 100 } as any) as any[];
      setThreads(list as ChatThread[]);
      if (selectFirstIfAny) {
        if (list.length > 0) {
          setActiveThreadId(String((list[0] as any)._id));
        } else {
          await createNewThread('Default');
          return;
        }
      }
    } catch (e: any) {
      setThreadsError(e?.message || 'Failed to load threads');
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadMessagesForThread(tid: string) {
    try {
      setInitialChatMessages(undefined);
      if (!convexReady || !convexClient) { setInitialChatMessages([]); setChatSessionKey(`ephemeral:${Date.now()}`); return; }
      const msgs = await convexClient.query(convexApi.chat.listMessages as any, { threadId: tid as any, limit: 200 } as any) as any[];
      const converted = msgs.map((m: any) => ({ id: String(m._id || m.id || Math.random().toString(36).slice(2)), role: m.role === 'assistant' ? 'assistant' : 'user', parts: [{ type: 'text', text: String(m.content || '') }] }));
      setInitialChatMessages(converted);
      setChatSessionKey(`${tid}:${Date.now()}`);
    } catch {
      setInitialChatMessages(undefined);
    }
  }

  async function createNewThread(title = 'New Chat') {
    try {
      if (!convexReady || !convexClient) {
        setActiveThreadId(null);
        setInitialChatMessages([]);
        setChatSessionKey(`ephemeral:${Date.now()}`);
        return;
      }
      const tid = await convexClient.mutation(convexApi.chat.createThread as any, { title } as any) as any;
      await refreshThreads(false);
      setActiveThreadId(String(tid));
      await loadMessagesForThread(String(tid));
    } catch (e) {
      console.error('Failed to create thread', e);
    }
  }

  async function deleteThread(id: string) {
    try {
      if (convexReady && convexClient) {
        await convexClient.mutation(convexApi.chat.deleteThread as any, { threadId: id as any } as any);
      }
      // Update local state and pick a new active thread
      const remaining = threads.filter(t => String((t as any)._id) !== id);
      setThreads(remaining);
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

  // Initial load after auth state known
  useEffect(() => { if (convexReady) { void refreshThreads(true); } }, [convexReady]);

  // When active thread changes, load its messages
  useEffect(() => { if (activeThreadId) { void loadMessagesForThread(activeThreadId); } }, [activeThreadId]);

  // Refresh threads when window gains focus
  useEffect(() => {
    const onFocus = () => { if (!threadsLoading) { void refreshThreads(false); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [threadsLoading]);

  return {
    threads,
    threadsLoading,
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


