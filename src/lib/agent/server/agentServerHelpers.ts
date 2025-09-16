import { promises as fs } from 'fs';
import path from 'path';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';

const parseAppName = (candidate: unknown): string | undefined => {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const value = (candidate as { name?: unknown }).name;
  return typeof value === 'string' ? value : undefined;
};

export async function getInstalledAppNames(): Promise<string[]> {
  try {
    const regPath = path.join(process.cwd(), 'public', 'apps', 'registry.json');
    const buf = await fs.readFile(regPath, 'utf-8');
    const data = JSON.parse(buf);
    if (Array.isArray(data)) {
      return data.map(parseAppName).filter((name: string | undefined): name is string => Boolean(name));
    }
    if (Array.isArray(data?.apps)) {
      return data.apps.map(parseAppName).filter((name: string | undefined): name is string => Boolean(name));
    }
  } catch {}
  try {
    const appsDir = path.join(process.cwd(), 'src', 'apps');
    const entries = await fs.readdir(appsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const id = entry.name;
        try {
          const meta = JSON.parse(await fs.readFile(path.join(appsDir, id, 'metadata.json'), 'utf-8'));
          names.push(parseAppName(meta) ?? id);
        } catch {
          names.push(id);
        }
      }
    }
    return names;
  } catch {}
  return [];
}

export function sanitizeToolInput(toolName: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  try {
    if (toolName === 'web_fs_write' && input) {
      const contentRaw = input['content'];
      const contentString = typeof contentRaw === 'string' ? contentRaw : '';
      const contentBytes = new TextEncoder().encode(contentString).length;
      return {
        path: typeof input['path'] === 'string' ? (input['path'] as string) : undefined,
        createDirs: typeof input['createDirs'] === 'boolean' ? (input['createDirs'] as boolean) : undefined,
        contentSize: contentBytes,
        contentSizeKB: Number((contentBytes / 1024).toFixed(1)),
        contentPreview: contentString ? `${contentString.slice(0, 100)}${contentString.length > 100 ? '...' : ''}` : undefined,
      };
    }
    if (toolName === 'web_fs_read') {
      return {
        path: typeof input?.['path'] === 'string' ? (input['path'] as string) : undefined,
        encoding: typeof input?.['encoding'] === 'string' ? (input['encoding'] as string) : undefined,
      } as Record<string, unknown>;
    }
    return input ?? {};
  } catch {
    const keys = input ? Object.keys(input) : [];
    return { sanitizationError: true, originalKeys: keys };
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
