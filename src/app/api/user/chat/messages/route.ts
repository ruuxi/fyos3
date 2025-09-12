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

export async function GET(req: NextRequest) {
  try {
    const client = await getClient();
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get('threadId');
    const limitParam = searchParams.get('limit');
    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }
    const limit = limitParam ? Number(limitParam) : undefined;
    const messages = await client.query(api.chat.listMessages as any, { threadId: threadId as any, limit } as any);
    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to list messages' }, { status: err?.message === 'Unauthorized' ? 401 : 500 });
  }
}

