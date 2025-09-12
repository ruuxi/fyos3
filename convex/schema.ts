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
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"]) 
    .index("by_createdAt", ["createdAt"]),
});

