export type MediaScope = { desktopId?: string; appId?: string; appName?: string };

export type PersistedAsset = {
  kind: 'image' | 'audio' | 'video' | 'unknown';
  source: 'url' | 'base64';
  original: string;
  publicUrl?: string;
  sha256?: string;
  r2Key?: string;
  contentType?: string;
  size?: number;
  path: string; // JSON path to where replacement occurred
};

type JsonParent = Record<string, unknown> | unknown[];

type Candidate = {
  id: string; // dedupe key (url or base64 prefix+len)
  kind: PersistedAsset['kind'];
  source: PersistedAsset['source'];
  original: string; // url or base64
  // Where to modify result once ingested
  parent: JsonParent;
  key: string | number; // key in parent to replace
  // For audioBase64 transformation we also record that we should convert base64->audioUrl
  isAudioBase64Field?: boolean;
  contentTypeHint?: string;
  path: string;
};

const URL_KEYS = new Set([
  'url', 'image', 'audioUrl', 'video', 'videoUrl', 'src'
]);
const ARRAY_KEYS = new Set([
  'images', 'outputs', 'output', 'videos', 'frames', 'assets'
]);
const MEDIA_KEYS = new Set(['image', 'audio', 'video']);

function isHttpUrl(value: string): boolean {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function guessKindFromKey(key: string): PersistedAsset['kind'] {
  if (key.toLowerCase().includes('image')) return 'image';
  if (key.toLowerCase().includes('audio')) return 'audio';
  if (key.toLowerCase().includes('video')) return 'video';
  return 'unknown';
}

function guessKindFromContentType(ct?: string): PersistedAsset['kind'] {
  if (!ct) return 'unknown';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('video/')) return 'video';
  return 'unknown';
}

function makeJsonPath(parentPath: string, key: string | number): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : String(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFromParent(parent: JsonParent, key: string | number): unknown {
  return Array.isArray(parent) ? parent[key as number] : parent[key as string];
}

function setOnParent(parent: JsonParent, key: string | number, value: unknown): void {
  if (Array.isArray(parent)) {
    parent[key as number] = value;
  } else {
    parent[key as string] = value;
  }
}

function deleteFromParent(parent: JsonParent, key: string | number): void {
  if (Array.isArray(parent)) {
    parent[key as number] = undefined;
  } else {
    delete parent[key as string];
  }
}

async function ingestUrl(url: string, scope?: MediaScope): Promise<PersistedAsset | null> {
  try {
    const res = await fetch('/api/media/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: url, scope }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      kind: data.contentType ? guessKindFromContentType(data.contentType) : 'unknown',
      source: 'url',
      original: url,
      publicUrl: data.publicUrl,
      sha256: data.sha256,
      r2Key: data.r2Key,
      contentType: data.contentType,
      size: data.size,
      path: '',
    };
  } catch {
    return null;
  }
}

async function ingestBase64(base64: string, contentType?: string, scope?: MediaScope): Promise<PersistedAsset | null> {
  try {
    const res = await fetch('/api/media/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, contentType, scope }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      kind: data.contentType ? guessKindFromContentType(data.contentType) : 'unknown',
      source: 'base64',
      original: base64.slice(0, 32) + '...',
      publicUrl: data.publicUrl,
      sha256: data.sha256,
      r2Key: data.r2Key,
      contentType: data.contentType,
      size: data.size,
      path: '',
    };
  } catch {
    return null;
  }
}

export async function persistAssetsFromAIResult<T = unknown>(inputResult: T, scope?: MediaScope): Promise<{ result: T; persistedAssets: PersistedAsset[] }>{
  // Work on a shallow clone to avoid mutating caller's reference unexpectedly
  const clonedResult: unknown = Array.isArray(inputResult)
    ? [...(inputResult as unknown[])]
    : isPlainObject(inputResult)
      ? { ...(inputResult as Record<string, unknown>) }
      : inputResult;
  const result = clonedResult as T;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  function visit(node: unknown, parent: JsonParent | null, key: string | number | null, path: string) {
    if (node == null) return;
    if (typeof node === 'string') {
      if (key != null && parent && isHttpUrl(node) && (URL_KEYS.has(String(key)) || MEDIA_KEYS.has(String(key)))) {
        const id = `url:${node}`;
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push({ id, kind: guessKindFromKey(String(key)), source: 'url', original: node, parent, key, path });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        const childPath = makeJsonPath(path, i);
        if (typeof child === 'string' && isHttpUrl(child) && (ARRAY_KEYS.has(String(key)) || MEDIA_KEYS.has(String(key)))) {
          const id = `url:${child}`;
          if (!seen.has(id)) {
            seen.add(id);
            candidates.push({ id, kind: guessKindFromKey(String(key)), source: 'url', original: child, parent: node, key: i, path: childPath });
          }
        } else if (typeof child === 'object' && child !== null) {
          visit(child, node, i, childPath);
        }
      }
      return;
    }
    if (isPlainObject(node)) {
      // ElevenLabs audio: { contentType, audioBase64 }
      const audioBase64 = node['audioBase64'];
      if (typeof audioBase64 === 'string' && audioBase64.length > 0) {
        const raw = audioBase64;
        const id = `b64:${raw.slice(0, 48)}:${raw.length}`;
        if (!seen.has(id)) {
          seen.add(id);
          const contentTypeHint = typeof node['contentType'] === 'string' ? node['contentType'] : undefined;
          candidates.push({ id, kind: 'audio', source: 'base64', original: raw, parent: node, key: 'audioBase64', isAudioBase64Field: true, contentTypeHint, path: makeJsonPath(path, 'audioBase64') });
        }
      }

      // Traverse object properties
      for (const k of Object.keys(node)) {
        const v = node[k];
        const childPath = makeJsonPath(path, k);
        if (typeof v === 'string') {
          if (isHttpUrl(v) && (URL_KEYS.has(k) || MEDIA_KEYS.has(k))) {
            const id = `url:${v}`;
            if (!seen.has(id)) {
              seen.add(id);
              candidates.push({ id, kind: guessKindFromKey(k), source: 'url', original: v, parent: node, key: k, path: childPath });
            }
          }
        } else if (Array.isArray(v)) {
          visit(v, node, k, childPath);
        } else if (isPlainObject(v)) {
          // Common pattern: { url: '...' }
          const urlValue = v['url'];
          if (typeof urlValue === 'string' && isHttpUrl(urlValue)) {
            const u = urlValue;
            const id = `url:${u}`;
            if (!seen.has(id)) {
              seen.add(id);
              candidates.push({ id, kind: guessKindFromKey(k), source: 'url', original: u, parent: v, key: 'url', path: makeJsonPath(childPath, 'url') });
            }
          }
          visit(v, node, k, childPath);
        }
      }
    }
  }

  if (Array.isArray(result)) {
    visit(result, result, null, '');
  } else if (isPlainObject(result)) {
    visit(result, result, null, '');
  }

  const persistedAssets: PersistedAsset[] = [];
  const cache = new Map<string, PersistedAsset | null>();

  for (const cand of candidates) {
    if (cache.has(cand.id)) continue;
    let persisted: PersistedAsset | null = null;
    if (cand.source === 'url') {
      persisted = await ingestUrl(cand.original, scope);
    } else {
      persisted = await ingestBase64(cand.original, cand.contentTypeHint, scope);
    }
    cache.set(cand.id, persisted);
  }

  // Apply replacements and build final assets list
  for (const cand of candidates) {
    const persisted = cache.get(cand.id);
    if (!persisted || !persisted.publicUrl) continue;
    try {
      if (cand.isAudioBase64Field && !Array.isArray(cand.parent)) {
        // Replace audioBase64 -> audioUrl
        deleteFromParent(cand.parent, cand.key);
        cand.parent['audioUrl'] = persisted.publicUrl;
        if (persisted.contentType) {
          cand.parent['contentType'] = persisted.contentType;
        }
      } else {
        // Replace url string or { url }
        const current = getFromParent(cand.parent, cand.key);
        if (typeof current === 'string') {
          setOnParent(cand.parent, cand.key, persisted.publicUrl);
        } else if (isPlainObject(current) && typeof current['url'] === 'string') {
          current['url'] = persisted.publicUrl;
        } else {
          // Fallback: set to object with url
          setOnParent(cand.parent, cand.key, { url: persisted.publicUrl });
        }
      }
      const asset: PersistedAsset = { ...persisted, path: cand.path, source: cand.source, kind: cand.kind, original: cand.original };
      persistedAssets.push(asset);
    } catch {
      // ignore replacement failure
    }
  }

  try {
    if (isPlainObject(result) || Array.isArray(result)) {
      (result as unknown as Record<string, unknown>)['persistedAssets'] = persistedAssets;
    }
  } catch {}

  return { result: result as T, persistedAssets };
}


// Extract provider-returned media URLs before ingestion for immediate rendering
export function extractOriginalMediaUrlsFromResult(inputResult: unknown): Array<{ url: string; contentType?: string }>{
  const urls: Array<{ url: string; contentType?: string }> = [];
  const seen = new Set<string>();

  const push = (u: string, ct?: string) => {
    if (!u || !isHttpUrl(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push({ url: u, contentType: ct });
  };

  function visit(node: unknown, parentKey: string | number | null) {
    if (node == null) return;
    const t = typeof node;
    if (t === 'string') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === 'string') {
          if (isHttpUrl(v) && (ARRAY_KEYS.has(String(parentKey)) || MEDIA_KEYS.has(String(parentKey)))) {
            push(v);
          }
        } else {
          visit(v, i);
        }
      }
      return;
    }
    if (isPlainObject(node)) {
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === 'string') {
          if (isHttpUrl(v) && (URL_KEYS.has(k) || MEDIA_KEYS.has(k))) {
            push(v);
          }
        } else if (Array.isArray(v)) {
          visit(v, k);
        } else if (isPlainObject(v)) {
          // Common pattern: { url: '...' }
          const urlValue = v['url'];
          if (typeof urlValue === 'string' && isHttpUrl(urlValue)) {
            const contentType = typeof v['contentType'] === 'string' ? v['contentType'] : undefined;
            push(urlValue, contentType);
          }
          visit(v, k);
        }
      }
    }
  }

  try {
    visit(inputResult, null);
  } catch {}

  return urls;
}
