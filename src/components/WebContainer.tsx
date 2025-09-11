'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI } from '@webcontainer/api';
// Binary snapshot approach for faster mounting
import { useWebContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';
import { hasPersistedVfs, restoreFromPersistence, persistNow } from '@/utils/vfs-persistence';
import { persistAssetsFromAIResult } from '@/utils/ai-media';

export default function WebContainer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [webcontainerInstance, setWebcontainerInstance] = useState<WebContainerAPI | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing…');
  const [displayProgress, setDisplayProgress] = useState<number>(2);
  const [targetProgress, setTargetProgress] = useState<number>(2);
  const progressTargetRef = useRef<number>(2);
  const lastFrameTsRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [shouldExitBoot, setShouldExitBoot] = useState(false);
  const { setInstance } = useWebContainer();
  const devProcRef = useRef<any>(null);
  const devUrlRef = useRef<string | null>(null);
  const pendingOpenAppsRef = useRef<any[]>([]);
  const desktopReadyRef = useRef<boolean>(false);

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
        setTargetProgress((p) => Math.max(p, 8));

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
        setTargetProgress((p) => Math.max(p, 18));

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
        // Inject a lightweight preview script to forward console errors from non-app previews
        try {
          const script = `(() => {
            try {
              const origErr = console.error;
              console.error = function(...args){
                try { origErr.apply(console, args); } catch {}
                try {
                  const safe = args.map(a => {
                    try { if (typeof a === 'string') return a; if (a && typeof a === 'object') return a.message || JSON.stringify(a).slice(0,800); return String(a); } catch { return '[unserializable]'; }
                  });
                  window.top?.postMessage({ type: 'APP_CONSOLE', level: 'error', args: safe, pathname: location.pathname, search: location.search, hash: location.hash }, '*');
                } catch {}
              };
              window.addEventListener('error', (e) => {
                try {
                  window.top?.postMessage({ type: 'APP_RUNTIME_ERROR', message: String(e?.error?.message || e?.message || 'Unknown error'), stack: String((e?.error && e.error.stack) || ''), pathname: location.pathname, search: location.search, hash: location.hash }, '*');
                } catch {}
              }, true);
              window.addEventListener('unhandledrejection', (e) => {
                try {
                  window.top?.postMessage({ type: 'APP_RUNTIME_ERROR', message: String(e?.reason?.message || e?.reason || 'Unhandled promise rejection'), stack: String((e?.reason && e.reason.stack) || ''), pathname: location.pathname, search: location.search, hash: location.hash }, '*');
                } catch {}
              }, true);
            } catch {}
          })();`;
          try { await (instance as any).setPreviewScript?.(script); } catch {}
        } catch {}
        setLoadingStage('Preparing workspace…');
        setTargetProgress((p) => Math.max(p, 26));

        // Prefer restoring the user's persisted VFS if available; otherwise mount default snapshot
        let restored = false;
        try {
          const hasSaved = await hasPersistedVfs();
          if (hasSaved) {
            setLoadingStage('Restoring your workspace…');
            setTargetProgress((p) => Math.max(p, 32));
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


        // Add a small normalization stylesheet to guarantee full-bleed preview sizing
        const normalizeCss = `html,body,#root{height:100%;width:100%;margin:0;padding:0}
body{background:transparent}
#root{position:relative}
`;
        try { await instance.fs.writeFile('/preview-normalize.css', normalizeCss); } catch {}
        
        // Inject normalization CSS into HTML files
        try {
          const packageJsonContent = await instance.fs.readFile('/package.json', 'utf8');
          const packageJson = JSON.parse(packageJsonContent);
          
          // Check if it's a React/Next.js app and inject into public/index.html or pages/_document.tsx
          const publicIndexPath = '/public/index.html';
          const appIndexPath = '/app/layout.tsx';
          const srcIndexPath = '/src/index.html';
          
          let injected = false;
          
          // Try different common HTML entry points
          const htmlPaths = [publicIndexPath, srcIndexPath, '/index.html'];
          
          for (const htmlPath of htmlPaths) {
            try {
              const htmlContent = await instance.fs.readFile(htmlPath, 'utf8');
              if (htmlContent.includes('<head>') && !htmlContent.includes('preview-normalize.css')) {
                const updatedContent = htmlContent.replace(
                  '<head>',
                  '<head>\n    <link rel="stylesheet" href="/preview-normalize.css" />'
                );
                await instance.fs.writeFile(htmlPath, updatedContent);
                console.log(`[WebContainer] Injected normalize CSS into ${htmlPath}`);
                injected = true;
                break;
              }
            } catch {}
          }
          
          // For Next.js apps, we might need to inject into _document.tsx or create a custom head
          if (!injected) {
            try {
              // Try to create or update a Next.js _document.tsx file
              const documentPath = '/pages/_document.tsx';
              const nextDocumentContent = `import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head>
        <link rel="stylesheet" href="/preview-normalize.css" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}`;
              await instance.fs.writeFile(documentPath, nextDocumentContent);
              console.log('[WebContainer] Created _document.tsx with normalize CSS');
              injected = true;
            } catch {}
          }
          
          // Fallback: inject into any HTML file we can find
          if (!injected) {
            try {
              const files = await instance.fs.readdir('/', { withFileTypes: true });
              for (const file of files) {
                if (file.name.endsWith('.html')) {
                  try {
                    const content = await instance.fs.readFile(`/${file.name}`, 'utf8');
                    if (content.includes('<head>') && !content.includes('preview-normalize.css')) {
                      const updated = content.replace('<head>', '<head>\n    <link rel="stylesheet" href="/preview-normalize.css" />');
                      await instance.fs.writeFile(`/${file.name}`, updated);
                      console.log(`[WebContainer] Injected normalize CSS into ${file.name}`);
                      break;
                    }
                  } catch {}
                }
              }
            } catch {}
          }
        } catch (e) {
          console.warn('[WebContainer] Could not inject normalize CSS:', e);
        }

        setLoadingStage('Getting things ready…');
        setTargetProgress((p) => Math.max(p, 42));
        // Use pnpm for faster dependency installation
        const installProcess = await instance.spawn('pnpm', ['install']);
        
        // Consume installation output without noisy logging to avoid jank
        try {
          installProcess.output.pipeTo(new WritableStream({
            write() {}
          }));
        } catch {}

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
        // Jump progress modestly; avoid per-chunk increments to reduce renders
        setTargetProgress((p) => Math.max(p, 78));
        // Start dev server
        const devProcess = await instance.spawn('pnpm', ['run', 'dev']);
        devProcRef.current = devProcess;
        
        // Consume dev server output silently
        try {
          devProcess.output.pipeTo(new WritableStream({
            write() {}
          }));
        } catch {}

        // Wait for server-ready event
        instance.on('server-ready', (port: number, url: string) => {
          devUrlRef.current = url;
          setServerReady(true);
          setLoadingStage('Almost ready…');
          setTargetProgress(88);
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
        });

        // Message bridge for AI requests, auto-open app, and desktop readiness from preview iframes
        const onMessage = async (event: MessageEvent) => {
          
          if (event.data && event.data.type === 'AI_REQUEST') {
            const { id, provider, model, input, scope } = event.data as any;
            const srcWin = (event.source as Window | null);
            const reply = (payload: any) => { try { srcWin?.postMessage(payload, event.origin); } catch {} };
            try {
              if (provider === 'fal') {
                const res = await fetch('/api/ai/fal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
                if (!res.ok) { reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() }); return; }
                const raw = await res.json();
                try {
                  const { result: updated, persistedAssets } = await persistAssetsFromAIResult(raw, scope);
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: updated, persistedAssets });
                } catch {
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: raw });
                }
              } else if (provider === 'eleven') {
                const res = await fetch('/api/ai/eleven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) });
                if (!res.ok) { reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() }); return; }
                const raw = await res.json();
                try {
                  const { result: updated, persistedAssets } = await persistAssetsFromAIResult(raw, scope);
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: updated, persistedAssets });
                } catch {
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: raw });
                }
              }
            } catch (e: any) {
              reply({ type: 'AI_RESPONSE', id, ok: false, error: e?.message || 'Request failed' });
            }
            return;
          }

          // Media ingest bridge: apps can request host to ingest base64 or sourceUrl to R2
          if (event.data && event.data.type === 'MEDIA_INGEST') {
            const { id, payload, scope } = event.data as any;
            const srcWin = (event.source as Window | null);
            const reply = (resp: any) => { try { srcWin?.postMessage(resp, event.origin); } catch {} };
            try {
              const body = { ...(payload || {}), scope };
              const res = await fetch('/api/media/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) {
                const text = await res.text().catch(() => '');
                reply({ type: 'MEDIA_INGEST_RESPONSE', id, ok: false, error: text || `HTTP ${res.status}` });
                return;
              }
              const json = await res.json();
              reply({ type: 'MEDIA_INGEST_RESPONSE', id, ok: true, result: json });
            } catch (e: any) {
              reply({ type: 'MEDIA_INGEST_RESPONSE', id, ok: false, error: e?.message || 'Ingest failed' });
            }
            return;
          }

          // Forward app runtime errors from app iframes to the host diagnostic bus
          if (event.data && event.data.type === 'APP_RUNTIME_ERROR') {
            try {
              const d = event.data as any;
              const title = 'App Runtime Error';
              const description = d?.message || 'Unknown app error';
              const loc = `${d?.pathname || ''}${d?.search || ''}${d?.hash || ''}`;
              const stack = d?.stack || '';
              const detail = { source: 'preview' as const, title, description, content: `Error at ${loc}\n\nStack trace:\n${stack}` };
              window.dispatchEvent(new CustomEvent('wc-preview-error', { detail }));
            } catch {}
            return;
          }

          // Optionally surface app console errors as diagnostics (warnings ignored)
          if (event.data && event.data.type === 'APP_CONSOLE') {
            try {
              const d = event.data as any;
              if (d?.level === 'error') {
                const loc = `${d?.pathname || ''}${d?.search || ''}${d?.hash || ''}`;
                const msg = Array.isArray(d?.args) ? d.args.join(' ') : String(d?.args || '');
                const detail = { source: 'preview' as const, title: 'App Console Error', description: msg, content: `Console error at ${loc}\n\n${msg}` };
                window.dispatchEvent(new CustomEvent('wc-preview-error', { detail }));
              }
            } catch {}
            return;
          }

          // Install App from App Store (bundle download + install inside WebContainer)
          if (event.data && event.data.type === 'FYOS_INSTALL_APP') {
            try {
              const appId = event.data.appId as string;
              if (!appId) return;
              const bundleUrl = `/api/store/apps/${appId}/bundle`;
              const res = await fetch(bundleUrl);
              if (!res.ok) {
                console.error('[WebContainer] Failed to fetch bundle', res.status);
                return;
              }
              const buf = new Uint8Array(await res.arrayBuffer());
              const { installAppFromBundle } = await import('@/utils/app-install');
              await installAppFromBundle(instance, buf);
            } catch (e) {
              console.error('[WebContainer] Install failed', e);
            }
            return;
          }

          // Desktop iframe announced readiness; mark ready and flush any queued opens
          if (event.data && event.data.type === 'FYOS_DESKTOP_READY') {
            desktopReadyRef.current = true;
            const target = iframeRef.current?.contentWindow;
            if (target && pendingOpenAppsRef.current.length > 0) {
              try {
                pendingOpenAppsRef.current.forEach(payload => {
                  try {
                    const delay = Number((payload as any)?.delayMs) || 2000;
                    window.setTimeout(() => {
                      try { target.postMessage(payload, '*'); } catch {}
                    }, delay);
                  } catch {}
                });
                pendingOpenAppsRef.current = [];
              } catch {}
            }
            return;
          }

          // Handle auto-open app signals. If desktop not ready yet, queue for later.
          // If desktop is ready, send immediately without queueing.
          if (event.data && event.data.type === 'FYOS_OPEN_APP') {
            const payload = event.data;
            if (!desktopReadyRef.current) {
              try {
                const delay = Number((payload as any)?.delayMs) || 2000;
                (payload as any).delayMs = delay;
                const idx = pendingOpenAppsRef.current.findIndex(p => p?.app?.id === payload?.app?.id);
                if (idx === -1) pendingOpenAppsRef.current.push(payload);
              } catch { pendingOpenAppsRef.current.push(payload); }
            } else {
              const target = iframeRef.current?.contentWindow;
              if (target) {
                const delay = Number((payload as any)?.delayMs) || 2000;
                try {
                  window.setTimeout(() => {
                    try { target.postMessage(payload, '*'); } catch {}
                  }, delay);
                } catch {}
              }
            }
            return;
          }
        };
        window.addEventListener('message', onMessage);
        cleanupMessageListener = () => window.removeEventListener('message', onMessage);

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

  // Keep a ref in sync with the latest target for stable reads inside rAF loop
  useEffect(() => {
    const clamped = Math.max(0, Math.min(100, targetProgress));
    progressTargetRef.current = clamped;
  }, [targetProgress]);

  // Smoothly animate displayProgress toward targetProgress
  useEffect(() => {
    if (!isLoading) {
      return;
    }

    let rafId: number;

    const animate = (timestamp: number) => {
      if (!isLoading) return;

      if (lastFrameTsRef.current == null) {
        lastFrameTsRef.current = timestamp;
      }
      const elapsedMs = Math.min(100, timestamp - (lastFrameTsRef.current || timestamp));
      lastFrameTsRef.current = timestamp;

      setDisplayProgress((prev) => {
        const target = progressTargetRef.current;
        if (Math.abs(target - prev) < 0.05) return target;
        // Exponential smoothing factor based on frame time for consistent feel
        const alpha = 1 - Math.pow(0.001, elapsedMs / 200);
        const next = prev + (target - prev) * alpha;
        return Math.max(0, Math.min(100, next));
      });

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      try { cancelAnimationFrame(rafId); } catch {}
      lastFrameTsRef.current = null;
    };
  }, [isLoading]);

  // Effect to handle completion with 1.5 second delay after server is ready
  useEffect(() => {
    if (!(serverReady && isLoading)) return;

    console.log('[WebContainer] Server ready, starting 1.5s delay before revealing preview');
    
    const delayTimeout = window.setTimeout(() => {
      setLoadingStage('Ready');
      setTargetProgress(100);

      const iframe = iframeRef.current;
      if (!iframe) {
        // If no iframe ref, exit overlay immediately as a fallback
        setShouldExitBoot(true);
        return;
      }

      // Do not forward queued auto-open messages here to avoid duplicates.
      // These will be flushed when the desktop iframe announces readiness.

      // Start iframe fade-in
      iframe.classList.add('iframe-ready');

      // When iframe opacity transition finishes, trigger boot overlay exit
      const onTransitionEnd = (ev: TransitionEvent) => {
        if (ev.propertyName === 'opacity') {
          iframe.removeEventListener('transitionend', onTransitionEnd);
          setShouldExitBoot(true);
        }
      };
      iframe.addEventListener('transitionend', onTransitionEnd);

      // Fallback in case transitionend doesn't fire
      const fallbackId = window.setTimeout(() => {
        try { iframe.removeEventListener('transitionend', onTransitionEnd); } catch {}
        setShouldExitBoot(true);
      }, 700);

      // Clean up transition listener on unmount
      return () => {
        window.clearTimeout(fallbackId);
        try { iframe.removeEventListener('transitionend', onTransitionEnd); } catch {}
      };
    }, 1500); // 1.5 second delay

    return () => {
      window.clearTimeout(delayTimeout);
    };
  }, [serverReady, isLoading]);

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
    <div className="absolute inset-0 overflow-hidden">
      {isLoading && (
        <BootScreen
          message={loadingStage || 'Preparing…'}
          progress={displayProgress}
          complete={shouldExitBoot}
          onExited={() => setIsLoading(false)}
        />
      )}
      <iframe
        ref={iframeRef}
        className={`block absolute inset-0 w-full h-full border-0 opacity-0 will-change-[opacity] transition-opacity duration-[500ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isLoading ? '' : 'opacity-100'}`}
        title="Preview"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
        style={{ backgroundColor: 'rgb(11, 16, 32)' }}
      />
      <style jsx>{`
        .iframe-ready { opacity: 1; }
      `}</style>
    </div>
  );
}
