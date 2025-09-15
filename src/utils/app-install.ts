import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

type FS = WebContainerAPI['fs'];

async function ensureDir(fs: FS, dir: string) {
  try { await fs.mkdir(dir, { recursive: true } as any); } catch {}
}

async function writeFile(fs: FS, path: string, data: Uint8Array | string) {
  if (typeof data === 'string') {
    await fs.writeFile(path, data);
  } else {
    await fs.writeFile(path, data);
  }
}

async function readJSON<T>(fs: FS, path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf8' as any);
    const s = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as any);
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function installAppFromBundle(instance: WebContainerAPI, bundleBytes: Uint8Array) {
  const fs = instance.fs as FS;
  // Our bundle format is gzip(zip(files...)) per packaging util
  const fflate = await import('fflate');
  const unGz = fflate.gunzipSync(bundleBytes);
  const files = fflate.unzipSync(unGz);

  // Find manifest first
  const manifestEntry = files['app.manifest.json'];
  if (!manifestEntry) throw new Error('Invalid bundle: missing app.manifest.json');
  const manifestText = fflate.strFromU8(manifestEntry);
  const manifest = JSON.parse(manifestText) as {
    id: string; name: string; icon?: string; entry: string;
    dependencies?: Record<string,string>; peerDependencies?: Record<string,string>; devDependencies?: Record<string,string>;
  };

  // Resolve target path and handle duplicate ids
  let targetId = manifest.id;
  const registryPath = '/public/apps/registry.json';
  let registry: Array<{ id: string; name: string; icon?: string; path: string }> = [];
  const existing = await readJSON<typeof registry>(fs, registryPath);
  if (existing) registry = existing;
  const existingIds = new Set(registry.map(r => r.id));
  let counter = 1;
  while (existingIds.has(targetId)) {
    targetId = `${manifest.id}-${counter++}`;
  }

  const appBase = `/src/apps/${targetId}`;
  await ensureDir(fs, appBase);

  // Write files under src/apps/<id> without duplicating nested <id>/<id>
  for (const [name, content] of Object.entries(files)) {
    if (name === 'app.manifest.json') continue;
    let fullPath: string;
    const exactPrefix = `src/apps/${manifest.id}/`;
    if (name.startsWith(exactPrefix)) {
      const rest = name.slice(exactPrefix.length);
      fullPath = `/src/apps/${targetId}/${rest}`;
    } else if (name.startsWith('src/apps/')) {
      const rest = name.slice('src/apps/'.length);
      fullPath = `/src/apps/${targetId}/${rest}`;
    } else {
      fullPath = `/${name}`;
    }
    const dir = fullPath.split('/').slice(0, -1).join('/');
    await ensureDir(fs, dir);
    await writeFile(fs, fullPath, content as Uint8Array);
  }

  // Update registry
  const entry = { id: targetId, name: manifest.name, icon: manifest.icon || '📦', path: manifest.entry.replace(`/src/apps/${manifest.id}/`, `/src/apps/${targetId}/`) };
  const nextReg = [...registry, entry];
  await writeFile(fs, registryPath, JSON.stringify(nextReg, null, 2));

  // Compute delta dependencies and install missing
  const pkgRaw = await fs.readFile('/package.json', 'utf8' as any);
  const pkg = JSON.parse(typeof pkgRaw === 'string' ? pkgRaw : new TextDecoder().decode(pkgRaw as any));
  const have: Record<string,string> = { ...(pkg.dependencies||{}), ...(pkg.devDependencies||{}) };
  const need = manifest.dependencies || {};
  const missing: string[] = [];
  for (const [dep, ver] of Object.entries(need)) {
    if (!have[dep]) missing.push(`${dep}@${ver}`);
  }
  if (missing.length > 0) {
    const proc = await instance.spawn('pnpm', ['add', ...missing, '--reporter', 'silent', '--color=false']);
    const exit = await proc.exit;
    if (exit !== 0) {
      throw new Error(`pnpm add failed for: ${missing.join(', ')}`);
    }
  }

  // Auto-open removed; the app will appear in registry and can be launched by the user

  return { id: targetId, entry };
}


