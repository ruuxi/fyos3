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
  if (token) {
    client.setAuth(token);
  } else {
    throw new Error("Unauthorized");
  }

  return client;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      desktopId,
      title,
      gzBase64,
      size,
      fileCount,
      contentSha256,
      description,
      icon,
    } = body as any;

    if (!desktopId || !title || !gzBase64 || !contentSha256) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const client = await getClient();

    // Step 1: request signed URL
    const { url, r2KeySnapshot } = await client.mutation(api.desktops_private.saveDesktopStart as any, {
      desktopId,
      title,
      size,
      fileCount,
      contentSha256,
    } as any);

    // Step 2: upload snapshot
    const binary = Buffer.from(gzBase64, "base64");
    const uploadRes = await fetch(url, {
      method: "PUT",
      body: binary,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Upload failed: ${uploadRes.status}` }, { status: 502 });
    }

    // Step 3: finalize
    const id = await client.mutation(api.desktops_private.saveDesktopFinalize as any, {
      desktopId,
      title,
      r2KeySnapshot,
      size,
      fileCount,
      contentSha256,
      description,
      icon,
    } as any);

    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to save desktop" },
      { status: err?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}

