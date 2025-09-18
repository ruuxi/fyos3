import { metricsEnabled } from '@/lib/metrics/config';
import { getSessionDetail, getSessionsSummary } from '@/lib/metrics/store';
import { computePerToolAttribution } from '@/lib/metrics/attribution';

function p95(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const idx = Math.floor(0.95 * (arr.length - 1));
  return arr[idx] || 0;
}

export async function GET(req: Request) {
  if (!metricsEnabled) return new Response('Not Found', { status: 404 });

  // Strategy fixed to payloadWeighted (UI no longer toggles)
  const strategy = 'payloadWeighted' as const;

  const sessions = getSessionsSummary();
  const toolAgg = new Map<string, {
    tool: string;
    totalCalls: number;
    uniqueSessions: Set<string>;
    durations: number[];
    errors: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    maxConsecutive: number;
  }>();

  let firstEventAt: string | undefined;
  let lastEventAt: string | undefined;

  for (const s of sessions) {
    const detail = getSessionDetail(s.sessionId);
    if (!detail) continue;
    const events = detail.events;
    if (events.length > 0) {
      firstEventAt = !firstEventAt || events[0].timestamp < firstEventAt ? events[0].timestamp : firstEventAt;
      lastEventAt = !lastEventAt || events[events.length - 1].timestamp > lastEventAt ? events[events.length - 1].timestamp : lastEventAt;
    }

    // Token/cost attribution per session
    const perToolSession = computePerToolAttribution(events);
    for (const [name, v] of Object.entries(perToolSession)) {
      if (!toolAgg.has(name)) {
        toolAgg.set(name, { tool: name, totalCalls: 0, uniqueSessions: new Set<string>(), durations: [], errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, maxConsecutive: 0 });
      }
      const agg = toolAgg.get(name)!;
      agg.inputTokens += v.inputTokens;
      agg.outputTokens += v.outputTokens;
      agg.totalTokens += v.totalTokens;
      agg.cost += v.cost;
      agg.uniqueSessions.add(s.sessionId);
      // We'll add counts/durations/errors via tool_end scan below
    }

    // Counts, durations, errors by scanning tool_end
    const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    // maxConsecutive (per-session), then fold into global max
    let lastTool: string | null = null;
    let runLen = 0;
    const maxByToolInSession = new Map<string, number>();

    for (const ev of ordered) {
      if (ev.type !== 'tool_end') continue;
      const name = ev.toolName || 'unknown';
      if (!toolAgg.has(name)) {
        toolAgg.set(name, { tool: name, totalCalls: 0, uniqueSessions: new Set<string>(), durations: [], errors: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, maxConsecutive: 0 });
      }
      const agg = toolAgg.get(name)!;
      agg.totalCalls += 1;
      agg.durations.push(ev.durationMs || 0);
      if (!ev.success) agg.errors += 1;
      agg.uniqueSessions.add(s.sessionId);

      // consecutive run tracking
      if (lastTool === name) {
        runLen += 1;
      } else {
        // reset run for new tool
        lastTool = name;
        runLen = 1;
      }
      const prevMax = maxByToolInSession.get(name) || 0;
      if (runLen > prevMax) maxByToolInSession.set(name, runLen);
    }

    // Fold session maxes into global
    for (const [name, m] of maxByToolInSession.entries()) {
      const agg = toolAgg.get(name)!;
      if (m > agg.maxConsecutive) agg.maxConsecutive = m;
    }
  }

  // Build response lists
  const perTool = [...toolAgg.values()].map((v) => {
    const avgMs = v.totalCalls > 0 ? Math.round(v.durations.reduce((a, b) => a + b, 0) / v.totalCalls) : 0;
    const p95Ms = p95(v.durations);
    const uniqueSessions = v.uniqueSessions.size;
    const errorRate = v.totalCalls > 0 ? v.errors / v.totalCalls : 0;
    return {
      tool: v.tool,
      totalCalls: v.totalCalls,
      uniqueSessions,
      avgCallsPerSession: (getSafeRatio(v.totalCalls, sessions.length)),
      avgWhenUsed: (getSafeRatio(v.totalCalls, uniqueSessions)),
      errors: v.errors,
      errorRate,
      avgMs,
      p95Ms,
      totalTokens: v.totalTokens,
      cost: v.cost,
      maxConsecutive: v.maxConsecutive,
    };
  });

  // Totals across tools
  const totals = perTool.reduce((acc, t) => {
    acc.toolCalls += t.totalCalls;
    // Sum tokens from aggregated per-tool attribution
    const src = toolAgg.get(t.tool)!;
    acc.inputTokens += src.inputTokens;
    acc.outputTokens += src.outputTokens;
    acc.totalTokens += src.totalTokens;
    acc.totalCost += t.cost;
    return acc;
  }, { toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0 });

  // Pre-sorted lists of repeat offenders
  const minCalls = 3;
  const offenders = perTool.filter(t => t.totalCalls >= minCalls);
  const byTotalCalls = [...offenders].sort((a, b) => b.totalCalls - a.totalCalls).slice(0, 10);
  const byAvgCallsPerSession = [...offenders].sort((a, b) => b.avgCallsPerSession - a.avgCallsPerSession).slice(0, 10);
  const byMaxConsecutive = [...offenders].sort((a, b) => b.maxConsecutive - a.maxConsecutive).slice(0, 10);
  const byErrorRate = [...offenders].filter(t => t.totalCalls >= 10).sort((a, b) => b.errorRate - a.errorRate).slice(0, 10);

  const payload = {
    strategy,
    timeframe: { firstEventAt: firstEventAt || null, lastEventAt: lastEventAt || null },
    sessions: { count: sessions.length },
    totals,
    perTool: perTool.sort((a, b) => b.totalCalls - a.totalCalls),
    repeatOffenders: { byTotalCalls, byAvgCallsPerSession, byMaxConsecutive, byErrorRate },
  };

  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

function getSafeRatio(n: number, d: number): number {
  if (!d || d <= 0) return 0;
  return n / d;
}
