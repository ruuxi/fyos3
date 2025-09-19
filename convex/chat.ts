import { query, mutation } from "./_generated/server";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

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
      contentHash: contentHash ?? undefined,
      translatorState: args.role === "assistant" && args.mode === "agent" ? "pending" : undefined,
      createdAt: now,
    });

    await ctx.db.patch(args.threadId, { updatedAt: now, lastMessageAt: now });
    return id;
  },
});

export const updateMessageTranslator = mutation({
  args: {
    threadId: v.id("chat_threads"),
    messageId: v.optional(v.string()),
    normalizedContent: v.string(),
    translatorState: v.union(
      v.literal("pending"),
      v.literal("translating"),
      v.literal("done"),
      v.literal("error")
    ),
    translatorOutputs: v.optional(v.array(v.string())),
    translatorError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerId !== ownerId) throw new Error("Not found");

    const normalizedContent = normalizeAgentContent(args.normalizedContent);
    if (!normalizedContent) {
      throw new Error("Empty content payload");
    }

    const contentHash = hashAgentContent(normalizedContent);

    let targetMessageId: Id<'chat_messages'> | null = null;
    if (args.messageId) {
      try {
        targetMessageId = args.messageId as Id<'chat_messages'>;
        const direct = await ctx.db.get(targetMessageId);
        if (!direct || direct.ownerId !== ownerId || direct.threadId !== args.threadId) {
          targetMessageId = null;
        }
      } catch {
        targetMessageId = null;
      }
    }

    let messageRecord: {
      _id: Id<'chat_messages'>;
      ownerId: string;
      threadId: Id<'chat_threads'>;
      role: 'user' | 'assistant';
      content: string;
      createdAt: number;
      contentHash?: string;
    } | null = null;

    if (targetMessageId) {
      const direct = await ctx.db.get(targetMessageId);
      if (direct && direct.ownerId === ownerId && direct.threadId === args.threadId) {
        messageRecord = {
          _id: targetMessageId,
          ownerId: direct.ownerId,
          threadId: direct.threadId,
          role: direct.role,
          content: direct.content,
          createdAt: direct.createdAt,
          contentHash: direct.contentHash,
        };
      }
    }

    if (!messageRecord) {
      let candidates: Array<{
        _id: Id<'chat_messages'>;
        threadId: Id<'chat_threads'>;
        ownerId: string;
        role: 'user' | 'assistant';
        content: string;
        createdAt: number;
        contentHash?: string;
      }> = [];

      if (contentHash) {
        candidates = await ctx.db
          .query("chat_messages")
          .withIndex("by_thread_hash", (q) => q.eq("threadId", args.threadId).eq("contentHash", contentHash))
          .collect();
      }

      if (!candidates.length) {
        const fallback = await ctx.db
          .query("chat_messages")
          .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
          .collect();
        candidates = fallback.filter((doc) => {
          if (!doc || doc.ownerId !== ownerId) return false;
          if (doc.role !== 'assistant') return false;
          const normalizedStored = normalizeAgentContent(doc.content ?? '');
          return normalizedStored === normalizedContent;
        });
      }

      if (!candidates.length) {
        throw new Error("Message not found for translator update");
      }

      const message = candidates.reduce((latest, current) => {
        if (!latest) return current;
        return (current.createdAt ?? 0) > (latest.createdAt ?? 0) ? current : latest;
      });

      if (!message || message.ownerId !== ownerId) {
        throw new Error("Not authorized to update message");
      }
      messageRecord = message;
      targetMessageId = message._id;
    }

    if (!messageRecord || !targetMessageId) {
      throw new Error("Message not found for translator update");
    }

    await ctx.db.patch(targetMessageId, {
      translatorState: args.translatorState,
      translatorOutputs: args.translatorOutputs,
      translatorError: args.translatorError,
      translatorUpdatedAt: Date.now(),
      contentHash: contentHash ?? hashAgentContent(normalizedContent) ?? undefined,
    });

    return true;
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
