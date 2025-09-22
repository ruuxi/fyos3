import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { UIMessage } from 'ai';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';
import { useThreads } from './useThreads';
import { useAgentChat } from './useAgentChat';
import { useValidationDiagnostics } from './useValidationDiagnostics';
import { getMutableWindow } from '../utils/window';
import type { Attachment } from '../ui/ChatComposer';
import type { Id } from '../../../../../convex/_generated/dataModel';

export type OptimisticChatMessage = {
  id: string;
  role: 'user';
  parts: Array<{ type: 'text'; text: string }>;
  metadata?: { optimistic: true; optimisticAttachments?: Attachment[] };
};

export type AppRegistryEntry = {
  id: string;
  name: string;
  icon?: string;
  path: string;
};

const AGENT_APP_CREATED_EVENT = 'fyos:agent-app-created';

type WebContainerFns = {
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  readdirRecursive: (path?: string, maxDepth?: number) => Promise<{ path: string; type: 'file' | 'dir' }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  spawn: (command: string, args?: string[], opts?: { cwd?: string }) => Promise<{ exitCode: number; output: string }>;
};

type UseAgentControllerArgs = {
  input: string;
  setInput: (value: string) => void;
  attachments: Attachment[];
  setAttachments: (updater: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  forceFollow: () => void;
  projectAttachmentsToDurable: (attachments: Attachment[]) => Attachment[];
  busyUpload: boolean;
  loadMedia: () => Promise<void>;
  instanceRef: RefObject<WebContainerAPI | null>;
  fnsRef: RefObject<WebContainerFns>;
};

type AgentComposerHandlers = {
  handleSubmit: (event: React.FormEvent) => Promise<void>;
};

type AgentThreadsState = ReturnType<typeof useThreads> & {
  showThreadHistory: boolean;
  setShowThreadHistory: Dispatch<SetStateAction<boolean>>;
  activeThreadIdImmediateRef: RefObject<string | null>;
  activeThreadConvexIdImmediateRef: RefObject<Id<'chat_threads'> | null>;
};

type AgentChatState = {
  messages: UIMessage[];
  optimisticMessages: OptimisticChatMessage[];
  status: string;
  stop: () => void;
  agentActive: boolean;
  didAnimateWelcome: boolean;
  setDidAnimateWelcome: (value: boolean) => void;
  bubbleAnimatingIds: Set<string>;
  lastSentAttachments: Attachment[] | null;
};

type AgentController = {
  threads: AgentThreadsState;
  chat: AgentChatState;
  composer: AgentComposerHandlers;
};

export function useAgentController(args: UseAgentControllerArgs): AgentController {
  const {
    input,
    setInput,
    attachments,
    setAttachments,
    forceFollow,
    projectAttachmentsToDurable,
    busyUpload,
    loadMedia,
    instanceRef,
    fnsRef,
  } = args;

  const {
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId,
    activeThreadConvexId,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    startBlankThread,
    ensureActiveThread,
    closeThread,
    deleteThread,
    isAuthenticated: isChatAuthenticated,
  } = useThreads();

  const [showThreadHistory, setShowThreadHistory] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticChatMessage[]>([]);
  const [agentActive, setAgentActive] = useState(false);
  const [didAnimateWelcome, setDidAnimateWelcome] = useState(false);
  const [bubbleAnimatingIds, setBubbleAnimatingIds] = useState<Set<string>>(new Set());
  const [lastSentAttachments, setLastSentAttachments] = useState<Attachment[] | null>(null);

  const skipOptimisticClearRef = useRef(false);
  const activeThreadIdImmediateRef = useRef<string | null>(activeThreadId);
  useEffect(() => { activeThreadIdImmediateRef.current = activeThreadId; }, [activeThreadId]);
  const activeThreadConvexIdImmediateRef = useRef<Id<'chat_threads'> | null>(activeThreadConvexId);
  useEffect(() => { activeThreadConvexIdImmediateRef.current = activeThreadConvexId; }, [activeThreadConvexId]);

  useEffect(() => {
    if (skipOptimisticClearRef.current) {
      skipOptimisticClearRef.current = false;
      return;
    }
    setOptimisticMessages([]);
  }, [activeThreadId]);

  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  const pendingAttachmentsRef = useRef<Attachment[] | null>(null);
  const uploadBusyRef = useRef<boolean>(false);
  useEffect(() => { uploadBusyRef.current = busyUpload; }, [busyUpload]);

  const statusRef = useRef<string>('ready');
  const sendMessageRef = useRef<(content: string) => Promise<void>>(async () => {});

  const { runValidation } = useValidationDiagnostics({
    spawn: (command, args, opts) => fnsRef.current.spawn(command, args, opts),
    sendMessage: (content) => sendMessageRef.current(content),
    getStatus: () => statusRef.current,
  });

  const hmrGateActiveRef = useRef<boolean>(false);
  const agentActiveRef = useRef<boolean>(false);
  const registryBeforeRunRef = useRef<AppRegistryEntry[] | null>(null);
  const pendingAutoOpenRef = useRef<AppRegistryEntry | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return () => {};
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const candidate = detail as Partial<AppRegistryEntry>;
      if (typeof candidate.id !== 'string' || typeof candidate.path !== 'string') return;
      pendingAutoOpenRef.current = {
        id: candidate.id,
        name: typeof candidate.name === 'string' ? candidate.name : candidate.id,
        icon: typeof candidate.icon === 'string' ? candidate.icon : undefined,
        path: candidate.path,
      };
    };
    window.addEventListener(AGENT_APP_CREATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(AGENT_APP_CREATED_EVENT, handler as EventListener);
  }, []);

  const readRegistry = useCallback(async (): Promise<AppRegistryEntry[] | null> => {
    try {
      const raw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const isRegistryEntry = (entry: unknown): entry is AppRegistryEntry => {
        return Boolean(
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          typeof (entry as { path?: unknown }).path === 'string'
        );
      };
      return parsed
        .filter(isRegistryEntry)
        .map((entry) => ({
          id: entry.id,
          name: typeof entry.name === 'string' ? entry.name : entry.id,
          icon: typeof entry.icon === 'string' ? entry.icon : undefined,
          path: entry.path,
        }));
    } catch (error) {
      console.warn('[AGENT] Failed to read app registry snapshot', error);
      return null;
    }
  }, [fnsRef]);

  const finishAgentRun = useCallback(async () => {
    if (!agentActiveRef.current) {
      return;
    }

    const pendingAutoOpen = pendingAutoOpenRef.current;
    pendingAutoOpenRef.current = null;

    const hadHmrGate = hmrGateActiveRef.current;
    hmrGateActiveRef.current = false;

    agentActiveRef.current = false;
    setAgentActive(false);

    const previousRegistry = registryBeforeRunRef.current;
    registryBeforeRunRef.current = null;

    if (!hadHmrGate) {
      return;
    }

    try { window.postMessage({ type: 'FYOS_AGENT_RUN_ENDED' }, '*'); } catch {}

    try {
      const latestRegistry = await readRegistry();
      let targetApp: AppRegistryEntry | null = null;
      if (latestRegistry && latestRegistry.length > 0) {
        if (previousRegistry && previousRegistry.length > 0) {
          const previousIds = new Set(previousRegistry.map((entry) => entry.id));
          const newEntries = latestRegistry.filter((entry) => !previousIds.has(entry.id));
          targetApp = newEntries[newEntries.length - 1] ?? null;
        }
        if (!targetApp) {
          targetApp = pendingAutoOpen ?? latestRegistry[latestRegistry.length - 1] ?? null;
        }
      } else if (pendingAutoOpen) {
        targetApp = pendingAutoOpen;
      }

      if (targetApp && targetApp.id && targetApp.path) {
        try {
          window.postMessage({ type: 'FYOS_OPEN_APP', app: targetApp, source: 'agent-auto-open' }, '*');
        } catch (error) {
          console.warn('[AGENT] Failed to auto-open created app', error);
        }
      }
    } catch (error) {
      console.warn('[AGENT] Unable to resolve registry after agent run', error);
    }
  }, [readRegistry]);

  const { messages, sendMessage: sendMessageRaw, status, stop } = useAgentChat({
    id: chatSessionKey,
    initialMessages: initialChatMessages,
    activeThreadId,
    getActiveThreadId: () => activeThreadIdImmediateRef.current,
    wc: { instanceRef, fnsRef },
    media: { loadMedia },
    runValidation,
    attachmentsProvider: () => (pendingAttachmentsRef.current || attachmentsRef.current || []),
    onFirstToolCall: () => {
      hmrGateActiveRef.current = true;
      try { window.postMessage({ type: 'FYOS_AGENT_RUN_STARTED' }, '*'); } catch {}
      agentActiveRef.current = true;
      setAgentActive(true);
    },
    onToolProgress: (_toolName: string) => {
      // Tool progress callback
    },
  });

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = (content: string) => sendMessageRaw({ text: content }); }, [sendMessageRaw]);

  useEffect(() => {
    if (optimisticMessages.length === 0) return;

    const isTextPart = (part: unknown): part is { type: 'text'; text?: string } => {
      return Boolean(
        part &&
        typeof part === 'object' &&
        'type' in (part as { type?: unknown }) &&
        (part as { type?: unknown }).type === 'text'
      );
    };

    const extractText = (message: UIMessage | OptimisticChatMessage | undefined): string => {
      if (!message) return '';
      if ('parts' in message && Array.isArray((message as { parts?: unknown[] }).parts)) {
        const parts = (message as { parts?: unknown[] }).parts ?? [];
        return parts
          .filter(isTextPart)
          .map((part) => (part.text ?? ''))
          .join('');
      }
      if ('content' in message && typeof message.content === 'string') {
        return message.content;
      }
      return '';
    };

    const metadataHasOptimistic = (metadata: unknown): boolean => {
      return Boolean(metadata && typeof metadata === 'object' && (metadata as { optimistic?: unknown }).optimistic === true);
    };

    const realUserMessages = (messages ?? []).filter((msg) => msg.role === 'user' && !metadataHasOptimistic(msg.metadata));
    if (realUserMessages.length === 0) return;
    const latestReal = realUserMessages[realUserMessages.length - 1];
    const latestText = extractText(latestReal).trim();
    if (!latestText) return;

    setOptimisticMessages((prev) => {
      const filtered = prev.filter((opt) => {
        const targetText = (opt.parts?.[0]?.text ?? '').trim();
        if (!targetText) return false;
        return !latestText.startsWith(targetText);
      });
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [messages, optimisticMessages.length]);

  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(messages.map(m => m.id));
    const unseen: string[] = [];
    for (const id of currentIds) {
      if (!seenMessageIdsRef.current.has(id)) unseen.push(id);
    }
    if (unseen.length === 0) return;

    unseen.forEach(id => seenMessageIdsRef.current.add(id));
    setBubbleAnimatingIds(prev => {
      const next = new Set(prev);
      unseen.forEach(id => next.add(id));
      return next;
    });

    const timeout = setTimeout(() => {
      setBubbleAnimatingIds(prev => {
        const next = new Set(prev);
        unseen.forEach(id => next.delete(id));
        return next;
      });
    }, 450);

    return () => clearTimeout(timeout);
  }, [messages]);

  const agentStatusPrevRef = useRef<string>('ready');
  useEffect(() => {
    const prevStatus = agentStatusPrevRef.current;
    const statusIsActive = status === 'submitted' || status === 'streaming';
    const prevWasActive = prevStatus === 'submitted' || prevStatus === 'streaming';

    if (statusIsActive && !prevWasActive) {
      setAgentActive(true);
      agentActiveRef.current = true;
      try {
        const globalWin = getMutableWindow();
        if (globalWin?.__FYOS_FIRST_TOOL_CALLED_REF) {
          globalWin.__FYOS_FIRST_TOOL_CALLED_REF.current = false;
        }
      } catch {}
      registryBeforeRunRef.current = null;
      (async () => {
        try {
          const snapshot = await readRegistry();
          if (snapshot) {
            registryBeforeRunRef.current = snapshot;
          }
        } catch (error) {
          console.warn('[AGENT] Failed to snapshot app registry before run', error);
        }
      })();
    }

    if (!statusIsActive && prevWasActive) {
      void finishAgentRun().catch((error) => {
        console.warn('[AGENT] Failed to finalize run', error);
        agentActiveRef.current = false;
        setAgentActive(false);
        registryBeforeRunRef.current = null;
        hmrGateActiveRef.current = false;
      });
    } else if (!statusIsActive && agentActiveRef.current) {
      agentActiveRef.current = false;
      setAgentActive(false);
      registryBeforeRunRef.current = null;
    }

    agentStatusPrevRef.current = status;
  }, [finishAgentRun, readRegistry, status]);

  const sendMessage = useCallback((args: { text: string }) => sendMessageRaw(args), [sendMessageRaw]);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const attachmentsForDisplay = (attachmentsRef.current || attachments).map((a) => ({ ...a }));
    const optimisticId = `optimistic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimisticEntry: OptimisticChatMessage = {
      id: optimisticId,
      role: 'user',
      parts: [{ type: 'text', text: trimmedInput }],
      metadata: { optimistic: true, optimisticAttachments: attachmentsForDisplay },
    };
    setOptimisticMessages((prev) => [...prev, optimisticEntry]);
    forceFollow();

    const removeOptimistic = () => {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    };

    let userText = trimmedInput;

    const waitForDurable = async (timeoutMs = 6000, intervalMs = 80) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const curr = attachmentsRef.current || [];
        const hasDurable = curr.some(a => /^https?:\/\//i.test(a.publicUrl));
        const hasBlobOnly = curr.length > 0 && curr.every(a => /^blob:/i.test(a.publicUrl));
        const stillUploading = uploadBusyRef.current;
        if (hasDurable || (!hasBlobOnly && !stillUploading)) break;
        await new Promise(r => setTimeout(r, intervalMs));
      }
    };

    try {
      if (!activeThreadIdImmediateRef.current && isChatAuthenticated) {
        skipOptimisticClearRef.current = true;
        const ensured = await ensureActiveThread({ titleHint: trimmedInput });
        if (ensured) {
          activeThreadIdImmediateRef.current = ensured;
          await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        } else {
          skipOptimisticClearRef.current = false;
        }
      }

      await waitForDurable();
      const snapshot = projectAttachmentsToDurable((attachmentsRef.current || attachments).map((a) => ({ ...a })));

      if (snapshot.length > 0) {
        const durable = snapshot.filter(a => /^https?:\/\//i.test(a.publicUrl));
        if (durable.length > 0) {
          const lines = durable.map(a => `Attached ${a.contentType || 'file'}: ${a.publicUrl}`);
          userText += '\n' + lines.join('\n');
        }
      }

      console.log('📤 [CHAT] Sending with attachments snapshot:', snapshot);

      pendingAttachmentsRef.current = snapshot;
      setLastSentAttachments(snapshot);

      let sendPromise: Promise<void> | void;
      try {
        sendPromise = sendMessage({ text: userText });
      } catch (error) {
        pendingAttachmentsRef.current = null;
        removeOptimistic();
        throw error;
      }

      setInput('');
      setAttachments([]);
      const finalize = () => {
        removeOptimistic();
        setTimeout(() => { pendingAttachmentsRef.current = null; }, 1500);
      };

      if (sendPromise && typeof sendPromise.then === 'function') {
        sendPromise
          .then(() => finalize())
          .catch((error) => {
            console.error('[CHAT] sendMessage failed', error);
            finalize();
          });
      } else {
        finalize();
      }
    } catch (error) {
      console.error('[CHAT] Failed to prepare message', error);
      removeOptimistic();
      pendingAttachmentsRef.current = null;
      skipOptimisticClearRef.current = false;
    }
  }, [attachments, ensureActiveThread, forceFollow, input, isChatAuthenticated, projectAttachmentsToDurable, sendMessage, setAttachments, setInput]);

  const threadsState = useMemo<AgentThreadsState>(() => ({
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId,
    activeThreadConvexId,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    startBlankThread,
    ensureActiveThread,
    closeThread,
    deleteThread,
    isAuthenticated: isChatAuthenticated,
    showThreadHistory,
    setShowThreadHistory,
    activeThreadIdImmediateRef,
    activeThreadConvexIdImmediateRef,
  }), [
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId,
    activeThreadConvexId,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    startBlankThread,
    ensureActiveThread,
    closeThread,
    deleteThread,
    isChatAuthenticated,
    showThreadHistory,
    activeThreadIdImmediateRef,
    activeThreadConvexIdImmediateRef,
  ]);

  const chatState: AgentChatState = {
    messages,
    optimisticMessages,
    status,
    stop,
    agentActive,
    didAnimateWelcome,
    setDidAnimateWelcome,
    bubbleAnimatingIds,
    lastSentAttachments,
  };

  return {
    threads: threadsState,
    chat: chatState,
    composer: { handleSubmit },
  };
}
