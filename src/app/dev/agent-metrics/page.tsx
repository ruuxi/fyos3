"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricEvent, StepUsageEvent, ToolEndEvent, ToolStartEvent, TotalUsageEvent } from '@/lib/metrics/types';
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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
    const end = [...ordered].reverse().find((e) => e.type === 'total_usage') as TotalUsageEvent | undefined;
    const totalCost = end ? end.totalCost : ((sum.input / 1_000_000) * 1.25 + (sum.output / 1_000_000) * 10);
    return { ...sum, cost: totalCost };
  }, [ordered]);

  const perTool = useMemo(() => computePerToolAttribution(ordered, strategy), [ordered, strategy]);

  // Helper: Parse input/output summaries into a concise human-friendly action string
  function describeToolAction(toolName: string, inputSummary?: string, outputSummary?: string): string | null {
    const tryParse = (s?: string): any => {
      if (!s || typeof s !== 'string') return null;
      try { return JSON.parse(s); } catch { return null; }
    };
    const inp = tryParse(inputSummary);
    const out = tryParse(outputSummary);

    // Prefer explicit fields from parsed inputs
    switch (toolName) {
      case 'web_fs_write': {
        const p = inp?.path || inp?.file || undefined;
        return p ? `write to ${p}` : (inputSummary ? 'write file' : null);
      }
      case 'web_fs_read': {
        const p = inp?.path || undefined;
        return p ? `read ${p}` : (inputSummary ? 'read file' : null);
      }
      case 'web_fs_rm': {
        const p = inp?.path || undefined;
        const rec = inp?.recursive ? ' (recursive)' : '';
        return p ? `remove ${p}${rec}` : (inputSummary ? 'remove path' : null);
      }
      case 'web_fs_find': {
        const root = inp?.root ?? '.';
        const filters: string[] = [];
        if (inp?.glob) filters.push(`glob:${String(inp.glob)}`);
        if (inp?.prefix) filters.push(`prefix:${String(inp.prefix)}`);
        const filt = filters.length ? ` with ${filters.join(', ')}` : '';
        return `list ${root}${filt}`;
      }
      case 'web_exec': {
        const cmd = inp?.command as string | undefined;
        const args = Array.isArray(inp?.args) ? inp.args.join(' ') : '';
        const full = [cmd, args].filter(Boolean).join(' ').trim();
        const cwd = inp?.cwd ? ` (cwd: ${inp.cwd})` : '';
        return full ? `exec: ${full}${cwd}` : (inputSummary ? 'exec command' : null);
      }
      case 'validate_project': {
        const scope = inp?.scope || 'quick';
        const filesCount = Array.isArray(inp?.files) ? inp.files.length : 0;
        return filesCount > 0 ? `validate ${scope} (${filesCount} files)` : `validate ${scope}`;
      }
      case 'app_manage': {
        const action = inp?.action || 'manage';
        const id = inp?.id || inp?.name || '';
        return id ? `app ${action}: ${id}` : `app ${action}`;
      }
      case 'ai_generate': {
        const provider = inp?.provider || 'ai';
        const task = inp?.task || 'generate';
        return `${provider}/${task}`;
      }
      case 'web_search': {
        const q = inp?.query || (typeof inp === 'string' ? inp : undefined);
        return q ? `search "${String(q)}"` : 'search';
      }
      default: {
        // Fallbacks: try common fields, else truncate raw inputSummary
        const path = inp?.path || inp?.file || inp?.target;
        if (path) return `path: ${String(path)}`;
        if (inputSummary && typeof inputSummary === 'string') {
          const s = inputSummary.replace(/\s+/g, ' ').trim();
          return s.length > 140 ? s.slice(0, 140) + '…' : s;
        }
        // As a last resort, try output summary
        if (out && typeof out === 'object') {
          const keys = Object.keys(out);
          if (keys.includes('results')) return `results: ${String((out as any).results)}`;
        }
        return null;
      }
    }
  }

  function pastTense(desc: string, toolName: string): string {
    const lower = desc.toLowerCase();
    if (toolName === 'web_fs_write' && lower.startsWith('write to ')) return 'wrote to ' + desc.slice('write to '.length);
    if (lower.startsWith('remove ')) return 'removed ' + desc.slice('remove '.length);
    if (lower.startsWith('list ')) return 'listed ' + desc.slice('list '.length);
    if (lower.startsWith('validate ')) return 'validated ' + desc.slice('validate '.length);
    if (lower.startsWith('search ')) return 'searched ' + desc.slice('search '.length);
    return desc;
  }

  // Build recent action snippets per tool for the breakdown table
  const recentActionsByTool = useMemo(() => {
    const map = new Map<string, string[]>();
    // Iterate from newest to oldest to collect recent actions
    for (let i = ordered.length - 1; i >= 0; i--) {
      const e = ordered[i];
      if (e.type !== 'tool_start') continue;
      const ts = e as ToolStartEvent;
      const desc = describeToolAction(ts.toolName, ts.inputSummary, undefined);
      if (!desc) continue;
      const arr = map.get(ts.toolName) ?? [];
      // Record each instance; limit later when rendering
      arr.push(desc);
      map.set(ts.toolName, arr);
    }
    return map;
  }, [ordered]);

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

      {/* Drawer handle/tab on left side of drawer (always visible) */}
      <div
        className="fixed top-1/2 -translate-y-1/2 z-40"
        style={{ right: drawerOpen ? 320 : 0 }}
      >
        <div className="flex flex-col gap-2 items-center">
          <button
            type="button"
            onClick={() => setDrawerOpen(v => !v)}
            className="px-2 py-1 border rounded bg-white shadow hover:bg-slate-50 rotate-90 origin-center text-sm"
            aria-label={drawerOpen ? 'Close sessions drawer' : 'Open sessions drawer'}
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => { try { window.location.href = '/dev/agent-metrics/aggregate'; } catch {} }}
            className="px-2 py-1 border rounded bg-white shadow hover:bg-slate-50 rotate-90 origin-center text-sm"
          >
            Summary
          </button>
        </div>
      </div>

      {/* Side Drawer: Sessions list (no backdrop) */}
      <div
        className={`fixed top-0 right-0 h-full w-[320px] max-w-full bg-white border-l shadow-xl transition-transform duration-200 ease-in-out z-40 ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
        role="complementary"
        aria-label="Sessions Drawer"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="font-medium">Sessions</div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="text-sm px-2 py-1 border rounded bg-white hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto max-h-[calc(100%-44px)]">
          <ul className="divide-y">
            {(sessions || []).map((s) => {
              const isActive = selected === s.sessionId;
              const last = s.lastEventAt ? new Date(s.lastEventAt).toLocaleString() : '—';
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => { setSelected(s.sessionId); setDrawerOpen(false); }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${isActive ? 'bg-slate-100' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs truncate max-w-[200px]">{s.sessionId}</div>
                      <div className="text-[11px] text-slate-500 ml-2">{last}</div>
                    </div>
                    <div className="text-[12px] text-slate-600 mt-0.5">msgs:{s.messageCount} · tools:{s.toolCalls}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
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
        <div className="border rounded p-3 bg-white md:col-span-2 overflow-hidden">
          <div className="font-medium mb-2">Tool Breakdown (approx)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 w-24">Tool</th>
                  <th className="py-1 w-48">Recent Actions</th>
                  <th className="py-1 w-16">Calls</th>
                  <th className="py-1 w-16">Avg ms</th>
                  <th className="py-1 w-16">Errors</th>
                  <th className="py-1 w-16">Tokens</th>
                  <th className="py-1 w-20">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(perTool).sort((a, b) => (b[1].cost - a[1].cost)).slice(0, 10).map(([name, v]) => (
                  <tr key={name} className="border-t">
                    <td className="py-1 pr-2 font-mono text-xs truncate">{name}</td>
                    <td className="py-1 pr-2 align-top text-slate-700 break-words">
                      {(() => {
                        const actions = recentActionsByTool.get(name) || [];
                        if (actions.length === 0) return '—';
                        return (
                          <div className="flex flex-col gap-0.5">
                            {actions.slice(0, 5).map((a, idx) => (
                              <div key={idx} className="text-xs leading-snug">{a}</div>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
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
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-medium mb-2">Live Timeline</div>
          <div className="text-sm">
            {ordered.map((e, i) => (
              <div key={`${e.type}-${i}`} className="py-1 border-b">
                <span className="font-mono text-xs text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {e.type === 'tool_start' && (
                  <span className="ml-2 text-slate-600">
                    {(e as ToolStartEvent).toolName}
                    <span className="text-slate-400">{`(${(e as ToolStartEvent).toolCallId})`}</span>
                    {(() => {
                      const ts = e as ToolStartEvent;
                      const d = describeToolAction(ts.toolName, ts.inputSummary, undefined);
                      return d ? <span className="ml-2 text-slate-500">— {d}</span> : null;
                    })()}
                  </span>
                )}
                {e.type === 'tool_end' && (
                  <span className="ml-2 text-slate-600">
                    {(e as ToolEndEvent).toolName}
                    <span className="text-slate-400">{`(${(e as ToolEndEvent).toolCallId})`}</span>
                    {' '}— {(e as ToolEndEvent).durationMs}ms {((e as ToolEndEvent).success ? '' : '×')}
                    {(() => {
                      const te = e as ToolEndEvent;
                      // Also include the attempted action in past tense when possible
                      let startForThis: ToolStartEvent | undefined;
                      for (let j = ordered.length - 1; j >= 0; j--) {
                        const ev = ordered[j];
                        if (ev.type === 'tool_start' && (ev as ToolStartEvent).toolCallId === te.toolCallId) { startForThis = ev as ToolStartEvent; break; }
                      }
                      const d0 = describeToolAction(te.toolName, startForThis?.inputSummary, te.outputSummary);
                      const d = d0 ? pastTense(d0, te.toolName) : null;
                      return d ? <span className="ml-2 text-slate-500">— {d}</span> : null;
                    })()}
                    {(() => {
                      const te = e as ToolEndEvent;
                      // Optionally surface brief output context for ends
                      if (te.outputSummary && typeof te.outputSummary === 'string') {
                        const s = te.outputSummary.replace(/\s+/g, ' ').trim();
                        const short = s.length > 120 ? s.slice(0, 120) + '…' : s;
                        return short ? <span className="ml-2 text-slate-500">— {short}</span> : null;
                      }
                      return null;
                    })()}
                  </span>
                )}
                {e.type === 'step_usage' && (
                  <span className="ml-2 text-slate-600">step {(e as StepUsageEvent).stepIndex} — tokens {(e as StepUsageEvent).totalTokens} — tools {(e as StepUsageEvent).toolCallIds.length}</span>
                )}
              </div>
            ))}
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
