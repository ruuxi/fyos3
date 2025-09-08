import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

type PersistedVfs = {
  version: number;
  savedAt: number;
  files: Array<{ path: string; base64: string }>;
};

const DB_NAME = 'fyos-webcontainer';
const DB_VERSION = 1;
const STORE_NAME = 'vfs';
const STORE_KEY = 'current';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.pnpm',
  '.vite',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  'pnpm-store',
  'tmp',
]);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function idbGet<T>(key: IDBValidKey): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get error'));
  });
}

async function idbSet<T>(key: IDBValidKey, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value as any, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put error'));
  });
}

async function idbDel(key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete error'));
  });
}

export async function hasPersistedVfs(): Promise<boolean> {
  try {
    const data = await idbGet<PersistedVfs>(STORE_KEY);
    return !!(data && data.version === CURRENT_VFS_VERSION && data.files && data.files.length > 0);
  } catch {
    return false;
  }
}

export async function loadPersistedVfsMeta(): Promise<{ fileCount: number; savedAt: number } | null> {
  try {
    const data = await idbGet<PersistedVfs>(STORE_KEY);
    if (!data || data.version !== CURRENT_VFS_VERSION) return null;
    return { fileCount: data.files.length, savedAt: data.savedAt };
  } catch {
    return null;
  }
}

export async function clearPersistedVfs(): Promise<void> {
  try {
    await idbDel(STORE_KEY);
  } catch {
    // ignore
  }
}

function toBase64(buffer: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as unknown as number[]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function walkFiles(instance: WebContainerAPI, root: string, files: string[], maxDepth: number, depth: number): Promise<void> {
  if (depth > maxDepth) return;
  let entries: string[] = [];
  try {
    entries = await instance.fs.readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (EXCLUDED_DIRS.has(name)) continue;
    const p = root === '.' ? name : `${root}/${name}`;
    // Check if directory
    let isDir = false;
    try {
      await instance.fs.readdir(p);
      isDir = true;
    } catch {
      isDir = false;
    }
    if (isDir) {
      await walkFiles(instance, p, files, maxDepth, depth + 1);
    } else {
      files.push(p);
    }
  }
}

export async function exportVfs(instance: WebContainerAPI, opts?: { maxDepth?: number; fileLimit?: number }): Promise<PersistedVfs> {
  const maxDepth = opts?.maxDepth ?? 12;
  const fileLimit = opts?.fileLimit ?? 2000;
  const paths: string[] = [];
  await walkFiles(instance, '.', paths, maxDepth, 0);
  const limited = paths.slice(0, fileLimit);
  const files: Array<{ path: string; base64: string }> = [];
  for (const p of limited) {
    try {
      const buf = await instance.fs.readFile(p);
      files.push({ path: p, base64: toBase64(buf as unknown as Uint8Array) });
    } catch {
      // ignore
    }
  }
  return { version: CURRENT_VFS_VERSION, savedAt: Date.now(), files };
}

export async function persistNow(instance: WebContainerAPI): Promise<void> {
  const data = await exportVfs(instance);
  await idbSet(STORE_KEY, data);
}

let debounceTimer: number | null = null;
let lastQueuedAt = 0;
const DEBOUNCE_MS = 1000;

export function enqueuePersist(instance: WebContainerAPI) {
  lastQueuedAt = Date.now();
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = (setTimeout(async () => {
    try {
      await persistNow(instance);
    } catch {
      // ignore
    }
    debounceTimer = null;
  }, DEBOUNCE_MS) as unknown) as number;
}

export async function restoreFromPersistence(instance: WebContainerAPI): Promise<boolean> {
  try {
    const data = await idbGet<PersistedVfs>(STORE_KEY);
    if (!data || data.version !== CURRENT_VFS_VERSION || !data.files || data.files.length === 0) return false;
    // Recreate directories and files
    const dirs = new Set<string>();
    for (const file of data.files) {
      const parts = file.path.split('/');
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          const d = parts.slice(0, i).join('/') || '.';
          if (d !== '.') dirs.add(d);
        }
      }
    }
    // Create directories (shallow to deep)
    const sortedDirs = Array.from(dirs).sort((a, b) => a.length - b.length);
    for (const d of sortedDirs) {
      try {
        await instance.fs.mkdir(d, { recursive: true });
      } catch {
        // ignore
      }
    }
    // Write files
    for (const f of data.files) {
      try {
        const content = fromBase64(f.base64);
        await instance.fs.writeFile(f.path, content as unknown as Uint8Array);
      } catch {
        // ignore
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Increment to invalidate stale persisted VFS snapshots when templates change in a breaking way.
export const CURRENT_VFS_VERSION = 2;


