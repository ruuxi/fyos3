import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../../../convex/_generated/api";

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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = await getClient();
    await client.mutation(api.chat.deleteThread as any, { threadId: params.id as any } as any);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete thread' }, { status: err?.message === 'Unauthorized' ? 401 : 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = await getClient();
    const body = await req.json();
    const title: string = String(body?.title || '').trim();
    if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    await client.mutation(api.chat.renameThread as any, { threadId: params.id as any, title } as any);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to rename thread' }, { status: err?.message === 'Unauthorized' ? 401 : 500 });
  }
}

