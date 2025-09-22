import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { UserIdentity } from "convex/server";

function getOwnerId(identity: UserIdentity): string {
  return identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const ownerId = getOwnerId(identity);
    const existing = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).first();
    if (!existing) return null;
    return existing;
  },
});

export const upsertMyProfile = mutation({
  args: {
    nickname: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const email = identity.email ?? undefined;
    const now = Date.now();
    const existing = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { nickname: args.nickname ?? existing.nickname, email: email ?? existing.email, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("profiles", { ownerId, email, nickname: args.nickname, createdAt: now, updatedAt: now });
  },
});

export const findProfile = query({
  args: { ownerId: v.optional(v.string()), email: v.optional(v.string()), nickname: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.ownerId) {
      const byOwner = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId as string)).first();
      return byOwner ?? null;
    }
    if (args.email) {
      const byEmail = await ctx.db.query("profiles").withIndex("by_email", (q) => q.eq("email", args.email as string)).first();
      if (byEmail) return byEmail;
    }
    if (args.nickname) {
      // Simple nickname lookup (not unique guaranteed)
      const byNick = await ctx.db.query("profiles").withIndex("by_nickname", (q) => q.eq("nickname", args.nickname as string)).first();
      if (byNick) return byNick;
    }
    return null;
  },
});

export const addFriend = mutation({
  args: { nickname: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);

    const friendProfile = await ctx.db
      .query("profiles")
      .withIndex("by_nickname", (q) => q.eq("nickname", args.nickname))
      .first();
    if (!friendProfile) throw new Error("Friend not found");
    const friendId = friendProfile.ownerId;
    if (friendId === ownerId) throw new Error("Cannot add yourself");

    const existing = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", ownerId).eq("friendId", friendId))
      .first();
    if (!existing) {
      await ctx.db.insert("friendships", { ownerId, friendId, createdAt: Date.now() });
    }
    // Insert reverse edge to make it symmetric for simple UX
    const reverse = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", friendId).eq("friendId", ownerId))
      .first();
    if (!reverse) {
      await ctx.db.insert("friendships", { ownerId: friendId, friendId: ownerId, createdAt: Date.now() });
    }
    return { ok: true };
  },
});

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);
    const rows = await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).collect();
    const friends: Array<{ ownerId: string; nickname?: string; email?: string }> = [];
    for (const row of rows) {
      const prof = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerId", row.friendId)).first();
      friends.push({ ownerId: row.friendId, nickname: prof?.nickname, email: prof?.email });
    }
    // De-duplicate in case of duplicates
    const unique = new Map<string, { ownerId: string; nickname?: string; email?: string }>();
    for (const f of friends) unique.set(f.ownerId, f);
    return Array.from(unique.values());
  },
});

export const sendDm = mutation({
  args: { peerId: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const ownerId = getOwnerId(identity);
    const peerId = args.peerId;
    const now = Date.now();

    // Insert for sender's view
    await ctx.db.insert("dm_messages", { ownerId, peerId, senderId: ownerId, content: args.content, createdAt: now });
    // Insert for recipient's view
    await ctx.db.insert("dm_messages", { ownerId: peerId, peerId: ownerId, senderId: ownerId, content: args.content, createdAt: now });
    return { ok: true, createdAt: now };
  },
});

export const listDmMessages = query({
  args: { peerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);
    const lim = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const page = await ctx.db
      .query("dm_messages")
      .withIndex("by_owner_peer_createdAt", (q) => q.eq("ownerId", ownerId).eq("peerId", args.peerId))
      .order("asc")
      .take(lim);
    return page;
  },
});

export const listDmThreads = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);

    const latestByPeer = new Map<
      string,
      { lastMessageAt: number; content: string; senderId: string }
    >();

    const recentMessages = await ctx.db
      .query("dm_messages")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(500);

    for (const message of recentMessages) {
      if (!latestByPeer.has(message.peerId)) {
        latestByPeer.set(message.peerId, {
          lastMessageAt: message.createdAt,
          content: message.content,
          senderId: message.senderId,
        });
      }
    }

    const friendships = await ctx.db
      .query("friendships")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    const peerIds = new Set<string>();
    for (const row of friendships) {
      peerIds.add(row.friendId);
    }
    for (const peerId of latestByPeer.keys()) {
      peerIds.add(peerId);
    }

    const threads: Array<{
      peerId: string;
      peerNickname?: string;
      peerEmail?: string;
      lastMessageAt: number;
      lastMessageContent?: string;
      lastMessageSenderId?: string;
    }> = [];

    for (const peerId of peerIds) {
      const latest = latestByPeer.get(peerId);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_owner", (q) => q.eq("ownerId", peerId))
        .first();

      threads.push({
        peerId,
        peerNickname: profile?.nickname ?? undefined,
        peerEmail: profile?.email ?? undefined,
        lastMessageAt: latest?.lastMessageAt ?? 0,
        lastMessageContent: latest?.content ?? undefined,
        lastMessageSenderId: latest?.senderId ?? undefined,
      });
    }

    threads.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    return threads;
  },
});
