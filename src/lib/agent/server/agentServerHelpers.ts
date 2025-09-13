import { promises as fs } from 'fs';
import path from 'path';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';

export async function getInstalledAppNames(): Promise<string[]> {
  try {
    const regPath = path.join(process.cwd(), 'public', 'apps', 'registry.json');
    const buf = await fs.readFile(regPath, 'utf-8');
    const data = JSON.parse(buf);
    if (Array.isArray(data)) {
      return data.map((x: any) => (typeof x?.name === 'string' ? x.name : undefined)).filter(Boolean);
    }
    if (Array.isArray(data?.apps)) {
      return data.apps.map((x: any) => (typeof x?.name === 'string' ? x.name : undefined)).filter(Boolean);
    }
  } catch {}
  try {
    const appsDir = path.join(process.cwd(), 'src', 'apps');
    const entries = (await fs.readdir(appsDir, { withFileTypes: true } as any)) as unknown as Array<{ isDirectory: () => boolean; name: string }>;
    const names: string[] = [];
    for (const e of entries) {
      if (e.isDirectory && e.isDirectory()) {
        const id = e.name;
        try {
          const meta = JSON.parse(await fs.readFile(path.join(appsDir, id, 'metadata.json'), 'utf-8'));
          names.push(typeof meta?.name === 'string' ? meta.name : id);
        } catch {
          names.push(id);
        }
      }
    }
    return names;
  } catch {}
  return [];
}

export function sanitizeToolInput(toolName: string, input: any): any {
  try {
    if (toolName === 'web_fs_write' && input?.content) {
      const contentBytes = typeof input.content === 'string' ? new TextEncoder().encode(input.content).length : 0;
      return {
        path: input.path,
        createDirs: input.createDirs,
        contentSize: contentBytes,
        contentSizeKB: Number((contentBytes / 1024).toFixed(1)),
        contentPreview: typeof input.content === 'string' ? input.content.slice(0, 100) + (input.content.length > 100 ? '...' : '') : undefined,
      };
    }
    if (toolName === 'web_fs_read') {
      return { path: input?.path, encoding: input?.encoding };
    }
    return input;
  } catch {
    return { sanitizationError: true, originalKeys: Object.keys(input || {}) };
  }
}

export async function getConvexClientOptional() {
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    const client = new ConvexHttpClient(url);
    const { getToken } = await auth();
    const token = await getToken({ template: 'convex' });
    if (!token) return null;
    client.setAuth(token);
    return client;
  } catch {
    return null;
  }
}


