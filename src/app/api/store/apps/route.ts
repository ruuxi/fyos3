import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { api } from "../../../../../convex/_generated/api";

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
    // Auth is optional for public listings
  }
  
  return client;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const search = searchParams.get("search") ?? undefined;
    const ownerId = searchParams.get("ownerId") ?? undefined;
    const visibility = searchParams.get("visibility") ?? undefined;
    const limit = limitParam ? Number(limitParam) : undefined;

    const client = await getClient();
    const apps = await client.query(api.apps.listApps, {
      limit: Number.isFinite(limit) ? limit : undefined,
      search,
      ownerId,
      visibility,
    });
    return NextResponse.json({ apps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list apps";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

