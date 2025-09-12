import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../../convex/_generated/api";

async function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(url);
  const { getToken } = await auth();
  const token = await getToken({ template: "convex" });
  if (!token) throw new Error("Unauthorized");
  client.setAuth(token);
  return client;
}

export async function POST(req: NextRequest) {
  try {
    const client = await getClient();
    const body = await req.json().catch(() => ({}));
    const title = (body && typeof body.title === 'string' && body.title.trim()) ? body.title : undefined;
    const id = await client.mutation(api.chat.createThread as any, { title } as any);
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create thread' }, { status: err?.message === 'Unauthorized' ? 401 : 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const client = await getClient();
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const threads = await client.query(api.chat.listThreads as any, { limit } as any);
    return NextResponse.json({ threads });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to list threads' }, { status: err?.message === 'Unauthorized' ? 401 : 500 });
  }
}

