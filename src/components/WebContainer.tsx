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
  const [displayProgress, setDisplayProgress] = useState<number>(2);
  const [targetProgress, setTargetProgress] = useState<number>(2);
  const progressTargetRef = useRef<number>(2);
  const lastFrameTsRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fcpDetected, setFcpDetected] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [shouldExitBoot, setShouldExitBoot] = useState(false);
  const { setInstance } = useWebContainer();
  const devProcRef = useRef<any>(null);
  const devUrlRef = useRef<string | null>(null);
  const pendingOpenAppsRef = useRef<any[]>([]);
  // Wait for both server-ready AND FCP before hiding boot screen

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

        // Inject FCP notifier to detect when content is actually rendered
        setLoadingStage('Setting up content detection…');
        setTargetProgress((p) => Math.max(p, 38));
        
        const fcpNotifierScript = `
// FCP Notifier - detects when content is actually painted
(function() {
  let fcpDetected = false;
  let observer;
  
  function notifyFCP() {
    if (fcpDetected) return;
    fcpDetected = true;
    
    // Clean up observer
    if (observer) {
      observer.disconnect();
    }
    
    // Notify parent about FCP
    try {
      window.parent.postMessage({ type: 'FCP_DETECTED' }, '*');
    } catch (e) {
      console.log('[FCP] Could not notify parent:', e);
    }
  }
  
  // Method 1: Use PerformanceObserver for FCP if available
  if ('PerformanceObserver' in window) {
    try {
      const perfObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.name === 'first-contentful-paint') {
            console.log('[FCP] Detected via PerformanceObserver:', entry.startTime + 'ms');
            notifyFCP();
            return;
          }
        }
      });
      perfObserver.observe({ entryTypes: ['paint'] });
    } catch (e) {
      console.log('[FCP] PerformanceObserver failed:', e);
    }
  }
  
  // Method 2: Fallback - watch for DOM content and visible elements
  function checkForVisibleContent() {
    const body = document.body;
    if (!body) return false;
    
    // Check if body has visible content
    const bodyRect = body.getBoundingClientRect();
    if (bodyRect.width === 0 || bodyRect.height === 0) return false;
    
    // Look for visible elements with content
    const elements = document.querySelectorAll('*');
    for (let el of elements) {
      if (el === document.body || el === document.documentElement) continue;
      
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      
      // Check if element is visible and has dimensions
      if (rect.width > 0 && rect.height > 0 && 
          style.visibility !== 'hidden' && 
          style.display !== 'none' &&
          style.opacity !== '0') {
        
        // Check if it has text content or background/border
        const hasText = el.textContent && el.textContent.trim().length > 0;
        const hasBackground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                            style.backgroundColor !== 'transparent';
        const hasBorder = style.borderWidth !== '0px';
        const hasImage = el.tagName === 'IMG' && el.complete;
        
        if (hasText || hasBackground || hasBorder || hasImage) {
          return true;
        }
      }
    }
    return false;
  }
  
  // Method 3: Watch for DOM mutations and check content
  if ('MutationObserver' in window) {
    observer = new MutationObserver(() => {
      if (checkForVisibleContent()) {
        console.log('[FCP] Detected via DOM content check');
        notifyFCP();
      }
    });
    
    // Start observing when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      });
    } else {
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
  }
  
  // Method 4: Fallback timeout (in case nothing else works)
  setTimeout(() => {
    if (!fcpDetected && checkForVisibleContent()) {
      console.log('[FCP] Detected via timeout fallback');
      notifyFCP();
    }
  }, 2000);
  
  // Method 5: Load event fallback
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!fcpDetected) {
        console.log('[FCP] Detected via load event fallback');
        notifyFCP();
      }
    }, 100);
  });
})();
`;

        await instance.fs.writeFile('/fcp-notifier.js', fcpNotifierScript);

        // Add a small normalization stylesheet to guarantee full-bleed preview sizing
        const normalizeCss = `html,body,#root{height:100%;width:100%;margin:0;padding:0}
body{background:transparent}
#root{position:relative}
`;
        try { await instance.fs.writeFile('/preview-normalize.css', normalizeCss); } catch {}
        
        // Inject the FCP notifier into HTML files
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
              if (htmlContent.includes('<head>') && !htmlContent.includes('fcp-notifier.js')) {
                const updatedContent = htmlContent.replace(
                  '<head>',
                  '<head>\n    <script src="/fcp-notifier.js"></script>\n    <link rel="stylesheet" href="/preview-normalize.css" />'
                );
                await instance.fs.writeFile(htmlPath, updatedContent);
                console.log(`[WebContainer] Injected FCP notifier into ${htmlPath}`);
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
        <script src="/fcp-notifier.js"></script>
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
              console.log('[WebContainer] Created _document.tsx with FCP notifier');
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
                    if (content.includes('<head>') && !content.includes('fcp-notifier.js')) {
                      const updated = content.replace('<head>', '<head>\n    <script src="/fcp-notifier.js"></script>\n    <link rel="stylesheet" href="/preview-normalize.css" />');
                      await instance.fs.writeFile(`/${file.name}`, updated);
                      console.log(`[WebContainer] Injected FCP notifier into ${file.name}`);
                      break;
                    }
                  } catch {}
                }
              }
            } catch {}
          }
        } catch (e) {
          console.warn('[WebContainer] Could not inject FCP notifier:', e);
        }

        setLoadingStage('Getting things ready…');
        setTargetProgress((p) => Math.max(p, 42));
        // Use pnpm for faster dependency installation
        const installProcess = await instance.spawn('pnpm', ['install']);
        
        // Stream installation output for better UX
        installProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Install]:', data);
            // Heuristically increase progress during install
            setTargetProgress((prev) => (prev < 72 ? prev + 0.25 : prev));
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
        setTargetProgress((p) => Math.max(p, 78));
        // Start dev server
        const devProcess = await instance.spawn('pnpm', ['run', 'dev']);
        devProcRef.current = devProcess;
        
        // Stream dev server output (optional logging + progress)
        devProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Dev]:', data);
            setTargetProgress((prev) => (prev < 88 ? prev + 0.15 : prev));
          }
        }));

        // Wait for server-ready event
        instance.on('server-ready', (port: number, url: string) => {
          console.log(`Server ready on port ${port}: ${url}`);
          devUrlRef.current = url;
          setServerReady(true);
          setLoadingStage('Waiting for content to render…');
          setTargetProgress(88);
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
        });

        // Message bridge for AI requests, auto-open app, and FCP/desktop readiness from preview iframes
        const onMessage = async (event: MessageEvent) => {
          if (event.data && event.data.type === 'FCP_DETECTED') {
            console.log('[WebContainer] FCP detected in preview');
            setFcpDetected(true);
            return;
          }
          
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
                  const { persistAssetsFromAIResult } = await import('@/utils/ai-media');
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
                  const { persistAssetsFromAIResult } = await import('@/utils/ai-media');
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

          // Desktop iframe announced readiness; flush any queued opens
          if (event.data && event.data.type === 'FYOS_DESKTOP_READY') {
            const target = iframeRef.current?.contentWindow;
            if (target && pendingOpenAppsRef.current.length > 0) {
              try {
                pendingOpenAppsRef.current.forEach(payload => {
                  try { target.postMessage(payload, '*'); } catch {}
                });
                pendingOpenAppsRef.current = [];
              } catch {}
            }
            return;
          }

          // Forward auto-open app signals to the desktop iframe; always queue and try to send
          if (event.data && event.data.type === 'FYOS_OPEN_APP') {
            const payload = event.data;
            try {
              const idx = pendingOpenAppsRef.current.findIndex(p => p?.app?.id === payload?.app?.id);
              if (idx === -1) pendingOpenAppsRef.current.push(payload);
            } catch { pendingOpenAppsRef.current.push(payload); }
            const target = iframeRef.current?.contentWindow;
            if (target) {
              try { target.postMessage(payload, '*'); } catch {}
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

  // Effect to handle completion when both server is ready AND FCP is detected
  useEffect(() => {
    if (!(serverReady && fcpDetected && isLoading)) return;

    console.log('[WebContainer] Both server ready and FCP detected, revealing preview');
    setLoadingStage('Ready');
    setTargetProgress(100);

    const iframe = iframeRef.current;
    if (!iframe) {
      // If no iframe ref, exit overlay immediately as a fallback
      setShouldExitBoot(true);
      return;
    }

    // Best-effort: attempt to forward queued auto-open messages on FCP,
    // but do NOT clear the queue here. We'll clear only after desktop signals readiness.
    try {
      const target = iframe.contentWindow;
      if (target && pendingOpenAppsRef.current.length > 0) {
        pendingOpenAppsRef.current.forEach(payload => {
          try { target.postMessage(payload, '*'); } catch {}
        });
      }
    } catch {}

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

    return () => {
      window.clearTimeout(fallbackId);
      try { iframe.removeEventListener('transitionend', onTransitionEnd); } catch {}
    };
  }, [serverReady, fcpDetected, isLoading]);

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
          waitingForContent={serverReady && !fcpDetected}
        />
      )}
      <iframe
        ref={iframeRef}
        className={`block absolute inset-0 w-full h-full border-0 opacity-0 will-change-[opacity] transition-opacity duration-[500ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isLoading ? '' : 'opacity-100'}`}
        title="Preview"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
      />
      <style jsx>{`
        .iframe-ready { opacity: 1; }
      `}</style>
    </div>
  );
}
