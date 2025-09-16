import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { auth } from '@clerk/nextjs/server';
import { api as convexApi } from '../../../../../convex/_generated/api';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') ?? undefined;
    const appId = searchParams.get('appId') ?? undefined;
    const desktopId = searchParams.get('desktopId') ?? undefined;
    const threadId = searchParams.get('threadId') ?? undefined;
    const fromStr = searchParams.get('from') ?? undefined;
    const toStr = searchParams.get('to') ?? undefined;
    const limitStr = searchParams.get('limit') ?? undefined;
    const from = fromStr ? Number(fromStr) : undefined;
    const to = toStr ? Number(toStr) : undefined;
    const limit = limitStr ? Number(limitStr) : undefined;

    const client = await getClient();
    const items = await client.query(convexApi.media.listMedia, {
      type,
      appId,
      desktopId,
      threadId,
      from: Number.isFinite(from) ? from : undefined,
      to: Number.isFinite(to) ? to : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list media';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

