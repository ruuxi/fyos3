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

type Candidate = {
  id: string; // dedupe key (url or base64 prefix+len)
  kind: PersistedAsset['kind'];
  source: PersistedAsset['source'];
  original: string; // url or base64
  // Where to modify result once ingested
  parent: any;
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

export async function persistAssetsFromAIResult<T = any>(inputResult: T, scope?: MediaScope): Promise<{ result: T; persistedAssets: PersistedAsset[] }>{
  // Work on a shallow clone to avoid mutating caller's reference unexpectedly
  const result: any = Array.isArray(inputResult) ? [...(inputResult as any)] : (typeof inputResult === 'object' && inputResult !== null) ? { ...(inputResult as any) } : inputResult;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  function visit(node: any, parent: any, key: string | number, path: string) {
    if (node == null) return;
    const t = typeof node;
    if (t === 'string') {
      if (key != null && isHttpUrl(node) && (URL_KEYS.has(String(key)) || MEDIA_KEYS.has(String(key)))) {
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
        } else if (typeof child === 'object' && child) {
          visit(child, node, i, childPath);
        }
      }
      return;
    }
    if (t === 'object') {
      // ElevenLabs audio: { contentType, audioBase64 }
      if (typeof (node as any).audioBase64 === 'string' && (node as any).audioBase64.length > 0) {
        const raw = (node as any).audioBase64 as string;
        const id = `b64:${raw.slice(0, 48)}:${raw.length}`;
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push({ id, kind: 'audio', source: 'base64', original: raw, parent: node, key: 'audioBase64', isAudioBase64Field: true, contentTypeHint: (node as any).contentType, path: makeJsonPath(path, 'audioBase64') });
        }
      }

      // Traverse object properties
      for (const k of Object.keys(node)) {
        const v = (node as any)[k];
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
        } else if (typeof v === 'object' && v !== null) {
          // Common pattern: { url: '...' }
          if (typeof (v as any).url === 'string' && isHttpUrl((v as any).url)) {
            const u = (v as any).url as string;
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

  if (typeof result === 'object' && result !== null) {
    visit(result, { root: true, value: result }, 'value', '');
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
      if (cand.isAudioBase64Field && cand.parent && typeof cand.parent === 'object') {
        // Replace audioBase64 -> audioUrl
        delete cand.parent[cand.key as any];
        (cand.parent as any).audioUrl = persisted.publicUrl;
        (cand.parent as any).contentType = persisted.contentType || (cand.parent as any).contentType;
      } else {
        // Replace url string or { url }
        const current = cand.parent[cand.key as any];
        if (typeof current === 'string') {
          cand.parent[cand.key as any] = persisted.publicUrl;
        } else if (typeof current === 'object' && current && typeof current.url === 'string') {
          (current as any).url = persisted.publicUrl;
        } else {
          // Fallback: set to object with url
          cand.parent[cand.key as any] = { url: persisted.publicUrl };
        }
      }
      const asset: PersistedAsset = { ...persisted, path: cand.path, source: cand.source, kind: cand.kind, original: cand.original };
      persistedAssets.push(asset);
    } catch {
      // ignore replacement failure
    }
  }

  try {
    if (typeof result === 'object' && result) {
      (result as any).persistedAssets = persistedAssets;
    }
  } catch {}

  return { result: result as T, persistedAssets };
}


// Extract provider-returned media URLs before ingestion for immediate rendering
export function extractOriginalMediaUrlsFromResult(inputResult: any): Array<{ url: string; contentType?: string }>{
  const urls: Array<{ url: string; contentType?: string }> = [];
  const seen = new Set<string>();

  const push = (u: string, ct?: string) => {
    if (!u || !isHttpUrl(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push({ url: u, contentType: ct });
  };

  function visit(node: any, parentKey: string | number | null) {
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
    if (t === 'object') {
      for (const k of Object.keys(node)) {
        const v = (node as any)[k];
        if (typeof v === 'string') {
          if (isHttpUrl(v) && (URL_KEYS.has(k) || MEDIA_KEYS.has(k))) {
            push(v);
          }
        } else if (Array.isArray(v)) {
          visit(v, k);
        } else if (typeof v === 'object' && v !== null) {
          // Common pattern: { url: '...' }
          if (typeof (v as any).url === 'string' && isHttpUrl((v as any).url)) {
            push((v as any).url);
          }
          visit(v, k);
        }
      }
    }
  }

  try {
    if (typeof inputResult === 'object' && inputResult !== null) {
      visit(inputResult, null);
    }
  } catch {}

  return urls;
}

