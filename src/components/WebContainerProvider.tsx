'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useEffect } from 'react';
import type { WebContainer as WebContainerAPI, FileSystemTree } from '@webcontainer/api';
import { 
  WebContainerOrchestrator, 
  ContainerInstance,
  type ContainerConfig,
  type ContainerMetrics
} from '@/services/WebContainerOrchestrator';

type SpawnResult = {
  exitCode: number;
  output: string;
};

type WebContainerCtx = {
  // Legacy support - returns default container
  instance: WebContainerAPI | null;
  setInstance: (inst: WebContainerAPI | null) => void;
  
  // New orchestrator-based API
  orchestrator: WebContainerOrchestrator;
  getContainer: (appId?: string) => ContainerInstance | undefined;
  createApp: (config: ContainerConfig) => Promise<ContainerInstance>;
  suspendApp: (appId: string) => Promise<void>;
  resumeApp: (appId: string) => Promise<ContainerInstance | null>;
  terminateApp: (appId: string) => Promise<void>;
  getAppMetrics: () => ContainerMetrics[];
  
  // App-aware file system helpers
  writeFile: (path: string, content: string, appId?: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64', appId?: string) => Promise<string>;
  mkdir: (path: string, recursive?: boolean, appId?: string) => Promise<void>;
  readdirRecursive: (path?: string, maxDepth?: number, appId?: string) => Promise<Array<{ path: string; type: 'file' | 'dir' }>>;
  exists: (path: string, appId?: string) => Promise<boolean>;
  remove: (path: string, opts?: { recursive?: boolean }, appId?: string) => Promise<void>;
  
  // Process execution
  spawn: (command: string, args?: string[], opts?: { cwd?: string; appId?: string }) => Promise<SpawnResult>;
};

const Ctx = createContext<WebContainerCtx | null>(null);

export function WebContainerProvider({ children }: { children: React.ReactNode }) {
  const orchestratorRef = useRef<WebContainerOrchestrator>(new WebContainerOrchestrator({
    maxContainers: 10,
    maxMemoryMB: 2048
  }));
  
  // Get the WebContainer instance for a specific app (or default)
  const getContainerInstance = useCallback((appId?: string): WebContainerAPI | null => {
    const container = appId 
      ? orchestratorRef.current.getContainer(appId)
      : orchestratorRef.current.getDefaultContainer();
    return container?.container || null;
  }, []);

  // Legacy setInstance for backward compatibility
  const setInstance = useCallback((inst: WebContainerAPI | null) => {
    // This is now a no-op as containers are managed by orchestrator
    console.warn('setInstance is deprecated. Use createApp instead.');
  }, []);

  // Get container wrapper
  const getContainer = useCallback((appId?: string): ContainerInstance | undefined => {
    return appId 
      ? orchestratorRef.current.getContainer(appId)
      : orchestratorRef.current.getDefaultContainer();
  }, []);

  // Create a new application container
  const createApp = useCallback(async (config: ContainerConfig): Promise<ContainerInstance> => {
    return orchestratorRef.current.createApplication(config);
  }, []);

  // Suspend an application
  const suspendApp = useCallback(async (appId: string): Promise<void> => {
    await orchestratorRef.current.suspendApplication(appId);
  }, []);

  // Resume an application
  const resumeApp = useCallback(async (appId: string): Promise<ContainerInstance | null> => {
    return orchestratorRef.current.resumeApplication(appId);
  }, []);

  // Terminate an application
  const terminateApp = useCallback(async (appId: string): Promise<void> => {
    await orchestratorRef.current.terminateApplication(appId);
  }, []);

  // Get metrics for all applications
  const getAppMetrics = useCallback((): ContainerMetrics[] => {
    return orchestratorRef.current.getMetrics().containers;
  }, []);

  // File system operations with app awareness
  const writeFile = useCallback(async (path: string, content: string, appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${appId || 'default'}`);
    await instance.fs.writeFile(path, content);
  }, [getContainerInstance]);

  const readFile = useCallback(async (path: string, encoding: 'utf-8' | 'base64' = 'utf-8', appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${appId || 'default'}`);
    const data = await instance.fs.readFile(path);
    if (encoding === 'base64') return btoa(String.fromCharCode(...Array.from(data)));
    return new TextDecoder().decode(data);
  }, [getContainerInstance]);

  const mkdir = useCallback(async (path: string, recursive = true, appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${appId || 'default'}`);
    if (recursive) {
      await instance.fs.mkdir(path, { recursive: true });
    } else {
      await instance.fs.mkdir(path);
    }
  }, [getContainerInstance]);

  const exists = useCallback(async (path: string, appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) return false;
    try {
      await instance.fs.readdir(path);
      return true;
    } catch {
      try {
        await instance.fs.readFile(path);
        return true;
      } catch {
        return false;
      }
    }
  }, [getContainerInstance]);

  const remove = useCallback(async (path: string, opts?: { recursive?: boolean }, appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${appId || 'default'}`);
    await instance.fs.rm(path, { recursive: opts?.recursive ?? true });
  }, [getContainerInstance]);

  const readdirRecursive = useCallback(async (root: string = '.', maxDepth: number = 10, appId?: string) => {
    const instance = getContainerInstance(appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${appId || 'default'}`);
    
    const results: Array<{ path: string; type: 'file' | 'dir' }> = [];
    const excluded = new Set(['node_modules', '.pnpm', '.vite', '.git', 'dist', 'build', '.next', 'out', 'coverage']);
    const hardLimit = 1500;

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth) return;
      if (results.length >= hardLimit) return;
      let items: string[] = [];
      try {
        items = await instance.fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of items) {
        if (excluded.has(name)) continue;
        const p = dir === '.' ? name : `${dir}/${name}`;
        // try to read as directory first
        try {
          await instance.fs.readdir(p);
          results.push({ path: p, type: 'dir' });
          await walk(p, depth + 1);
          continue;
        } catch {}
        // else file
        results.push({ path: p, type: 'file' });
        if (results.length >= hardLimit) return;
      }
    }

    await walk(root, 0);
    return results;
  }, [getContainerInstance]);

  const spawn = useCallback(async (
    command: string, 
    args: string[] = [], 
    opts?: { cwd?: string; appId?: string }
  ) => {
    const instance = getContainerInstance(opts?.appId);
    if (!instance) throw new Error(`WebContainer not ready for app: ${opts?.appId || 'default'}`);
    
    const proc = await instance.spawn(command, args, { cwd: opts?.cwd });
    let output = '';
    const reader = proc.output.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === 'string') {
        output += value;
      } else if (value) {
        // value is likely a Uint8Array from the stream
        output += decoder.decode(value as Uint8Array, { stream: true });
      }
    }
    const exitCode = await proc.exit;
    return { exitCode, output } as SpawnResult;
  }, [getContainerInstance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Shutdown orchestrator when provider unmounts
      orchestratorRef.current.shutdown().catch(console.error);
    };
  }, []);

  // Listen for orchestrator events
  useEffect(() => {
    const orchestrator = orchestratorRef.current;
    
    const handleContainerError = ({ appId, error }: { appId: string; error: Error }) => {
      console.error(`[Provider] Container error for app ${appId}:`, error);
    };

    const handleContainerSuspended = (appId: string) => {
      console.log(`[Provider] Container suspended: ${appId}`);
    };

    orchestrator.on('container-error', handleContainerError);
    orchestrator.on('container-suspended', handleContainerSuspended);

    return () => {
      orchestrator.off('container-error', handleContainerError);
      orchestrator.off('container-suspended', handleContainerSuspended);
    };
  }, []);

  const value = useMemo<WebContainerCtx>(() => ({
    // Legacy support
    instance: getContainerInstance(),
    setInstance,
    
    // Orchestrator API
    orchestrator: orchestratorRef.current,
    getContainer,
    createApp,
    suspendApp,
    resumeApp,
    terminateApp,
    getAppMetrics,
    
    // File system operations
    writeFile,
    readFile,
    mkdir,
    readdirRecursive,
    exists,
    remove,
    
    // Process operations
    spawn,
  }), [
    getContainerInstance,
    setInstance,
    getContainer,
    createApp,
    suspendApp,
    resumeApp,
    terminateApp,
    getAppMetrics,
    writeFile,
    readFile,
    mkdir,
    readdirRecursive,
    exists,
    remove,
    spawn
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebContainer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWebContainer must be used within WebContainerProvider');
  return ctx;
}

// Hook for app-specific container access
export function useAppContainer(appId: string) {
  const { getContainer, createApp } = useWebContainer();
  
  const ensureContainer = useCallback(async () => {
    let container = getContainer(appId);
    if (!container) {
      container = await createApp({
        appId,
        displayName: appId,
        autoSuspend: true,
        suspendAfterMs: 5 * 60 * 1000, // 5 minutes
      });
    }
    return container;
  }, [appId, getContainer, createApp]);

  return {
    getContainer: () => getContainer(appId),
    ensureContainer,
  };
}