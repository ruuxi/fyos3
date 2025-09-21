import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

type BatchRunDoc = Doc<'agent_batch_runs'>;

const sanitizePrompts = (input: string[]): string[] =>
  input
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0);

const sanitizeTags = (input: string[] | undefined): string[] | undefined => {
  if (!input) return undefined;
  const cleaned = input
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
};

const deriveTotalRuns = (prompts: string[], runsPerPrompt: number, requestedRuns?: number | null): number => {
  const totalFromRunsPerPrompt = prompts.length * Math.max(1, Math.round(runsPerPrompt));
  if (typeof requestedRuns !== 'number' || !Number.isFinite(requestedRuns)) {
    return totalFromRunsPerPrompt;
  }
  const normalizedRequested = Math.max(0, Math.round(requestedRuns));
  return Math.max(totalFromRunsPerPrompt, normalizedRequested);
};

export const recordBatchStart = mutation({
  args: {
    name: v.optional(v.string()),
    batchId: v.string(),
    prompts: v.array(v.string()),
    runsPerPrompt: v.number(),
    requestedRuns: v.optional(v.number()),
    delayMs: v.number(),
    restoreBaseline: v.boolean(),
    tags: v.optional(v.array(v.string())),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = typeof args.name === 'string' ? args.name.trim() : undefined;
    const normalizedName = name && name.length > 0 ? name : undefined;
    const normalizedPrompts = sanitizePrompts(args.prompts);
    const runsPerPrompt = Math.max(1, Math.round(args.runsPerPrompt));
    const delayMs = Math.max(0, Math.round(args.delayMs));
    const startedAt = typeof args.startedAt === 'number' && Number.isFinite(args.startedAt)
      ? args.startedAt
      : now;
    const totalRuns = deriveTotalRuns(normalizedPrompts, runsPerPrompt, args.requestedRuns);

    const doc: Omit<BatchRunDoc, '_id' | '_creationTime'> = {
      name: normalizedName,
      batchId: args.batchId,
      prompts: normalizedPrompts,
      promptCount: normalizedPrompts.length,
      totalRuns,
      runsPerPrompt,
      delayMs,
      restoreBaseline: args.restoreBaseline,
      tags: sanitizeTags(args.tags),
      startedAt,
      finishedAt: undefined,
      successCount: 0,
      failureCount: 0,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };

    const batchRunId = await ctx.db.insert('agent_batch_runs', doc);
    return { ok: true as const, batchRunId };
  },
});

export const recordBatchResult = mutation({
  args: {
    batchRunId: v.id('agent_batch_runs'),
    finishedAt: v.optional(v.number()),
    successCount: v.number(),
    failureCount: v.number(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchRunId);
    if (!batch) {
      return { ok: false as const, error: 'not_found' as const };
    }

    const now = Date.now();
    const finishedAt = typeof args.finishedAt === 'number' && Number.isFinite(args.finishedAt)
      ? args.finishedAt
      : now;

    await ctx.db.patch(args.batchRunId, {
      finishedAt,
      successCount: Math.max(0, Math.round(args.successCount)),
      failureCount: Math.max(0, Math.round(args.failureCount)),
      status: args.status ?? (batch.status === 'running' ? 'finished' : batch.status),
      updatedAt: now,
    });

    return { ok: true as const };
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query('agent_batch_runs')
      .withIndex('by_startedAt')
      .order('desc')
      .take(limit);

    return runs.map((run) => ({
      batchRunId: run._id,
      name: run.name,
      batchId: run.batchId,
      prompts: run.prompts,
      promptCount: run.promptCount,
      totalRuns: run.totalRuns,
      runsPerPrompt: run.runsPerPrompt,
      delayMs: run.delayMs,
      restoreBaseline: run.restoreBaseline,
      tags: run.tags ?? [],
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      successCount: run.successCount ?? 0,
      failureCount: run.failureCount ?? 0,
      status: run.status ?? (run.finishedAt ? 'finished' : 'running'),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
  },
});

export const deleteRun = mutation({
  args: {
    batchRunId: v.id('agent_batch_runs'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.batchRunId);
    if (!existing) {
      return { ok: false as const, error: 'not_found' as const };
    }
    await ctx.db.delete(args.batchRunId);
    return { ok: true as const };
  },
});
