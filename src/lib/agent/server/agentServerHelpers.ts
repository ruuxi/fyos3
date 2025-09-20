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
    const data = JSON.parse(buf) as unknown;
    if (Array.isArray(data)) {
      return data.map(parseAppName).filter((name: string | undefined): name is string => Boolean(name));
    }
    if (typeof data === 'object' && data !== null && Array.isArray((data as { apps?: unknown }).apps)) {
      const apps = (data as { apps: unknown[] }).apps;
      return apps.map(parseAppName).filter((name: string | undefined): name is string => Boolean(name));
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
          const metaRaw = await fs.readFile(path.join(appsDir, id, 'metadata.json'), 'utf-8');
          const meta = JSON.parse(metaRaw) as unknown;
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
    if (toolName === 'web_fs_read' && input) {
      const sanitized: Record<string, unknown> = {
        path: typeof input['path'] === 'string' ? (input['path'] as string) : undefined,
        encoding: typeof input['encoding'] === 'string' ? (input['encoding'] as string) : undefined,
      };
      if (typeof input['responseFormat'] === 'string') {
        sanitized.responseFormat = input['responseFormat'];
      }
      const rangeRaw = input['range'];
      if (rangeRaw && typeof rangeRaw === 'object') {
        const range = rangeRaw as Record<string, unknown>;
        const summary: Record<string, number> = {};
        if (typeof range.offset === 'number') summary.offset = range.offset;
        if (typeof range.length === 'number') summary.length = range.length;
        if (typeof range.lineStart === 'number') summary.lineStart = range.lineStart;
        if (typeof range.lineEnd === 'number') summary.lineEnd = range.lineEnd;
        sanitized.range = summary;
      }
      return sanitized;
    }
    return input ?? {};
  } catch {
    const keys = input ? Object.keys(input) : [];
    return { sanitizationError: true, originalKeys: keys };
  }
}

const MAX_SUMMARY_CHARS = 800;

export function summarizeToolResult(toolName: string, value: unknown): Record<string, unknown> {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value === 'string') {
    return {
      valueType: 'string',
      preview: value.slice(0, MAX_SUMMARY_CHARS),
      charCount: value.length,
      truncated: value.length > MAX_SUMMARY_CHARS,
    };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { valueType: typeof value, value };
  }

  try {
    const serialized = JSON.stringify(value);
    return {
      valueType: 'json',
      preview: serialized.slice(0, MAX_SUMMARY_CHARS),
      charCount: serialized.length,
      truncated: serialized.length > MAX_SUMMARY_CHARS,
      keys: typeof value === 'object' && value !== null ? Object.keys(value as Record<string, unknown>) : undefined,
      toolName,
    };
  } catch (error) {
    return {
      valueType: 'unknown',
      error: error instanceof Error ? error.message : 'Failed to serialize tool result',
      toolName,
    };
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
