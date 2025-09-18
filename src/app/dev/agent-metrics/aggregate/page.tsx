"use client";
import React from 'react';

type AggregateResponse = {
  strategy: 'payloadWeighted';
  timeframe: { firstEventAt: string | null; lastEventAt: string | null };
  sessions: { count: number };
  totals: { toolCalls: number; inputTokens: number; outputTokens: number; totalTokens: number; totalCost: number };
  perTool: Array<{
    tool: string;
    totalCalls: number;
    uniqueSessions: number;
    avgCallsPerSession: number;
    avgWhenUsed: number;
    errors: number;
    errorRate: number;
    avgMs: number;
    p95Ms: number;
    totalTokens: number;
    cost: number;
    maxConsecutive: number;
  }>;
  repeatOffenders: {
    byTotalCalls: AggregateResponse['perTool'];
    byAvgCallsPerSession: AggregateResponse['perTool'];
    byMaxConsecutive: AggregateResponse['perTool'];
    byErrorRate: AggregateResponse['perTool'];
  };
};

export default function AgentMetricsAggregatePage() {
  const [data, setData] = React.useState<AggregateResponse | null>(null);
  // Payload-weighted attribution only
  const [loading, setLoading] = React.useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = React.useState<boolean>(false);
  const drawerRef = React.useRef<HTMLDivElement | null>(null);

  type SessionSummary = {
    sessionId: string;
    clientChatId?: string;
    startedAt?: string;
    lastEventAt?: string;
    messageCount: number;
    toolCalls: number;
  };
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics/aggregate`);
      if (res.ok) {
        const json = await res.json();
        setData(json as AggregateResponse);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  // Load sessions for drawer navigation
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/metrics/sessions');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const list = (json.sessions || []) as SessionSummary[];
        setSessions(list);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Close drawer when clicking outside of drawer and not on a button
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (drawerRef.current && drawerRef.current.contains(t)) return;
      if (t.closest('button')) return; // allow button clicks elsewhere without closing
      setDrawerOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [drawerOpen]);

  const tf = data?.timeframe;
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
  const usd = (n: number) => `$${(n || 0).toFixed(6)}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Agent Metrics — All Sessions</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(v => !v)}
            className="px-2 py-1 border rounded bg-white shadow hover:bg-slate-50 text-sm"
          >
            Session List
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-600">Attribution:</span>
          <span className="text-sm px-2 py-1 border rounded bg-white">Payload-weighted</span>
        </div>
      </div>

      {/* Side Drawer: Sessions list (shared UX with single-session page) */}
      <div
        className={`fixed top-0 right-0 h-full w-[320px] max-w-full bg-white border-l shadow-xl transition-transform duration-200 ease-in-out z-40 ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
        role="complementary"
        aria-label="Sessions Drawer"
        ref={drawerRef}
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
              const last = s.lastEventAt ? new Date(s.lastEventAt).toLocaleString() : '—';
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => {
                      try { window.location.href = `/dev/agent-metrics?sessionId=${encodeURIComponent(s.sessionId)}`; } catch {}
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50`}
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-medium">Sessions</div>
          <div className="text-2xl">{data?.sessions.count ?? 0}</div>
          <div className="text-xs text-slate-500">{tf ? `${fmt(tf.firstEventAt)} → ${fmt(tf.lastEventAt)}` : '—'}</div>
        </div>
        <div className="border rounded p-3 bg-white">
          <div className="font-medium">Tool Calls</div>
          <div className="text-2xl">{data?.totals.toolCalls ?? 0}</div>
        </div>
        <div className="border rounded p-3 bg-white">
          <div className="font-medium">Total Tokens</div>
          <div className="text-2xl">{data?.totals.totalTokens ?? 0}</div>
        </div>
        <div className="border rounded p-3 bg-white">
          <div className="font-medium">Total Cost</div>
          <div className="text-2xl">{usd(data?.totals.totalCost || 0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OffenderList title="Top by Total Calls" items={data?.repeatOffenders.byTotalCalls || []} loading={loading} />
        <OffenderList title="Top by Avg Calls/Session" items={data?.repeatOffenders.byAvgCallsPerSession || []} loading={loading} statKey="avgCallsPerSession" />
        <OffenderList title="Top by Longest Streak" items={data?.repeatOffenders.byMaxConsecutive || []} loading={loading} statKey="maxConsecutive" />
        <OffenderList title="Top by Error Rate (≥10 calls)" items={data?.repeatOffenders.byErrorRate || []} loading={loading} statKey="errorRate" formatPercent />
      </div>

      <div className="border rounded p-3 bg-white overflow-hidden">
        <div className="font-medium mb-2">Per-Tool Overview</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 w-28">Tool</th>
                <th className="py-1 w-20">Calls</th>
                <th className="py-1 w-20">Sessions</th>
                <th className="py-1 w-24">Avg/Session</th>
                <th className="py-1 w-20">Errors</th>
                <th className="py-1 w-24">Error Rate</th>
                <th className="py-1 w-20">Avg ms</th>
                <th className="py-1 w-20">P95 ms</th>
                <th className="py-1 w-24">Tokens</th>
                <th className="py-1 w-28">Cost</th>
                <th className="py-1 w-24">Max Streak</th>
              </tr>
            </thead>
            <tbody>
              {(data?.perTool || []).map((t) => (
                <tr key={t.tool} className="border-t">
                  <td className="py-1 pr-2 font-mono text-xs truncate">{t.tool}</td>
                  <td className="py-1 pr-2">{t.totalCalls}</td>
                  <td className="py-1 pr-2">{t.uniqueSessions}</td>
                  <td className="py-1 pr-2">{t.avgCallsPerSession.toFixed(2)} ({t.avgWhenUsed.toFixed(2)} used)</td>
                  <td className="py-1 pr-2">{t.errors}</td>
                  <td className="py-1 pr-2">{(t.errorRate * 100).toFixed(1)}%</td>
                  <td className="py-1 pr-2">{t.avgMs}</td>
                  <td className="py-1 pr-2">{t.p95Ms}</td>
                  <td className="py-1 pr-2">{t.totalTokens}</td>
                  <td className="py-1 pr-2">{usd(t.cost)}</td>
                  <td className="py-1 pr-2">{t.maxConsecutive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OffenderList({ title, items, loading, statKey, formatPercent }: { title: string; items: AggregateResponse['perTool']; loading: boolean; statKey?: keyof AggregateResponse['perTool'][number]; formatPercent?: boolean }) {
  const fmtVal = (val: any) => {
    if (val == null) return '';
    if (typeof val === 'number' && formatPercent) return `${(val * 100).toFixed(1)}%`;
    if (typeof val === 'number') return val.toFixed && !Number.isInteger(val) ? val.toFixed(2) : String(val);
    return String(val);
  };
  return (
    <div className="border rounded p-3 bg-white">
      <div className="font-medium mb-2">{title}</div>
      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {!loading && items && items.length === 0 && <div className="text-sm text-slate-500">No data</div>}
      <div className="flex flex-col gap-1">
        {(items || []).slice(0, 10).map((t) => (
          <div key={t.tool} className="flex items-center justify-between text-sm">
            <div className="font-mono text-xs truncate">{t.tool}</div>
            <div className="text-slate-700 ml-3">{statKey ? fmtVal((t as any)[statKey]) : t.totalCalls}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
