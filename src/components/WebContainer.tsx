'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI } from '@webcontainer/api';
// Binary snapshot approach for faster mounting
import { useWebContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';
import { hasPersistedVfs, restoreFromPersistence, enqueuePersist, persistNow } from '@/utils/vfs-persistence';

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
  const isDevBusyRef = useRef(false);

  // Expose lightweight dev controls globally for sibling components (agent) to use
  useEffect(() => {
    (globalThis as any).devServerControls = {
      refreshPreview: async () => {
        if (!iframeRef.current || !devUrlRef.current) return false;
        if (isDevBusyRef.current) return true; // already refreshing
        isDevBusyRef.current = true;
        try {
          const url = new URL(devUrlRef.current);
          url.searchParams.set('r', String(Date.now()));
          const awaitFCP = new Promise<boolean>((resolve) => {
            const onMsg = (e: MessageEvent) => {
              try {
                if (!iframeRef.current) return;
                const iframeOrigin = new URL(iframeRef.current.src).origin;
                if (e.origin !== iframeOrigin) return;
              } catch {}
              if (e.data && e.data.type === 'webcontainer:fcp') {
                window.removeEventListener('message', onMsg);
                resolve(true);
              }
            };
            window.addEventListener('message', onMsg);
            // Hard timeout fallback
            setTimeout(() => {
              window.removeEventListener('message', onMsg);
              resolve(false);
            }, 8000);
          });
          iframeRef.current.src = url.toString();
          const ok = await awaitFCP;
          if (!ok) {
            // Could not confirm FCP; try a full restart
            return await (globalThis as any).devServerControls.restartDevServer();
          }
          return true;
        } finally {
          isDevBusyRef.current = false;
        }
      },
      restartDevServer: async () => {
        if (!webcontainerInstance) return false;
        if (isDevBusyRef.current) return true;
        isDevBusyRef.current = true;
        try {
          // Try to kill existing dev process
          try { await (devProcRef.current as any)?.kill?.(); } catch {}
          // Spawn new dev server
          const devProcess = await webcontainerInstance.spawn('pnpm', ['run', 'dev']);
          devProcRef.current = devProcess;
          // Update output stream (optional logging)
          devProcess.output.pipeTo(new WritableStream({ write(data) { console.log('[WebContainer Dev]:', data); } })).catch(()=>{});
          // Wait for server-ready; the global listener will update iframe src
          const serverReady = await new Promise<boolean>((resolve) => {
            const handler = (port: number, url: string) => {
              devUrlRef.current = url;
              if (iframeRef.current) {
                iframeRef.current.src = url;
              }
              resolve(true);
            };
            (webcontainerInstance as any).on('server-ready', handler);
            setTimeout(() => resolve(false), 15000);
          });
          if (!serverReady) return false;
          // Wait for FCP again
          const ok = await new Promise<boolean>((resolve) => {
            const onMsg = (e: MessageEvent) => {
              try {
                if (!iframeRef.current) return;
                const iframeOrigin = new URL(iframeRef.current.src).origin;
                if (e.origin !== iframeOrigin) return;
              } catch {}
              if (e.data && e.data.type === 'webcontainer:fcp') {
                window.removeEventListener('message', onMsg);
                resolve(true);
              }
            };
            window.addEventListener('message', onMsg);
            setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 12000);
          });
          return ok;
        } finally {
          isDevBusyRef.current = false;
        }
      },
    };
    return () => { try { delete (globalThis as any).devServerControls; } catch {} };
  }, [webcontainerInstance]);

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
          workdirName: 'project' 
        });
        
        if (!mounted) return;
        setWebcontainerInstance(instance);
        setProgress((p) => Math.max(p, 18));
        
        // Store instance globally for API access
        if (typeof window !== 'undefined') {
          (global as any).webcontainerInstance = instance;
        }
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

        // Try to inject a First Contentful Paint notifier into common HTML entrypoints
        try {
          const injectInto = async (path: string) => {
            try {
              const buf = await instance.fs.readFile(path);
              const html = new TextDecoder().decode(buf as any);
              if (html.includes('webcontainer-fcp-notify')) return;
              const snippet = `\n<script id="webcontainer-fcp-notify">(function(){try{var sent=false;function send(msg){if(sent)return;sent=true;try{parent.postMessage({type:'webcontainer:fcp'},'*');}catch(e){}}if('PerformanceObserver'in window){try{var obs=new PerformanceObserver(function(list){for(var e of list.getEntries()){if(e.name==='first-contentful-paint'){send();obs.disconnect();break;}}});obs.observe({type:'paint',buffered:true});}catch(e){}}window.addEventListener('load',function(){requestAnimationFrame(function(){send();});});}catch(e){}})();</script>\n`;
              const injected = html.includes('</head>') ? html.replace('</head>', snippet + '</head>') : (html.includes('</body>') ? html.replace('</body>', snippet + '</body>') : (html + snippet));
              await instance.fs.writeFile(path, injected as any);
              console.log('[WebContainer] Injected FCP notifier into', path);
            } catch {}
          };
          await injectInto('/index.html');
          await injectInto('/public/index.html');
        } catch {}

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

        // Start lightweight periodic autosave after instance is ready
        autosaveIntervalId = setInterval(() => {
          try {
            enqueuePersist(instance);
          } catch {}
        }, 5000);

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
        
        // Stream dev server output
        devProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Dev]:', data);
            // Nudge progress as server boots
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
            // Listen for FCP message from the iframe content
            const onMessage = (event: MessageEvent) => {
              if (!iframeRef.current) return;
              // Optionally, verify origin matches iframe origin
              try {
                const iframeOrigin = new URL(iframeRef.current.src).origin;
                if (event.origin !== iframeOrigin) return;
              } catch {}
              if (event.data && event.data.type === 'webcontainer:fcp') {
                setLoadingStage('Ready');
                setProgress(100);
                // Ensure iframe is visible before overlay exit
                iframeRef.current.classList.add('iframe-ready');
                void iframeRef.current.offsetHeight;
                setTimeout(() => setIsLoading(false), 120);
              }
            };
            window.addEventListener('message', onMessage);
            cleanupMessageListener = () => window.removeEventListener('message', onMessage);

            // Fallback: if we never receive FCP within a grace period after load, proceed
            const handleLoad = () => {
              const fallbackTimer = window.setTimeout(() => {
                if (!iframeRef.current) return;
                setLoadingStage('Ready');
                setProgress(100);
                iframeRef.current.classList.add('iframe-ready');
                void iframeRef.current.offsetHeight;
                setTimeout(() => setIsLoading(false), 150);
              }, 1500);
              // Clear if FCP arrives
              const clearOnFCP = (e: MessageEvent) => {
                try {
                  const iframeOrigin = new URL(iframeRef.current!.src).origin;
                  if (e.origin !== iframeOrigin) return;
                } catch {}
                if (e.data && e.data.type === 'webcontainer:fcp') {
                  window.clearTimeout(fallbackTimer);
                  window.removeEventListener('message', clearOnFCP);
                }
              };
              window.addEventListener('message', clearOnFCP);
            };
            iframeRef.current.addEventListener('load', handleLoad, { once: true });
          }
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
      if (autosaveIntervalId) clearInterval(autosaveIntervalId);
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
