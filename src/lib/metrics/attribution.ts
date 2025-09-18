import { PRICING } from '@/lib/metrics/config';
import type { MetricEvent, StepUsageEvent, ToolEndEvent, ToolStartEvent } from '@/lib/metrics/types';

export type AttributionStrategy = 'equal' | 'durationWeighted' | 'payloadWeighted';

type PerToolAttribution = Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; cost: number; count: number; totalDurationMs: number; errors: number }>; // toolName aggregations

export function computePerToolAttribution(events: MetricEvent[], strategy: AttributionStrategy = 'equal'): PerToolAttribution {
  const perTool: PerToolAttribution = {};
  const toolEndById = new Map<string, ToolEndEvent>();
  const toolStartById = new Map<string, ToolStartEvent>();

  for (const ev of events) {
    if (ev.type === 'tool_end') toolEndById.set(ev.toolCallId, ev as ToolEndEvent);
    if (ev.type === 'tool_start') toolStartById.set(ev.toolCallId, ev as ToolStartEvent);
  }

  const stepEvents = events.filter(e => e.type === 'step_usage') as StepUsageEvent[];

  for (const step of stepEvents) {
    const ids = (step.toolCallIds || []).filter(Boolean);
    if (ids.length === 0) continue;

    // Determine weights
    let weights: number[] = [];
    if (strategy === 'durationWeighted') {
      const durations = ids.map(id => toolEndById.get(id)?.durationMs || 0);
      const sum = durations.reduce((a, b) => a + b, 0);
      weights = sum > 0 ? durations.map(d => d / sum) : [];
    } else if (strategy === 'payloadWeighted') {
      const sizes = ids.map(id => {
        const start = toolStartById.get(id);
        const end = toolEndById.get(id);
        const a = (start?.inputSummary || '').length;
        const b = (end?.outputSummary || '').length;
        return a + b;
      });
      const sum = sizes.reduce((a, b) => a + b, 0);
      weights = sum > 0 ? sizes.map(s => s / sum) : [];
    }
    if (weights.length !== ids.length) {
      // fallback to equal
      weights = ids.map(() => 1 / ids.length);
    }

    // Split tokens per tool in this step
    ids.forEach((id, idx) => {
      const w = weights[idx] || 0;
      const end = toolEndById.get(id);
      const start = toolStartById.get(id);
      const name = end?.toolName || start?.toolName || 'unknown';
      if (!perTool[name]) perTool[name] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, count: 0, totalDurationMs: 0, errors: 0 };
      const p = perTool[name];
      const inTok = Math.round(step.inputTokens * w);
      const outTok = Math.round(step.outputTokens * w);
      const totTok = Math.round(step.totalTokens * w);
      p.inputTokens += inTok;
      p.outputTokens += outTok;
      p.totalTokens += totTok;
      p.cost += (inTok / 1_000_000) * PRICING.inputPerMillion + (outTok / 1_000_000) * PRICING.outputPerMillion;
    });
  }

  // Add counts, durations, and error tallies by tool
  for (const ev of events) {
    if (ev.type === 'tool_end') {
      const te = ev as ToolEndEvent;
      const name = te.toolName || 'unknown';
      if (!perTool[name]) perTool[name] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, count: 0, totalDurationMs: 0, errors: 0 };
      perTool[name].count += 1;
      perTool[name].totalDurationMs += te.durationMs || 0;
      if (!te.success) perTool[name].errors += 1;
    }
  }

  return perTool;
}
