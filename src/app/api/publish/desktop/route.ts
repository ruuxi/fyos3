import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../convex/_generated/api";

async function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(url);
  
  // Get the auth token from Clerk
  const { getToken } = await auth();
  const token = await getToken({ template: "convex" });
  if (token) {
    client.setAuth(token);
  }
  
  return client;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { desktopId, title, version, description, icon, size, blobBase64, manifestHash, lockfileHash } = body as any;
    if (!desktopId || !title || !version || !blobBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const client = await getClient();
    const { url, r2KeySnapshot } = await client.mutation(api.desktops.publishDesktopStart, {
      desktopId,
      title,
      version,
      size,
    } as any);

    const binary = Buffer.from(blobBase64, 'base64');
    const uploadRes = await fetch(url, { method: 'PUT', body: binary, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Upload failed: ${uploadRes.status}` }, { status: 502 });
    }

    const id = await client.mutation(api.desktops.publishDesktopFinalize, {
      desktopId,
      title,
      version,
      description,
      icon,
      size,
      r2KeySnapshot,
      manifestHash,
      lockfileHash,
      visibility: 'public',
    } as any);

    return NextResponse.json({ ok: true, id, visitUrl: `/d/${id}` });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to publish desktop" },
      { status: 500 }
    );
  }
}


