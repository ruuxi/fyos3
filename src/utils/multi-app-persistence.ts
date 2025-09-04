import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

export type PersistedVfs = {
  version: 1;
  savedAt: number;
  files: Array<{ path: string; base64: string }>;
};

export interface AppMetadata {
  appId: string;
  displayName: string;
  savedAt: number;
  fileCount: number;
  sizeBytes: number;
}

const DB_NAME = 'fyos-multi-app';
const DB_VERSION = 1;
const VFS_STORE = 'vfs';
const METADATA_STORE = 'metadata';

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

class MultiAppPersistence {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDb();
    }
    return this.dbPromise;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      
      req.onupgradeneeded = () => {
        const db = req.result;
        
        // Create VFS store if it doesn't exist
        if (!db.objectStoreNames.contains(VFS_STORE)) {
          db.createObjectStore(VFS_STORE, { keyPath: 'appId' });
        }
        
        // Create metadata store if it doesn't exist
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const metadataStore = db.createObjectStore(METADATA_STORE, { keyPath: 'appId' });
          metadataStore.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
      
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
  }

  async saveAppState(appId: string, vfs: PersistedVfs, displayName?: string): Promise<void> {
    const db = await this.getDb();
    
    // Calculate size
    let sizeBytes = 0;
    for (const file of vfs.files) {
      sizeBytes += file.base64.length;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction([VFS_STORE, METADATA_STORE], 'readwrite');
      
      // Save VFS data
      const vfsStore = tx.objectStore(VFS_STORE);
      const vfsReq = vfsStore.put({ appId, ...vfs });
      
      // Save metadata
      const metadataStore = tx.objectStore(METADATA_STORE);
      const metadata: AppMetadata = {
        appId,
        displayName: displayName || appId,
        savedAt: vfs.savedAt,
        fileCount: vfs.files.length,
        sizeBytes,
      };
      const metaReq = metadataStore.put(metadata);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save app state'));
    });
  }

  async loadAppState(appId: string): Promise<PersistedVfs | null> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VFS_STORE, 'readonly');
      const store = tx.objectStore(VFS_STORE);
      const req = store.get(appId);
      
      req.onsuccess = () => {
        const result = req.result;
        if (!result) {
          resolve(null);
        } else {
          const { appId: _, ...vfs } = result;
          resolve(vfs as PersistedVfs);
        }
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to load app state'));
    });
  }

  async hasAppState(appId: string): Promise<boolean> {
    const state = await this.loadAppState(appId);
    return state !== null && state.files.length > 0;
  }

  async deleteAppState(appId: string): Promise<void> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction([VFS_STORE, METADATA_STORE], 'readwrite');
      
      // Delete from both stores
      tx.objectStore(VFS_STORE).delete(appId);
      tx.objectStore(METADATA_STORE).delete(appId);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete app state'));
    });
  }

  async listApps(): Promise<AppMetadata[]> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const req = store.getAll();
      
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error ?? new Error('Failed to list apps'));
    });
  }

  async getAppMetadata(appId: string): Promise<AppMetadata | null> {
    const db = await this.getDb();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const req = store.get(appId);
      
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error ?? new Error('Failed to get app metadata'));
    });
  }

  async pruneOldApps(daysOld: number): Promise<number> {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const apps = await this.listApps();
    
    let deletedCount = 0;
    for (const app of apps) {
      if (app.savedAt < cutoffTime) {
        await this.deleteAppState(app.appId);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }

  async getTotalStorageUsage(): Promise<{ apps: number; totalSizeBytes: number }> {
    const apps = await this.listApps();
    const totalSizeBytes = apps.reduce((sum, app) => sum + app.sizeBytes, 0);
    return { apps: apps.length, totalSizeBytes };
  }
}

// Helper functions for VFS operations
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

async function walkFiles(
  instance: WebContainerAPI, 
  root: string, 
  files: string[], 
  maxDepth: number, 
  depth: number
): Promise<void> {
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

export async function exportAppVfs(
  instance: WebContainerAPI, 
  opts?: { maxDepth?: number; fileLimit?: number }
): Promise<PersistedVfs> {
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
  
  return { version: 1, savedAt: Date.now(), files };
}

export async function restoreAppVfs(
  instance: WebContainerAPI, 
  vfs: PersistedVfs
): Promise<boolean> {
  try {
    // Recreate directories and files
    const dirs = new Set<string>();
    for (const file of vfs.files) {
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
    for (const f of vfs.files) {
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

// Debounced auto-save functionality
class AutoSaveManager {
  private timers = new Map<string, NodeJS.Timeout>();
  private persistence = new MultiAppPersistence();
  private readonly DEBOUNCE_MS = 1000;

  enqueue(appId: string, instance: WebContainerAPI, displayName?: string): void {
    // Clear existing timer
    const existingTimer = this.timers.get(appId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      try {
        const vfs = await exportAppVfs(instance);
        await this.persistence.saveAppState(appId, vfs, displayName);
        console.log(`[AutoSave] Saved state for app: ${appId}`);
      } catch (error) {
        console.error(`[AutoSave] Failed to save app ${appId}:`, error);
      }
      this.timers.delete(appId);
    }, this.DEBOUNCE_MS);

    this.timers.set(appId, timer);
  }

  async saveNow(appId: string, instance: WebContainerAPI, displayName?: string): Promise<void> {
    // Cancel pending save
    const existingTimer = this.timers.get(appId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(appId);
    }

    // Save immediately
    const vfs = await exportAppVfs(instance);
    await this.persistence.saveAppState(appId, vfs, displayName);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

// Export singleton instances
export const multiAppPersistence = new MultiAppPersistence();
export const autoSaveManager = new AutoSaveManager();