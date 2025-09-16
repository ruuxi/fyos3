'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { Search, Undo2 } from 'lucide-react';
import { useWebContainer } from './WebContainerProvider';
import { useScreens } from './ScreensProvider';
import { formatBytes } from '@/lib/agent/agentUtils';
import { useThreads } from '@/components/agent/AIAgentBar/hooks/useThreads';
import { useMediaLibrary } from '@/components/agent/AIAgentBar/hooks/useMediaLibrary';
import { useGlobalDrop } from '@/components/agent/AIAgentBar/hooks/useGlobalDrop';
import { useScrollSizing } from '@/components/agent/AIAgentBar/hooks/useScrollSizing';
import { useValidationDiagnostics } from '@/components/agent/AIAgentBar/hooks/useValidationDiagnostics';
import { useFriends } from '@/components/agent/AIAgentBar/hooks/useFriends';
import { useAgentChat } from '@/components/agent/AIAgentBar/hooks/useAgentChat';
import AgentBarShell from '@/components/agent/AIAgentBar/ui/AgentBarShell';
import Toolbar from '@/components/agent/AIAgentBar/ui/Toolbar';
import ChatTabs from '@/components/agent/AIAgentBar/ui/ChatTabs';
import MessagesPane from '@/components/agent/AIAgentBar/ui/MessagesPane';
import ChatComposer, { type Attachment } from '@/components/agent/AIAgentBar/ui/ChatComposer';
import MediaPane from '@/components/agent/AIAgentBar/ui/MediaPane';
import AddFriendForm from '@/components/agent/AIAgentBar/ui/AddFriendForm';
import FriendMessagesPane from '@/components/agent/AIAgentBar/ui/FriendMessagesPane';
import { buildDesktopSnapshot, restoreDesktopSnapshot } from '@/utils/desktop-snapshot';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { UIMessage } from 'ai';
import type { Doc } from '../../convex/_generated/dataModel';

type OptimisticChatMessage = {
  id: string;
  role: 'user';
  parts: Array<{ type: 'text'; text: string }>;
  metadata?: { optimistic: true; optimisticAttachments?: Attachment[] };
};

type AppRegistryEntry = {
  id: string;
  name: string;
  icon?: string;
  path: string;
};

type MutableWindow = Window & {
  __FYOS_FIRST_TOOL_CALLED_REF?: { current: boolean };
  __FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL?: number;
};

const getMutableWindow = (): MutableWindow | null => {
  if (typeof window === 'undefined') return null;
  return window as MutableWindow;
};

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'visit' | 'media' | 'friends'>('chat');
  const [leftPane, setLeftPane] = useState<'agent' | 'friend'>('agent');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');
  const [showThreadHistory, setShowThreadHistory] = useState<boolean>(false);
  const [didAnimateWelcome, setDidAnimateWelcome] = useState(false);
  const [bubbleAnimatingIds, setBubbleAnimatingIds] = useState<Set<string>>(new Set());
  const [lastSentAttachments, setLastSentAttachments] = useState<Attachment[] | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticChatMessage[]>([]);
  const skipOptimisticClearRef = useRef(false);
  // Undo stack depth for UI invalidation
  const [undoDepth, setUndoDepth] = useState<number>(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  
  const { goTo, activeIndex } = useScreens();
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();
  
  // Visit desktops state
  const [desktopsListing, setDesktopsListing] = useState<Array<{ _id: string; title: string; description?: string; icon?: string }>>([]);
  const [desktopsLoading, setDesktopsLoading] = useState(false);
  const [desktopsError, setDesktopsError] = useState<string | null>(null);

  // Phase 2 hooks
  const {
    openThreads,
    historyThreads,
    threadsLoading,
    threadsError,
    activeThreadId,
    setActiveThreadId,
    initialChatMessages,
    chatSessionKey,
    refreshThreads,
    startBlankThread,
    ensureActiveThread,
    closeThread,
    isAuthenticated: isChatAuthenticated,
  } = useThreads();

  const activeThreadIdImmediateRef = useRef<string | null>(activeThreadId);
  useEffect(() => { activeThreadIdImmediateRef.current = activeThreadId; }, [activeThreadId]);
  useEffect(() => {
    if (skipOptimisticClearRef.current) {
      skipOptimisticClearRef.current = false;
      return;
    }
    setOptimisticMessages([]);
  }, [activeThreadId]);

  const {
    mediaItems,
    mediaType,
    setMediaType,
    mediaError,
    uploadError,
    attachments,
    setAttachments,
    loadMedia,
    uploadFiles,
    ingestFromUrl,
    busyFlags,
    projectAttachmentsToDurable,
  } = useMediaLibrary();

  const { messagesContainerRef, messagesInnerRef, containerHeight, forceFollow } = useScrollSizing(mode === 'friends' ? 'chat' : mode);

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const baseFnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { baseFnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  // Track whether the agent mutated the filesystem during a run
  const fsChangedRef = useRef<boolean>(false);
  const markFsChanged = () => { fsChangedRef.current = true; };

  // Install tracked wrappers so agent tool calls can flip fsChangedRef when mutating
  useEffect(() => {
    const base = baseFnsRef.current;
    const tracked = {
      mkdir: base.mkdir,
      writeFile: async (path: string, content: string) => { markFsChanged(); return base.writeFile(path, content); },
      readFile: base.readFile,
      readdirRecursive: base.readdirRecursive,
      remove: async (path: string, opts?: { recursive?: boolean }) => { markFsChanged(); return base.remove(path, opts); },
      spawn: async (command: string, args: string[] = [], opts?: { cwd?: string }) => {
        const cmdLower = (command || '').toLowerCase();
        const firstArg = (args[0] || '').toLowerCase();
        const isPkgMgr = /^(pnpm|npm|yarn|bun)$/.test(cmdLower);
        const isInstallLike = /^(add|install|update|remove|uninstall|i)$/i.test(firstArg);
        if (isPkgMgr && isInstallLike) { markFsChanged(); }
        return base.spawn(command, args, opts);
      },
    } as typeof fnsRef.current;
    fnsRef.current = tracked;
  }, [undoDepth]);

  const statusRef = useRef<string>('ready');
  const sendMessageRef = useRef<(content: string) => Promise<void>>(async () => {});
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const pendingAttachmentsRef = useRef<Attachment[] | null>(null);
  const uploadBusyRef = useRef<boolean>(false);
  useEffect(() => { uploadBusyRef.current = !!busyFlags.uploadBusy; }, [busyFlags.uploadBusy]);
  const undoStackRef = useRef<Uint8Array[]>([]);
  const prevStatusRef = useRef<string>('ready');
  const hmrGateActiveRef = useRef<boolean>(false);
  const registryBeforeRunRef = useRef<AppRegistryEntry[] | null>(null);

  const { runValidation } = useValidationDiagnostics({
    spawn: (cmd, args, opts) => fnsRef.current.spawn(cmd, args, opts),
    sendMessage: (content) => sendMessageRef.current(content),
    getStatus: () => statusRef.current,
  });

  const agentActiveRef = useRef<boolean>(false);

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
    },
    onToolProgress: (toolName: string) => {
      // Tool progress callback
    },
  });

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

  // Friends hook
  const {
    isAuthenticated: isAuthed,
    me,
    setNickname,
    friends,
    friendsLoading,
    friendsError,
    addFriend,
    activePeerId,
    setActivePeerId,
    dmMessages,
    sendDm,
  } = useFriends();

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = (content: string) => sendMessageRaw({ text: content }); }, [sendMessageRaw]);
  const sendMessage = (args: { text: string }) => sendMessageRaw(args);

  // Capture initial snapshot once the WebContainer is ready
  useEffect(() => {
    (async () => {
      const inst = instanceRef.current;
      if (!inst) return;
      if (undoStackRef.current.length > 0) return;
      try {
        const { gz } = await buildDesktopSnapshot(inst);
        undoStackRef.current.push(gz);
        setUndoDepth(undoStackRef.current.length);
        console.log('📸 [UNDO] Initial snapshot captured');
      } catch (e) {
        console.warn('[UNDO] Initial snapshot failed', e);
      }
    })();
  }, [instance]);

  // On agent run completion: if FS changed, push a new snapshot and reset flag
  useEffect(() => {
    const prev = prevStatusRef.current;
    const now = status;
    const started = (prev === 'ready') && (now === 'submitted' || now === 'streaming');
    const finished = (prev === 'submitted' || prev === 'streaming') && now === 'ready';
    const readRegistry = async (): Promise<AppRegistryEntry[] | null> => {
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
    };
    // Reset first-tool-call gate at run start so subsequent runs can pause HMR again
    if (started) {
      try {
        const globalWin = getMutableWindow();
        if (globalWin?.__FYOS_FIRST_TOOL_CALLED_REF) {
          globalWin.__FYOS_FIRST_TOOL_CALLED_REF.current = false;
        }
      } catch {}
      registryBeforeRunRef.current = null;
      (async () => {
        const snapshot = await readRegistry();
        if (snapshot) {
          registryBeforeRunRef.current = snapshot;
        }
      })();
    }
    // Signal run end only if we actually paused during this run
    const runFinishedWithGate = finished && hmrGateActiveRef.current;
    if (runFinishedWithGate) {
      try { window.postMessage({ type: 'FYOS_AGENT_RUN_ENDED' }, '*'); } catch {}
      hmrGateActiveRef.current = false;
      agentActiveRef.current = false;
    }
    if (finished && fsChangedRef.current && instanceRef.current) {
      (async () => {
        try {
          const inst = instanceRef.current;
          if (!inst) return;
          const { gz } = await buildDesktopSnapshot(inst);
          undoStackRef.current.push(gz);
          setUndoDepth(undoStackRef.current.length);
          fsChangedRef.current = false;
          console.log('📸 [UNDO] Snapshot captured after agent run. Depth:', undoStackRef.current.length);
        } catch (e) {
          console.warn('[UNDO] Snapshot after run failed', e);
        }
      })();
    }
    if (runFinishedWithGate) {
      (async () => {
        const previous = registryBeforeRunRef.current;
        registryBeforeRunRef.current = null;
        if (!previous) return;
        const latest = await readRegistry();
        if (!latest || latest.length === 0) return;
        const previousIds = new Set(previous.map((entry) => entry.id));
        const newEntries = latest.filter((entry) => !previousIds.has(entry.id));
        if (newEntries.length === 0) return;
        const targetApp = newEntries[newEntries.length - 1];
        if (!targetApp || typeof targetApp.id !== 'string' || typeof targetApp.path !== 'string') return;
        try {
          window.postMessage({ type: 'FYOS_OPEN_APP', app: targetApp, source: 'agent-auto-open' }, '*');
        } catch (error) {
          console.warn('[AGENT] Failed to auto-open created app', error);
        }
      })();
    } else if (finished) {
      registryBeforeRunRef.current = null;
    }
    prevStatusRef.current = now;
  }, [status]);

  // Undo handler
  const handleUndo = useMemo(() => {
    return async () => {
      const inst = instanceRef.current;
      const stack = undoStackRef.current;
      if (!inst) return;
      if (stack.length < 2) return;
      try {
        // Temporarily suppress preview errors during restore to avoid false alarms
        const globalWin = getMutableWindow();
        if (globalWin) {
          try { globalWin.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL = Date.now() + 1500; } catch {}
        }
        // Drop the current snapshot and restore the previous
        stack.pop();
        const prev = stack[stack.length - 1];
        await restoreDesktopSnapshot(inst, prev);
        setUndoDepth(stack.length);
        console.log('↩️ [UNDO] Restored previous snapshot. Depth:', stack.length);
      } catch (e) {
        console.error('[UNDO] Restore failed', e);
      } finally {
        // Clear suppression shortly after
        setTimeout(() => {
          const win = getMutableWindow();
          if (win) {
            try { win.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL = 0; } catch {}
          }
        }, 1600);
      }
    };
  }, []);

  // Global drag & drop handled by useGlobalDrop hook
  useGlobalDrop({
    onFiles: async (files) => { await uploadFiles(files); setMode('chat'); },
    onUrl: async (url) => { await ingestFromUrl(url); setMode('chat'); },
    onTextAsFile: async (text) => {
      const file = new File([text], 'dropped.txt', { type: 'text/plain' });
      await uploadFiles([file]);
      setMode('chat');
    },
    setIsDraggingOver,
  });

  // UI state
  const isOpen = mode !== 'compact';
  const prevOpenRef = useRef(isOpen);
  const isOpening = isOpen && !prevOpenRef.current;
  const isClosing = !isOpen && prevOpenRef.current;
  useEffect(() => { prevOpenRef.current = isOpen; }, [isOpen]);
  const barAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event?.data;
      if (!payload || typeof payload !== 'object') return;
      const type = (payload as { type?: unknown }).type;
      if (type === 'FYOS_OPEN_CHAT') {
        setMode('chat');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // One-time welcome animation flag
  useEffect(() => {
    const t = setTimeout(() => setDidAnimateWelcome(true), 500);
    return () => clearTimeout(t);
  }, []);

  // Add pop animation to newly added bubbles
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

  // Visit desktops fetcher
  useEffect(() => {
    if (mode !== 'visit') return;
    let cancelled = false;

    const loadDesktops = async () => {
      setDesktopsLoading(true);
      setDesktopsError(null);
      try {
        const response = await fetch('/api/visit/desktops');
        const data = (await response.json()) as { desktops?: Doc<'desktops_public'>[] };
        if (cancelled) return;
        const list = (data.desktops ?? []).map((desktop) => ({
          _id: String(desktop._id),
          title: desktop.title ?? 'Untitled desktop',
          description: desktop.description,
          icon: desktop.icon,
        }));
        setDesktopsListing(list);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load desktops';
          setDesktopsError(message);
        }
      } finally {
        if (!cancelled) {
          setDesktopsLoading(false);
        }
      }
    };

    void loadDesktops();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Keyboard shortcuts: Cmd/Ctrl+K to open chat, Esc to close overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = (e.key ?? '').toLowerCase();
      const isK = key === 'k';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setMode('chat');
      }
      if (key === 'escape' && mode !== 'compact') {
        e.preventDefault();
        setMode('compact');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Handlers
  const handleUploadFiles = async (files: FileList | File[] | null) => {
    await uploadFiles(files);
  };

  const handleIngestFromUrl = async () => {
    const url = ingestUrl.trim();
    if (!url) return;
    await ingestFromUrl(url);
    setIngestUrl('');
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
  };

  // Drag overlay
  const dragOverlay = isDraggingOver ? (
    <div
      className="fixed inset-0 z-[60] pointer-events-auto"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
      }}
      onDragLeave={() => {
        setIsDraggingOver(false);
      }}
      aria-label="Drop files to attach"
    >
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="rounded border-2 border-dashed border-sky-300/70 bg-black/40 text-white px-4 py-3 text-sm">
          Drop to attach
        </div>
      </div>
    </div>
  ) : null;

  // Bottom bar
  const bottomBar = (
    <div className="rounded-none px-4 py-3 bg-transparent">
      <div className="flex items-center gap-2">
        <Toolbar
          activeIndex={activeIndex}
          onToggleHomeStore={() => goTo(activeIndex === 0 ? 1 : 0)}
          onVisit={() => setMode('visit')}
          onMedia={() => setMode('media')}
          onFriends={() => setMode('friends')}
        />
        {/* Left Undo removed */}
        <div className="flex-1 relative">
          <Search className="absolute left-16 top-1/2 -translate-y-1/2 h-4 w-4 text-white" />
          {leftPane === 'agent' && (
            <ChatComposer
              input={input}
              setInput={setInput}
              status={status}
              attachments={attachments}
              removeAttachment={removeAttachment}
              onSubmit={onSubmit}
              onFileSelect={handleUploadFiles}
              onStop={() => stop()}
              onFocus={() => setMode('chat')}
              uploadBusy={busyFlags.uploadBusy}

            />
          )}
          {leftPane === 'friend' && (
            <ChatComposer
              input={input}
              setInput={setInput}
              status={status === 'ready' ? 'ready' : status}
              attachments={[]}
              removeAttachment={() => {}}
              onSubmit={(e)=>{ e.preventDefault(); if (input.trim() && activePeerId) { void sendDm(input); setInput(''); } }}
              onFileSelect={()=>{}}
              onStop={()=>{}}
              onFocus={() => setMode('chat')}
              uploadBusy={false}
            />
          )}
        </div>
      </div>
    </div>
  );



  return (
    <AgentBarShell
      isOpen={isOpen}
      isOpening={isOpening}
      isClosing={isClosing}
      onBackdropClick={() => setMode('compact')}
      barAreaRef={barAreaRef}
      dragOverlay={dragOverlay}
      bottomBar={bottomBar}
    >
      <div className="bg-transparent text-white">
        {(mode === 'chat' || mode === 'friends') && (
          <div className="relative pb-3">
            <div className="border border-white/15 bg-white/5 overflow-hidden">
              <div className="grid grid-cols-[220px_minmax(0,1fr)]">
                {/* Left switcher: Agent vs Friends */}
                <div className="min-h-[420px] border-r border-white/15">
                  <div className="px-3 pt-3 pb-3 flex flex-col gap-2">
                    <div className="text-xs text-white/70 mb-1">Chats</div>
                    <div className="flex flex-col gap-1">
                      <button
                        className={`text-left text-sm px-2 py-1 rounded ${leftPane==='agent' ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`}
                        onClick={()=>{ setLeftPane('agent'); setMode('chat'); }}
                      >
                        Agent
                      </button>
                      <button
                        className={`text-left text-sm px-2 py-1 rounded ${leftPane==='friend' ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`}
                        onClick={()=>{ setLeftPane('friend'); setMode('friends'); }}
                      >
                        Friends
                      </button>
                    </div>

                    {leftPane==='friend' && (
                      <div className="mt-2 flex flex-col gap-2">
                        {friendsLoading && (<div className="text-xs text-white/60">Loading…</div>)}
                        {friendsError && (<div className="text-xs text-red-300">{friendsError}</div>)}
                        {(friends.length > 0) && (
                          <div className="text-xs text-white/70">Friends</div>
                        )}
                        <div className="flex flex-col gap-1 max-h-[240px] overflow-auto">
                          {friends.map((f)=> (
                            <button key={f.ownerId}
                              className={`text-left text-xs px-2 py-1 rounded ${activePeerId===f.ownerId ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`}
                              onClick={()=> setActivePeerId(f.ownerId)}
                              title={f.email || f.ownerId}
                            >
                              {f.nickname || f.email || f.ownerId.slice(0,8)}
                            </button>
                          ))}
                          {friends.length===0 && !friendsLoading && !friendsError && (
                            <div className="text-xs text-white/60">No friends yet</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-h-[420px] flex flex-col">
                  <div className="flex flex-col gap-3 h-full px-3 pt-3 pb-3">
                    {leftPane==='agent' && (
                      <>
                        <ChatTabs
                          openThreads={openThreads}
                          historyThreads={historyThreads}
                          threadsLoading={threadsLoading}
                          threadsError={threadsError}
                          activeThreadId={activeThreadId}
                          setActiveThreadId={setActiveThreadId}
                          showHistory={showThreadHistory}
                          setShowHistory={setShowThreadHistory}
                          onRefresh={() => { void refreshThreads(); }}
                          onNewConversation={() => { activeThreadIdImmediateRef.current = null; startBlankThread(); }}
                          onClose={(id) => {
                            if (activeThreadIdImmediateRef.current === id) {
                              activeThreadIdImmediateRef.current = null;
                            }
                            closeThread(id);
                          }}
                          onOpenFromHistory={(id) => {
                            activeThreadIdImmediateRef.current = id;
                            setActiveThreadId(id);
                          }}
                        />
                        <div className="flex-1 min-h-0">
                          <MessagesPane
                            messages={messages}
                            optimisticMessages={optimisticMessages}
                            status={status}
                            messagesContainerRef={messagesContainerRef}
                            messagesInnerRef={messagesInnerRef}
                            containerHeight={containerHeight}
                            didAnimateWelcome={didAnimateWelcome}
                            bubbleAnimatingIds={bubbleAnimatingIds}
                            lastSentAttachments={lastSentAttachments || undefined}
                            activeThreadId={activeThreadId || undefined}
                          />
                        </div>
                      </>
                    )}
                    {leftPane==='friend' && (
                      <div className="flex flex-col gap-3 flex-1 min-h-0">
                        <div className="flex flex-col gap-2">
                          <div className="text-xs text-white/70">Me</div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              className="rounded-none text-black px-2 py-1 text-xs flex-1"
                              placeholder="Nickname"
                              defaultValue={me?.nickname || ''}
                              onBlur={(e)=>{ const v = e.target.value.trim(); if (v && v !== (me?.nickname||'')) void setNickname(v); }}
                              disabled={!isAuthed}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-white/70 mb-1">Add friend</div>
                          <AddFriendForm onAdd={(nickname)=> addFriend(nickname)} disabled={!isAuthed} />
                        </div>
                        <div className="flex-1 min-h-0">
                          <FriendMessagesPane
                            messages={dmMessages || []}
                            activePeerId={activePeerId}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {status === 'ready' && undoDepth > 1 && (
              <button
                onClick={handleUndo}
                className="absolute right-6 bottom-2 z-40 p-3 text-white/70 hover:text-white transition-colors flex items-center gap-2"
                title="Undo changes"
              >
                <Undo2 className="h-4 w-4" />
                <span className="text-sm">undo</span>
              </button>
            )}

            <style jsx>{`
              .ios-pop { animation: iosPop 420ms cubic-bezier(0.22, 1, 0.36, 1) both; transform-origin: bottom left; }
              @keyframes iosPop {
                0% { transform: scale(0.92); opacity: 0; }
                60% { transform: scale(1.02); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
              }
              @media (prefers-reduced-motion: reduce) {
                .ios-pop { animation-duration: 1ms; }
              }
            `}</style>
            <style jsx global>{`
              .modern-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(56,189,248,0.45) transparent; }
              .modern-scrollbar::-webkit-scrollbar { width: 9px; height: 9px; }
              .modern-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .modern-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(56,189,248,0.45); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
              .modern-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(56,189,248,0.65); }
            `}</style>
          </div>
        )}

        {mode === 'visit' && (
          <div className="px-4 py-3">
            <div className="font-medium mb-2">Visit Desktops</div>
            {desktopsLoading && <div className="text-sm text-gray-500">Loading…</div>}
            {desktopsError && <div className="text-sm text-red-600">{desktopsError}</div>}
            {!desktopsLoading && !desktopsError && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {desktopsListing.map((d) => (
                  <div key={d._id} className="border border-white/10 dark:border-white/10 p-2 bg-white text-black hover:bg-white/90 transition-colors">
                    <div className="flex items-center gap-2">
                      <div>{d.icon || '🖥️'}</div>
                      <div className="font-medium truncate" title={d.title}>{d.title}</div>
                    </div>
                    {d.description && <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{d.description}</div>}
                    <div className="mt-2 flex items-center gap-2">
                      <a href={`/d/${d._id}`} className="text-xs px-2 py-1 bg-black text-white">Open</a>
                      <a href={`/api/visit/desktops/${d._id}/snapshot`} target="_blank" className="text-xs px-2 py-1 border">Download</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'media' && (
          <MediaPane
            mediaType={mediaType}
            setMediaType={setMediaType}
            loadMedia={loadMedia}
            loading={busyFlags.loading}
            error={mediaError}
            uploadError={uploadError}
            onFiles={handleUploadFiles}
            ingestUrl={ingestUrl}
            setIngestUrl={setIngestUrl}
            onIngest={handleIngestFromUrl}
            items={mediaItems}
            disabled={busyFlags.uploadBusy}
            formatBytes={formatBytes}
          />
        )}
      </div>
    </AgentBarShell>
  );
}
