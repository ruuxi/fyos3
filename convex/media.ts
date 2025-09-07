import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import r2 from "./r2";

function buildR2Key(params: { ownerId: string; desktopId?: string; appId?: string; sha256: string; contentType: string; now: Date; }): string {
  const { ownerId, desktopId, appId, sha256, contentType, now } = params;
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const typeExt = ((): string => {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/aac": "aac",
      "audio/m4a": "m4a",
      "audio/mp4": "m4a",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    };
    return map[contentType] || contentType.split('/')[1] || 'bin';
  })();
  const parts = [
    "media",
    ownerId,
    desktopId || undefined,
    appId || undefined,
    yyyy,
    mm,
    dd,
    `${sha256}.${typeExt}`,
  ].filter(Boolean) as string[];
  return parts.join('/');
}

export const startIngest = mutation({
  args: {
    sha256: v.string(),
    size: v.number(),
    contentType: v.string(),
    desktopId: v.optional(v.string()),
    appId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const now = new Date();

    const r2Key = buildR2Key({ ownerId, desktopId: args.desktopId ?? undefined, appId: args.appId ?? undefined, sha256: args.sha256, contentType: args.contentType, now });
    const signed = await r2.generateUploadUrl(r2Key) as any;
    const url: string = typeof signed === 'string' ? signed : signed?.url;
    return { url, r2Key };
  },
});

export const finalizeIngest = mutation({
  args: {
    desktopId: v.optional(v.string()),
    appId: v.optional(v.string()),
    sha256: v.string(),
    size: v.number(),
    contentType: v.string(),
    r2Key: v.string(),
    publicUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const now = Date.now();

    const existing = await ctx.db
      .query("media_public")
      .withIndex("by_owner_sha", (q) => q.eq("ownerId", ownerId).eq("sha256", args.sha256))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        size: args.size,
        contentType: args.contentType,
        r2Key: args.r2Key,
        publicUrl: args.publicUrl,
        metadata: args.metadata,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("media_public", {
      ownerId,
      desktopId: args.desktopId,
      appId: args.appId,
      sha256: args.sha256,
      size: args.size,
      contentType: args.contentType,
      r2Key: args.r2Key,
      publicUrl: args.publicUrl,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const getMediaByHash = query({
  args: { sha256: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const doc = await ctx.db
      .query("media_public")
      .withIndex("by_owner_sha", (q) => q.eq("ownerId", ownerId).eq("sha256", args.sha256))
      .first();
    return doc;
  },
});

export const listMedia = query({
  args: {
    ownerId: v.optional(v.string()),
    appId: v.optional(v.string()),
    desktopId: v.optional(v.string()),
    type: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("media_public").withIndex("by_createdAt");
    const all = await q.collect();
    const filtered = all.filter((m) => {
      if (args.ownerId && m.ownerId !== args.ownerId) return false;
      if (args.appId && m.appId !== args.appId) return false;
      if (args.desktopId && m.desktopId !== args.desktopId) return false;
      if (args.type && !m.contentType.startsWith(args.type + "/")) return false;
      if (args.from && m.createdAt < args.from) return false;
      if (args.to && m.createdAt > args.to) return false;
      return true;
    });
    return args.limit ? filtered.slice(0, args.limit) : filtered;
  },
});

export const getUrlForKey = query({
  args: { r2Key: v.string(), expiresIn: v.optional(v.number()) },
  handler: async (_ctx, args) => {
    const ttl = args.expiresIn ?? 86400;
    return await r2.getUrl(args.r2Key, { expiresIn: ttl });
  },
});


