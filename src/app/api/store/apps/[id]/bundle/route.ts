import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

async function getClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(url);
  
  // Get the auth token from Clerk (optional for public queries)
  try {
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" });
    if (token) {
      client.setAuth(token);
    }
  } catch {
    // Auth is optional for public bundle downloads
  }
  
  return client;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await getClient();
    const { id } = await params;
    const typedId = id as Id<'apps_public'>; // Validated by Convex schema
    const signedUrl = await client.query(api.apps.getAppBundleUrl, { id: typedId });
    const resp = await fetch(signedUrl, { cache: 'no-store' });
    if (!resp.ok || !resp.body) {
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
    }
    const etag = resp.headers.get('etag') || undefined;
    const cc = 'public, max-age=300, s-maxage=300, stale-while-revalidate=60';
    const headers: Record<string, string> = {
      "Content-Type": resp.headers.get("Content-Type") || "application/gzip",
      "Cache-Control": cc,
    };
    if (etag) headers['ETag'] = etag;
    return new Response(resp.body, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to proxy bundle";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
