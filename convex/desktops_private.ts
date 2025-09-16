import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import r2 from "./r2";

// Start save: returns signed PUT URL and proposed r2 key for private desktop snapshot
export const saveDesktopStart = mutation({
  args: {
    desktopId: v.string(),
    title: v.string(),
    size: v.optional(v.number()),
    fileCount: v.optional(v.number()),
    contentSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    // Stable key for latest private snapshot per (owner, desktopId)
    const r2KeySnapshot = `desktops/private/${ownerId}/${args.desktopId}/snapshot.gz`;
    const { url } = await r2.generateUploadUrl(r2KeySnapshot);
    return { url, r2KeySnapshot };
  },
});

// Finalize save: upsert record in desktops_private
export const saveDesktopFinalize = mutation({
  args: {
    desktopId: v.string(),
    title: v.string(),
    r2KeySnapshot: v.string(),
    size: v.optional(v.number()),
    fileCount: v.optional(v.number()),
    contentSha256: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const now = Date.now();

    const existing = await ctx.db
      .query("desktops_private")
      .withIndex("by_desktopId", (q) => q.eq("desktopId", args.desktopId))
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        description: args.description,
        icon: args.icon,
        r2KeySnapshot: args.r2KeySnapshot,
        size: args.size,
        fileCount: args.fileCount,
        contentSha256: args.contentSha256,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("desktops_private", {
      ownerId,
      desktopId: args.desktopId,
      title: args.title,
      description: args.description,
      icon: args.icon,
      r2KeySnapshot: args.r2KeySnapshot,
      size: args.size,
      fileCount: args.fileCount,
      contentSha256: args.contentSha256,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

// Get latest desktop record for current user, optionally filtered by desktopId
export const getLatestDesktop = query({
  args: { desktopId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    if (args.desktopId) {
      return await ctx.db
        .query("desktops_private")
        .withIndex("by_desktopId", (q) => q.eq("desktopId", args.desktopId as string))
        .filter((q) => q.eq(q.field("ownerId"), ownerId))
        .first();
    }

    // By owner, pick latest by updatedAt
    const all = await ctx.db
      .query("desktops_private")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    if (all.length === 0) return null;
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  },
});

// Get signed URL to download snapshot for a given record
export const getDesktopSnapshotUrl = query({
  args: { id: v.id("desktops_private"), expiresIn: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    const record = await ctx.db.get(args.id);
    if (!record || record.ownerId !== ownerId) throw new Error("Not found");
    const ttl = args.expiresIn ?? 900; // 15 minutes default
    return await r2.getUrl(record.r2KeySnapshot, { expiresIn: ttl });
  },
});

// List current user's desktops ordered by updatedAt desc
export const listMyDesktops = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    const all = await ctx.db
      .query("desktops_private")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const sorted = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return args.limit ? sorted.slice(0, args.limit) : sorted;
  },
});
