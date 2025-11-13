'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI, type WebContainerProcess } from '@webcontainer/api';
// Binary snapshot approach for faster mounting
import { useWebContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';
import { hasPersistedVfs, restoreFromPersistence, persistNow } from '@/utils/vfs-persistence';
import { persistAssetsFromAIResult, type MediaScope } from '@/utils/ai-media';
import { useConvexClient } from '@/lib/useConvexClient';
import { api as convexApi } from '../../convex/_generated/api';
import { useAuth, useClerk } from '@clerk/nextjs';

declare global {
  interface Window {
    webcontainerInstance?: WebContainerAPI;
    __FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL?: number;
  }
}

type AgentMessageBase = { type: string } & Record<string, unknown>;

type OpenAppPayload = AgentMessageBase & {
  type: 'FYOS_OPEN_APP';
  app?: { id?: string } & Record<string, unknown>;
  delayMs?: number | string;
};

type AIRequestMessage = AgentMessageBase & {
  type: 'AI_REQUEST';
  id: string;
  provider: string;
  model?: string;
  input?: unknown;
  scope?: MediaScope;
};

type AIResponseMessage =
  | { type: 'AI_RESPONSE'; id: string; ok: true; result: unknown; persistedAssets?: unknown }
  | { type: 'AI_RESPONSE'; id: string; ok: false; error: unknown };

type MediaIngestMessage = AgentMessageBase & {
  type: 'MEDIA_INGEST';
  id: string;
  payload?: Record<string, unknown> | null;
  scope?: unknown;
};

type MediaIngestResponse =
  | { type: 'MEDIA_INGEST_RESPONSE'; id: string; ok: true; result: unknown }
  | { type: 'MEDIA_INGEST_RESPONSE'; id: string; ok: false; error: unknown };

type DesktopReadyMessage = AgentMessageBase & { type: 'FYOS_DESKTOP_READY' };
type DesktopStateMessage = AgentMessageBase & { type: 'FYOS_DESKTOP_STATE'; payload?: Record<string, unknown> | null };
type AppRuntimeErrorMessage = AgentMessageBase & {
  type: 'APP_RUNTIME_ERROR';
  message?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  stack?: string;
};

type AppBuildErrorMessage = AgentMessageBase & {
  type: 'APP_BUILD_ERROR';
  message?: string;
  stack?: string;
  plugin?: string;
  id?: string;
  frame?: string;
  pathname?: string;
  search?: string;
  hash?: string;
};

type AppBuildErrorClearedMessage = AgentMessageBase & {
  type: 'APP_BUILD_ERROR_CLEARED';
  pathname?: string;
  search?: string;
  hash?: string;
};

type AppConsoleMessage = AgentMessageBase & {
  type: 'APP_CONSOLE';
  level?: string;
  args?: unknown;
  pathname?: string;
  search?: string;
  hash?: string;
};

type MaskMode = 'agent' | 'error' | 'reload' | 'hmr' | 'boot';

type MaskCommand =
  | { type: 'FYOS_MASK_PIN'; mode?: MaskMode }
  | { type: 'FYOS_MASK_UNPIN'; mode?: MaskMode }
  | { type: 'FYOS_MASK_FLASH'; mode?: MaskMode };

type UserMode = 'auth' | 'anon';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isAIRequestMessage = (value: unknown): value is AIRequestMessage => {
  return (
    isRecord(value) &&
    value.type === 'AI_REQUEST' &&
    typeof value.id === 'string' &&
    typeof value.provider === 'string'
  );
};

const isMediaIngestMessage = (value: unknown): value is MediaIngestMessage => {
  return isRecord(value) && value.type === 'MEDIA_INGEST' && typeof value.id === 'string';
};

const isOpenAppMessage = (value: unknown): value is OpenAppPayload => {
  return isRecord(value) && value.type === 'FYOS_OPEN_APP';
};

const isDesktopReadyMessage = (value: unknown): value is DesktopReadyMessage => {
  return isRecord(value) && value.type === 'FYOS_DESKTOP_READY';
};

const isDesktopStateMessage = (value: unknown): value is DesktopStateMessage => {
  return isRecord(value) && value.type === 'FYOS_DESKTOP_STATE';
};

const isAppRuntimeErrorMessage = (value: unknown): value is AppRuntimeErrorMessage => {
  return isRecord(value) && value.type === 'APP_RUNTIME_ERROR';
};

const isAppBuildErrorMessage = (value: unknown): value is AppBuildErrorMessage => {
  return isRecord(value) && value.type === 'APP_BUILD_ERROR';
};

const isAppBuildErrorClearedMessage = (value: unknown): value is AppBuildErrorClearedMessage => {
  return isRecord(value) && value.type === 'APP_BUILD_ERROR_CLEARED';
};

const isAppConsoleMessage = (value: unknown): value is AppConsoleMessage => {
  return isRecord(value) && value.type === 'APP_CONSOLE';
};

const getSourceWindow = (source: MessageEventSource | null): Window | null => {
  if (typeof Window === 'undefined' || !source) {
    return null;
  }
  return source instanceof Window ? source : null;
};

const DEFAULT_OPEN_APP_DELAY_MS = 2000;

const parseDelayMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_OPEN_APP_DELAY_MS;
};

const formatPreviewMessageArgs = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        try {
          return JSON.stringify(item);
        } catch {
          return '[unserializable]';
        }
      })
      .join(' ');
  }
  if (value == null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
};

export default function WebContainer() {
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [webcontainerInstance, setWebcontainerInstance] = useState<WebContainerAPI | null>(null);
  const webcontainerInstanceRef = useRef<WebContainerAPI | null>(null);
  useEffect(() => { webcontainerInstanceRef.current = webcontainerInstance; }, [webcontainerInstance]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Preparing workspace…');
  const [displayProgress, setDisplayProgress] = useState<number>(2);
  const [targetProgress, setTargetProgress] = useState<number>(2);
  const progressTargetRef = useRef<number>(2);
  const lastFrameTsRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [shouldExitBoot, setShouldExitBoot] = useState(false);
  const { setInstance } = useWebContainer();
  const setInstanceRef = useRef(setInstance);
  useEffect(() => { setInstanceRef.current = setInstance; }, [setInstance]);
  const devProcRef = useRef<WebContainerProcess | null>(null);
  const devUrlRef = useRef<string | null>(null);
  const pendingOpenAppsRef = useRef<OpenAppPayload[]>([]);
  const desktopReadyRef = useRef<boolean>(false);
  const lastRemoteSaveRef = useRef<number>(0);
  const remoteSaveInFlightRef = useRef<boolean>(false);
  const { client: convexClient, ready: convexReady } = useConvexClient();
  const convexClientRef = useRef(convexClient);
  useEffect(() => { convexClientRef.current = convexClient; }, [convexClient]);
  const convexReadyRef = useRef(convexReady);
  useEffect(() => { convexReadyRef.current = convexReady; }, [convexReady]);
  const [userMode, setUserMode] = useState<UserMode | null>(null);
  const userModeRef = useRef<UserMode | null>(userMode);
  useEffect(() => { userModeRef.current = userMode; }, [userMode]);
  const [bootRequested, setBootRequested] = useState(false);
  const hasBootedRef = useRef(false);
  const canProceed = isSignedIn || userMode === 'anon';
  const bootMaskPinnedRef = useRef(false);

  const postMaskCommand = (command: MaskCommand) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    try {
      target.postMessage(command, '*');
    } catch {}
  };

  useEffect(() => {
    const nextMode: UserMode = isSignedIn ? 'auth' : 'anon';
    setUserMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [isSignedIn]);

  useEffect(() => {
    if (!userMode || bootRequested) return;
    setBootRequested(true);
  }, [userMode, bootRequested]);

  useEffect(() => {
    if (!userMode) return;
    if (!desktopReadyRef.current) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    try {
      target.postMessage({ type: 'FYOS_USER_MODE', payload: { mode: userMode } }, '*');
    } catch {}
  }, [userMode]);

  useEffect(() => {
    if (!bootRequested || hasBootedRef.current) {
      return;
    }
    hasBootedRef.current = true;
    let mounted = true;
    let cleanupMessageListener: (() => void) | null = null;
    let visibilityHandler: (() => void) | null = null;
    let beforeUnloadHandler: (() => void) | null = null;

    const initWebContainer = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setLoadingStage('Waking up…');
        setTargetProgress((p) => Math.max(p, 8));

        // Boot WebContainer
        const bootOptions: Parameters<typeof WebContainerAPI.boot>[0] & { forwardPreviewErrors?: boolean } = {
          coep: 'credentialless',
          workdirName: 'project',
          // Forward uncaught exceptions/unhandled rejections from preview iframes
          // so we can surface them in the chat and ask the AI to fix
          forwardPreviewErrors: true,
        };
        const instance = await WebContainerAPI.boot(bootOptions);
        
        if (!mounted) return;
        setWebcontainerInstance(instance);
        setTargetProgress((p) => Math.max(p, 18));

        // Store instance globally for API access
        if (typeof window !== 'undefined') {
          window.webcontainerInstance = instance;
        }

        // Listen for preview errors (uncaught exceptions / unhandled promise rejections)
        type PreviewMessage = {
          type?: string;
          message?: string;
          pathname?: string;
          search?: string;
          hash?: string;
          port?: number;
          stack?: string;
        };

        type PreviewCapableContainer = WebContainerAPI & {
          on?(event: 'preview-message', handler: (message: PreviewMessage) => void): void;
          setPreviewScript?(script: string): Promise<void>;
        };

        const previewContainer = instance as PreviewCapableContainer;

        try {
          previewContainer.on?.('preview-message', (message: PreviewMessage) => {
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
                    try {
                      if (typeof a === 'string') return a;
                      if (a && typeof a === 'object') {
                        try {
                          if ('message' in a && typeof a.message === 'string') {
                            return a.message;
                          }
                        } catch {}
                        try { return JSON.stringify(a).slice(0, 800); } catch {}
                        return '[unserializable]';
                      }
                      return String(a);
                    } catch { return '[unserializable]'; }
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
          try { await previewContainer.setPreviewScript?.(script); } catch {}
        } catch {}
        setLoadingStage('Preparing workspace…');
        setTargetProgress((p) => Math.max(p, 26));

        // Try restoring a private desktop snapshot from server, then local IndexedDB, else default snapshot
        let restored = false;
        try {
          const convexClientCurrent = convexClientRef.current;
          if (userModeRef.current === 'auth' && convexReadyRef.current && convexClientCurrent) {
            setLoadingStage('Checking cloud snapshot…');
            setTargetProgress((p) => Math.max(p, 30));
            const record = await convexClientCurrent.query(convexApi.desktops_private.getLatestDesktop, {});
            if (record && record._id) {
              setLoadingStage('Restoring from cloud…');
              setTargetProgress((p) => Math.max(p, 34));
              const url = await convexClientCurrent.query(convexApi.desktops_private.getDesktopSnapshotUrl, { id: record._id });
              const snapRes = await fetch(url, { cache: 'no-store' });
              if (snapRes.ok) {
                const buf = new Uint8Array(await snapRes.arrayBuffer());
                try {
                  const { restoreDesktopSnapshot } = await import('@/utils/desktop-snapshot');
                  await restoreDesktopSnapshot(instance, buf);
                  restored = true;
                  console.log('[WebContainer] Restored from private cloud snapshot');
                } catch (e) {
                  console.warn('[WebContainer] Cloud snapshot restore failed, falling back:', e);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[WebContainer] Could not check latest private snapshot:', e);
        }

        if (!restored) {
          try {
            const hasSaved = await hasPersistedVfs();
            if (hasSaved) {
              setLoadingStage('Restoring your workspace…');
              setTargetProgress((p) => Math.max(p, 38));
              restored = await restoreFromPersistence(instance);
              if (restored) {
                console.log('[WebContainer] Restored from persisted VFS');
              }
            }
          } catch {}
        }

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
          await instance.fs.readFile('/package.json', 'utf8');

          // Check if it's a React/Next.js app and inject into public/index.html or pages/_document.tsx
          const publicIndexPath = '/public/index.html';
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
        setInstanceRef.current?.(instance);

        // Removed periodic autosave; persist on visibility/unload only

        // Save on tab hide or before unload (local + cloud) for auth users only
        const savePrivateSnapshot = async () => {
          try {
            if (remoteSaveInFlightRef.current) return;
            const now = Date.now();
            if (now - lastRemoteSaveRef.current < 60000) return; // throttle 60s
            remoteSaveInFlightRef.current = true;
            // Ask desktop iframe for current UI state and persist to FS before building snapshot
            const fetchDesktopState = async (timeoutMs = 1500): Promise<Record<string, unknown> | null> => {
              try {
                const cw = iframeRef.current?.contentWindow;
                if (!cw) return null;
                return await new Promise((resolve) => {
                  let done = false;
                  const timer = window.setTimeout(() => {
                    if (!done) {
                      done = true;
                      window.removeEventListener('message', onMsg);
                      resolve(null);
                    }
                  }, timeoutMs);
                  const onMsg = (event: MessageEvent) => {
                    if (event.source !== cw) return;
                    if (!isDesktopStateMessage(event.data)) return;
                    window.clearTimeout(timer);
                    done = true;
                    window.removeEventListener('message', onMsg);
                    resolve(event.data.payload ?? null);
                  };
                  window.addEventListener('message', onMsg);
                  try { cw.postMessage({ type: 'FYOS_REQUEST_DESKTOP_STATE' }, '*'); } catch {}
                });
              } catch {
                return null;
              }
            };

            if (userModeRef.current === 'auth') {
              const state = await fetchDesktopState().catch(() => null);
              if (state) {
                try {
                  await instance.fs.mkdir('/public/_fyos', { recursive: true });
                } catch {}
                try {
                  // Attach theme selection from localStorage
                  let theme: unknown = null;
                  try {
                    const raw = window.localStorage.getItem('fyos.desktop.theme');
                    if (raw) theme = JSON.parse(raw);
                  } catch {}
                  const toWrite = { ...state, theme };
                  const encoded = new TextEncoder().encode(JSON.stringify(toWrite, null, 2));
                  await instance.fs.writeFile('/public/_fyos/desktop-state.json', encoded);
                } catch {}
              }
            }
            const convexClientCurrent = convexClientRef.current;
            if (userModeRef.current === 'auth' && convexReadyRef.current && convexClientCurrent) {
              const { buildDesktopSnapshot } = await import('@/utils/desktop-snapshot');
              const snap = await buildDesktopSnapshot(instance);
              const start = await convexClientCurrent.mutation(convexApi.desktops_private.saveDesktopStart, {
                desktopId: 'default',
                title: 'My Desktop',
                size: snap.size,
                fileCount: snap.fileCount,
                contentSha256: snap.contentSha256,
              });
              if (start?.url && start?.r2KeySnapshot) {
                await fetch(start.url, { method: 'PUT', body: new Uint8Array(snap.gz), headers: { 'Content-Type': 'application/octet-stream' } }).catch(() => {});
                await convexClientCurrent.mutation(convexApi.desktops_private.saveDesktopFinalize, {
                  desktopId: 'default',
                  title: 'My Desktop',
                  r2KeySnapshot: start.r2KeySnapshot,
                  size: snap.size,
                  fileCount: snap.fileCount,
                  contentSha256: snap.contentSha256,
                }).catch(() => {});
              }
            }
            lastRemoteSaveRef.current = now;
          } catch {
            // ignore network or build errors
          } finally {
            remoteSaveInFlightRef.current = false;
          }
        };

        const persistLocalVfs = () => {
          try {
            void persistNow(instance);
          } catch {}
        };

        const handleVisibility = () => {
          if (document.visibilityState === 'hidden') {
            persistLocalVfs();
            if (userModeRef.current === 'auth') {
              void savePrivateSnapshot();
            }
          }
        };
        const handleBeforeUnload = () => {
          persistLocalVfs();
          if (userModeRef.current === 'auth') {
            void savePrivateSnapshot();
          }
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
        const onMessage = async (event: MessageEvent<unknown>) => {
          const data = event.data;

          if (isAIRequestMessage(data)) {
            const { id, provider, model, input, scope } = data;
            const srcWin = getSourceWindow(event.source);
            const reply = (payload: AIResponseMessage) => {
              if (!srcWin) return;
              try { srcWin.postMessage(payload, event.origin); } catch {}
            };
            try {
              if (provider === 'fal') {
                const res = await fetch('/api/ai/fal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model, input }),
                });
                if (!res.ok) {
                  reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() });
                  return;
                }
                const raw = await res.json();
                try {
                  const { result: updated, persistedAssets } = await persistAssetsFromAIResult(raw, scope);
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: updated, persistedAssets });
                } catch {
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: raw });
                }
              } else if (provider === 'eleven') {
                const res = await fetch('/api/ai/eleven', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(input ?? {}),
                });
                if (!res.ok) {
                  reply({ type: 'AI_RESPONSE', id, ok: false, error: await res.text() });
                  return;
                }
                const raw = await res.json();
                try {
                  const { result: updated, persistedAssets } = await persistAssetsFromAIResult(raw, scope);
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: updated, persistedAssets });
                } catch {
                  reply({ type: 'AI_RESPONSE', id, ok: true, result: raw });
                }
              }
            } catch (rawError: unknown) {
              const errorMessage = rawError instanceof Error ? rawError.message : 'Request failed';
              reply({ type: 'AI_RESPONSE', id, ok: false, error: errorMessage });
            }
            return;
          }

          // Media ingest bridge: apps can request host to ingest base64 or sourceUrl to R2
          if (isMediaIngestMessage(data)) {
            const { id, payload, scope } = data;
            const srcWin = getSourceWindow(event.source);
            const reply = (resp: MediaIngestResponse) => {
              if (!srcWin) return;
              try { srcWin.postMessage(resp, event.origin); } catch {}
            };
            try {
              if (userModeRef.current === 'anon') {
                // In anon mode, skip persistence; return original payload
                const originalPayload = typeof payload === 'object' && payload !== null ? payload : {};
                reply({ type: 'MEDIA_INGEST_RESPONSE', id, ok: true, result: { ...originalPayload, persisted: false } });
                return;
              }
              const body = { ...(payload ?? {}), scope };
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
            } catch (rawError: unknown) {
              const errorMessage = rawError instanceof Error ? rawError.message : 'Ingest failed';
              reply({ type: 'MEDIA_INGEST_RESPONSE', id, ok: false, error: errorMessage });
            }
            return;
          }

          // Forward app runtime errors from app iframes to the host diagnostic bus
          if (isAppRuntimeErrorMessage(data)) {
            try {
              const suppressUntil = window.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL;
              if (typeof suppressUntil === 'number' && Date.now() < suppressUntil) {
                // Suppress transient preview errors during controlled operations (e.g., undo restore)
                return;
              }
              const title = 'App Runtime Error';
              const description = data.message ?? 'Unknown app error';
              const loc = `${data.pathname ?? ''}${data.search ?? ''}${data.hash ?? ''}`;
              const stack = data.stack ?? '';
              const detail = { source: 'preview' as const, title, description, content: `Error at ${loc}\n\nStack trace:\n${stack}` };
              window.dispatchEvent(new CustomEvent('wc-preview-error', { detail }));
            } catch {}
            return;
          }

          if (isAppBuildErrorMessage(data)) {
            try {
              const suppressUntil = window.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL;
              if (typeof suppressUntil === 'number' && Date.now() < suppressUntil) {
                return;
              }
              const title = 'App Build Error';
              const description = data.message ?? 'Unknown build error';
              const loc = `${data.pathname ?? ''}${data.search ?? ''}${data.hash ?? ''}`;
              const plugin = data.plugin ? `Plugin: ${data.plugin}\n` : '';
              const id = data.id ? `File: ${data.id}\n` : '';
              const frame = data.frame ? `Frame:\n${data.frame}\n` : '';
              const stack = data.stack ?? '';
              const detail = {
                source: 'preview' as const,
                title,
                description,
                content: `Build error at ${loc}\n${plugin}${id}${frame}\n${stack}`,
              };
              window.dispatchEvent(new CustomEvent('wc-preview-error', { detail }));
            } catch {}
            return;
          }

          if (isAppBuildErrorClearedMessage(data)) {
            return;
          }

          // Optionally surface app console errors as diagnostics (warnings ignored)
          if (isAppConsoleMessage(data)) {
            try {
              const suppressUntil = window.__FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL;
              if (typeof suppressUntil === 'number' && Date.now() < suppressUntil) {
                // Suppress transient preview console errors during controlled operations (e.g., undo restore)
                return;
              }
              if (data.level === 'error') {
                const loc = `${data.pathname ?? ''}${data.search ?? ''}${data.hash ?? ''}`;
                const msg = formatPreviewMessageArgs(data.args);
                const detail = { source: 'preview' as const, title: 'App Console Error', description: msg, content: `Console error at ${loc}\n\n${msg}` };
                window.dispatchEvent(new CustomEvent('wc-preview-error', { detail }));
              }
            } catch {}
            return;
          }

          // FYOS_AGENT_RUN_* forwarding removed (HMR no longer paused during runs)

          // Install App from App Store (bundle download + install inside WebContainer)
          if (isRecord(data) && data.type === 'FYOS_INSTALL_APP') {
            try {
              const appId = typeof data.appId === 'string' ? data.appId : null;
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
            } catch (installError: unknown) {
              console.error('[WebContainer] Install failed', installError);
            }
            return;
          }

          // Desktop iframe announced readiness; mark ready and flush any queued opens
          if (isDesktopReadyMessage(data)) {
            desktopReadyRef.current = true;
            const target = iframeRef.current?.contentWindow;
            // Announce user mode to the desktop iframe
            if (userModeRef.current && target) {
              try { target.postMessage({ type: 'FYOS_USER_MODE', payload: { mode: userModeRef.current } }, '*'); } catch {}
            }
            // Send current theme as soon as desktop is ready
            try {
              const raw = window.localStorage.getItem('fyos.desktop.theme');
              if (raw && target) {
                const theme = JSON.parse(raw);
                target.postMessage({ type: 'FYOS_SET_THEME', payload: theme }, '*');
              }
            } catch {}
            if (target && pendingOpenAppsRef.current.length > 0) {
              try {
                const queued = [...pendingOpenAppsRef.current];
                pendingOpenAppsRef.current = [];
                queued.forEach((payload) => {
                  const delay = parseDelayMs(payload.delayMs);
                  window.setTimeout(() => {
                    try { target.postMessage(payload, '*'); } catch {}
                  }, delay);
                });
              } catch {}
            }
            return;
          }

          // Handle auto-open app signals. If desktop not ready yet, queue for later.
          // If desktop is ready, send immediately without queueing.
          if (isOpenAppMessage(data)) {
            const normalizedPayload: OpenAppPayload = { ...data, delayMs: parseDelayMs(data.delayMs) };
            if (!desktopReadyRef.current) {
              const idx = pendingOpenAppsRef.current.findIndex(
                (queued) => queued?.app?.id === normalizedPayload?.app?.id,
              );
              if (idx === -1) pendingOpenAppsRef.current.push(normalizedPayload);
            } else {
              const target = iframeRef.current?.contentWindow;
              if (target) {
                const delay = parseDelayMs(normalizedPayload.delayMs);
                window.setTimeout(() => {
                  try { target.postMessage(normalizedPayload, '*'); } catch {}
                }, delay);
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
      setInstanceRef.current?.(null);
      if (cleanupMessageListener) cleanupMessageListener();
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler);
      try {
        const existingInstance = webcontainerInstanceRef.current;
        if (existingInstance) {
          void persistNow(existingInstance);
        }
      } catch {}
    };
  }, [bootRequested]);

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
      const exitBoot = () => {
        if (!bootMaskPinnedRef.current) {
          bootMaskPinnedRef.current = true;
          postMaskCommand({ type: 'FYOS_MASK_PIN', mode: 'boot' });
        }
        setShouldExitBoot(true);
      };
      const onTransitionEnd = (ev: TransitionEvent) => {
        if (ev.propertyName === 'opacity') {
          iframe.removeEventListener('transitionend', onTransitionEnd);
          exitBoot();
        }
      };
      iframe.addEventListener('transitionend', onTransitionEnd);

      // Fallback in case transitionend doesn't fire
      const fallbackId = window.setTimeout(() => {
        try { iframe.removeEventListener('transitionend', onTransitionEnd); } catch {}
        exitBoot();
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

  useEffect(() => {
    if (isLoading) return;
    if (!bootMaskPinnedRef.current) return;
    bootMaskPinnedRef.current = false;
    postMaskCommand({ type: 'FYOS_MASK_UNPIN', mode: 'boot' });
  }, [isLoading]);

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
          isSignedIn={Boolean(isSignedIn)}
          canProceed={Boolean(canProceed)}
          onSignIn={() => {
            try { openSignIn({}) } catch { try { window.location.href = '/sign-in'; } catch {} }
          }}
        />
      )}
      <iframe
        ref={iframeRef}
        className={`block absolute inset-0 w-full h-full border-0 opacity-0 will-change-[opacity] transition-opacity duration-[500ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isLoading ? '' : 'opacity-100'}`}
        title="Preview"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
        style={{ backgroundColor: 'white' }}
      />
      <style jsx>{`
        .iframe-ready { opacity: 1; }
      `}</style>
    </div>
  );
}
