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
    const { appId, name, version, description, icon, tags, manifestHash, depsHash, size, blobBase64 } = body as any;
    if (!appId || !name || !version || !blobBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Step 1: request signed URL
    const client = await getClient();
    const { url, r2KeyTar } = await client.mutation(api.apps.publishAppStart, {
      appId,
      name,
      version,
      size,
    } as any);

    // Step 2: upload to signed URL
    const binary = Buffer.from(blobBase64, 'base64');
    const uploadRes = await fetch(url, { method: 'PUT', body: binary, headers: { 'Content-Type': 'application/gzip' } });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Upload failed: ${uploadRes.status}` }, { status: 502 });
    }

    // Step 3: finalize record
    const id = await client.mutation(api.apps.publishAppFinalize, {
      appId,
      name,
      version,
      description,
      icon,
      tags,
      size,
      r2KeyTar,
      manifestHash,
      depsHash,
      visibility: 'public',
    } as any);

    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to publish app" },
      { status: 500 }
    );
  }
}


