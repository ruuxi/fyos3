import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type IncomingEvent = {
  sessionId: string;
  requestId: string;
  timestamp: number;
  sequence: number;
  kind: string;
  payload: Record<string, unknown>;
  source?: string;
  model?: string;
  threadId?: string;
  personaMode?: boolean;
  dedupeKey?: string;
  userIdentifier?: string;
};

type UsageRecord = Partial<Record<'promptTokens' | 'completionTokens' | 'totalTokens' | 'reasoningTokens' | 'cachedInputTokens' | 'charCount', number>>;

const usageKeys: Array<keyof UsageRecord> = [
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedInputTokens',
  'charCount',
];

const pickDefined = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
};

const mergeUsage = (base?: UsageRecord, delta?: UsageRecord): UsageRecord => {
  const result: UsageRecord = {};
  for (const key of usageKeys) {
    const baseValue = typeof base?.[key] === 'number' ? (base?.[key] as number) : 0;
    const deltaValue = typeof delta?.[key] === 'number' ? (delta?.[key] as number) : 0;
    const total = baseValue + deltaValue;
    if (total > 0) {
      result[key] = Number(total.toFixed(4));
    }
  }
  return result;
};

const hasUsage = (usage?: UsageRecord): boolean => {
  if (!usage) return false;
  return usageKeys.some((key) => typeof usage[key] === 'number' && (usage[key] as number) > 0);
};

const getSessionBySessionId = async (ctx: MutationCtx, sessionId: string): Promise<Doc<'agent_sessions'> | null> => {
  return await ctx.db
    .query('agent_sessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
};

const ensureSessionRecord = async (
  ctx: MutationCtx,
  event: IncomingEvent,
  defaults: Partial<Doc<'agent_sessions'>> = {}
): Promise<Doc<'agent_sessions'>> => {
  const existing = await getSessionBySessionId(ctx, event.sessionId);
  if (existing) return existing;

  const insertBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    sessionStartedAt: defaults.sessionStartedAt ?? event.timestamp,
    createdAt: defaults.createdAt ?? event.timestamp,
    updatedAt: defaults.updatedAt ?? event.timestamp,
  } satisfies Pick<Doc<'agent_sessions'>, 'sessionId' | 'requestId' | 'sessionStartedAt' | 'createdAt' | 'updatedAt'>;

  const insertOptional = pickDefined({
    userIdentifier: defaults.userIdentifier ?? event.userIdentifier,
    threadId: defaults.threadId ?? event.threadId,
    model: defaults.model ?? event.model,
    personaMode: defaults.personaMode ?? event.personaMode ?? false,
    toolNames: defaults.toolNames ?? [],
    attachmentsCount: defaults.attachmentsCount,
    messagePreviews: defaults.messagePreviews,
    sessionFinishedAt: defaults.sessionFinishedAt,
    stepCount: defaults.stepCount ?? 0,
    toolCallCount: defaults.toolCallCount ?? 0,
    estimatedUsage: defaults.estimatedUsage,
    actualUsage: defaults.actualUsage,
    estimatedCostUSD: defaults.estimatedCostUSD,
    actualCostUSD: defaults.actualCostUSD,
  });

  const insertDoc = { ...insertBase, ...insertOptional };

  const insertId = await ctx.db.insert('agent_sessions', insertDoc);

  const created = await ctx.db.get(insertId);
  if (!created) {
    throw new Error('Failed to create agent session record');
  }
  return created;
};

const recordEvent = async (ctx: MutationCtx, event: IncomingEvent): Promise<Id<'agent_events'> | null> => {
  const existing = await ctx.db
    .query('agent_events')
    .withIndex('by_session_sequence', (q) => q.eq('sessionId', event.sessionId).eq('sequence', event.sequence))
    .first();
  if (existing) {
    return existing._id;
  }
  return await ctx.db.insert('agent_events', {
    sessionId: event.sessionId,
    requestId: event.requestId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    payload: event.payload,
    source: event.source,
    model: event.model,
    threadId: event.threadId,
    personaMode: event.personaMode,
    userIdentifier: event.userIdentifier,
    dedupeKey: event.dedupeKey,
    createdAt: event.timestamp,
  });
};

const handleSessionStarted = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const defaults: Partial<Doc<'agent_sessions'>> = {
    userIdentifier: event.userIdentifier ?? (payload.userIdentifier as string | undefined),
    threadId: event.threadId,
    model: event.model,
    personaMode: (payload.personaMode as boolean | undefined) ?? event.personaMode ?? false,
    toolNames: Array.isArray(payload.toolNames) ? (payload.toolNames as string[]) : [],
    attachmentsCount: typeof payload.attachmentsCount === 'number' ? (payload.attachmentsCount as number) : undefined,
    messagePreviews: payload.messagePreviews,
    sessionStartedAt: typeof payload.sessionStartedAt === 'number' ? (payload.sessionStartedAt as number) : event.timestamp,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };

  const session = await ensureSessionRecord(ctx, event, defaults);
  await ctx.db.patch(session._id, pickDefined({
    userIdentifier: defaults.userIdentifier,
    threadId: event.threadId ?? session.threadId,
    model: event.model ?? session.model,
    personaMode: defaults.personaMode,
    toolNames: defaults.toolNames,
    attachmentsCount: defaults.attachmentsCount,
    messagePreviews: defaults.messagePreviews,
    sessionStartedAt: defaults.sessionStartedAt,
    updatedAt: event.timestamp,
  }));
};

const handleStepFinished = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const stepIndex = typeof payload.stepIndex === 'number' ? (payload.stepIndex as number) : 0;
  const session = await ensureSessionRecord(ctx, event);

  const existingStep = await ctx.db
    .query('agent_steps')
    .withIndex('by_session_step', (q) => q.eq('sessionId', event.sessionId).eq('stepIndex', stepIndex))
    .first();

  const stepBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    stepIndex,
    timestamp: event.timestamp,
    textLength: typeof payload.textLength === 'number' ? (payload.textLength as number) : 0,
    toolCallsCount: typeof payload.toolCallsCount === 'number' ? (payload.toolCallsCount as number) : 0,
    toolResultsCount: typeof payload.toolResultsCount === 'number' ? (payload.toolResultsCount as number) : 0,
    createdAt: existingStep ? existingStep.createdAt : event.timestamp,
  } satisfies Pick<Doc<'agent_steps'>, 'sessionId' | 'requestId' | 'stepIndex' | 'timestamp' | 'textLength' | 'toolCallsCount' | 'toolResultsCount' | 'createdAt'>;

  const stepOptional = pickDefined({
    finishReason: typeof payload.finishReason === 'string' ? (payload.finishReason as string) : undefined,
    usage: payload.usage,
    generatedTextPreview: typeof payload.generatedTextPreview === 'string' ? (payload.generatedTextPreview as string) : undefined,
  });

  if (existingStep) {
    await ctx.db.patch(existingStep._id, {
      ...stepOptional,
      timestamp: stepBase.timestamp,
      textLength: stepBase.textLength,
      toolCallsCount: stepBase.toolCallsCount,
      toolResultsCount: stepBase.toolResultsCount,
    });
  } else {
    await ctx.db.insert('agent_steps', { ...stepBase, ...stepOptional });
  }

  const currentStepCount = session.stepCount ?? 0;
  const desiredStepCount = Math.max(currentStepCount, stepIndex + 1);
  await ctx.db.patch(session._id, pickDefined({
    stepCount: desiredStepCount,
    updatedAt: event.timestamp,
  }));
};

const handleToolCallStarted = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const toolCallId = typeof payload.toolCallId === 'string' ? (payload.toolCallId as string) : `tc_${event.sequence}`;
  const toolName = typeof payload.toolName === 'string' ? (payload.toolName as string) : 'unknown';
  const stepIndex = typeof payload.stepIndex === 'number' ? (payload.stepIndex as number) : 0;

  const session = await ensureSessionRecord(ctx, event);

  const existing = await ctx.db
    .query('agent_tool_calls')
    .withIndex('by_session_tool', (q) => q.eq('sessionId', event.sessionId).eq('toolCallId', toolCallId))
    .first();

  const insertBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    toolCallId,
    toolName,
    stepIndex,
    status: 'started',
    startedAt: event.timestamp,
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
  } satisfies Pick<Doc<'agent_tool_calls'>, 'sessionId' | 'requestId' | 'toolCallId' | 'toolName' | 'stepIndex' | 'status' | 'startedAt' | 'createdAt' | 'updatedAt'>;

  const optionalFields = pickDefined({
    inputSummary: payload.inputSummary,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...optionalFields,
      toolName,
      stepIndex,
      status: 'started',
      startedAt: typeof existing.startedAt === 'number' ? existing.startedAt : insertBase.startedAt,
      updatedAt: event.timestamp,
    });
  } else {
    await ctx.db.insert('agent_tool_calls', { ...insertBase, ...optionalFields });
  }
};

const handleToolCallOutbound = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const toolCallId = typeof payload.toolCallId === 'string' ? (payload.toolCallId as string) : `tc_${event.sequence}`;
  const toolName = typeof payload.toolName === 'string' ? (payload.toolName as string) : 'unknown';
  const stepIndex = typeof payload.stepIndex === 'number' ? (payload.stepIndex as number) : 0;
  const argsSummary = typeof payload.argsSummary === 'object' && payload.argsSummary !== null
    ? (payload.argsSummary as Record<string, unknown>)
    : undefined;

  const session = await ensureSessionRecord(ctx, event);

  const existing = await ctx.db
    .query('agent_tool_calls')
    .withIndex('by_session_tool', (q) => q.eq('sessionId', event.sessionId).eq('toolCallId', toolCallId))
    .first();

  const insertBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    toolCallId,
    toolName,
    stepIndex,
    status: 'outbound',
    startedAt: event.timestamp,
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
  } satisfies Pick<Doc<'agent_tool_calls'>, 'sessionId' | 'requestId' | 'toolCallId' | 'toolName' | 'stepIndex' | 'status' | 'startedAt' | 'createdAt' | 'updatedAt'>;

  const optionalFields = pickDefined({
    inputSummary: argsSummary,
    outboundSequence: event.sequence,
    outboundAt: event.timestamp,
    outboundPayload: payload,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...optionalFields,
      toolName,
      stepIndex,
      status: 'outbound',
      startedAt: typeof existing.startedAt === 'number' ? existing.startedAt : insertBase.startedAt,
      updatedAt: event.timestamp,
    });
  } else {
    await ctx.db.insert('agent_tool_calls', { ...insertBase, ...optionalFields });
  }

  await ctx.db.patch(session._id, pickDefined({ updatedAt: event.timestamp }));
};

const handleToolCallFinished = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const toolCallId = typeof payload.toolCallId === 'string' ? (payload.toolCallId as string) : `tc_${event.sequence}`;
  const toolName = typeof payload.toolName === 'string' ? (payload.toolName as string) : 'unknown';
  const stepIndex = typeof payload.stepIndex === 'number' ? (payload.stepIndex as number) : 0;
  const durationMs = typeof payload.durationMs === 'number' ? (payload.durationMs as number) : undefined;
  const costUSD = typeof payload.costUSD === 'number' ? (payload.costUSD as number) : undefined;
  const tokenUsage = payload.tokenUsage as UsageRecord | undefined;
  const resultSummary = payload.resultSummary ?? {};
  const isError = typeof resultSummary === 'object' && resultSummary !== null ? Boolean((resultSummary as { isError?: boolean }).isError) : false;

  const session = await ensureSessionRecord(ctx, event);

  const existing = await ctx.db
    .query('agent_tool_calls')
    .withIndex('by_session_tool', (q) => q.eq('sessionId', event.sessionId).eq('toolCallId', toolCallId))
    .first();

  const alreadyCompleted = existing?.status === 'completed';

  const completionBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    toolCallId,
    toolName,
    stepIndex,
    status: 'completed',
    startedAt: typeof existing?.startedAt === 'number'
      ? (existing.startedAt as number)
      : durationMs ? event.timestamp - durationMs : event.timestamp,
    completedAt: event.timestamp,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  } satisfies Pick<Doc<'agent_tool_calls'>, 'sessionId' | 'requestId' | 'toolCallId' | 'toolName' | 'stepIndex' | 'status' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'>;

  const completionOptional = pickDefined({
    durationMs,
    inputSummary: payload.inputSummary,
    resultSummary,
    tokenUsage,
    costUSD,
    isError,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...completionOptional,
      toolName,
      stepIndex,
      status: 'completed',
      completedAt: event.timestamp,
      updatedAt: event.timestamp,
    });
  } else {
    await ctx.db.insert('agent_tool_calls', { ...completionBase, ...completionOptional });
  }

  if (!alreadyCompleted) {
    const estimatedUsage = hasUsage(tokenUsage)
      ? mergeUsage(session.estimatedUsage as UsageRecord | undefined, tokenUsage)
      : (session.estimatedUsage as UsageRecord | undefined);
    const newEstimatedCost = typeof costUSD === 'number'
      ? Number(((session.estimatedCostUSD ?? 0) + costUSD).toFixed(6))
      : session.estimatedCostUSD;

    await ctx.db.patch(session._id, pickDefined({
      toolCallCount: (session.toolCallCount ?? 0) + 1,
      estimatedUsage,
      estimatedCostUSD: newEstimatedCost,
      updatedAt: event.timestamp,
    }));
  } else {
    await ctx.db.patch(session._id, pickDefined({ updatedAt: event.timestamp }));
  }
};

const handleToolCallInbound = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const toolCallId = typeof payload.toolCallId === 'string' ? (payload.toolCallId as string) : `tc_${event.sequence}`;
  const toolName = typeof payload.toolName === 'string' ? (payload.toolName as string) : 'unknown';
  const stepIndex = typeof payload.stepIndex === 'number' ? (payload.stepIndex as number) : 0;
  const durationMs = typeof payload.durationMs === 'number' ? (payload.durationMs as number) : undefined;
  const resultSummary = typeof payload.resultSummary === 'object' && payload.resultSummary !== null
    ? (payload.resultSummary as Record<string, unknown>)
    : undefined;
  const tokenUsage = payload.tokenUsage as UsageRecord | undefined;
  const costUSD = typeof payload.costUSD === 'number' ? (payload.costUSD as number) : undefined;
  const isError = Boolean((resultSummary?.isError as boolean | undefined) ?? false);

  const session = await ensureSessionRecord(ctx, event);

  const existing = await ctx.db
    .query('agent_tool_calls')
    .withIndex('by_session_tool', (q) => q.eq('sessionId', event.sessionId).eq('toolCallId', toolCallId))
    .first();

  const startedAt = typeof existing?.startedAt === 'number'
    ? (existing.startedAt as number)
    : durationMs ? event.timestamp - durationMs : event.timestamp;

  const insertBase = {
    sessionId: event.sessionId,
    requestId: event.requestId,
    toolCallId,
    toolName,
    stepIndex,
    status: 'inbound_received',
    startedAt,
    completedAt: event.timestamp,
    durationMs,
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
  } satisfies Pick<Doc<'agent_tool_calls'>, 'sessionId' | 'requestId' | 'toolCallId' | 'toolName' | 'stepIndex' | 'status' | 'startedAt' | 'completedAt' | 'durationMs' | 'createdAt' | 'updatedAt'>;

  const optionalFields = pickDefined({
    resultSummary,
    tokenUsage,
    costUSD,
    isError,
    inboundSequence: event.sequence,
    inboundAt: event.timestamp,
    inboundPayload: payload,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...optionalFields,
      toolName,
      stepIndex,
      status: 'inbound_received',
      completedAt: event.timestamp,
      durationMs,
      updatedAt: event.timestamp,
    });
  } else {
    await ctx.db.insert('agent_tool_calls', { ...insertBase, ...optionalFields });
  }

  await ctx.db.patch(session._id, pickDefined({ updatedAt: event.timestamp }));
};

const handleSessionFinished = async (ctx: MutationCtx, event: IncomingEvent) => {
  const payload = event.payload ?? {};
  const session = await ensureSessionRecord(ctx, event);

  const estimatedUsage = payload.estimatedUsage as UsageRecord | undefined;
  const actualUsage = payload.actualUsage as UsageRecord | undefined;
  const estimatedCostUSD = typeof payload.estimatedCostUSD === 'number'
    ? Number((payload.estimatedCostUSD as number).toFixed(6))
    : session.estimatedCostUSD;
  const actualCostUSD = typeof payload.actualCostUSD === 'number'
    ? Number((payload.actualCostUSD as number).toFixed(6))
    : session.actualCostUSD;

  await ctx.db.patch(session._id, pickDefined({
    sessionFinishedAt: event.timestamp,
    stepCount: typeof payload.stepCount === 'number' ? (payload.stepCount as number) : session.stepCount,
    toolCallCount: typeof payload.toolCallCount === 'number' ? (payload.toolCallCount as number) : session.toolCallCount,
    estimatedUsage: hasUsage(estimatedUsage) ? estimatedUsage : session.estimatedUsage,
    actualUsage: hasUsage(actualUsage) ? actualUsage : session.actualUsage,
    estimatedCostUSD,
    actualCostUSD,
    updatedAt: event.timestamp,
  }));
};

const kindHandlers: Record<string, (ctx: MutationCtx, event: IncomingEvent) => Promise<void>> = {
  session_started: handleSessionStarted,
  step_finished: handleStepFinished,
  tool_call_started: handleToolCallStarted,
  tool_call_finished: handleToolCallFinished,
  tool_call_outbound: handleToolCallOutbound,
  tool_call_inbound: handleToolCallInbound,
  session_finished: handleSessionFinished,
};

export const ingestEvent = mutation({
  args: {
    event: v.object({
      sessionId: v.string(),
      requestId: v.string(),
      timestamp: v.number(),
      sequence: v.number(),
      kind: v.string(),
      payload: v.any(),
      source: v.optional(v.string()),
      model: v.optional(v.string()),
      threadId: v.optional(v.string()),
      personaMode: v.optional(v.boolean()),
      dedupeKey: v.optional(v.string()),
      userIdentifier: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const event = args.event as IncomingEvent;

    await recordEvent(ctx, event);

    const handler = kindHandlers[event.kind];
    if (handler) {
      await handler(ctx, event);
    } else {
      const session = await ensureSessionRecord(ctx, event);
      await ctx.db.patch(session._id, pickDefined({ updatedAt: event.timestamp }));
    }

    return { ok: true } as const;
  },
});

const usageValue = (usage: UsageRecord | undefined, key: keyof UsageRecord): number => {
  const value = usage?.[key];
  return typeof value === 'number' ? value : 0;
};

export const listSessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 25, 200));
    const sessions = await ctx.db
      .query('agent_sessions')
      .withIndex('by_createdAt')
      .order('desc')
      .take(limit);

    return sessions.map((session) => {
      const estimatedUsage = session.estimatedUsage as UsageRecord | undefined;
      const actualUsage = session.actualUsage as UsageRecord | undefined;
      const durationMs = typeof session.sessionFinishedAt === 'number'
        ? session.sessionFinishedAt - session.sessionStartedAt
        : undefined;

      return {
        sessionId: session.sessionId,
        requestId: session.requestId,
        userIdentifier: session.userIdentifier,
        model: session.model,
        personaMode: session.personaMode ?? false,
        toolCallCount: session.toolCallCount ?? 0,
        stepCount: session.stepCount ?? 0,
        estimatedCostUSD: session.estimatedCostUSD ?? 0,
        actualCostUSD: session.actualCostUSD ?? null,
        estimatedUsage,
        actualUsage,
        sessionStartedAt: session.sessionStartedAt,
        sessionFinishedAt: session.sessionFinishedAt ?? null,
        durationMs,
        attachmentsCount: session.attachmentsCount ?? 0,
        messagePreviews: session.messagePreviews ?? null,
        status: session.sessionFinishedAt ? 'completed' : 'active',
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      };
    });
  },
});

export const getSessionTimeline = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('agent_sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .first();
    if (!session) return null;

    const steps = await ctx.db
      .query('agent_steps')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .take(500);
    steps.sort((a, b) => a.stepIndex - b.stepIndex);

    const toolCalls = await ctx.db
      .query('agent_tool_calls')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .take(1000);
    toolCalls.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

    const events = await ctx.db
      .query('agent_events')
      .withIndex('by_session_sequence', (q) => q.eq('sessionId', args.sessionId))
      .take(2000);

    return {
      session,
      steps,
      toolCalls,
      events,
    };
  },
});

export const getSummary = query({
  args: {
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = 200;
    const now = Date.now();
    const windowStart = args.windowMs ? now - args.windowMs : undefined;

    const allSessions = await ctx.db
      .query('agent_sessions')
      .withIndex('by_createdAt')
      .order('desc')
      .take(limit);

    const sessions = windowStart
      ? allSessions.filter((session) => session.createdAt >= windowStart)
      : allSessions;

    const totalSessions = sessions.length;
    const activeSessions = sessions.filter((session) => !session.sessionFinishedAt).length;
    const totalToolCalls = sessions.reduce((acc, session) => acc + (session.toolCallCount ?? 0), 0);

    const totalEstimatedTokens = sessions.reduce((acc, session) => {
      const usage = session.estimatedUsage as UsageRecord | undefined;
      return acc + usageValue(usage, 'totalTokens');
    }, 0);
    const totalActualTokens = sessions.reduce((acc, session) => {
      const usage = session.actualUsage as UsageRecord | undefined;
      return acc + usageValue(usage, 'totalTokens');
    }, 0);

    const estimatedCostUSD = sessions.reduce((acc, session) => acc + (session.estimatedCostUSD ?? 0), 0);
    const actualCostUSD = sessions.reduce((acc, session) => acc + (session.actualCostUSD ?? 0), 0);

    const averages = totalSessions > 0 ? {
      toolCallsPerSession: Number((totalToolCalls / totalSessions).toFixed(2)),
      estimatedTokensPerSession: Number((totalEstimatedTokens / totalSessions).toFixed(2)),
      actualTokensPerSession: Number((totalActualTokens / totalSessions).toFixed(2)),
    } : {
      toolCallsPerSession: 0,
      estimatedTokensPerSession: 0,
      actualTokensPerSession: 0,
    };

    const recentToolCallsRaw = await ctx.db
      .query('agent_tool_calls')
      .withIndex('by_completed')
      .order('desc')
      .take(25);

    const recentToolCalls = recentToolCallsRaw
      .filter((call) => typeof call.completedAt === 'number')
      .slice(0, 10)
      .map((call) => ({
        sessionId: call.sessionId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        stepIndex: call.stepIndex,
        completedAt: call.completedAt,
        durationMs: call.durationMs ?? null,
        costUSD: call.costUSD ?? 0,
        isError: call.isError ?? false,
        tokenUsage: call.tokenUsage ?? null,
      }));

    return {
      totals: {
        sessions: totalSessions,
        activeSessions,
        toolCalls: totalToolCalls,
        estimatedTokens: totalEstimatedTokens,
        actualTokens: totalActualTokens,
        estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
        actualCostUSD: Number(actualCostUSD.toFixed(4)),
      },
      averages,
      recentToolCalls,
    };
  },
});
