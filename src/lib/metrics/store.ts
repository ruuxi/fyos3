import { metricsEnabled, PRICING, SESSION_LIMITS, defaultAttributionStrategy } from '@/lib/metrics/config';
import {
  AssistantMessageEvent,
  MetricEvent,
  SessionDetail,
  SessionInitEvent,
  SessionSummary,
  StepUsageEvent,
  ToolEndEvent,
  ToolStartEvent,
  TotalUsageEvent,
  UserMessageEvent,
} from '@/lib/metrics/types';
import { metricsBus } from '@/lib/metrics/bus';

type SessionBuffer = {
  events: MetricEvent[];
  // Idempotency keys
  seenKeys: Set<string>;
  clientChatId?: string;
};

// Persist store across route bundles and HMR using globalThis
declare global {
  // eslint-disable-next-line no-var
  var __FYOS_METRICS_SESSIONS__: Map<string, SessionBuffer> | undefined;
  // eslint-disable-next-line no-var
  var __FYOS_METRICS_CLIENT2SESSION__: Map<string, string> | undefined;
}

const sessions: Map<string, SessionBuffer> =
  globalThis.__FYOS_METRICS_SESSIONS__ ?? (globalThis.__FYOS_METRICS_SESSIONS__ = new Map());
const clientToSession: Map<string, string> =
  globalThis.__FYOS_METRICS_CLIENT2SESSION__ ?? (globalThis.__FYOS_METRICS_CLIENT2SESSION__ = new Map());

function nowIso(): string { return new Date().toISOString(); }

function makeKeyFor(event: MetricEvent): string | null {
  switch (event.type) {
    case 'tool_start':
      return `tool_start|${event.sessionId}|${event.toolCallId}|start`;
    case 'tool_end':
      return `tool_end|${event.sessionId}|${event.toolCallId}|end`;
    case 'step_usage':
      return `step_usage|${event.sessionId}|${event.stepIndex}`;
    case 'total_usage':
      return `total_usage|${event.sessionId}|total`;
    default:
      return null; // other events are not deduped by key
  }
}

function coerceSummary(s?: string): string | undefined {
  if (!s) return undefined;
  // limit summaries to avoid memory pressure
  if (s.length > 2000) return s.slice(0, 2000) + '…';
  return s;
}

function upsertSession(sessionId: string): SessionBuffer {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { events: [], seenKeys: new Set() });
  }
  return sessions.get(sessionId)!;
}

export function mapClientToSession(clientChatId: string, sessionId: string) {
  if (!metricsEnabled) return;
  clientToSession.set(clientChatId, sessionId);
  const buf = upsertSession(sessionId);
  buf.clientChatId = buf.clientChatId || clientChatId;
}

export function getSessionIdForClient(clientChatId: string): string | undefined {
  return clientToSession.get(clientChatId);
}

export function appendEvent(event: MetricEvent): { inserted: boolean } {
  if (!metricsEnabled) return { inserted: false };
  const buf = upsertSession(event.sessionId);

  // Normalize potentially large summaries
  if (event.type === 'tool_start') {
    (event as ToolStartEvent).inputSummary = coerceSummary(event.inputSummary);
  } else if (event.type === 'tool_end') {
    (event as ToolEndEvent).outputSummary = coerceSummary(event.outputSummary);
  }

  const key = makeKeyFor(event);
  if (key && buf.seenKeys.has(key)) return { inserted: false };
  if (key) buf.seenKeys.add(key);

  // Ring buffer management
  buf.events.push(event);
  const over = buf.events.length - SESSION_LIMITS.maxEventsPerSession;
  if (over > 0) buf.events.splice(0, over);

  metricsBus.publish(event);
  return { inserted: true };
}

// Convenience helpers to emit specific events
export function emitSessionInit(params: { sessionId: string; clientChatId: string; source: 'server' | 'client' }) {
  const ev: SessionInitEvent = { type: 'session_init', sessionId: params.sessionId, clientChatId: params.clientChatId, timestamp: nowIso(), source: params.source };
  mapClientToSession(params.clientChatId, params.sessionId);
  appendEvent(ev);
}

export function emitUserMessage(params: { sessionId: string; clientChatId?: string; messageId?: string; content: string; source: 'server' | 'client' }) {
  const ev: UserMessageEvent = { type: 'user_message', sessionId: params.sessionId, clientChatId: params.clientChatId, messageId: params.messageId, content: params.content, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

export function emitAssistantMessage(params: { sessionId: string; clientChatId?: string; messageId?: string; content: string; source: 'server' | 'client' }) {
  const ev: AssistantMessageEvent = { type: 'assistant_message', sessionId: params.sessionId, clientChatId: params.clientChatId, messageId: params.messageId, content: params.content, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

export function emitStepUsage(params: { sessionId: string; clientChatId?: string; stepIndex: number; inputTokens: number; outputTokens: number; totalTokens: number; toolCallIds: string[]; source: 'server' | 'client' }) {
  const ev: StepUsageEvent = { type: 'step_usage', sessionId: params.sessionId, clientChatId: params.clientChatId, stepIndex: params.stepIndex, inputTokens: params.inputTokens, outputTokens: params.outputTokens, totalTokens: params.totalTokens, toolCallIds: params.toolCallIds, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

export function emitToolStart(params: { sessionId: string; clientChatId?: string; toolCallId: string; toolName: string; inputSummary?: string; source: 'server' | 'client' }) {
  const ev: ToolStartEvent = { type: 'tool_start', sessionId: params.sessionId, clientChatId: params.clientChatId, toolCallId: params.toolCallId, toolName: params.toolName, inputSummary: params.inputSummary, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

export function emitToolEnd(params: { sessionId: string; clientChatId?: string; toolCallId: string; toolName: string; durationMs: number; success: boolean; error?: string; outputSummary?: string; source: 'server' | 'client' }) {
  const ev: ToolEndEvent = { type: 'tool_end', sessionId: params.sessionId, clientChatId: params.clientChatId, toolCallId: params.toolCallId, toolName: params.toolName, durationMs: params.durationMs, success: params.success, error: params.error, outputSummary: params.outputSummary, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

export function emitTotalUsage(params: { sessionId: string; clientChatId?: string; inputTokens: number; outputTokens: number; totalTokens: number; model: string; totalCost?: number; source: 'server' | 'client' }) {
  const totalCost = params.totalCost ?? (params.inputTokens / 1_000_000) * PRICING.inputPerMillion + (params.outputTokens / 1_000_000) * PRICING.outputPerMillion;
  const ev: TotalUsageEvent = { type: 'total_usage', sessionId: params.sessionId, clientChatId: params.clientChatId, inputTokens: params.inputTokens, outputTokens: params.outputTokens, totalTokens: params.totalTokens, model: params.model, totalCost, timestamp: nowIso(), source: params.source };
  appendEvent(ev);
}

// Queries
export function getSessionsSummary(): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const [sessionId, buf] of sessions.entries()) {
    const evs = [...buf.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let messageCount = 0;
    let toolEnds = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let sumDuration = 0;
    const toolCounts = new Map<string, number>();
    const startedAt = evs[0]?.timestamp;
    const lastEventAt = evs[evs.length - 1]?.timestamp;

    for (const ev of evs) {
      if (ev.type === 'user_message' || ev.type === 'assistant_message') messageCount++;
      if (ev.type === 'tool_end') {
        toolEnds++;
        sumDuration += (ev as ToolEndEvent).durationMs || 0;
        const name = (ev as ToolEndEvent).toolName || 'unknown';
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
      if (ev.type === 'step_usage') {
        inputTokens += (ev as StepUsageEvent).inputTokens || 0;
        outputTokens += (ev as StepUsageEvent).outputTokens || 0;
        totalTokens += (ev as StepUsageEvent).totalTokens || 0;
      }
      if (ev.type === 'total_usage') {
        // Prefer total_usage when present
        inputTokens = (ev as TotalUsageEvent).inputTokens;
        outputTokens = (ev as TotalUsageEvent).outputTokens;
        totalTokens = (ev as TotalUsageEvent).totalTokens;
        totalCost = (ev as TotalUsageEvent).totalCost;
      }
    }

    const avgToolDurationMs = toolEnds > 0 ? Math.round(sumDuration / toolEnds) : 0;
    const topTools = [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    out.push({
      sessionId,
      clientChatId: buf.clientChatId,
      startedAt,
      lastEventAt,
      messageCount,
      toolCalls: toolEnds,
      inputTokens,
      outputTokens,
      totalTokens,
      totalCost,
      avgToolDurationMs,
      topTools,
    });
  }
  // Most recent first
  out.sort((a, b) => (b.lastEventAt || '').localeCompare(a.lastEventAt || ''));
  return out.slice(0, SESSION_LIMITS.maxRecentSessions);
}

export function getSessionDetail(sessionId: string): SessionDetail | undefined {
  const buf = sessions.get(sessionId);
  if (!buf) return undefined;
  const events = [...buf.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const stepToToolMap: Record<number, string[]> = {};
  const toolDurations: Record<string, number> = {};

  for (const ev of events) {
    if (ev.type === 'step_usage') {
      const idx = (ev as StepUsageEvent).stepIndex;
      stepToToolMap[idx] = Array.from(new Set([...(stepToToolMap[idx] || []), ...((ev as StepUsageEvent).toolCallIds || [])]));
    }
    if (ev.type === 'tool_end') {
      const te = ev as ToolEndEvent;
      toolDurations[te.toolCallId] = te.durationMs || 0;
    }
  }

  return {
    sessionId,
    clientChatId: buf.clientChatId,
    events,
    timeline: events,
    stepToToolMap,
    toolDurations,
  };
}

export function getAttributionStrategy(): string {
  return defaultAttributionStrategy;
}

export function clearAllForTests() {
  sessions.clear();
  clientToSession.clear();
}
