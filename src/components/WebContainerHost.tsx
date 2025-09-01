'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { files } from '@/lib/webcontainer-files';

// Import xterm CSS
import '@xterm/xterm/css/xterm.css';

interface WebContainerHostProps {
  className?: string;
}

export default function WebContainerHost({ className = '' }: WebContainerHostProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState('Initializing WebContainer...');

  useEffect(() => {
    let mounted = true;

    async function initWebContainer() {
      try {
        setStatus('Booting WebContainer...');
        
        // Boot WebContainer
        const webcontainerInstance = await WebContainer.boot();
        webcontainerRef.current = webcontainerInstance;

        if (!mounted) return;

        setStatus('Mounting files...');
        
        // Mount files
        await webcontainerInstance.mount(files);

        // Set up terminal
        const fitAddon = new FitAddon();
        const terminal = new Terminal({
          convertEol: true,
          theme: {
            background: '#1a1a1a',
            foreground: '#ffffff',
            cursor: '#ffffff',
          },
        });

        terminal.loadAddon(fitAddon);
        
        if (terminalRef.current) {
          terminal.open(terminalRef.current);
          fitAddon.fit();
          terminalInstanceRef.current = terminal;
        }

        if (!mounted) return;

        setStatus('Installing dependencies...');
        
        // Install dependencies
        const installProcess = await webcontainerInstance.spawn('npm', ['install']);
        installProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              terminal.write(data);
            },
          })
        );

        const exitCode = await installProcess.exit;
        if (exitCode !== 0) {
          throw new Error('Installation failed');
        }

        if (!mounted) return;

        setStatus('Starting development server...');

        // Start dev server
        const serverProcess = await webcontainerInstance.spawn('npm', ['run', 'start']);
        serverProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              terminal.write(data);
            },
          })
        );

        // Listen for server ready event
        webcontainerInstance.on('server-ready', (port, url) => {
          if (iframeRef.current && mounted) {
            iframeRef.current.src = url;
            setIsLoading(false);
            setStatus('Ready!');
          }
        });

        // Start shell for interactive use
        const shellProcess = await webcontainerInstance.spawn('jsh');
        shellProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              terminal.write(data);
            },
          })
        );

        // Handle terminal input
        terminal.onData((data) => {
          shellProcess.input.getWriter().write(data);
        });

      } catch (error) {
        console.error('WebContainer initialization failed:', error);
        setStatus('Failed to initialize WebContainer');
        setIsLoading(false);
      }
    }

    initWebContainer();

    return () => {
      mounted = false;
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
      }
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (terminalInstanceRef.current) {
        const fitAddon = new FitAddon();
        terminalInstanceRef.current.loadAddon(fitAddon);
        fitAddon.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`w-full h-screen flex flex-col ${className}`}>
      {/* Header */}
      <div className="bg-gray-900 text-white p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">WebContainer Environment</h1>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400' : 'bg-green-400'}`}></div>
            <span className="text-sm text-gray-300">{status}</span>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex">
        {/* Application preview */}
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-800 text-white px-4 py-2 text-sm border-b border-gray-700">
            Application Preview
          </div>
          <div className="flex-1 relative">
            {isLoading && (
              <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">{status}</p>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              className="w-full h-full border-0"
              title="WebContainer Application"
            />
          </div>
        </div>

        {/* Terminal */}
        <div className="w-1/2 flex flex-col border-l border-gray-700">
          <div className="bg-gray-800 text-white px-4 py-2 text-sm border-b border-gray-700">
            Terminal
          </div>
          <div 
            ref={terminalRef} 
            className="flex-1 bg-gray-900"
            style={{ minHeight: '200px' }}
          />
        </div>
      </div>
    </div>
  );
}
