import { query, mutation } from "./_generated/server";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";

function normalizeAgentContent(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +/g, " ")
    .trim();
}

function hashAgentContent(text: string): string | null {
  const normalized = normalizeAgentContent(text);
  if (!normalized) return null;
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0; // Force 32-bit
  }
  return Math.abs(hash).toString(36);
}

function getOwnerId(identity: UserIdentity): string {
  return identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
}

export const createThread = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const now = Date.now();
    const id = await ctx.db.insert("chat_threads", {
      ownerId,
      title: args.title ?? "Untitled",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    });
    return id;
  },
});

export const appendMessage = mutation({
  args: {
    threadId: v.id("chat_threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    mode: v.optional(v.union(v.literal("agent"), v.literal("persona"))),
    session: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const now = Date.now();
    const contentHash = hashAgentContent(args.content);
    const id = await ctx.db.insert("chat_messages", {
      threadId: args.threadId,
      ownerId,
      role: args.role,
      content: args.content,
      mode: args.mode,
      session: args.session,
      contentHash: contentHash ?? undefined,
      createdAt: now,
    });

    await ctx.db.patch(args.threadId, { updatedAt: now, lastMessageAt: now });
    return id;
  },
});

export const recordMemory = mutation({
  args: {
    threadId: v.id("chat_threads"),
    descriptor: v.string(),
    session: v.number(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const existing = await ctx.db
      .query("chat_memories")
      .withIndex("by_thread_session", (q) => q.eq("threadId", args.threadId).eq("session", args.session))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        descriptor: args.descriptor,
        metadata: args.metadata,
        createdAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("chat_memories", {
      threadId: args.threadId,
      ownerId,
      descriptor: args.descriptor,
      session: args.session,
      createdAt: now,
      metadata: args.metadata,
    });
  },
});

export const listMemories = query({
  args: { threadId: v.id("chat_threads") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const entries = await ctx.db
      .query("chat_memories")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    return entries;
  },
});

export const listThreads = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const all = await ctx.db
      .query("chat_threads")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const sorted = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return args.limit ? sorted.slice(0, args.limit) : sorted;
  },
});

export const listMessages = query({
  args: { threadId: v.id("chat_threads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const all = await ctx.db
      .query("chat_messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    const sorted = all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return args.limit ? sorted.slice(0, args.limit) : sorted;
  },
});

export const listMessagesPage = query({
  args: {
    threadId: v.id("chat_threads"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const pageSize = Math.min(Math.max(args.pageSize ?? 50, 1), 200);
    const page = await ctx.db
      .query("chat_messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    return { page: page.page, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const renameThread = mutation({
  args: { threadId: v.id("chat_threads"), title: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");
    await ctx.db.patch(args.threadId, { title: args.title, updatedAt: Date.now() });
    return true;
  },
});

export const deleteThread = mutation({
  args: { threadId: v.id("chat_threads") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    // Delete messages first
    const msgs = await ctx.db
      .query("chat_messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const m of msgs) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.threadId);
    return true;
  },
});
