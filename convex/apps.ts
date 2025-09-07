import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import r2 from "./r2";
import { internal } from "./_generated/api";

// Start publish: returns signed PUT URL and proposed r2 key
export const publishAppStart = mutation({
  args: {
    appId: v.string(),
    name: v.string(),
    version: v.string(),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";

    const r2KeyTar = `apps/${ownerId}/${args.appId}/${args.version}/app.tar.gz`;
    const signed = await r2.generateUploadUrl(r2KeyTar) as any;
    const url: string = typeof signed === 'string' ? signed : signed?.url;
    return { url, r2KeyTar };
  },
});

// Finalize publish: upsert record
export const publishAppFinalize = mutation({
  args: {
    appId: v.string(),
    name: v.string(),
    version: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    size: v.optional(v.number()),
    r2KeyTar: v.string(),
    manifestHash: v.optional(v.string()),
    depsHash: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
    const now = Date.now();

    const existing = await ctx.db
      .query("apps_public")
      .withIndex("by_appId", (q) => q.eq("appId", args.appId))
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        version: args.version,
        description: args.description,
        icon: args.icon,
        tags: args.tags,
        size: args.size,
        r2KeyTar: args.r2KeyTar,
        manifestHash: args.manifestHash,
        depsHash: args.depsHash,
        visibility: args.visibility ?? existing.visibility,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("apps_public", {
      ownerId,
      appId: args.appId,
      name: args.name,
      version: args.version,
      description: args.description,
      icon: args.icon,
      tags: args.tags,
      size: args.size,
      r2KeyTar: args.r2KeyTar,
      manifestHash: args.manifestHash,
      depsHash: args.depsHash,
      visibility: args.visibility ?? "public",
      createdAt: now,
      updatedAt: now,
    });
    // metrics
    try { await ctx.runMutation(internal.metrics.increment, { name: 'publish_apps', by: 1 } as any); } catch {}
    return id;
  },
});

export const listApps = query({
  args: {
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    visibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("apps_public").withIndex("by_updatedAt");
    if (args.ownerId) {
      q = ctx.db.query("apps_public").withIndex("by_owner", (qq) =>
        qq.eq("ownerId", args.ownerId as string)
      );
    }
    const results = await q.collect();
    const filtered = results.filter((doc) => {
      if (args.visibility && doc.visibility !== args.visibility) return false;
      if (args.search) {
        const s = args.search.toLowerCase();
        return (
          doc.name.toLowerCase().includes(s) ||
          (doc.description ?? "").toLowerCase().includes(s) ||
          (doc.tags ?? []).some((t: string) => t.toLowerCase().includes(s))
        );
      }
      return true;
    });
    return args.limit ? filtered.slice(0, args.limit) : filtered;
  },
});

export const getApp = query({
  args: { id: v.id("apps_public") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getAppBundleUrl = query({
  args: { id: v.id("apps_public"), expiresIn: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.id);
    if (!app) throw new Error("Not found");
    // Default TTL 15 min if not provided
    const ttl = args.expiresIn ?? 900;
    return await r2.getUrl(app.r2KeyTar, { expiresIn: ttl });
  },
});


