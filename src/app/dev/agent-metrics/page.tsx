"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricEvent, StepUsageEvent, ToolEndEvent, ToolStartEvent, TotalUsageEvent } from '@/lib/metrics/types';
import type { UserMessageEvent, AssistantMessageEvent } from '@/lib/metrics/types';
import { computePerToolAttribution, type TokenCounter } from '@/lib/metrics/attribution';

type SessionSummary = {
  sessionId: string;
  name?: string;
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
  const [sessionName, setSessionName] = useState<string>('');
  const [savingName, setSavingName] = useState<boolean>(false);
  // Payload-weighted attribution only
  const [tokenCounter, setTokenCounter] = useState<TokenCounter | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

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
        // Prefer sessionId from URL if present
        try {
          const url = new URL(window.location.href);
          const pid = url.searchParams.get('sessionId');
          if (pid && list.some(s => s.sessionId === pid)) {
            setSelected(pid);
          } else if (list.length > 0) {
            setSelected(list[0].sessionId);
          }
        } catch {
          if (list.length > 0) setSelected(list[0].sessionId);
        }
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
        setSessionName(String(json.name || selected));
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

  // Close drawer when clicking outside of drawer and not on a button
  useEffect(() => {
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

  const ordered = useMemo(() => {
    return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [events]);

  // For any event position, find the most recent preceding step_usage index
  const stepIndexForPosition = React.useCallback((pos: number): number | null => {
    if (pos < 0 || pos >= ordered.length) return null;
    for (let j = pos; j >= 0; j--) {
      const ev = ordered[j];
      if (ev.type === 'step_usage') return (ev as StepUsageEvent).stepIndex;
    }
    return null;
  }, [ordered]);

  // Deterministic color per tool name
  const toolColor = useMemo(() => {
    const hashString = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return h;
    };
    return (name: string) => {
      const h = Math.abs(hashString(name)) % 360;
      return `hsl(${h}, 70%, 40%)`;
    };
  }, []);

  const ToolName = React.useCallback(({ name }: { name: string }) => (
    <span style={{ color: toolColor(name) }}>{name}</span>
  ), [toolColor]);

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

  const perTool = useMemo(() =>
    computePerToolAttribution(ordered, tokenCounter ? { tokenCounter } : undefined)
  , [ordered, tokenCounter]);

  // Initialize a lightweight approximate token counter (no external deps)
  // We approximate tokens as ~chars/4, which aligns reasonably with GPT BPEs.
  useEffect(() => {
    setTokenCounter(() => (s?: string) => (s ? Math.ceil(s.length / 4) : 0));
  }, []);

  // Track expanded rows in the Live Timeline by a stable key (prefer toolCallId)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Track expanded state for Tool Breakdown "Recent Actions" cells per tool name
  const [expandedToolRows, setExpandedToolRows] = useState<Record<string, boolean>>({});

  function rowKeyForEvent(e: MetricEvent, idx: number): string {
    if (e.type === 'tool_start') return (e as ToolStartEvent).toolCallId || `${e.type}-${idx}`;
    if (e.type === 'tool_end') return (e as ToolEndEvent).toolCallId || `${e.type}-${idx}`;
    if (e.type === 'user_message') return (e as UserMessageEvent).messageId || `${e.type}-${idx}`;
    if (e.type === 'assistant_message') return (e as AssistantMessageEvent).messageId || `${e.type}-${idx}`;
    return `${e.type}-${idx}`;
  }

  function toggleExpanded(key: string) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleToolRow(name: string) {
    setExpandedToolRows(prev => ({ ...prev, [name]: !prev[name] }));
  }

  // Redaction + formatting helpers for summaries
  const isSecretKey = (k: string) => /(^|_|-)(api|token|key|secret|authorization|password|passwd|cookie)(_|-|$)/i.test(k);
  const looksLikeJwt = (v: string) => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(v);
  const looksLikePrivateKey = (v: string) => /-----(BEGIN|END) (RSA |EC )?PRIVATE KEY-----/.test(v);
  const looksLikeLongCred = (v: string) => /(^|\b)(sk-|xox[abpr]-)[A-Za-z0-9-]{16,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+\/=]{36,}/.test(v);
  const redactScalar = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (looksLikeJwt(s) || looksLikePrivateKey(s) || looksLikeLongCred(s)) return '•••redacted•••';
    return v;
  };
  const redactObject = (x: any): any => {
    if (x === null || x === undefined) return x;
    if (Array.isArray(x)) return x.map(redactObject);
    if (typeof x === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(x)) {
        if (isSecretKey(k)) { out[k] = '•••redacted•••'; continue; }
        out[k] = redactObject(v);
      }
      return out;
    }
    return redactScalar(x);
  };
  const prettyJson = (x: any, max = 4000) => {
    try {
      const s = JSON.stringify(x, null, 2);
      return s.length > max ? s.slice(0, max) + '…' : s;
    } catch { return String(x); }
  };

  // Pretty, human-readable summary renderer for tool inputs/outputs
  function renderToolSummary(toolName: string, summary?: string, kind: 'input' | 'output' = 'input') {
    if (!summary || typeof summary !== 'string') return null;
    const safePre = (text: string, opts?: { maxLines?: number; maxChars?: number }) => {
      let t = text ?? '';
      const maxChars = opts?.maxChars ?? 4000;
      if (t.length > maxChars) t = t.slice(0, maxChars) + '…';
      const maxLines = opts?.maxLines ?? 24;
      const lines = t.split(/\r?\n/);
      const clipped = lines.length > maxLines
        ? [...lines.slice(0, Math.max(3, Math.floor(maxLines / 2))), '…', ...lines.slice(-Math.max(3, Math.floor(maxLines / 2)))].join('\n')
        : t;
      return (
        <pre className="mt-1 bg-white border rounded p-2 overflow-auto max-h-56 text-[11px] leading-snug whitespace-pre-wrap">
          {clipped}
        </pre>
      );
    };
    const kv = (label: string, value?: React.ReactNode) => (
      value === undefined || value === null || value === '' ? null : (
        <div className="flex items-start gap-2 text-[12px]">
          <div className="text-slate-500 shrink-0 min-w-[72px]">{label}</div>
          <div className="text-slate-700 break-words">{value}</div>
        </div>
      )
    );
    const code = (v: string) => (<code className="font-mono text-[11px] bg-slate-100 rounded px-1 py-0.5">{v}</code>);
    const list = (items: string[], limit = 8) => {
      const shown = items.slice(0, limit);
      const more = Math.max(0, items.length - shown.length);
      return (
        <div className="mt-1">
          <ul className="list-disc pl-5 text-[11px] text-slate-700 max-h-56 overflow-auto">
            {shown.map((it, i) => (<li key={i}><span className="font-mono break-all">{it}</span></li>))}
          </ul>
          {more > 0 && (<div className="text-[11px] text-slate-500 mt-1">+{more} more</div>)}
        </div>
      );
    };

    // Try parse JSON
    let obj: any = null;
    try { obj = JSON.parse(summary); } catch {}

    // If not JSON, show trimmed raw block
    if (!obj) {
      const trimmed = summary.trim();
      return trimmed ? safePre(trimmed) : null;
    }

    // Tool-aware formatting
    const t = toolName;
    const isInput = kind === 'input';
    const wrap = (children: React.ReactNode) => (
      <div className="mt-1 bg-slate-50 border rounded p-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-slate-500">{isInput ? 'Input' : 'Output'}</div>
          {summary ? (
            <button
              type="button"
              onClick={() => { try { navigator.clipboard.writeText(summary); } catch {} }}
              className="text-[11px] px-1.5 py-0.5 border rounded bg-white hover:bg-slate-50"
              title="Copy raw JSON"
            >
              Copy Raw
            </button>
          ) : null}
        </div>
        {children}
      </div>
    );

    // web_fs_* inputs/outputs
    if (t === 'web_fs_write') {
      if (isInput) {
        const content = typeof obj.content === 'string' ? obj.content : '';
        const size = new TextEncoder().encode(content).length;
        return wrap(<>
          {kv('Path', code(String(obj.path || '')))}
          {kv('Size', `${size} bytes`)}
          {kv('Create Dirs', String(obj.createDirs ?? true))}
          {content ? (<div className="pt-1"><div className="text-slate-500 text-[12px]">Preview</div>{safePre(content, { maxLines: 20, maxChars: 3000 })}</div>) : null}
        </>);
      }
      return wrap(<>
        {kv('OK', String(obj.ok ?? ''))}
        {kv('Path', code(String(obj.path || '')))}
        {kv('Size', obj.size ? String(obj.size) : undefined)}
      </>);
    }
    if (t === 'web_fs_read') {
      if (isInput) {
        return wrap(<>
          {kv('Path', code(String(obj.path || '')))}
          {kv('Encoding', code(String(obj.encoding || 'utf-8')))}
        </>);
      }
      const content = typeof obj.content === 'string' ? obj.content : '';
      return wrap(<>
        {kv('Path', code(String(obj.path || '')))}
        {kv('Size', obj.size ? String(obj.size) : undefined)}
        {content ? (<div className="pt-1"><div className="text-slate-500 text-[12px]">Content</div>{safePre(content, { maxLines: 30, maxChars: 4000 })}</div>) : null}
      </>);
    }
    if (t === 'web_fs_rm') {
      return wrap(<>
        {kv('Path', code(String(obj.path || '')))}
        {kv(isInput ? 'Recursive?' : 'Recursive', String(obj.recursive ?? false))}
        {!isInput ? kv('OK', String(obj.ok ?? '')) : null}
      </>);
    }
    if (t === 'web_fs_find') {
      if (isInput) {
        return wrap(<>
          {kv('Root', code(String(obj.root ?? '.')))}
          {kv('Glob', obj.glob ? code(String(obj.glob)) : undefined)}
          {kv('Prefix', obj.prefix ? code(String(obj.prefix)) : undefined)}
          {kv('Max Depth', obj.maxDepth !== undefined ? String(obj.maxDepth) : undefined)}
          {kv('Limit', obj.limit !== undefined ? String(obj.limit) : undefined)}
          {kv('Offset', obj.offset !== undefined ? String(obj.offset) : undefined)}
        </>);
      }
      const files = Array.isArray(obj.files) ? obj.files : [];
      const applied: string[] = [];
      if (obj.applied?.glob) applied.push('glob');
      if (obj.applied?.prefix) applied.push('prefix');
      return wrap(<>
        {kv('Root', code(String(obj.root ?? '.')))}
        {kv('Count', `${obj.count ?? files.length} of ${obj.total ?? files.length}`)}
        {kv('Has More', obj.hasMore !== undefined ? String(obj.hasMore) : undefined)}
        {applied.length ? kv('Filters', applied.join(', ')) : null}
        {files.length ? (<div className="pt-1"><div className="text-slate-500 text-[12px]">Files</div>{list(files, 12)}</div>) : null}
      </>);
    }
    if (t === 'web_exec') {
      if (isInput) {
        const args = Array.isArray(obj.args) ? obj.args : [];
        const cmd = [obj.command, ...(args || [])].filter(Boolean).join(' ');
        return wrap(<>
          {kv('Command', code(cmd))}
          {kv('CWD', obj.cwd ? code(String(obj.cwd)) : undefined)}
          {args.length ? kv('Args', <span className="font-mono text-[11px]">[{args.join(', ')}]</span>) : null}
        </>);
      }
      const outText = String(obj.outputTail ?? obj.output ?? '');
      const ok = obj.ok ?? (obj.exitCode === 0 ? true : undefined);
      return wrap(<>
        {kv('Command', obj.command ? code(String(obj.command)) : undefined)}
        {kv('Exit Code', obj.exitCode !== undefined ? String(obj.exitCode) : undefined)}
        {ok !== undefined ? kv('OK', String(ok)) : null}
        {kv('CWD', obj.cwd ? code(String(obj.cwd)) : undefined)}
        {outText ? (<div className="pt-1"><div className="text-slate-500 text-[12px]">Output</div>{safePre(outText, { maxLines: 26, maxChars: 4000 })}</div>) : null}
      </>);
    }
    if (t === 'validate_project') {
      if (isInput) {
        const files = Array.isArray(obj.files) ? obj.files : [];
        return wrap(<>
          {kv('Scope', code(String(obj.scope ?? 'quick')))}
          {kv('Files', files.length ? `${files.length}` : undefined)}
          {files.length ? (<div className="pt-1">{list(files, 10)}</div>) : null}
        </>);
      }
      const files = Array.isArray(obj.files) ? obj.files : [];
      return wrap(<>
        {kv('OK', String(obj.ok ?? ''))}
        {kv('Scope', obj.scope ? code(String(obj.scope)) : undefined)}
        {kv('Files', files.length ? `${files.length}` : undefined)}
      </>);
    }
    if (t === 'app_manage') {
      return wrap(<>
        {kv('Action', code(String(obj.action || (isInput ? '' : (obj.ok ? 'done' : 'error')))))}
        {kv('Id', obj.id ? code(String(obj.id)) : undefined)}
        {kv('Name', obj.name || obj.newName ? code(String(obj.name || obj.newName)) : undefined)}
        {obj.removedPaths ? (<div className="pt-1"><div className="text-slate-500 text-[12px]">Removed</div>{list(obj.removedPaths || [], 10)}</div>) : null}
        {!isInput ? kv('OK', String(obj.ok ?? '')) : null}
      </>);
    }
    if (t === 'ai_generate') {
      return wrap(<>
        {kv('Provider', obj.provider ? code(String(obj.provider)) : undefined)}
        {kv('Task', obj.task ? code(String(obj.task)) : undefined)}
        {kv('Scope', obj.scope ? code(JSON.stringify(obj.scope)) : undefined)}
        {kv('Input Keys', obj.input ? Object.keys(obj.input).join(', ') : undefined)}
      </>);
    }

    // Unknown tool: best-effort formatting with redaction
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      const red = redactObject(obj);
      const entries = Object.entries(red as Record<string, any>);
      const nodes = entries.map(([k, v]) => kv(
        k,
        typeof v === 'string' ? (v.length > 200 ? safePre(v, { maxLines: 8, maxChars: 600 }) : v)
        : typeof v === 'number' || typeof v === 'boolean' ? String(v)
        : Array.isArray(v) ? list(v.map((x: any) => (typeof x === 'string' ? (redactScalar(x) as string) : JSON.stringify(redactObject(x)))), 8)
        : (<pre className="mt-0.5 bg-white border rounded p-2 overflow-auto max-h-40 text-[11px] leading-snug whitespace-pre-wrap">{prettyJson(redactObject(v), 2000)}</pre>)
      ));
      return wrap(nodes);
    }
    if (Array.isArray(obj)) {
      return wrap(<>
        {kv('Items', `${obj.length}`)}
        {list(obj.map((x: any) => (typeof x === 'string' ? (redactScalar(x) as string) : JSON.stringify(redactObject(x)))), 12)}
      </>);
    }
    // Scalar
    return safePre(String(redactScalar(obj)));
  }

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

  // Derive which tool calls contributed changes to the app being created vs no-ops
  type Impact = { kind: 'contributed' | 'no_change' | 'unknown'; reason?: string; appBase?: string; appId?: string };
  const appImpact = useMemo(() => {
    const byToolCallId: Record<string, Impact> = {};
    let currentAppBase: string | null = null;
    let currentAppId: string | null = null;
    const parse = (s?: string): any | null => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

    for (const ev of ordered) {
      if (ev.type === 'user_message') {
        // Reset context on new user instruction
        currentAppBase = null; currentAppId = null;
        continue;
      }
      if (ev.type !== 'tool_end') continue;
      const te = ev as ToolEndEvent;
      const out = parse(te.outputSummary);
      // Establish or update app creation context
      if (te.toolName === 'app_manage' && out && out.action === 'create' && typeof out.base === 'string') {
        currentAppBase = out.base; currentAppId = out.appId || (out.base?.split('/').pop());
        byToolCallId[te.toolCallId] = { kind: 'contributed', reason: 'app created', appBase: currentAppBase, appId: currentAppId || undefined };
        continue;
      }
      if (te.toolName === 'web_fs_write' && out && typeof out.path === 'string' && /(^|\/)src\/apps\/[^/]+\/metadata\.json$/.test(out.path)) {
        const id = out.path.split('/').slice(-2, -1)[0];
        currentAppBase = `src/apps/${id}`; currentAppId = id;
        byToolCallId[te.toolCallId] = { kind: 'contributed', reason: 'wrote app metadata', appBase: currentAppBase, appId: currentAppId || undefined };
        continue;
      }
      // Classify impact for this tool call based on current context
      let impact: Impact = { kind: 'unknown' };
      const underApp = (p?: string | string[]) => {
        if (!p) return false;
        const paths = Array.isArray(p) ? p : [p];
        return !!(currentAppBase && paths.some(x => typeof x === 'string' && x.startsWith(currentAppBase!)));
      };
      switch (te.toolName) {
        case 'web_fs_write': {
          const p = out?.path as string | undefined;
          if (underApp(p)) impact = { kind: 'contributed', reason: 'wrote under app', appBase: currentAppBase || undefined, appId: currentAppId || undefined };
          else if (p === 'public/apps/registry.json') impact = { kind: 'contributed', reason: 'updated registry' };
          else impact = { kind: 'no_change', reason: 'wrote outside app' };
          break;
        }
        case 'web_fs_rm': {
          const p = out?.path as string | undefined;
          if (underApp(p)) impact = { kind: 'contributed', reason: 'removed under app' };
          else impact = { kind: 'no_change', reason: 'removed outside app' };
          break;
        }
        case 'code_edit_ast': {
          const p = out?.path as string | undefined;
          const applied = !!out?.applied;
          if (applied && underApp(p)) impact = { kind: 'contributed', reason: 'code edit applied' };
          else if (!applied) impact = { kind: 'no_change', reason: 'no edits applied' };
          else impact = { kind: 'no_change', reason: 'edited outside app' };
          break;
        }
        case 'app_manage': {
          if (out?.action === 'rename') impact = { kind: 'contributed', reason: 'registry rename' };
          else if (out?.action === 'remove') impact = { kind: 'contributed', reason: 'app removed' };
          break;
        }
        case 'web_fs_read':
        case 'web_fs_find':
        case 'validate_project': {
          impact = { kind: 'no_change', reason: 'read-only' };
          break;
        }
        case 'web_exec': {
          // Could be package installs; conservatively mark unknown
          impact = { kind: 'unknown', reason: out?.maybeProjectChange ? 'package manager command' : 'exec' };
          break;
        }
        default: {
          impact = { kind: 'unknown' };
        }
      }
      byToolCallId[te.toolCallId] = impact;
    }
    const totals = Object.values(byToolCallId).reduce((acc, v) => {
      if (v.kind === 'contributed') acc.contributed++;
      else if (v.kind === 'no_change') acc.noChange++;
      else acc.unknown++;
      return acc;
    }, { contributed: 0, noChange: 0, unknown: 0 });
    return { byToolCallId, totals };
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { try { window.location.href = '/dev/agent-metrics/aggregate'; } catch {} }}
            className="px-2 py-1 border rounded bg-white shadow hover:bg-slate-50 text-sm"
          >
            Overall
          </button>
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

      {/* Editable Title */}
      <div className="border rounded p-3 bg-white">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (async () => {
                  if (!selected) return;
                  try {
                    setSavingName(true);
                    await fetch(`/api/metrics/session/${encodeURIComponent(selected)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: sessionName })
                    });
                    setSessions(prev => prev.map(s => s.sessionId === selected ? { ...s, name: sessionName.trim() || undefined } : s));
                  } finally {
                    setSavingName(false);
                  }
                })();
              }
            }}
            onBlur={() => {
              (async () => {
                if (!selected) return;
                try {
                  setSavingName(true);
                  await fetch(`/api/metrics/session/${encodeURIComponent(selected)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: sessionName })
                  });
                  setSessions(prev => prev.map(s => s.sessionId === selected ? { ...s, name: sessionName.trim() || undefined } : s));
                } finally {
                  setSavingName(false);
                }
              })();
            }}
            className="flex-1 border rounded px-2 py-1 text-sm"
            placeholder="Session title"
            aria-label="Session title"
          />
          <button
            type="button"
            disabled={savingName || !selected}
            onClick={async () => {
              if (!selected) return;
              try {
                setSavingName(true);
                await fetch(`/api/metrics/session/${encodeURIComponent(selected)}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: sessionName })
                });
                setSessions(prev => prev.map(s => s.sessionId === selected ? { ...s, name: sessionName.trim() || undefined } : s));
              } finally {
                setSavingName(false);
              }
            }}
            className={`px-2 py-1 border rounded bg-white shadow text-sm ${savingName ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-50'}`}
          >
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>


      {/* Side Drawer: Sessions list (no backdrop) */}
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
                      <div className="text-sm truncate max-w-[200px]" title={s.name || s.sessionId}>{s.name || s.sessionId}</div>
                      <div className="text-[11px] text-slate-500 ml-2">{last}</div>
                    </div>
                    <div className="font-mono text-[10px] text-slate-400 truncate" title={s.sessionId}>{s.sessionId}</div>
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
                    <td className="py-1 pr-2 font-mono text-xs truncate"><ToolName name={name} /></td>
                    <td className="py-1 pr-2 align-top text-slate-700">
                      {(() => {
                        const actions = recentActionsByTool.get(name) || [];
                        if (actions.length === 0) return '—';
                        const isOpen = !!expandedToolRows[name];
                        // Heuristic: if any action is long, show the toggle
                        const needsToggle = actions.some(a => (a?.length || 0) > 48);
                        return (
                          <div
                            className={`relative ${needsToggle ? 'cursor-pointer' : ''}`}
                            role={needsToggle ? 'button' : undefined}
                            tabIndex={needsToggle ? 0 : undefined}
                            aria-expanded={needsToggle ? isOpen : undefined}
                            onClick={() => { if (needsToggle) toggleToolRow(name); }}
                            onKeyDown={(evt) => {
                              if (!needsToggle) return;
                              if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); toggleToolRow(name); }
                            }}
                          >
                            <div className="flex flex-col gap-0.5 pr-5" aria-label="Recent actions">
                              {actions.slice(0, 5).map((a, idx) => (
                                <div
                                  key={idx}
                                  className={`text-xs leading-snug ${isOpen ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                                  title={a}
                                >
                                  {a}
                                </div>
                              ))}
                            </div>
                            {needsToggle && (
                              <button
                                type="button"
                                aria-label={isOpen ? 'Collapse recent actions' : 'Expand recent actions'}
                                onClick={(e) => { e.stopPropagation(); toggleToolRow(name); }}
                                className="absolute top-0 right-0 text-slate-500 hover:text-slate-700 text-xs px-1"
                              >
                                {isOpen ? '▾' : '▸'}
                              </button>
                            )}
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
          <div className="font-medium mb-2">Creation Impact</div>
          <div className="text-sm text-slate-700 flex gap-6">
            <div>
              <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Contributed</span>
              <span className="ml-2">{appImpact.totals.contributed}</span>
            </div>
            <div>
              <span className="inline-block px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">No Change</span>
              <span className="ml-2">{appImpact.totals.noChange}</span>
            </div>
            <div>
              <span className="inline-block px-2 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200">Unknown</span>
              <span className="ml-2">{appImpact.totals.unknown}</span>
            </div>
          </div>
        </div>
        <div className="border rounded p-3 bg-white">
          <div className="font-medium mb-2">Live Timeline</div>
          <div className="text-sm">
            {ordered.map((e, i) => {
              const key = rowKeyForEvent(e, i);
              const isMessageEvent = e.type === 'user_message' || e.type === 'assistant_message';
              const isExpandable = e.type === 'tool_start' || e.type === 'tool_end' || isMessageEvent;
              const isOpen = !!expanded[key];
              const isToolEvent = e.type === 'tool_start' || e.type === 'tool_end';
              const toolNameForRow = isToolEvent ? (e as any).toolName as string : undefined;
              const stepIdx = stepIndexForPosition(i);
              return (
                <div
                  key={`${e.type}-${i}`}
                  className={`py-1 border-b ${isToolEvent ? 'bg-indigo-50 border-l-4' : ''} ${isExpandable ? 'cursor-pointer' : ''}`}
                  style={isToolEvent && toolNameForRow ? { borderLeftColor: toolColor(toolNameForRow) } : undefined}
                  role={isExpandable ? 'button' : undefined}
                  tabIndex={isExpandable ? 0 : undefined}
                  aria-expanded={isExpandable ? isOpen : undefined}
                  onClick={() => { if (isExpandable) toggleExpanded(key); }}
                  onKeyDown={(evt) => {
                    if (!isExpandable) return;
                    if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); toggleExpanded(key); }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      <span className="ml-2 font-semibold">{e.type}</span>
                      {e.type === 'tool_start' && (
                        <span className="ml-2 text-slate-600">
                          <ToolName name={(e as ToolStartEvent).toolName} />
                          {(() => {
                            const ts = e as ToolStartEvent;
                            const d = describeToolAction(ts.toolName, ts.inputSummary, undefined);
                            return d ? <span className="ml-2 text-slate-500">— {d}</span> : null;
                          })()}
                          {(() => {
                            const ts = e as ToolStartEvent;
                            const imp = appImpact.byToolCallId[ts.toolCallId];
                            if (!imp) return null;
                            const label = imp.kind === 'contributed' ? 'Contributed' : imp.kind === 'no_change' ? 'No Change' : 'Unknown';
                            const cls = imp.kind === 'contributed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : imp.kind === 'no_change' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-700 border-slate-200';
                            return <span className={`ml-2 inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border ${cls}`} title={imp.reason || ''}>{label}</span>;
                          })()}
                        </span>
                      )}
                      {e.type === 'tool_end' && (
                        <span className="ml-2 text-slate-600">
                          <ToolName name={(e as ToolEndEvent).toolName} />
                          {(() => {
                            const te = e as ToolEndEvent;
                            // Keep concise action summary; detailed info is in dropdown
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
                            const imp = appImpact.byToolCallId[te.toolCallId];
                            if (!imp) return null;
                            const label = imp.kind === 'contributed' ? 'Contributed' : imp.kind === 'no_change' ? 'No Change' : 'Unknown';
                            const cls = imp.kind === 'contributed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : imp.kind === 'no_change' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-700 border-slate-200';
                            return <span className={`ml-2 inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border ${cls}`} title={imp.reason || ''}>{label}</span>;
                          })()}
                        </span>
                      )}
                      {e.type === 'step_usage' && (
                        <span className="ml-2 text-slate-600">step {(e as StepUsageEvent).stepIndex} — tokens {(e as StepUsageEvent).totalTokens} — tools {(e as StepUsageEvent).toolCallIds.length}</span>
                      )}
                      {e.type === 'user_message' && (() => {
                        const ue = e as UserMessageEvent;
                        const preview = (ue.content || '').trim();
                        const short = preview.length > 160 ? preview.slice(0, 160) + '…' : preview;
                        return (
                          <>
                            <span className="ml-2 text-slate-600">{short || '[empty message]'}</span>
                            {typeof stepIdx === 'number' ? (
                              <span className="ml-2 text-slate-500">(step {stepIdx})</span>
                            ) : null}
                          </>
                        );
                      })()}
                      {e.type === 'assistant_message' && (() => {
                        const ae = e as AssistantMessageEvent;
                        const preview = (ae.content || '').trim();
                        const short = preview.length > 160 ? preview.slice(0, 160) + '…' : preview;
                        return (
                          <>
                            <span className="ml-2 text-slate-600">{short || '[empty message]'}</span>
                            {typeof stepIdx === 'number' ? (
                              <span className="ml-2 text-slate-500">(step {stepIdx})</span>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                    {isExpandable && (
                      <button
                        type="button"
                        aria-label={isOpen ? 'Collapse details' : 'Expand details'}
                        onClick={(ev) => { ev.stopPropagation(); toggleExpanded(key); }}
                        className="shrink-0 mt-0.5 px-1 py-0.5 text-slate-500 hover:text-slate-700 rounded"
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    )}
                  </div>
                  {isExpandable && isOpen && (
                    <div className="mt-2 ml-6 mr-2 p-2 bg-slate-50 border rounded">
                      {e.type === 'tool_start' && (() => {
                        const ts = e as ToolStartEvent;
                        return (
                          <div className="text-[12px] text-slate-700 space-y-1">
                            <div><span className="text-slate-500">Call ID:</span> <span className="font-mono">{ts.toolCallId}</span></div>
                            <div><span className="text-slate-500">Tool:</span> <ToolName name={ts.toolName} /></div>
                            {ts.inputSummary ? renderToolSummary(ts.toolName, ts.inputSummary, 'input') : null}
                          </div>
                        );
                      })()}
                      {e.type === 'tool_end' && (() => {
                        const te = e as ToolEndEvent;
                        return (
                          <div className="text-[12px] text-slate-700 space-y-1">
                            <div><span className="text-slate-500">Call ID:</span> <span className="font-mono">{te.toolCallId}</span></div>
                            <div><span className="text-slate-500">Tool:</span> <ToolName name={te.toolName} /></div>
                            <div><span className="text-slate-500">Duration:</span> {te.durationMs}ms</div>
                            <div><span className={`inline-flex items-center ${te.success ? 'text-emerald-600' : 'text-rose-600'}`}>{te.success ? 'Success' : 'Error'}</span></div>
                            {(() => {
                              const imp = appImpact.byToolCallId[te.toolCallId];
                              if (!imp) return null;
                              const label = imp.kind === 'contributed' ? 'Contributed' : imp.kind === 'no_change' ? 'No Change' : 'Unknown';
                              const cls = imp.kind === 'contributed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : imp.kind === 'no_change' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-700 border-slate-200';
                              return (
                                <div>
                                  <span className="text-slate-500">Contribution:</span>
                                  <span className={`ml-2 inline-flex items-center text-[11px] px-1 py-0.5 rounded border ${cls}`} title={imp.reason || ''}>{label}</span>
                                  {imp.reason ? <span className="ml-2 text-slate-500">({imp.reason})</span> : null}
                                </div>
                              );
                            })()}
                            {te.error ? (
                              <div className="text-rose-700"><span className="text-slate-500">Error:</span> {te.error}</div>
                            ) : null}
                            {te.outputSummary ? renderToolSummary(te.toolName, te.outputSummary, 'output') : null}
                          </div>
                        );
                      })()}
                      {e.type === 'user_message' && (() => {
                        const ue = e as UserMessageEvent;
                        const text = (ue.content || '').trim();
                        return (
                          <div className="text-[12px] text-slate-700 space-y-1">
                            {ue.messageId ? (<div><span className="text-slate-500">Message ID:</span> <span className="font-mono">{ue.messageId}</span></div>) : null}
                            {typeof stepIdx === 'number' ? (<div><span className="text-slate-500">Step:</span> {stepIdx}</div>) : null}
                            <div>
                              <div className="text-slate-500">Content</div>
                              <pre className="mt-1 bg-white border rounded p-2 overflow-auto max-h-56 text-[11px] leading-snug whitespace-pre-wrap">{text || '[empty message]'}</pre>
                            </div>
                          </div>
                        );
                      })()}
                      {e.type === 'assistant_message' && (() => {
                        const ae = e as AssistantMessageEvent;
                        const text = (ae.content || '').trim();
                        return (
                          <div className="text-[12px] text-slate-700 space-y-1">
                            {ae.messageId ? (<div><span className="text-slate-500">Message ID:</span> <span className="font-mono">{ae.messageId}</span></div>) : null}
                            {typeof stepIdx === 'number' ? (<div><span className="text-slate-500">Step:</span> {stepIdx}</div>) : null}
                            <div>
                              <div className="text-slate-500">Content</div>
                              <pre className="mt-1 bg-white border rounded p-2 overflow-auto max-h-56 text-[11px] leading-snug whitespace-pre-wrap">{text || '[empty message]'}</pre>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
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
