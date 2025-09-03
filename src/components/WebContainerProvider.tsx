'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { WebContainer as WebContainerAPI, FileSystemTree } from '@webcontainer/api';

type SpawnResult = {
  exitCode: number;
  output: string;
};

type WebContainerCtx = {
  instance: WebContainerAPI | null;
  setInstance: (inst: WebContainerAPI | null) => void;
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

  const writeFile = useCallback(async (path: string, content: string) => {
    if (!instance) throw new Error('WebContainer not ready');
    await instance.fs.writeFile(path, content);
  }, [instance]);

  const readFile = useCallback(async (path: string, encoding: 'utf-8' | 'base64' = 'utf-8') => {
    if (!instance) throw new Error('WebContainer not ready');
    const data = await instance.fs.readFile(path);
    if (encoding === 'base64') return btoa(String.fromCharCode(...Array.from(data)));
    return new TextDecoder().decode(data);
  }, [instance]);

  const mkdir = useCallback(async (path: string, recursive = true) => {
    if (!instance) throw new Error('WebContainer not ready');
    if (recursive) {
      await instance.fs.mkdir(path, { recursive: true });
    } else {
      await instance.fs.mkdir(path);
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
    await instance.fs.rm(path, { recursive: opts?.recursive ?? true });
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
    const proc = await instance.spawn(command, args, { cwd: opts?.cwd });
    let output = '';
    const reader = proc.output.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += value;
    }
    const exitCode = await proc.exit;
    return { exitCode, output } as SpawnResult;
  }, [instance]);

  const value = useMemo<WebContainerCtx>(() => ({
    instance,
    setInstance,
    writeFile,
    readFile,
    mkdir,
    readdirRecursive,
    exists,
    remove,
    spawn,
  }), [instance, writeFile, readFile, mkdir, readdirRecursive, exists, remove, spawn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebContainer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWebContainer must be used within WebContainerProvider');
  return ctx;
}
