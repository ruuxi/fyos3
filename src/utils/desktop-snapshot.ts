// Build and restore a portable desktop snapshot (zip + gzip) from the WebContainer FS
// This is separate from the WebContainer binary snapshot used for the initial template mount.

import type { WebContainer as WebContainerAPI } from '@webcontainer/api';
import type { Unzipped } from 'fflate';

// Exclusions mirror src/utils/vfs-persistence.ts
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

type FS = WebContainerAPI['fs'];

async function listFilesRecursive(fs: FS, root = '.'): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (EXCLUDED_DIRS.has(name)) continue;
      const p = dir === '.' ? name : `${dir}/${name}`;
      try {
        await fs.readdir(p);
        await walk(p);
      } catch {
        results.push(p);
      }
    }
  }
  await walk(root);
  return results;
}

function toAbsolute(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // WebCrypto expects BufferSource (ArrayBuffer/ArrayBufferView bound to ArrayBuffer)
  const ab = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function buildDesktopSnapshot(instance: WebContainerAPI): Promise<{
  gz: Uint8Array;
  size: number;
  fileCount: number;
  contentSha256: string;
}> {
  const fs = instance.fs as FS;
  const files = await listFilesRecursive(fs, '.');

  // Build a zip tree of absolute paths
  const fflate = await import('fflate');
  const tree: Record<string, Uint8Array> = {};
  for (const rel of files) {
    try {
      const bytes = await fs.readFile(rel);
      tree[toAbsolute(rel).slice(1)] = bytes; // zip entries shouldn't start with '/'
    } catch {
      // ignore unreadable files
    }
  }

  const zipped = fflate.zipSync(tree, { level: 6 });
  const gz = fflate.gzipSync(zipped, { level: 6 });
  const contentSha256 = await sha256Hex(gz);
  return { gz, size: gz.byteLength, fileCount: Object.keys(tree).length, contentSha256 };
}

export async function restoreDesktopSnapshot(instance: WebContainerAPI, gzBytes: Uint8Array): Promise<void> {
  const fflate = await import('fflate');
  const unz = fflate.gunzipSync(gzBytes);
  const files: Unzipped = fflate.unzipSync(unz);

  // Pre-compute directory set
  const dirSet = new Set<string>();
  const paths = Object.keys(files);
  for (const p of paths) {
    const abs = toAbsolute(p);
    const parts = abs.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc += '/' + parts[i];
      dirSet.add(acc);
    }
  }

  // Create directories shallow-to-deep
  const dirs = Array.from(dirSet).sort((a, b) => a.length - b.length);
  for (const d of dirs) {
    try { await instance.fs.mkdir(d, { recursive: true }); } catch {}
  }

  // Write files
  for (const rel in files) {
    const abs = toAbsolute(rel);
    try {
      await instance.fs.writeFile(abs, files[rel]);
    } catch {
      // ignore write failures
    }
  }
}
