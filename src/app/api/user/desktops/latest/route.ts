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
  if (token) client.setAuth(token);
  else throw new Error("Unauthorized");
  return client;
}

export async function GET(_req: NextRequest) {
  try {
    const client = await getClient();
    const record = await client.query(api.desktops_private.getLatestDesktop as any, {} as any);
    if (!record) return NextResponse.json({ desktop: null });
    const url = await client.query(api.desktops_private.getDesktopSnapshotUrl as any, { id: record._id } as any);
    return NextResponse.json({ desktop: record, url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load latest desktop" },
      { status: err?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}

