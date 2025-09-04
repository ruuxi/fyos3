'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useWebContainer, useAppContainer } from './WebContainerProvider';
import BootScreen from './BootScreen';
import { multiAppPersistence, autoSaveManager } from '@/utils/multi-app-persistence';
import type { ContainerInstance } from '@/services/WebContainerOrchestrator';

interface WebContainerProps {
  appId?: string;
  displayName?: string;
  onReady?: (container: ContainerInstance) => void;
  onError?: (error: Error) => void;
  className?: string;
  autoSuspend?: boolean;
  suspendAfterMs?: number;
  mountSnapshot?: boolean; // Whether to mount default snapshot
}

export default function WebContainer({
  appId = 'default',
  displayName,
  onReady,
  onError,
  className = '',
  autoSuspend = true,
  suspendAfterMs = 5 * 60 * 1000,
  mountSnapshot = true,
}: WebContainerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [containerInstance, setContainerInstance] = useState<ContainerInstance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing…');
  const [progress, setProgress] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  
  const { createApp, getContainer } = useWebContainer();
  const { ensureContainer } = useAppContainer(appId);

  const initContainer = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setLoadingStage('Waking up…');
      setProgress(8);

      // Check if container already exists
      let container = getContainer(appId);
      
      if (!container) {
        setLoadingStage('Creating container…');
        setProgress(15);
        
        // Create new container
        container = await createApp({
          appId,
          displayName: displayName || appId,
          autoSuspend,
          suspendAfterMs,
        });
      } else if (container.state === 'suspended') {
        setLoadingStage('Resuming container…');
        await container.resume();
      }

      setContainerInstance(container);
      setProgress(25);

      // Get the actual WebContainer instance
      const webcontainer = container.container;
      if (!webcontainer) {
        throw new Error('WebContainer instance not available');
      }

      setLoadingStage('Preparing workspace…');
      setProgress(35);

      // Check if we should restore from persisted VFS or mount snapshot
      const hasSavedState = await multiAppPersistence.hasAppState(appId);
      
      if (hasSavedState) {
        setLoadingStage('Restoring your workspace…');
        setProgress(40);
        
        const vfs = await multiAppPersistence.loadAppState(appId);
        if (vfs) {
          const { restoreAppVfs } = await import('@/utils/multi-app-persistence');
          const restored = await restoreAppVfs(webcontainer, vfs);
          if (restored) {
            console.log(`[WebContainer ${appId}] Restored from persisted VFS`);
          }
        }
      } else if (mountSnapshot) {
        setLoadingStage('Loading template…');
        setProgress(40);
        
        // Mount default snapshot for new containers
        const snapshotResponse = await fetch('/api/webcontainer-snapshot');
        if (!snapshotResponse.ok) {
          console.warn('Binary snapshot not available. Starting with empty container.');
        } else {
          const snapshot = await snapshotResponse.arrayBuffer();
          await webcontainer.mount(snapshot);
          console.log(`[WebContainer ${appId}] Mounted default snapshot`);
        }
      }

      setLoadingStage('Installing dependencies…');
      setProgress(50);

      // Install dependencies
      const installProcess = await webcontainer.spawn('pnpm', ['install']);
      
      // Stream installation output
      installProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log(`[WebContainer ${appId} Install]:`, data);
          setProgress((prev) => Math.min(prev + 0.5, 70));
        }
      }));

      const installExitCode = await installProcess.exit;
      if (installExitCode !== 0) {
        console.warn(`[WebContainer ${appId}] Install exited with code ${installExitCode}`);
      }

      setLoadingStage('Starting development server…');
      setProgress(75);

      // Start dev server
      const devProcess = await webcontainer.spawn('pnpm', ['run', 'dev']);
      
      // Stream dev server output
      devProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log(`[WebContainer ${appId} Dev]:`, data);
          setProgress((prev) => Math.min(prev + 0.2, 88));
        }
      }));

      // Wait for server-ready event
      const handleServerReady = ({ port, url }: { port: number; url: string }) => {
        console.log(`[WebContainer ${appId}] Server ready on port ${port}: ${url}`);
        setLoadingStage('Final touches…');
        setProgress(92);
        setServerUrl(url);
        
        if (iframeRef.current) {
          iframeRef.current.src = url;
        }
      };

      // Listen for server ready
      container.once('server-ready', handleServerReady);

      // Setup auto-save
      const saveInterval = setInterval(async () => {
        if (container && container.container) {
          autoSaveManager.enqueue(appId, container.container, displayName);
        }
      }, 30000); // Auto-save every 30 seconds

      // Setup FCP detection
      const handleMessage = (event: MessageEvent) => {
        if (!iframeRef.current) return;
        
        try {
          const iframeOrigin = new URL(iframeRef.current.src).origin;
          if (event.origin !== iframeOrigin) return;
        } catch {}

        if (event.data?.type === 'webcontainer:fcp') {
          setProgress(100);
          setLoadingStage('Ready!');
          setTimeout(() => {
            setIsLoading(false);
            if (onReady) onReady(container!);
          }, 300);
        }
      };

      window.addEventListener('message', handleMessage);

      // Cleanup function
      return () => {
        window.removeEventListener('message', handleMessage);
        clearInterval(saveInterval);
        container?.off('server-ready', handleServerReady);
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[WebContainer ${appId}] Error:`, err);
      setError(errorMessage);
      setIsLoading(false);
      if (onError) onError(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [appId, displayName, autoSuspend, suspendAfterMs, mountSnapshot, createApp, getContainer, onReady, onError]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    initContainer().then(cleanupFn => {
      cleanup = cleanupFn;
    });

    return () => {
      if (cleanup) cleanup();
      
      // Save state on unmount
      if (containerInstance?.container) {
        autoSaveManager.saveNow(appId, containerInstance.container, displayName).catch(console.error);
      }
    };
  }, [appId, initContainer, containerInstance, displayName]);

  // Handle visibility changes for auto-save
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && containerInstance?.container) {
        autoSaveManager.saveNow(appId, containerInstance.container, displayName).catch(console.error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [appId, containerInstance, displayName]);

  // Handle before unload for auto-save
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (containerInstance?.container) {
        // Try to save synchronously (best effort)
        const { exportAppVfs } = require('@/utils/multi-app-persistence');
        exportAppVfs(containerInstance.container).then(vfs => {
          multiAppPersistence.saveAppState(appId, vfs, displayName);
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [appId, containerInstance, displayName]);

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center h-full bg-black text-white ${className}`}>
        <div className="text-xl mb-4">⚠️ Container Error</div>
        <div className="text-sm text-gray-400 max-w-md text-center">{error}</div>
        <button
          onClick={() => {
            setError(null);
            initContainer();
          }}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <BootScreen
        message={loadingStage}
        progress={progress}
        complete={!isLoading}
        onExited={() => {
          // Optional: any cleanup after boot screen exits
        }}
      />
      <div className={`w-full h-full ${isLoading ? 'invisible' : 'visible'} ${className}`}>
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          allow="cross-origin-isolated"
          sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
          title={`WebContainer App: ${displayName || appId}`}
        />
      </div>
    </>
  );
}

// Legacy default export for backward compatibility
export function DefaultWebContainer() {
  return <WebContainer appId="default" displayName="Default Application" />;
}