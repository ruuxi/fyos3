'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI } from '@webcontainer/api';
// Binary snapshot approach for faster mounting
import { useWebContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';

export default function WebContainer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [webcontainerInstance, setWebcontainerInstance] = useState<WebContainerAPI | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing…');
  const [progress, setProgress] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);
  const { setInstance } = useWebContainer();

  useEffect(() => {
    let mounted = true;
    let cleanupMessageListener: (() => void) | null = null;

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
        setInstance(instance);
        setProgress((p) => Math.max(p, 18));
        
        // Store instance globally for API access
        if (typeof window !== 'undefined') {
          (global as any).webcontainerInstance = instance;
        }
        setLoadingStage('Preparing workspace…');
        setProgress((p) => Math.max(p, 26));

        // Mount files using binary snapshot for faster loading
        const snapshotResponse = await fetch('/api/webcontainer-snapshot');
        if (!snapshotResponse.ok) {
          throw new Error('Binary snapshot not available. Run `pnpm generate:snapshot` first.');
        }
        const snapshot = await snapshotResponse.arrayBuffer();
        await instance.mount(snapshot);
        console.log('Mounted snapshot');

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

        setLoadingStage('Almost there…');
        setProgress((p) => Math.max(p, 78));
        // Start dev server
        const devProcess = await instance.spawn('pnpm', ['run', 'dev']);
        
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
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-red-950/20 border border-red-800/30 rounded-lg">
        <div className="text-center">
          <div className="text-red-400 font-semibold mb-2">Error</div>
          <div className="text-red-300 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-transparent overflow-hidden">
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
