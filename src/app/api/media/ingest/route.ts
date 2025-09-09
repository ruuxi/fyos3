import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';
import { api as convexApi } from '../../../../../convex/_generated/api';
const api: any = convexApi as any;

type IngestBody = {
  sourceUrl?: string;
  base64?: string;
  contentType?: string;
  filenameHint?: string;
  scope?: { desktopId?: string; appId?: string };
  metadata?: Record<string, string>;
};

const ALLOWED_PREFIXES = [
  'https://fal.run/',
  'https://fal.media/',
  'https://v3.fal.media/',
  'https://cdn.fal.ai/',
  'https://api.elevenlabs.io/',
  'https://storage.googleapis.com/',
  'https://pub-cdn-1.elevenlabs.io/',
  // FYOS R2 public bucket base
  'https://pub-d7b49ac5f9d84e3aba3879015a55f5b3.r2.dev/',
];

function isAllowedUrl(url: string): boolean {
  try {
    return ALLOWED_PREFIXES.some((p) => url.startsWith(p));
  } catch {
    return false;
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sniffContentType(bytes: Uint8Array, fallback?: string): string {
  // Minimal, safe sniffing for common types; otherwise use fallback or application/octet-stream
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length > 6 && String.fromCharCode(bytes[0], bytes[1], bytes[2]) === 'GIF') return 'image/gif';
  if (bytes.length > 3 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'fLaC') return 'audio/flac';
  if (bytes.length > 11 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
    // Could be mp4/m4a/mov
    return fallback && fallback.startsWith('video/') ? fallback : (fallback && fallback.startsWith('audio/')) ? fallback : 'video/mp4';
  }
  if (fallback) return fallback;
  return 'application/octet-stream';
}

function getPublicUrlFromEnv(r2Key: string): string | undefined {
  // Prefer the public r2.dev host. Fallbacks avoid cloudflarestorage.com which usually requires signed requests.
  const preferred = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || 'https://pub-d7b49ac5f9d84e3aba3879015a55f5b3.r2.dev';
  if (preferred) {
    const trimmed = preferred.endsWith('/') ? preferred.slice(0, -1) : preferred;
    return `${trimmed}/${r2Key}`;
  }
  const alt = process.env.R2_PUBLIC_HOST;
  if (alt && /r2\.dev/.test(alt)) {
    const trimmed = alt.endsWith('/') ? alt.slice(0, -1) : alt;
    return `${trimmed}/${r2Key}`;
  }
  return undefined;
}

async function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_CONVEX_URL');
  const client = new ConvexHttpClient(url);
  const { getToken } = await auth();
  const token = await getToken({ template: 'convex' });
  if (!token) throw new Error('Unauthorized');
  client.setAuth(token);
  return client;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IngestBody;
    const hasSource = typeof body.sourceUrl === 'string' && body.sourceUrl.trim().length > 0;
    const hasBase64 = typeof body.base64 === 'string' && body.base64.length > 0;
    if ((hasSource ? 1 : 0) + (hasBase64 ? 1 : 0) !== 1) {
      return NextResponse.json({ error: 'Provide exactly one of sourceUrl or base64' }, { status: 400 });
    }

    let arrayBuffer: ArrayBuffer;
    let contentType = body.contentType?.trim();
    if (hasSource) {
      const url = body.sourceUrl!.trim();
      if (!isAllowedUrl(url)) {
        return NextResponse.json({ error: 'Source URL not allowed' }, { status: 400 });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return NextResponse.json({ error: 'Fetch failed' }, { status: 502 });
      arrayBuffer = await res.arrayBuffer();
      contentType = contentType || res.headers.get('Content-Type') || undefined;
    } else {
      // base64 can include data URL prefix
      const base64 = body.base64!.includes(',') ? body.base64!.split(',').pop()! : body.base64!;
      const buf = Buffer.from(base64, 'base64');
      arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    const bytes = new Uint8Array(arrayBuffer);
    const size = bytes.byteLength;
    if (size <= 0) return NextResponse.json({ error: 'Empty payload' }, { status: 400 });
    // Size cap: 100 MB
    if (size > 100 * 1024 * 1024) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

    const detected = sniffContentType(bytes, contentType);
    if (!/^image\//.test(detected) && !/^audio\//.test(detected) && !/^video\//.test(detected)) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 });
    }

    const sha256 = await sha256Hex(arrayBuffer);

    const client = await getConvexClient();

    // Dedup check
    const existing = await client.query(api.media.getMediaByHash, { sha256 } as any);
    if (existing) {
      return NextResponse.json({ ok: true, deduped: true, publicUrl: existing.publicUrl, r2Key: existing.r2Key, sha256: existing.sha256, size: existing.size, contentType: existing.contentType });
    }

    // Request signed URL
    const { url, r2Key } = await client.mutation(api.media.startIngest, {
      sha256,
      size,
      contentType: detected,
      desktopId: body.scope?.desktopId,
      appId: body.scope?.appId,
    } as any);

    // Upload to signed URL
    const uploadRes = await fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': detected } });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Upload failed: ${uploadRes.status}` }, { status: 502 });
    }

    // Derive public URL
    let publicUrl = getPublicUrlFromEnv(r2Key);
    if (!publicUrl) {
      try {
        // Fallback via Convex query (avoids importing server r2 client here)
        publicUrl = await client.query(api.media.getUrlForKey, { r2Key, expiresIn: 86400 } as any);
      } catch {
        publicUrl = undefined;
      }
    }

    // Finalize record
    const id = await client.mutation(api.media.finalizeIngest, {
      desktopId: body.scope?.desktopId,
      appId: body.scope?.appId,
      sha256,
      size,
      contentType: detected,
      r2Key,
      publicUrl,
      metadata: body.metadata,
    } as any);

    return NextResponse.json({ ok: true, id, publicUrl, r2Key, sha256, size, contentType: detected });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Ingest failed' }, { status: 500 });
  }
}


