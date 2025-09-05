'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI } from '@webcontainer/api';
// Binary snapshot approach for faster mounting
import { useWebContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';
import { hasPersistedVfs, restoreFromPersistence, persistNow } from '@/utils/vfs-persistence';

export default function WebContainer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [webcontainerInstance, setWebcontainerInstance] = useState<WebContainerAPI | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing…');
  const [progress, setProgress] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);
  const { setInstance } = useWebContainer();
  const devProcRef = useRef<any>(null);
  const devUrlRef = useRef<string | null>(null);
  // Lean reloads: rely on server-ready + HMR; no global dev controls

  useEffect(() => {
    let mounted = true;
    let cleanupMessageListener: (() => void) | null = null;
    let autosaveIntervalId: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;
    let beforeUnloadHandler: (() => void) | null = null;

    const initWebContainer = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setLoadingStage('Waking up…');
        setProgress((p) => Math.max(p, 8));

        // Boot WebContainer
        const instance = await WebContainerAPI.boot({
          coep: 'credentialless',
          workdirName: 'project',
          // Forward uncaught exceptions/unhandled rejections from preview iframes
          // so we can surface them in the chat and ask the AI to fix
          forwardPreviewErrors: true as any,
        } as any);
        
        if (!mounted) return;
        setWebcontainerInstance(instance);
        setProgress((p) => Math.max(p, 18));

        // Store instance globally for API access
        if (typeof window !== 'undefined') {
          (global as any).webcontainerInstance = instance;
        }

        // Listen for preview errors (uncaught exceptions / unhandled promise rejections)
        try {
          (instance as any).on?.('preview-message', (message: any) => {
            try {
              if (
                message?.type === 'PREVIEW_UNCAUGHT_EXCEPTION' ||
                message?.type === 'PREVIEW_UNHANDLED_REJECTION'
              ) {
                const isPromise = message?.type === 'PREVIEW_UNHANDLED_REJECTION';
                const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
                const description = message?.message || 'Unknown error';
                const loc = `${message?.pathname || ''}${message?.search || ''}${message?.hash || ''}`;
                const port = message?.port ? `Port: ${message.port}` : '';
                const stack = message?.stack || '';

                const detail = {
                  source: 'preview' as const,
                  title,
                  description,
                  content: `Error at ${loc}\n${port}\n\nStack trace:\n${stack}`,
                };
                // Dispatch a DOM event so other components (Agent bar) can show an alert
                window.dispatchEvent(
                  new CustomEvent('wc-preview-error', { detail })
                );
              }
            } catch {}
          });
        } catch {}
        setLoadingStage('Preparing workspace…');
        setProgress((p) => Math.max(p, 26));

        // Prefer restoring the user's persisted VFS if available; otherwise mount default snapshot
        let restored = false;
        try {
          const hasSaved = await hasPersistedVfs();
          if (hasSaved) {
            setLoadingStage('Restoring your workspace…');
            setProgress((p) => Math.max(p, 32));
            restored = await restoreFromPersistence(instance);
            if (restored) {
              console.log('[WebContainer] Restored from persisted VFS');
            }
          }
        } catch {}

        if (!restored) {
          // Mount files using binary snapshot for faster cold start
          const snapshotResponse = await fetch('/api/webcontainer-snapshot');
          if (!snapshotResponse.ok) {
            throw new Error('Binary snapshot not available. Run `pnpm generate:snapshot` first.');
          }
          const snapshot = await snapshotResponse.arrayBuffer();
          await instance.mount(snapshot);
          console.log('[WebContainer] Mounted default snapshot');
        }

        // Removed FCP notifier injection for leaner reloads

        // Removed AI helper boot injection

        setLoadingStage('Getting things ready…');
        setProgress((p) => Math.max(p, 42));
        // Use pnpm for faster dependency installation
        const installProcess = await instance.spawn('pnpm', ['install']);
        
        // Stream installation output for better UX
        installProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Install]:', data);
            // Heuristically increase progress during install
            setProgress((prev) => (prev < 72 ? prev + 0.25 : prev));
          }
        }));

        const installExitCode = await installProcess.exit;

        if (installExitCode !== 0) {
          throw new Error('Failed to install dependencies');
        }

        // Expose the instance to tools only after dependencies are installed
        setInstance(instance);

        // Removed periodic autosave; persist on visibility/unload only

        // Save on tab hide or before unload
        const handleVisibility = () => {
          if (document.visibilityState === 'hidden') {
            void persistNow(instance);
          }
        };
        const handleBeforeUnload = () => {
          void persistNow(instance);
        };
        document.addEventListener('visibilitychange', handleVisibility);
        visibilityHandler = handleVisibility;
        window.addEventListener('beforeunload', handleBeforeUnload);
        beforeUnloadHandler = handleBeforeUnload;

        setLoadingStage('Almost there…');
        setProgress((p) => Math.max(p, 78));
        // Start dev server
        const devProcess = await instance.spawn('pnpm', ['run', 'dev']);
        devProcRef.current = devProcess;
        
        // Stream dev server output (optional logging + progress)
        devProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Dev]:', data);
            setProgress((prev) => (prev < 88 ? prev + 0.15 : prev));
          }
        }));

        // Wait for server-ready event
        instance.on('server-ready', (port: number, url: string) => {
          console.log(`Server ready on port ${port}: ${url}`);
          devUrlRef.current = url;
          setLoadingStage('Final touches…');
          setProgress(92);
          if (iframeRef.current) {
            iframeRef.current.src = url;
            const onLoad = () => {
              setLoadingStage('Ready');
              setProgress(100);
              iframeRef.current?.classList.add('iframe-ready');
              setTimeout(() => setIsLoading(false), 120);
            };
            iframeRef.current.addEventListener('load', onLoad, { once: true });
          }
          // Optional: message bridge for AI requests coming from preview iframes
          const onMessage = async (event: MessageEvent) => {
            if (event.data && event.data.type === 'AI_REQUEST') {
              const { id, provider, model, input } = event.data as any;
              const srcWin = (event.source as Window | null);
              const reply = (payload: any) => { try { srcWin?.postMessage(payload, event.origin); } catch {} };
              try {
                if (provider === 'fal') {
                  const res = await fetch('/api/ai/fal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
                  if (!res.ok) { reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() }); return; }
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: await res.json() });
                } else if (provider === 'eleven') {
                  const res = await fetch('/api/ai/eleven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) });
                  if (!res.ok) { reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() }); return; }
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: await res.json() });
                }
              } catch (e: any) {
                reply({ type: 'AI_RESPONSE', id, ok: false, error: e?.message || 'Request failed' });
              }
            }
          };
          window.addEventListener('message', onMessage);
          cleanupMessageListener = () => window.removeEventListener('message', onMessage);
        });

      } catch (err) {
        if (mounted) {
          console.error('Initialization error:', err);
          setError(err instanceof Error ? err.message : 'Failed to initialize sandbox');
          setIsLoading(false);
        }
      }
    };

    initWebContainer();

    return () => {
      mounted = false;
      setInstance(null);
      if (cleanupMessageListener) cleanupMessageListener();
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler);
      try {
        if (webcontainerInstance) {
          void persistNow(webcontainerInstance);
        }
      } catch {}
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-red-50 border border-red-200 rounded-lg">
        <div className="text-center">
          <div className="text-red-600 font-semibold mb-2">Error</div>
          <div className="text-red-500 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-white overflow-hidden">
      {isLoading && (
        <BootScreen
          message={loadingStage || 'Preparing…'}
          progress={progress}
          complete={!isLoading && progress >= 100}
        />
      )}
      <iframe
        ref={iframeRef}
        className={`w-full h-full border-0 opacity-0 will-change-[opacity,transform] transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isLoading ? 'scale-[0.995]' : 'opacity-100 scale-100'}`}
        title="Preview"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
      />
      <style jsx>{`
        .iframe-ready { opacity: 1; }
      `}</style>
    </div>
  );
}
