import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const AUTO_ROOM_OWNER_ID = "auto-system";
const DEFAULT_AUTO_ROOM_CAPACITY = 20;
const DEFAULT_GROUP_CAPACITY = 50;

function getOwnerId(identity: UserIdentity): string {
  return identity.subject ?? identity.tokenIdentifier ?? identity.email ?? "unknown";
}

type AnyCtx = QueryCtx | MutationCtx;

async function ensureIdentity(ctx: AnyCtx): Promise<{ ownerId: string; identity: UserIdentity }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return { ownerId: getOwnerId(identity), identity };
}

type GroupChatDoc = Doc<"group_chats">;
type GroupMemberDoc = Doc<"group_members">;

async function listMembers(ctx: AnyCtx, chatId: Id<"group_chats">) {
  const members: GroupMemberDoc[] = await ctx.db
    .query("group_members")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .collect();

  const profiles = new Map<string, Doc<"profiles"> | null>();
  for (const member of members) {
    if (profiles.has(member.memberId)) continue;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", member.memberId))
      .first();
    profiles.set(member.memberId, profile ?? null);
  }

  return members.map((member) => ({
    memberId: member.memberId,
    nickname: profiles.get(member.memberId)?.nickname ?? undefined,
    email: profiles.get(member.memberId)?.email ?? undefined,
    role: member.role ?? undefined,
    joinedAt: member.joinedAt,
  }));
}

async function assertMembership(ctx: AnyCtx, chatId: Id<"group_chats">, memberId: string): Promise<GroupChatDoc> {
  const chat = await ctx.db.get(chatId);
  if (!chat) {
    throw new Error("Group not found");
  }
  const membership = await ctx.db
    .query("group_members")
    .withIndex("by_chat_member", (q) => q.eq("chatId", chatId).eq("memberId", memberId))
    .first();
  if (!membership) {
    throw new Error("Not a member");
  }
  return chat;
}

async function enrichMessages(ctx: AnyCtx, messages: Doc<"group_messages">[]) {
  const senderIds = Array.from(new Set(messages.map((m) => m.senderId)));
  const profiles = new Map<string, Doc<"profiles"> | null>();
  for (const senderId of senderIds) {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", senderId))
      .first();
    profiles.set(senderId, profile ?? null);
  }
  return messages.map((msg) => ({
    _id: msg._id,
    chatId: msg.chatId,
    senderId: msg.senderId,
    content: msg.content,
    createdAt: msg.createdAt,
    senderNickname: profiles.get(msg.senderId)?.nickname ?? undefined,
    senderEmail: profiles.get(msg.senderId)?.email ?? undefined,
  }));
}

function normalizeCapacity(raw: number | undefined, fallback: number) {
  const base = Number.isFinite(raw) ? Number(raw) : fallback;
  return Math.min(Math.max(base, 2), 200);
}

async function upsertMembership(
  ctx: MutationCtx,
  chatId: Id<"group_chats">,
  memberId: string,
  role?: string,
) {
  const existing = await ctx.db
    .query("group_members")
    .withIndex("by_chat_member", (q) => q.eq("chatId", chatId).eq("memberId", memberId))
    .first();
  if (existing) return existing._id;
  return ctx.db.insert("group_members", { chatId, memberId, role, joinedAt: Date.now() });
}

async function getAutoRoomForMember(ctx: AnyCtx, memberId: string) {
  const memberships = await ctx.db
    .query("group_members")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .collect();
  for (const membership of memberships) {
    const chat = await ctx.db.get(membership.chatId);
    if (chat && chat.isAuto) {
      return { chat, membership } as const;
    }
  }
  return null;
}

export const listGroupChats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);
    const memberships = await ctx.db
      .query("group_members")
      .withIndex("by_member", (q) => q.eq("memberId", ownerId))
      .collect();

    const result: Array<{
      chatId: Id<"group_chats">;
      name: string;
      ownerId: string;
      updatedAt: number;
      createdAt: number;
      capacity: number;
      memberCount: number;
    }> = [];

    for (const membership of memberships) {
      const chat = await ctx.db.get(membership.chatId);
      if (!chat || chat.isAuto) continue;
      const members = await ctx.db
        .query("group_members")
        .withIndex("by_chat", (q) => q.eq("chatId", membership.chatId))
        .collect();
      result.push({
        chatId: membership.chatId,
        name: chat.name,
        ownerId: chat.ownerId,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        capacity: chat.capacity,
        memberCount: members.length,
      });
    }

    return result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
});

export const listGroupMembers = query({
  args: { chatId: v.id("group_chats") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);
    await assertMembership(ctx, args.chatId, ownerId);
    return listMembers(ctx, args.chatId);
  },
});

export const listGroupMessages = query({
  args: { chatId: v.id("group_chats"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = getOwnerId(identity);
    await assertMembership(ctx, args.chatId, ownerId);
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const messages = await ctx.db
      .query("group_messages")
      .withIndex("by_chat_createdAt", (q) => q.eq("chatId", args.chatId))
      .order("asc")
      .take(limit);
    return enrichMessages(ctx, messages);
  },
});

export const createGroupChat = mutation({
  args: {
    name: v.string(),
    memberIds: v.optional(v.array(v.string())),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { ownerId } = await ensureIdentity(ctx);
    const now = Date.now();
    const name = args.name.trim();
    if (!name) {
      throw new Error("Group name required");
    }
    const capacity = normalizeCapacity(args.capacity, DEFAULT_GROUP_CAPACITY);
    const chatId = await ctx.db.insert("group_chats", {
      ownerId,
      name,
      isAuto: false,
      capacity,
      createdAt: now,
      updatedAt: now,
    });

    const memberSet = new Set<string>([ownerId]);
    for (const id of args.memberIds ?? []) {
      if (id && typeof id === "string") {
        memberSet.add(id);
      }
    }

    for (const memberId of memberSet) {
      await upsertMembership(ctx, chatId, memberId, memberId === ownerId ? "owner" : undefined);
    }

    return chatId;
  },
});

export const addGroupMembers = mutation({
  args: { chatId: v.id("group_chats"), memberIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { ownerId } = await ensureIdentity(ctx);
    const chat = await assertMembership(ctx, args.chatId, ownerId);
    if (chat.isAuto) {
      throw new Error("Cannot manually add members to auto rooms");
    }
    for (const memberId of args.memberIds) {
      if (!memberId) continue;
      await upsertMembership(ctx, args.chatId, memberId);
    }
    return { ok: true } as const;
  },
});

export const leaveGroupChat = mutation({
  args: { chatId: v.id("group_chats") },
  handler: async (ctx, args) => {
    const { ownerId } = await ensureIdentity(ctx);
    const chat = await assertMembership(ctx, args.chatId, ownerId);
    const membership = await ctx.db
      .query("group_members")
      .withIndex("by_chat_member", (q) => q.eq("chatId", args.chatId).eq("memberId", ownerId))
      .first();
    if (membership) {
      await ctx.db.delete(membership._id);
    }

    const remaining = await ctx.db
      .query("group_members")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    if (remaining.length === 0) {
      await ctx.db.delete(args.chatId);
      const messages = await ctx.db
        .query("group_messages")
        .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
        .collect();
      for (const msg of messages) {
        await ctx.db.delete(msg._id);
      }
      return { ok: true, deleted: true } as const;
    }

    if (chat.ownerId === ownerId) {
      const newOwner = remaining[0];
      if (newOwner) {
        await ctx.db.patch(args.chatId, { ownerId: newOwner.memberId, updatedAt: Date.now() });
        await upsertMembership(ctx, args.chatId, newOwner.memberId, "owner");
      }
    }

    return { ok: true, deleted: false } as const;
  },
});

export const sendGroupMessage = mutation({
  args: { chatId: v.id("group_chats"), content: v.string() },
  handler: async (ctx, args) => {
    const { ownerId } = await ensureIdentity(ctx);
    await assertMembership(ctx, args.chatId, ownerId);
    const trimmed = args.content.trim();
    if (!trimmed) {
      throw new Error("Message content required");
    }
    const now = Date.now();
    await ctx.db.insert("group_messages", {
      chatId: args.chatId,
      senderId: ownerId,
      content: trimmed,
      createdAt: now,
    });
    await ctx.db.patch(args.chatId, { updatedAt: now });
    return { ok: true, createdAt: now } as const;
  },
});

export const getMyAutoRoom = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const ownerId = getOwnerId(identity);
    const current = await getAutoRoomForMember(ctx, ownerId);
    if (!current) return null;
    const members = await listMembers(ctx, current.chat._id);
    const messages = await ctx.db
      .query("group_messages")
      .withIndex("by_chat_createdAt", (q) => q.eq("chatId", current.chat._id))
      .order("asc")
      .take(200);
    return {
      chat: current.chat,
      members,
      messages: await enrichMessages(ctx, messages),
    } as const;
  },
});

export const claimAutoRoom = mutation({
  args: { nickname: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { ownerId, identity } = await ensureIdentity(ctx);

    if (args.nickname && args.nickname.trim()) {
      const existingProfile = await ctx.db
        .query("profiles")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .first();
      const now = Date.now();
      if (existingProfile) {
        await ctx.db.patch(existingProfile._id, { nickname: args.nickname.trim(), updatedAt: now });
      } else {
        await ctx.db.insert("profiles", {
          ownerId,
          nickname: args.nickname.trim(),
          email: identity.email ?? undefined,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const existing = await getAutoRoomForMember(ctx, ownerId);
    if (existing) {
      const members = await listMembers(ctx, existing.chat._id);
      const messages = await ctx.db
        .query("group_messages")
        .withIndex("by_chat_createdAt", (q) => q.eq("chatId", existing.chat._id))
        .order("asc")
        .take(200);
      return {
        chat: existing.chat,
        members,
        messages: await enrichMessages(ctx, messages),
      } as const;
    }

    const candidates = await ctx.db
      .query("group_chats")
      .withIndex("by_isAuto", (q) => q.eq("isAuto", true))
      .order("asc")
      .take(100);

    let chosen: GroupChatDoc | null = null;

    for (const chat of candidates) {
      const members = await ctx.db
        .query("group_members")
        .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
        .collect();
      if (members.length < chat.capacity) {
        chosen = chat;
        break;
      }
    }

    if (!chosen) {
      const now = Date.now();
      const autoName = `Auto Room ${new Date(now).toLocaleDateString()} ${new Date(now).toLocaleTimeString()}`;
      const chatId = await ctx.db.insert("group_chats", {
        ownerId: AUTO_ROOM_OWNER_ID,
        name: autoName,
        isAuto: true,
        capacity: DEFAULT_AUTO_ROOM_CAPACITY,
        createdAt: now,
        updatedAt: now,
      });
      chosen = (await ctx.db.get(chatId)) as GroupChatDoc;
    }

    await upsertMembership(ctx, chosen._id, ownerId);

    const members = await listMembers(ctx, chosen._id);
    const messages = await ctx.db
      .query("group_messages")
      .withIndex("by_chat_createdAt", (q) => q.eq("chatId", chosen._id))
      .order("asc")
      .take(200);

    return {
      chat: chosen,
      members,
      messages: await enrichMessages(ctx, messages),
    } as const;
  },
});

export const leaveAutoRoom = mutation({
  args: {},
  handler: async (ctx) => {
    const { ownerId } = await ensureIdentity(ctx);
    const current = await getAutoRoomForMember(ctx, ownerId);
    if (!current) return { ok: false } as const;
    const membership = await ctx.db
      .query("group_members")
      .withIndex("by_chat_member", (q) => q.eq("chatId", current.chat._id).eq("memberId", ownerId))
      .first();
    if (membership) {
      await ctx.db.delete(membership._id);
    }
    return { ok: true } as const;
  },
});
