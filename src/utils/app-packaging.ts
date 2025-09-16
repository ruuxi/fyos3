// Utilities to package an app folder into a tar.gz in-browser using fflate
// This will be used to publish apps to R2 via signed uploads.

import type { WebContainer as WebContainerAPI } from '@webcontainer/api';
import type { Zippable } from 'fflate';

type FS = WebContainerAPI['fs'];

async function readFileAsUint8Array(fs: FS, path: string): Promise<Uint8Array> {
  return fs.readFile(path);
}

async function readText(fs: FS, path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

async function listFilesRecursive(fs: FS, root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
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

export type AppManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  icon?: string;
  entry: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  tags?: string[];
  description?: string;
};

export type PackageResult = {
  tarGz: Uint8Array;
  manifest: AppManifest;
  size: number;
  manifestHash: string;
  depsHash: string;
};

function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.slice().buffer; // ensure ArrayBuffer, not ArrayBufferLike
  return crypto.subtle.digest('SHA-256', input).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

export async function buildAppTarGz(instance: WebContainerAPI, appId: string, manifest: AppManifest): Promise<PackageResult> {
  const fs = instance.fs as FS;
  const appRoot = `/src/apps/${appId}`;
  // Gather files under app root
  const files = await listFilesRecursive(fs, appRoot);

  // Prepare zip tree: use fflate on demand via dynamic import
  const fflate = await import('fflate');
  const tree: Zippable = {};

  // Include app files
  for (const filePath of files) {
    const rel = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    // Exclude secrets
    const base = filePath.split('/').pop() || '';
    if (/^\.env(\..*)?$/.test(base) || /token|secret|api[_-]?key/i.test(base)) {
      continue;
    }
    const data = await readFileAsUint8Array(fs, filePath);
    tree[rel] = data;
  }

  // Try to improve dependency detection by scanning imports in app files
  try {
    const depSet = new Set<string>(Object.keys(manifest.dependencies || {}));
    const importRe = /from\s+["']([^\.\/@][^"']*)["']|require\(\s*["']([^\.\/@][^"']*)["']\s*\)/g;
    for (const filePath of files) {
      if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) continue;
      const txt = await readText(fs, filePath);
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(txt))) {
        const mod = (m[1] || m[2] || '').trim();
        if (!mod) continue;
        // only bare specifiers (no relative/absolute)
        const pkg = mod.split('/')[0];
        if (pkg && !depSet.has(pkg)) depSet.add(pkg);
      }
    }
    // Keep existing versions unknown; installer will only add missing declared deps if present in manifest
    // This scan is informational; we don't auto-pin versions to avoid incorrect guesses.
  } catch {}

  // Add manifest JSON
  const manifestPath = 'app.manifest.json';
  const manifestRel = manifestPath;
  const manifestBytes = fflate.strToU8(JSON.stringify(manifest, null, 2));
  tree[manifestRel] = manifestBytes;

  // Create a zip of the folder, then gzip the zip (tar.gz alternative using zip+gzip)
  // Note: For simplicity and small size, we use zipSync and then gzipSync the zip.
  // If strict tar.gz is required, switch to an actual tar implementation.
  const zipped = fflate.zipSync(tree, { level: 6 });
  const gz = fflate.gzipSync(zipped, { level: 6 });

  const size = gz.byteLength;

  // Hashes
  const manifestHash = await sha256Hex(manifestBytes);
  const depsJson = JSON.stringify({
    dependencies: manifest.dependencies || {},
    peerDependencies: manifest.peerDependencies || {},
    devDependencies: manifest.devDependencies || {},
  });
  const depsHash = await sha256Hex(fflate.strToU8(depsJson));

  return { tarGz: gz, manifest, size, manifestHash, depsHash };
}
