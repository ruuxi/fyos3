import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import r2 from "./r2";
import { internal } from "./_generated/api";

// Start publish: returns signed PUT URL and proposed r2 key
export const publishDesktopStart = mutation({
  args: {
    desktopId: v.string(),
    title: v.string(),
    version: v.string(),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    const r2KeySnapshot = `desktops/${ownerId}/${args.desktopId}/${args.version}/snapshot.bin`;
    const signed = await r2.generateUploadUrl(r2KeySnapshot) as any;
    const url: string = typeof signed === 'string' ? signed : signed?.url;
    return { url, r2KeySnapshot };
  },
});

// Finalize publish: upsert record
export const publishDesktopFinalize = mutation({
  args: {
    desktopId: v.string(),
    title: v.string(),
    version: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    size: v.optional(v.number()),
    r2KeySnapshot: v.string(),
    manifestHash: v.optional(v.string()),
    lockfileHash: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const now = Date.now();

    const existing = await ctx.db
      .query("desktops_public")
      .withIndex("by_desktopId", (q) => q.eq("desktopId", args.desktopId))
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        description: args.description,
        icon: args.icon,
        size: args.size,
        r2KeySnapshot: args.r2KeySnapshot,
        manifestHash: args.manifestHash,
        lockfileHash: args.lockfileHash,
        visibility: args.visibility ?? existing.visibility,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("desktops_public", {
      ownerId,
      desktopId: args.desktopId,
      title: args.title,
      description: args.description,
      icon: args.icon,
      size: args.size,
      r2KeySnapshot: args.r2KeySnapshot,
      manifestHash: args.manifestHash,
      lockfileHash: args.lockfileHash,
      visibility: args.visibility ?? "public",
      createdAt: now,
      updatedAt: now,
    });
    try { await ctx.runMutation(internal.metrics.increment, { name: 'publish_desktops', by: 1 } as any); } catch {}
    return id;
  },
});

export const listDesktops = query({
  args: {
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    visibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("desktops_public").withIndex("by_updatedAt");
    if (args.ownerId) {
      q = ctx.db.query("desktops_public").withIndex("by_owner", (qq) =>
        qq.eq("ownerId", args.ownerId as string)
      );
    }
    const results = await q.collect();
    const filtered = results.filter((doc) => {
      if (args.visibility && doc.visibility !== args.visibility) return false;
      if (args.search) {
        const s = args.search.toLowerCase();
        return (
          doc.title.toLowerCase().includes(s) ||
          (doc.description ?? "").toLowerCase().includes(s)
        );
      }
      return true;
    });
    return args.limit ? filtered.slice(0, args.limit) : filtered;
  },
});

export const getDesktop = query({
  args: { id: v.id("desktops_public") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getDesktopSnapshotUrl = query({
  args: { id: v.id("desktops_public"), expiresIn: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const desktop = await ctx.db.get(args.id);
    if (!desktop) throw new Error("Not found");
    const ttl = args.expiresIn ?? 900;
    return await r2.getUrl(desktop.r2KeySnapshot, { expiresIn: ttl });
  },
});


