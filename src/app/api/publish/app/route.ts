import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../convex/_generated/api";

interface PublishAppRequestBody {
  appId?: string;
  name?: string;
  version?: string;
  description?: string;
  icon?: string;
  tags?: string[];
  manifestHash?: string;
  depsHash?: string;
  size?: number;
  blobBase64?: string;
}

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
    const body = (await req.json()) as PublishAppRequestBody;
    const { appId, name, version, description, icon, tags, manifestHash, depsHash, size, blobBase64 } = body;
    if (!appId || !name || !version || !blobBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const descriptionValue = typeof description === 'string' ? description : undefined;
    const iconValue = typeof icon === 'string' ? icon : undefined;
    const manifestHashValue = typeof manifestHash === 'string' ? manifestHash : undefined;
    const depsHashValue = typeof depsHash === 'string' ? depsHash : undefined;
    const sizeValue = typeof size === 'number' ? size : undefined;
    const normalizedTags = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : undefined;

    // Step 1: request signed URL
    const client = await getClient();
    const { url, r2KeyTar } = await client.mutation(api.apps.publishAppStart, {
      appId,
      name,
      version,
      size: sizeValue,
    });

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
      description: descriptionValue,
      icon: iconValue,
      tags: normalizedTags,
      size: sizeValue,
      r2KeyTar,
      manifestHash: manifestHashValue,
      depsHash: depsHashValue,
      visibility: 'public',
    });

    return NextResponse.json({ ok: true, id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to publish app";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
