'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useWebContainer } from './WebContainerProvider';
import { useScreens } from './ScreensProvider';
import { formatBytes } from '@/lib/agent/agentUtils';
import { useThreads } from '@/components/agent/AIAgentBar/hooks/useThreads';
import { useMediaLibrary } from '@/components/agent/AIAgentBar/hooks/useMediaLibrary';
import { useGlobalDrop } from '@/components/agent/AIAgentBar/hooks/useGlobalDrop';
import { useScrollSizing } from '@/components/agent/AIAgentBar/hooks/useScrollSizing';
import { useValidationDiagnostics } from '@/components/agent/AIAgentBar/hooks/useValidationDiagnostics';
import { useAgentChat } from '@/components/agent/AIAgentBar/hooks/useAgentChat';
import AgentBarShell from '@/components/agent/AIAgentBar/ui/AgentBarShell';
import Toolbar from '@/components/agent/AIAgentBar/ui/Toolbar';
import ChatTabs from '@/components/agent/AIAgentBar/ui/ChatTabs';
import MessagesPane from '@/components/agent/AIAgentBar/ui/MessagesPane';
import ChatComposer, { type Attachment } from '@/components/agent/AIAgentBar/ui/ChatComposer';
import MediaPane from '@/components/agent/AIAgentBar/ui/MediaPane';

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'visit' | 'media'>('chat');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');
  const [showThreadHistory, setShowThreadHistory] = useState<boolean>(false);
  const [didAnimateWelcome, setDidAnimateWelcome] = useState(false);
  const [bubbleAnimatingIds, setBubbleAnimatingIds] = useState<Set<string>>(new Set());
  const [lastSentAttachments, setLastSentAttachments] = useState<Attachment[] | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  
  const { goTo, activeIndex } = useScreens();
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();
  
  // Visit desktops state
  const [desktopsListing, setDesktopsListing] = useState<Array<{ _id: string; title: string; description?: string; icon?: string }>>([]);
  const [desktopsLoading, setDesktopsLoading] = useState(false);
  const [desktopsError, setDesktopsError] = useState<string | null>(null);

  // Phase 2 hooks
  const {
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
  } = useThreads();

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

  const { messagesContainerRef, messagesInnerRef, containerHeight, forceFollow } = useScrollSizing(mode);

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { fnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  const statusRef = useRef<string>('ready');
  const sendMessageRef = useRef<(content: string) => Promise<void>>(async () => {});
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const pendingAttachmentsRef = useRef<Attachment[] | null>(null);
  const uploadBusyRef = useRef<boolean>(false);
  useEffect(() => { uploadBusyRef.current = !!busyFlags.uploadBusy; }, [busyFlags.uploadBusy]);
  
  const { runValidation } = useValidationDiagnostics({
    spawn: (cmd, args, opts) => fnsRef.current.spawn(cmd, args, opts),
    sendMessage: (content) => sendMessageRef.current(content),
    getStatus: () => statusRef.current,
  });

  const { messages, sendMessage: sendMessageRaw, status, stop } = useAgentChat({
    id: chatSessionKey,
    initialMessages: initialChatMessages,
    activeThreadId,
    threadsCount: threads.length,
    wc: { instanceRef, fnsRef },
    media: { loadMedia },
    runValidation,
    attachmentsProvider: () => (pendingAttachmentsRef.current || attachmentsRef.current || []),
  });

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = (content: string) => sendMessageRaw({ text: content }); }, [sendMessageRaw]);
  const sendMessage = (args: { text: string }) => sendMessageRaw(args);

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
    setDesktopsLoading(true); setDesktopsError(null);
    fetch('/api/visit/desktops')
      .then(r => r.json())
      .then(j => setDesktopsListing((j?.desktops || []).map((d: any) => ({ _id: String(d._id), title: d.title, description: d.description, icon: d.icon }))))
      .catch(e => setDesktopsError(e?.message || 'Failed'))
      .finally(() => setDesktopsLoading(false));
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
    if (!input.trim()) return;
    forceFollow();
    let userText = input;
    // Ensure we pick up durable URLs if ingestion just finished
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
    await waitForDurable();
    // Project any blob: attachments to known durable URLs just in case state hasn't flushed
    const snapshot = projectAttachmentsToDurable((attachmentsRef.current || attachments).slice());
    
    if (snapshot.length > 0) {
      // Only include durable, fetchable URLs for the LLM (avoid blob:)
      const durable = snapshot.filter(a => /^https?:\/\//i.test(a.publicUrl));
      if (durable.length > 0) {
        // Append concise attachment hints per request into the user's message only
        const lines = durable.map(a => `Attached ${a.contentType || 'file'}: ${a.publicUrl}`);
        userText += '\n' + lines.join('\n');
      }
    }
    
    // Debug log the snapshot before sending
    console.log('📤 [CHAT] Sending with attachments snapshot:', snapshot);
    
    // Ensure server receives a stable view even if UI clears attachments immediately
    pendingAttachmentsRef.current = snapshot;
    setLastSentAttachments(snapshot);
    void sendMessage({ text: userText });
    // Clear the pending ref shortly after dispatch
    setTimeout(() => { pendingAttachmentsRef.current = null; }, 1500);
    setInput('');
    setAttachments([]);
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
        />
        <div className="flex-1 relative">
          <Search className="absolute left-16 top-1/2 -translate-y-1/2 h-4 w-4 text-white" />
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
        {mode === 'chat' && (
          <div className="px-4 pt-3">
            <ChatTabs
              threads={threads}
              threadsLoading={threadsLoading}
              threadsError={threadsError}
              activeThreadId={activeThreadId}
              setActiveThreadId={setActiveThreadId}
              showHistory={showThreadHistory}
              setShowHistory={setShowThreadHistory}
              onRefresh={() => refreshThreads(false)}
              onCreate={() => createNewThread('New Chat')}
              onDelete={deleteThread}
            />
            <MessagesPane
              messages={messages}
              status={status}
              messagesContainerRef={messagesContainerRef}
              messagesInnerRef={messagesInnerRef}
              containerHeight={containerHeight}
              didAnimateWelcome={didAnimateWelcome}
              bubbleAnimatingIds={bubbleAnimatingIds}
              lastSentAttachments={lastSentAttachments || undefined}
            />
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
