import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';
import { api as convexApi } from '../../../../../convex/_generated/api';
const api: any = convexApi as any;

async function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_CONVEX_URL');
  const client = new ConvexHttpClient(url);
  const { getToken } = await auth();
  const token = await getToken({ template: 'convex' });
  if (!token) throw new Error('Unauthorized');
  client.setAuth(token);
  return client;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const client = await getClient();
    // Best-effort fetch to build proxy URL: list recent and match
    const items = await client.query(api.media.listMedia, { limit: 500 } as any);
    const found = (items || []).find((m: any) => String(m._id) === id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = found.publicUrl || await client.query(api.media.getUrlForKey, { r2Key: found.r2Key, expiresIn: 3600 } as any);
    if (!url) return NextResponse.json({ error: 'No URL' }, { status: 404 });

    // Proxy the bytes to keep same-origin and satisfy COEP/COOP
    const range = req.headers.get('range') || undefined;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: range ? { Range: range } : undefined,
      cache: 'no-store',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: 502 });
    }

    const res = new NextResponse(upstream.body as any, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Length': upstream.headers.get('Content-Length') || '',
        'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
        'Content-Range': upstream.headers.get('Content-Range') || '',
        'Cache-Control': 'public, max-age=86400, immutable',
        // Critical: allow embedding under COEP require-corp by keeping it same-origin
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });

    // Clean up any empty headers to avoid invalid header errors
    ['Content-Length', 'Content-Range'].forEach((k) => {
      if (!res.headers.get(k)) res.headers.delete(k);
    });

    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 });
  }
}


