import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    body: v.string(),
    author: v.string(),
    createdAt: v.number(),
  }).index("by_author", ["author"]).index("by_createdAt", ["createdAt"]),

  apps_public: defineTable({
    ownerId: v.string(),
    appId: v.string(),
    name: v.string(),
    icon: v.optional(v.string()),
    version: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    size: v.optional(v.number()),
    r2KeyTar: v.string(),
    manifestHash: v.optional(v.string()),
    depsHash: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_name", ["name"]) 
    .index("by_appId", ["appId"]) 
    .index("by_updatedAt", ["updatedAt"]),

  desktops_public: defineTable({
    ownerId: v.string(),
    desktopId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    size: v.optional(v.number()),
    r2KeySnapshot: v.string(),
    manifestHash: v.optional(v.string()),
    lockfileHash: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_title", ["title"]) 
    .index("by_desktopId", ["desktopId"]) 
    .index("by_updatedAt", ["updatedAt"]),

  installs: defineTable({
    userId: v.string(),
    targetType: v.union(v.literal("desktop"), v.literal("app")),
    targetId: v.string(),
    version: v.optional(v.string()),
    installedAt: v.number(),
    installMeta: v.optional(v.any()),
  })
    .index("by_user", ["userId"]) 
    .index("by_target", ["targetType", "targetId"]) 
    .index("by_installedAt", ["installedAt"]),

  metrics_daily: defineTable({
    day: v.string(), // YYYY-MM-DD
    name: v.string(), // e.g., installs, publish_apps, publish_desktops
    count: v.number(),
  })
    .index("by_day_name", ["day", "name"]),
  
  media_public: defineTable({
    ownerId: v.string(),
    desktopId: v.optional(v.string()),
    appId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    sha256: v.string(),
    size: v.number(),
    contentType: v.string(),
    r2Key: v.string(),
    publicUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_thread", ["ownerId", "threadId"]) 
    .index("by_owner_createdAt", ["ownerId", "createdAt"]) 
    .index("by_owner_thread_createdAt", ["ownerId", "threadId", "createdAt"]) 
    .index("by_sha256", ["sha256"])
    .index("by_owner_sha", ["ownerId", "sha256"])
    .index("by_owner_app", ["ownerId", "appId"])
    .index("by_owner_desktop", ["ownerId", "desktopId"])
    .index("by_createdAt", ["createdAt"]),

  // Private desktop snapshots (per-user, not publicly listed)
  desktops_private: defineTable({
    ownerId: v.string(),
    desktopId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    r2KeySnapshot: v.string(),
    size: v.optional(v.number()),
    fileCount: v.optional(v.number()),
    contentSha256: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_desktopId", ["desktopId"]) 
    .index("by_updatedAt", ["updatedAt"]),

  // Chat threads per user
  chat_threads: defineTable({
    ownerId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_updatedAt", ["updatedAt"]),

  // Chat messages per thread
  chat_messages: defineTable({
    threadId: v.id("chat_threads"),
    ownerId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    mode: v.optional(v.union(v.literal("agent"), v.literal("persona"))),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"]) 
    .index("by_createdAt", ["createdAt"]),

  // User profile (nickname, email for friend discovery)
  profiles: defineTable({
    ownerId: v.string(),
    email: v.optional(v.string()),
    nickname: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_email", ["email"]) 
    .index("by_nickname", ["nickname"]),

  // Friendships are stored as directed edges (ownerId -> friendId). Insert both directions to make it symmetric.
  friendships: defineTable({
    ownerId: v.string(),
    friendId: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_owner_friend", ["ownerId", "friendId"]),

  // Direct messages duplicated per owner for efficient per-user queries
  dm_messages: defineTable({
    ownerId: v.string(),
    peerId: v.string(),
    senderId: v.string(),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner_peer_createdAt", ["ownerId", "peerId", "createdAt"]) 
    .index("by_owner_createdAt", ["ownerId", "createdAt"]),

  // Group chat metadata (manual and auto-assigned rooms)
  group_chats: defineTable({
    ownerId: v.string(),
    name: v.string(),
    isAuto: v.boolean(),
    capacity: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]) 
    .index("by_isAuto", ["isAuto", "createdAt"]) 
    .index("by_updatedAt", ["updatedAt"]),

  // Group chat members
  group_members: defineTable({
    chatId: v.id("group_chats"),
    memberId: v.string(),
    role: v.optional(v.string()),
    joinedAt: v.number(),
  })
    .index("by_chat", ["chatId"]) 
    .index("by_member", ["memberId"]) 
    .index("by_chat_member", ["chatId", "memberId"]),

  // Group chat messages
  group_messages: defineTable({
    chatId: v.id("group_chats"),
    senderId: v.string(),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId"]) 
    .index("by_chat_createdAt", ["chatId", "createdAt"]),

  agent_sessions: defineTable({
    sessionId: v.string(),
    requestId: v.string(),
    userIdentifier: v.optional(v.string()),
    threadId: v.optional(v.string()),
    model: v.optional(v.string()),
    personaMode: v.optional(v.boolean()),
    toolNames: v.optional(v.array(v.string())),
    attachmentsCount: v.optional(v.number()),
    messagePreviews: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    sessionStartedAt: v.number(),
    sessionFinishedAt: v.optional(v.number()),
    firstEventAt: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    firstUserMessageAt: v.optional(v.number()),
    lastAssistantMessageAt: v.optional(v.number()),
    endToEndStartedAt: v.optional(v.number()),
    endToEndFinishedAt: v.optional(v.number()),
    endToEndDurationMs: v.optional(v.number()),
    stepCount: v.optional(v.number()),
    toolCallCount: v.optional(v.number()),
    estimatedUsage: v.optional(v.any()),
    actualUsage: v.optional(v.any()),
    estimatedCostUSD: v.optional(v.number()),
    actualCostUSD: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"]) 
    .index("by_requestId", ["requestId"]) 
    .index("by_createdAt", ["createdAt"]) 
    .index("by_user", ["userIdentifier", "createdAt"]),

  agent_steps: defineTable({
    sessionId: v.string(),
    requestId: v.string(),
    stepIndex: v.number(),
    timestamp: v.number(),
    finishReason: v.optional(v.string()),
    textLength: v.number(),
    toolCallsCount: v.number(),
    toolResultsCount: v.number(),
    usage: v.optional(v.any()),
    generatedTextPreview: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_session_step", ["sessionId", "stepIndex"]) 
    .index("by_session", ["sessionId"]) 
    .index("by_timestamp", ["timestamp"]),

  agent_tool_calls: defineTable({
    sessionId: v.string(),
    requestId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    stepIndex: v.number(),
    status: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    inputSummary: v.optional(v.any()),
    resultSummary: v.optional(v.any()),
    tokenUsage: v.optional(v.any()),
    costUSD: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    outboundSequence: v.optional(v.number()),
    outboundAt: v.optional(v.number()),
    outboundPayload: v.optional(v.any()),
    inboundSequence: v.optional(v.number()),
    inboundAt: v.optional(v.number()),
    inboundPayload: v.optional(v.any()),
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session_tool", ["sessionId", "toolCallId"]) 
    .index("by_session", ["sessionId"]) 
    .index("by_completed", ["completedAt"]),

  agent_events: defineTable({
    sessionId: v.string(),
    requestId: v.string(),
    sequence: v.number(),
    timestamp: v.number(),
    kind: v.string(),
    payload: v.any(),
    source: v.optional(v.string()),
    model: v.optional(v.string()),
    threadId: v.optional(v.string()),
    personaMode: v.optional(v.boolean()),
    userIdentifier: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_session_sequence", ["sessionId", "sequence"]) 
    .index("by_session", ["sessionId"]) 
    .index("by_createdAt", ["createdAt"]),

  agent_batch_runs: defineTable({
    name: v.optional(v.string()),
    batchId: v.string(),
    prompts: v.array(v.string()),
    promptCount: v.number(),
    totalRuns: v.number(),
    runsPerPrompt: v.number(),
    delayMs: v.number(),
    restoreBaseline: v.boolean(),
    tags: v.optional(v.array(v.string())),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    successCount: v.optional(v.number()),
    failureCount: v.optional(v.number()),
    status: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batchId", ["batchId"]) 
    .index("by_startedAt", ["startedAt"]),
});
