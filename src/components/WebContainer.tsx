'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer as WebContainerAPI } from '@webcontainer/api';
import { getFiles } from '../utils/webcontainer-snapshot';
import { useWebContainer } from './WebContainerProvider';

export default function WebContainer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [webcontainerInstance, setWebcontainerInstance] = useState<WebContainerAPI | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const { setInstance } = useWebContainer();

  useEffect(() => {
    let mounted = true;

    const initWebContainer = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setLoadingStage('Booting WebContainer...');

        // Boot WebContainer
        const instance = await WebContainerAPI.boot({
          coep: 'credentialless', 
          workdirName: 'project' 
        });
        
        if (!mounted) return;
        setWebcontainerInstance(instance);
        setInstance(instance);
        
        // Store instance globally for API access
        if (typeof window !== 'undefined') {
          (global as any).webcontainerInstance = instance;
        }
        setLoadingStage('Mounting project files...');

        // Mount files
        const Files = getFiles();
        await instance.mount(Files);
        console.log('WebContainer mounted with file tree');

        setLoadingStage('Installing dependencies...');
        // Use pnpm for faster dependency installation
        const installProcess = await instance.spawn('pnpm', ['install']);
        
        // Stream installation output for better UX
        installProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Install]:', data);
          }
        }));

        const installExitCode = await installProcess.exit;

        if (installExitCode !== 0) {
          throw new Error('Failed to install dependencies');
        }

        setLoadingStage('Starting development server...');
        // Start dev server
        const devProcess = await instance.spawn('pnpm', ['run', 'dev']);
        
        // Stream dev server output
        devProcess.output.pipeTo(new WritableStream({
          write(data) {
            console.log('[WebContainer Dev]:', data);
          }
        }));

        // Wait for server-ready event
        instance.on('server-ready', (port: number, url: string) => {
          console.log(`WebContainer server ready on port ${port}: ${url}`);
          setLoadingStage('Server ready!');
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
          // Small delay to show "Server ready!" message before hiding loader
          setTimeout(() => setIsLoading(false), 500);
        });

      } catch (err) {
        if (mounted) {
          console.error('WebContainer initialization error:', err);
          setError(err instanceof Error ? err.message : 'Failed to initialize WebContainer');
          setIsLoading(false);
        }
      }
    };

    initWebContainer();

    return () => {
      mounted = false;
      setInstance(null);
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-red-50 border border-red-200 rounded-lg">
        <div className="text-center">
          <div className="text-red-600 font-semibold mb-2">WebContainer Error</div>
          <div className="text-red-500 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-white overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <div className="text-gray-600 font-medium">Starting WebContainer...</div>
            <div className="text-gray-500 text-sm mt-1">{loadingStage}</div>
            <div className="text-gray-400 text-xs mt-2">
              Optimized with binary snapshots and pnpm
            </div>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="w-full h-full border-0"
        title="WebContainer Preview"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
      />
    </div>
  );
}
