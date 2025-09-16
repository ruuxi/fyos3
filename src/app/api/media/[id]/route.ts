import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';
import { api as convexApi } from '../../../../../convex/_generated/api';
import type { Doc } from '../../../../../convex/_generated/dataModel';

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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const client = await getClient();
    const items = await client.query(convexApi.media.listMedia, { limit: 500 });
    const list = Array.isArray(items) ? items : [];
    const found = list.find((m: Doc<'media_public'>) => String(m._id) === id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url =
      typeof found.publicUrl === 'string' && found.publicUrl
        ? found.publicUrl
        : await client.query(convexApi.media.getUrlForKey, { r2Key: found.r2Key, expiresIn: 3600 });
    if (!url) return NextResponse.json({ error: 'No URL' }, { status: 404 });
    return NextResponse.redirect(url, { status: 302 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

