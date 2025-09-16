import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../convex/_generated/api";

interface PublishDesktopRequestBody {
  desktopId?: string;
  title?: string;
  version?: string;
  description?: string;
  icon?: string;
  size?: number;
  blobBase64?: string;
  manifestHash?: string;
  lockfileHash?: string;
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
    const body = (await req.json()) as PublishDesktopRequestBody;
    const { desktopId, title, version, description, icon, size, blobBase64, manifestHash, lockfileHash } = body;
    if (!desktopId || !title || !version || !blobBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const descriptionValue = typeof description === 'string' ? description : undefined;
    const iconValue = typeof icon === 'string' ? icon : undefined;
    const sizeValue = typeof size === 'number' ? size : undefined;
    const manifestHashValue = typeof manifestHash === 'string' ? manifestHash : undefined;
    const lockfileHashValue = typeof lockfileHash === 'string' ? lockfileHash : undefined;

    const client = await getClient();
    const { url, r2KeySnapshot } = await client.mutation(api.desktops.publishDesktopStart, {
      desktopId,
      title,
      version,
      size: sizeValue,
    });

    const binary = Buffer.from(blobBase64, 'base64');
    const uploadRes = await fetch(url, { method: 'PUT', body: binary, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Upload failed: ${uploadRes.status}` }, { status: 502 });
    }

    const id = await client.mutation(api.desktops.publishDesktopFinalize, {
      desktopId,
      title,
      version,
      description: descriptionValue,
      icon: iconValue,
      size: sizeValue,
      r2KeySnapshot,
      manifestHash: manifestHashValue,
      lockfileHash: lockfileHashValue,
      visibility: 'public',
    });

    return NextResponse.json({ ok: true, id, visitUrl: `/d/${id}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to publish desktop";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

