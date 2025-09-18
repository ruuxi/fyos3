"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricEvent, StepUsageEvent, ToolEndEvent } from '@/lib/metrics/types';
import { computePerToolAttribution, type AttributionStrategy } from '@/lib/metrics/attribution';

type SessionSummary = {
  sessionId: string;
  clientChatId?: string;
  startedAt?: string;
  lastEventAt?: string;
  messageCount: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  avgToolDurationMs: number;
  topTools: Array<{ name: string; count: number }>;
};

export default function AgentMetricsPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<MetricEvent[]>([]);
  const [strategy, setStrategy] = useState<AttributionStrategy>('equal');
  const esRef = useRef<EventSource | null>(null);

  // Load session list and pick the most recent
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/metrics/sessions');
        if (res.status === 404) { setEnabled(false); return; }
        if (!res.ok) throw new Error('Failed to fetch sessions');
        const json = await res.json();
        if (cancelled) return;
        const list = (json.sessions || []) as SessionSummary[];
        setEnabled(true);
        setSessions(list);
        if (list.length > 0) setSelected(list[0].sessionId);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load session details for selected
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/metrics/session/${encodeURIComponent(selected)}`);
        if (!res.ok) throw new Error('Failed to fetch session');
        const json = await res.json();
        if (cancelled) return;
        setEvents(Array.isArray(json.events) ? json.events : []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Subscribe to SSE for selected session
  useEffect(() => {
    if (!selected || enabled === false) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource(`/api/metrics/stream?sessionId=${encodeURIComponent(selected)}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || !data.type) return;
        setEvents(prev => [...prev, data as MetricEvent]);
      } catch {}
    };
    es.onerror = () => { /* ignore in dev */ };
    esRef.current = es;
    return () => { es.close(); esRef.current = null; };
  }, [selected, enabled]);

  const ordered = useMemo(() => {
    return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [events]);

  const totals = useMemo(() => {
    const stepTotals = ordered.filter(e => e.type === 'step_usage') as StepUsageEvent[];
    const sum = stepTotals.reduce((acc, s) => {
      acc.input += s.inputTokens || 0;
      acc.output += s.outputTokens || 0;
      acc.total += s.totalTokens || 0;
      return acc;
    }, { input: 0, output: 0, total: 0 });
    const end = ordered.findLast ? (ordered as any).findLast((e: MetricEvent) => e.type === 'total_usage') : [...ordered].reverse().find((e) => e.type === 'total_usage');
    const totalCost = end?.type === 'total_usage' ? (end as any).totalCost : ((sum.input / 1_000_000) * 1.25 + (sum.output / 1_000_000) * 10);
    return { ...sum, cost: totalCost };
  }, [ordered]);

  const perTool = useMemo(() => computePerToolAttribution(ordered, strategy), [ordered, strategy]);

  if (enabled === false) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Agent Metrics (Dev)</h1>
        <p className="text-sm text-slate-600 mt-2">Metrics are disabled. Enable by running with AGENT_METRICS=1 or in development mode.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Agent Metrics (Dev)</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-slate-600">Attribution</label>
          <select className="border rounded px-2 py-1 text-sm" value={strategy} onChange={(e) => setStrategy(e.target.value as AttributionStrategy)}>
            <option value="equal">Equal (approx)</option>
            <option value="durationWeighted">Duration-weighted (approx)</option>
            <option value="payloadWeighted">Payload-weighted (approx)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm">Session:</label>
        <select className="border rounded px-2 py-1 text-sm min-w-[280px]" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {(sessions || []).map(s => (
            <option key={s.sessionId} value={s.sessionId}>{s.sessionId} — msgs:{s.messageCount} tools:{s.toolCalls}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-medium mb-2">Session Summary</div>
          <div className="text-sm text-slate-700 space-y-1">
            <div>Total tokens: {totals.total}</div>
            <div>Input tokens: {totals.input}</div>
            <div>Output tokens: {totals.output}</div>
            <div>Total cost (USD): ${totals.cost?.toFixed(6)}</div>
          </div>
        </div>
        <div className="border rounded p-3 bg-white md:col-span-2">
          <div className="font-medium mb-2">Tool Breakdown (approx)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Tool</th>
                <th className="py-1">Calls</th>
                <th className="py-1">Avg ms</th>
                <th className="py-1">Errors</th>
                <th className="py-1">Tokens</th>
                <th className="py-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(perTool).sort((a, b) => (b[1].cost - a[1].cost)).slice(0, 10).map(([name, v]) => (
                <tr key={name} className="border-t">
                  <td className="py-1 pr-2 font-mono text-xs">{name}</td>
                  <td className="py-1 pr-2">{v.count}</td>
                  <td className="py-1 pr-2">{v.count > 0 ? Math.round(v.totalDurationMs / v.count) : 0}</td>
                  <td className="py-1 pr-2">{v.errors}</td>
                  <td className="py-1 pr-2">{v.totalTokens}</td>
                  <td className="py-1 pr-2">${v.cost.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-medium mb-2">Live Timeline</div>
          <div className="max-h-[360px] overflow-auto text-sm">
            {ordered.map((e, i) => (
              <div key={`${e.type}-${i}`} className="py-1 border-b">
                <span className="font-mono text-xs text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {e.type === 'tool_start' && (
                  <span className="ml-2 text-slate-600">{(e as any).toolName} <span className="text-slate-400">({(e as any).toolCallId})</span></span>
                )}
                {e.type === 'tool_end' && (
                  <span className="ml-2 text-slate-600">{(e as any).toolName} <span className="text-slate-400">({(e as any).toolCallId})</span> — {(e as any).durationMs}ms {(e as any).success ? '' : '×'}</span>
                )}
                {e.type === 'step_usage' && (
                  <span className="ml-2 text-slate-600">step {(e as StepUsageEvent).stepIndex} — tokens {(e as StepUsageEvent).totalTokens} — tools {(e as StepUsageEvent).toolCallIds.length}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-medium mb-2">Sequence Viewer</div>
          <div className="text-sm space-y-2 max-h-[360px] overflow-auto">
            {(() => {
              const steps = ordered.filter(e => e.type === 'step_usage') as StepUsageEvent[];
              return steps.map((s) => (
                <div key={s.stepIndex} className="border rounded p-2">
                  <div className="text-slate-700 font-medium">Step {s.stepIndex}</div>
                  <div className="text-slate-600">ToolCallIds: {s.toolCallIds.join(', ') || '—'}</div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <div className="border rounded p-3 bg-white">
        <div className="font-medium mb-2">Raw Events</div>
        <div className="max-h-[360px] overflow-auto text-xs font-mono text-slate-700">
          <pre>{JSON.stringify(ordered, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

