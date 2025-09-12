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
  if (token) client.setAuth(token);
  else throw new Error("Unauthorized");
  return client;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = await getClient();
    const url = await client.query(api.desktops_private.getDesktopSnapshotUrl as any, { id: params.id as any } as any);
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to get snapshot URL" },
      { status: err?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}

