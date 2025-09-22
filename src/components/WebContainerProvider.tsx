'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

type SpawnResult = {
  exitCode: number;
  output: string;
};

type WebContainerCtx = {
  instance: WebContainerAPI | null;
  setInstance: (inst: WebContainerAPI | null) => void;
  depsReady: boolean;
  setDepsReady: (ready: boolean) => void;
  waitForDepsReady: (timeoutMs?: number, intervalMs?: number) => Promise<boolean>;
  // FS helpers
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
  readdirRecursive: (path?: string, maxDepth?: number) => Promise<Array<{ path: string; type: 'file' | 'dir' }>>;
  exists: (path: string) => Promise<boolean>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  // process
  spawn: (command: string, args?: string[], opts?: { cwd?: string }) => Promise<SpawnResult>;
};

const Ctx = createContext<WebContainerCtx | null>(null);

export function WebContainerProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<WebContainerAPI | null>(null);
  const [depsReady, setDepsReady] = useState(false);
  const depsReadyRef = useRef(depsReady);

  useEffect(() => {
    depsReadyRef.current = depsReady;
  }, [depsReady]);

  const waitForDepsReady = useCallback(async (timeoutMs = 45000, intervalMs = 120) => {
    if (depsReadyRef.current) return true;
    const start = Date.now();
    while (!depsReadyRef.current && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return depsReadyRef.current;
  }, []);

  const writeFile = useCallback(async (path: string, content: string) => {
    if (!instance) throw new Error('WebContainer not ready');
    const startTime = Date.now();
    const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
    
    try {
      await instance.fs.writeFile(path, content);
      const duration = Date.now() - startTime;
      if (process.env.NODE_ENV === 'development') {
        // Keep minimal dev log; avoid noisy output in production
        console.debug?.(`📝 [FileOp] WRITE: ${path} (${sizeKB}KB, ${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [FileOp] WRITE FAILED: ${path} (${duration}ms)`, error);
      throw error;
    }
  }, [instance]);

  const readFile = useCallback(async (path: string, encoding: 'utf-8' | 'base64' = 'utf-8') => {
    if (!instance) throw new Error('WebContainer not ready');
    const startTime = Date.now();
    
    try {
      const data = await instance.fs.readFile(path);
      const sizeKB = (data.length / 1024).toFixed(1);
      const duration = Date.now() - startTime;
      if (process.env.NODE_ENV === 'development') {
        console.debug?.(`👁️ [FileOp] READ: ${path} (${sizeKB}KB, ${duration}ms)`);
      }
      
      if (encoding === 'base64') return btoa(String.fromCharCode(...Array.from(data)));
      return new TextDecoder().decode(data);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [FileOp] READ FAILED: ${path} (${duration}ms)`, error);
      throw error;
    }
  }, [instance]);

  const mkdir = useCallback(async (path: string, recursive = true) => {
    if (!instance) throw new Error('WebContainer not ready');
    const startTime = Date.now();
    
    try {
      if (recursive) {
        await instance.fs.mkdir(path, { recursive: true });
      } else {
        await instance.fs.mkdir(path);
      }
      const duration = Date.now() - startTime;
      if (process.env.NODE_ENV === 'development') {
        console.debug?.(`📁 [FileOp] MKDIR: ${path} ${recursive ? '(recursive)' : ''} (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [FileOp] MKDIR FAILED: ${path} (${duration}ms)`, error);
      throw error;
    }
  }, [instance]);

  const exists = useCallback(async (path: string) => {
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
  }, [instance]);

  const remove = useCallback(async (path: string, opts?: { recursive?: boolean }) => {
    if (!instance) throw new Error('WebContainer not ready');
    const startTime = Date.now();
    const isRecursive = opts?.recursive ?? true;

    try {
      await instance.fs.rm(path, { recursive: isRecursive });
      const duration = Date.now() - startTime;
      if (process.env.NODE_ENV === 'development') {
        console.debug?.(`🗑️ [FileOp] REMOVE: ${path} ${isRecursive ? '(recursive)' : ''} (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        if (process.env.NODE_ENV === 'development') {
          console.debug?.(`🗑️ [FileOp] REMOVE: ${path} (missing, treated as no-op) (${duration}ms)`);
        }
        return;
      }
      console.error(`❌ [FileOp] REMOVE FAILED: ${path} (${duration}ms)`, error);
      throw error;
    }
  }, [instance]);

  const readdirRecursive = useCallback(async (root: string = '.', maxDepth: number = 10) => {
    if (!instance) throw new Error('WebContainer not ready');
    const results: Array<{ path: string; type: 'file' | 'dir' }> = [];
    const excluded = new Set(['node_modules', '.pnpm', '.vite', '.git', 'dist', 'build', '.next', 'out', 'coverage']);
    const hardLimit = 1500;

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth) return;
      if (results.length >= hardLimit) return;
      let items: string[] = [];
      try {
        items = await instance!.fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of items) {
        if (excluded.has(name)) continue;
        const p = dir === '.' ? name : `${dir}/${name}`;
        // try to read as directory first
        try {
          await instance!.fs.readdir(p);
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
  }, [instance]);

  const spawn = useCallback(async (command: string, args: string[] = [], opts?: { cwd?: string }) => {
    if (!instance) throw new Error('WebContainer not ready');
    const startTime = Date.now();
    const fullCommand = `${command} ${args.join(' ')}`.trim();
    const cwd = opts?.cwd || '.';

    try {
      if (!depsReadyRef.current) {
        const shouldGate = (() => {
          const cmdLower = (command || '').toLowerCase();
          if (!cmdLower) return false;
          return /^(pnpm|npm|yarn|bun|node|npx|tsc|eslint|next|vite|vitest)$/.test(cmdLower);
        })();
        if (shouldGate) {
          const ready = await waitForDepsReady();
          if (!ready) {
            throw new Error('WebContainer dependencies are still installing. Try again shortly.');
          }
        }
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug?.(`⚡ [FileOp] SPAWN: ${fullCommand} (cwd: ${cwd})`);
      }
      const proc = await instance.spawn(command, args, { cwd: opts?.cwd });
      let output = '';
      const reader = proc.output.getReader();
      const decoder = new TextDecoder();

      // Read output concurrently, but don’t block exit if the stream misbehaves
      const readLoop = (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (typeof value === 'string') {
              output += value;
            } else if (value) {
              output += decoder.decode(value as Uint8Array, { stream: true });
            }
          }
        } catch {
          // Ignore read cancellation/errors; we still return what we have
        }
      })();

      const exitCode = await proc.exit;
      // Ensure we don’t hang if the output stream doesn’t close cleanly
      try { await reader.cancel(); } catch {}
      try { await readLoop; } catch {}
      const duration = Date.now() - startTime;
      
      if (process.env.NODE_ENV === 'development') {
        if (exitCode === 0) {
          console.debug?.(`✅ [FileOp] SPAWN SUCCESS: ${fullCommand} (${duration}ms, exit: ${exitCode})`);
        } else {
          console.warn(`⚠️ [FileOp] SPAWN WARNING: ${fullCommand} (${duration}ms, exit: ${exitCode})`);
        }
      }
      
      return { exitCode, output } as SpawnResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [FileOp] SPAWN FAILED: ${fullCommand} (${duration}ms)`, error);
      throw error;
    }
  }, [instance, waitForDepsReady]);

  const value = useMemo<WebContainerCtx>(() => ({
    instance,
    setInstance,
    depsReady,
    setDepsReady,
    waitForDepsReady,
    writeFile,
    readFile,
    mkdir,
    readdirRecursive,
    exists,
    remove,
    spawn,
  }), [instance, depsReady, writeFile, readFile, mkdir, readdirRecursive, exists, remove, spawn, waitForDepsReady]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebContainer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWebContainer must be used within WebContainerProvider');
  return ctx;
}
