'use client';

import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getUsageCostBreakdown } from '@/lib/agent/metrics/tokenEstimation';
import { cn } from '@/lib/utils';
import type { AgentEventKind, AgentMessagePreview } from '@/lib/agent/metrics/types';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';

type UsageRecord = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  charCount?: number;
};

type SessionListItem = {
  sessionId: string;
  requestId: string;
  userIdentifier?: string | null;
  model?: string | null;
  personaMode: boolean;
  toolCallCount: number;
  stepCount: number;
  estimatedCostUSD: number;
  actualCostUSD: number | null;
  estimatedUsage: UsageRecord | null;
  actualUsage: UsageRecord | null;
  sessionStartedAt: number;
  sessionFinishedAt: number | null;
  durationMs?: number;
  attachmentsCount: number;
  messagePreviews: AgentMessagePreview[] | null | undefined;
  tags: string[];
  status: 'active' | 'completed';
  updatedAt: number;
  createdAt: number;
};

type TimelineData = {
  session: SessionListItem & DocId;
  steps: Array<{
    _id: string;
    sessionId: string;
    stepIndex: number;
    finishReason?: string;
    textLength: number;
    toolCallsCount: number;
    toolResultsCount: number;
    usage?: UsageRecord;
    generatedTextPreview?: string;
    createdAt: number;
  }>;
  toolCalls: Array<{
    _id: string;
    sessionId: string;
    toolCallId: string;
    toolName: string;
    stepIndex: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
    inputSummary?: Record<string, unknown>;
    resultSummary?: Record<string, unknown>;
    tokenUsage?: UsageRecord;
    costUSD?: number;
    isError?: boolean;
  }>;
  events: Array<{
    _id: string;
    sessionId: string;
    sequence: number;
    timestamp: number;
    kind: string;
    payload: Record<string, unknown>;
    source?: string;
  }>;
};

type DocId = { _id: string };

type Nullable<T> = T | null | undefined;

const formatNumber = (value: number | undefined | null, precision = 0): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '0';
  return precision > 0 ? value.toLocaleString(undefined, { maximumFractionDigits: precision }) : value.toLocaleString();
};

const formatCost = (value: number | undefined | null): string => {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(4)}`;
};

const formatCostExact = (value: number | undefined | null): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `$${value.toFixed(4)}`;
};

const formatDuration = (ms?: number | null): string => {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const formatTimestamp = (ts?: number | null): string => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
};

const shortId = (value: string, max = 16): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
};

const truncateText = (value: string, max = 120): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
};

const tokensFromUsage = (usage: Nullable<UsageRecord>, key: keyof UsageRecord): number => {
  const value = usage?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const usageSummary = (usage: Nullable<UsageRecord>): string => {
  const total = tokensFromUsage(usage, 'totalTokens');
  if (total === 0) return '0 tokens';
  const prompt = tokensFromUsage(usage, 'promptTokens');
  const completion = tokensFromUsage(usage, 'completionTokens');
  return `${formatNumber(total)} tokens (prompt ${formatNumber(prompt)}, completion ${formatNumber(completion)})`;
};

type TimelineEntryKind = AgentEventKind;

type TimelineEntry = {
  id: string;
  kind: TimelineEntryKind;
  title: string;
  timestamp?: number;
  subtitle?: string;
  status?: 'default' | 'success' | 'warning' | 'error';
  accent: string;
  meta?: Array<{ label: string; value: string }>;
  preview?: string;
  payload?: Record<string, unknown>;
  payloadString?: string;
  sequence?: number;
};

const safeJsonStringify = (value: unknown, spacing = 2): string => {
  try {
    return JSON.stringify(value, null, spacing);
  } catch (error) {
    return `Unable to serialize payload: ${(error as Error).message}`;
  }
};

const getEventAccent = (kind: TimelineEntryKind, status: TimelineEntry['status'] = 'default'): string => {
  if (status === 'error') return 'bg-destructive/70';
  if (status === 'success') return 'bg-emerald-500/80';
  switch (kind) {
    case 'session_started':
      return 'bg-emerald-500/80';
    case 'session_finished':
      return 'bg-slate-500/70';
    case 'step_finished':
      return 'bg-indigo-500/70';
    case 'tool_call_started':
      return 'bg-blue-500/70';
    case 'tool_call_finished':
      return 'bg-blue-500/70';
    case 'tool_call_outbound':
      return 'bg-sky-500/70';
    case 'tool_call_inbound':
      return 'bg-sky-500/70';
    case 'message_logged':
      return 'bg-purple-500/70';
    default:
      return 'bg-muted-foreground/60';
  }
};

const describeEventKind = (kind: TimelineEntryKind): string => {
  switch (kind) {
    case 'session_started':
      return 'Session Started';
    case 'session_finished':
      return 'Session Finished';
    case 'step_finished':
      return 'Step Finished';
    case 'tool_call_started':
      return 'Tool Call Started';
    case 'tool_call_finished':
      return 'Tool Call Finished';
    case 'tool_call_outbound':
      return 'Tool Call Outbound';
    case 'tool_call_inbound':
      return 'Tool Call Inbound';
    case 'message_logged':
      return 'Message Logged';
    default:
      return 'Event';
  }
};

const capitalize = (value: string | undefined | null): string => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const formatList = (items: string[], max = 3): string => {
  if (items.length === 0) return '—';
  if (items.length <= max) return items.join(', ');
  const visible = items.slice(0, max).join(', ');
  return `${visible} +${items.length - max} more`;
};

export default function AgentDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = useMemo(() => searchParams?.toString() ?? '', [searchParams]);
  const sessionIdFromQuery = searchParams?.get('sessionId') ?? null;
  const sessions = useQuery(convexApi.agentMetrics.listSessions, { limit: 25 }) as SessionListItem[] | undefined;
  const sessionsLoading = sessions === undefined;

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionIdFromQuery);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    if (sessionIdFromQuery && sessionIdFromQuery !== selectedSessionId) {
      setSelectedSessionId(sessionIdFromQuery);
    }
  }, [sessionIdFromQuery, selectedSessionId]);

  useEffect(() => {
    if (!sessionIdFromQuery && !selectedSessionId && sessions && sessions.length > 0) {
      const fallbackSessionId = sessions[0].sessionId;
      setSelectedSessionId(fallbackSessionId);
      const params = new URLSearchParams(searchParamsString);
      params.set('sessionId', fallbackSessionId);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  }, [pathname, router, searchParamsString, selectedSessionId, sessionIdFromQuery, sessions]);

  const timeline = useQuery(
    convexApi.agentMetrics.getSessionTimeline,
    selectedSessionId ? { sessionId: selectedSessionId } : 'skip',
  ) as TimelineData | null | undefined;
  const timelineLoading = Boolean(selectedSessionId && timeline === undefined);

  const setSessionTagMutation = useMutation(convexApi.agentMetrics.setSessionTag);

  const handleSessionSelect = (sessionId: string) => {
    if (sessionId === selectedSessionId) return;
    setSelectedSessionId(sessionId);
    const params = new URLSearchParams(searchParamsString);
    params.set('sessionId', sessionId);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      }
    }
  };


  const selectedSession = useMemo(
    () => sessions?.find((session) => session.sessionId === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const [sessionTags, setSessionTags] = useState<Record<string, string>>({});

  const selectedSessionTitle = useMemo(() => {
    if (!selectedSession) return null;
    const override = sessionTags[selectedSession.sessionId]?.trim();
    if (override) return override;
    return getSessionTitle(selectedSession).title;
  }, [selectedSession, sessionTags]);

  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [editingTagSessionId, setEditingTagSessionId] = useState<string | null>(null);
  const [tagDraftValue, setTagDraftValue] = useState('');
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const skipTagCommitRef = useRef(false);
  const pendingTagMutationsRef = useRef(new Set<string>());

  useEffect(() => {
    if (editingTagSessionId && tagInputRef.current) {
      tagInputRef.current.focus();
      tagInputRef.current.select();
    }
  }, [editingTagSessionId]);

  useEffect(() => {
    if (!sessions) return;
    setSessionTags((prev) => {
      const next = { ...prev };
      let didChange = false;
      const activeIds = new Set(sessions.map((session) => session.sessionId));

      for (const session of sessions) {
        const sessionId = session.sessionId;
        if (pendingTagMutationsRef.current.has(sessionId)) {
          continue;
        }
        const serverTag = Array.isArray(session.tags)
          ? session.tags.find((tag) => typeof tag === 'string' && tag.trim().length > 0)
          : undefined;
        if (serverTag) {
          const trimmed = serverTag.trim();
          if (next[sessionId] !== trimmed) {
            next[sessionId] = trimmed;
            didChange = true;
          }
        } else if (next[sessionId] !== undefined) {
          delete next[sessionId];
          didChange = true;
        }
      }

      for (const sessionId of Object.keys(next)) {
        if (!activeIds.has(sessionId) && !pendingTagMutationsRef.current.has(sessionId)) {
          delete next[sessionId];
          didChange = true;
        }
      }

      return didChange ? next : prev;
    });
  }, [sessions]);

  useEffect(() => {
    if (!sessions) return;
    if (editingTagSessionId && !sessions.some((session) => session.sessionId === editingTagSessionId)) {
      setEditingTagSessionId(null);
      setTagDraftValue('');
    }
  }, [editingTagSessionId, sessions]);

  const persistTag = (sessionId: string, value: string | null) => {
    const normalizedInput = typeof value === 'string' ? value.trim() : '';
    const finalValue = normalizedInput.length > 0 ? normalizedInput : null;
    const previousValue = sessionTags[sessionId];
    const previousNormalized = typeof previousValue === 'string' && previousValue.trim().length > 0 ? previousValue : null;

    if (previousNormalized === finalValue) {
      return;
    }

    pendingTagMutationsRef.current.add(sessionId);

    setSessionTags((prev) => {
      if (finalValue) {
        if (prev[sessionId] === finalValue) {
          return prev;
        }
        return { ...prev, [sessionId]: finalValue };
      }
      if (prev[sessionId] === undefined) {
        return prev;
      }
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });

    void setSessionTagMutation({ sessionId, tag: finalValue })
      .catch((error) => {
        console.error('Failed to update session tag', error);
        setSessionTags((prev) => {
          if (previousNormalized) {
            if (prev[sessionId] === previousNormalized) {
              return prev;
            }
            return { ...prev, [sessionId]: previousNormalized };
          }
          if (prev[sessionId] === undefined) {
            return prev;
          }
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      })
      .finally(() => {
        pendingTagMutationsRef.current.delete(sessionId);
      });
  };

  const commitTagEdit = (sessionId: string) => {
    persistTag(sessionId, tagDraftValue);
    setEditingTagSessionId(null);
    setTagDraftValue('');
  };

  const cancelTagEdit = () => {
    skipTagCommitRef.current = true;
    setEditingTagSessionId(null);
    setTagDraftValue('');
    setTimeout(() => {
      skipTagCommitRef.current = false;
    }, 0);
  };

  const handleTagInputBlur = (_event: FocusEvent<HTMLInputElement>, sessionId: string) => {
    if (skipTagCommitRef.current) {
      skipTagCommitRef.current = false;
      return;
    }
    commitTagEdit(sessionId);
  };

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, sessionId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTagEdit(sessionId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTagEdit();
    }
  };

  const beginTagEdit = (sessionId: string) => {
    skipTagCommitRef.current = false;
    setEditingTagSessionId(sessionId);
    setTagDraftValue(sessionTags[sessionId] ?? '');
  };

  const clearSessionName = (sessionId: string) => {
    skipTagCommitRef.current = true;
    setEditingTagSessionId((current) => (current === sessionId ? null : current));
    setTagDraftValue('');
    persistTag(sessionId, null);
    setTimeout(() => {
      skipTagCommitRef.current = false;
    }, 0);
  };

  const sessionSummary = useMemo(() => {
    const sessionSource = (selectedSession ?? (timeline?.session as SessionListItem | null | undefined) ?? null) as
      | SessionListItem
      | null;

    const sessionDoc = (timeline?.session as (SessionListItem & DocId) | null | undefined) ?? null;

    const actualUsage =
      ((sessionSource?.actualUsage ?? null) as Nullable<UsageRecord>) ??
      ((sessionDoc?.actualUsage ?? null) as Nullable<UsageRecord>) ??
      null;
    const estimatedUsage =
      ((sessionSource?.estimatedUsage ?? null) as Nullable<UsageRecord>) ??
      ((sessionDoc?.estimatedUsage ?? null) as Nullable<UsageRecord>) ??
      null;

    const usage = actualUsage ?? estimatedUsage;
    const usageKind: 'actual' | 'estimated' | null = actualUsage ? 'actual' : estimatedUsage ? 'estimated' : null;

    const promptTokens = usage ? tokensFromUsage(usage, 'promptTokens') : null;
    const completionTokens = usage ? tokensFromUsage(usage, 'completionTokens') : null;
    let totalTokens: number | null = null;
    if (usage) {
      const totalCandidate = tokensFromUsage(usage, 'totalTokens');
      totalTokens = Number.isFinite(totalCandidate) && totalCandidate > 0 ? totalCandidate : (promptTokens ?? 0) + (completionTokens ?? 0);
    }

    const model = sessionSource?.model ?? (sessionDoc?.model as string | undefined);
    const costBreakdown = usage ? getUsageCostBreakdown(usage, model ?? undefined) : null;

    const events = Array.isArray(timeline?.events) ? timeline.events : [];

    let earliestUser: number | null = null;
    let latestAssistant: number | null = null;

    for (const event of events) {
      if (event.kind !== 'message_logged') continue;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const role = typeof payload.role === 'string' ? (payload.role as string) : null;
      if (!role) continue;
      const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
      if (ts === null) continue;

      if (role === 'user') {
        if (earliestUser === null || ts < earliestUser) {
          earliestUser = ts;
        }
      } else if (role === 'assistant') {
        if (latestAssistant === null || ts > latestAssistant) {
          latestAssistant = ts;
        }
      }
    }

    const sessionStart =
      typeof sessionSource?.sessionStartedAt === 'number'
        ? sessionSource.sessionStartedAt
        : typeof sessionDoc?.sessionStartedAt === 'number'
          ? sessionDoc.sessionStartedAt
          : null;

    const sessionFinish =
      typeof sessionSource?.sessionFinishedAt === 'number'
        ? sessionSource.sessionFinishedAt
        : typeof sessionDoc?.sessionFinishedAt === 'number'
          ? sessionDoc.sessionFinishedAt
          : null;

    const fallbackEarliest = events.reduce<number | null>((acc, event) => {
      const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
      if (ts === null) return acc;
      if (acc === null || ts < acc) return ts;
      return acc;
    }, null);

    const fallbackLatest = events.reduce<number | null>((acc, event) => {
      const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
      if (ts === null) return acc;
      if (acc === null || ts > acc) return ts;
      return acc;
    }, null);

    const startTimestamp = earliestUser ?? sessionStart ?? fallbackEarliest;
    const endTimestamp = latestAssistant ?? sessionFinish ?? fallbackLatest;

    const durationMs =
      typeof startTimestamp === 'number' &&
      typeof endTimestamp === 'number' &&
      endTimestamp >= startTimestamp
        ? endTimestamp - startTimestamp
        : null;

    return {
      usageKind,
      tokens: usage
        ? {
            prompt: promptTokens ?? 0,
            completion: completionTokens ?? 0,
            total: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
          }
        : null,
      costs: costBreakdown,
      durationMs,
    };
  }, [selectedSession, timeline]);

  const sessionStatus = selectedSession?.status ?? null;
  const summaryTokensPlaceholder = sessionsLoading ? 'Loading…' : '—';
  const summaryCostPlaceholder = summaryTokensPlaceholder;
  const summaryDurationPlaceholder = timelineLoading
    ? 'Loading…'
    : sessionStatus === 'active'
      ? 'In progress'
      : '—';

  const summaryRows = [
    {
      key: 'input',
      label: 'Input',
      value: sessionSummary.tokens
        ? `${formatNumber(sessionSummary.tokens.prompt)} tokens`
        : summaryTokensPlaceholder,
      secondary: sessionSummary.costs
        ? formatCostExact(sessionSummary.costs.promptCostUSD)
        : summaryCostPlaceholder,
    },
    {
      key: 'output',
      label: 'Output',
      value: sessionSummary.tokens
        ? `${formatNumber(sessionSummary.tokens.completion)} tokens`
        : summaryTokensPlaceholder,
      secondary: sessionSummary.costs
        ? formatCostExact(sessionSummary.costs.completionCostUSD)
        : summaryCostPlaceholder,
    },
    {
      key: 'total',
      label: 'Total',
      value: sessionSummary.tokens
        ? `${formatNumber(sessionSummary.tokens.total)} tokens`
        : summaryTokensPlaceholder,
      secondary: sessionSummary.costs
        ? formatCostExact(sessionSummary.costs.totalCostUSD)
        : summaryCostPlaceholder,
    },
    {
      key: 'duration',
      label: 'End to End',
      value:
        sessionSummary.durationMs !== null
          ? formatDuration(sessionSummary.durationMs)
          : summaryDurationPlaceholder,
      secondary: '—',
    },
  ];

  const usageSummaryRows = summaryRows.filter((row) => row.key !== 'duration');
  const auxiliarySummaryRows = summaryRows.filter((row) => row.key === 'duration');

  const summaryUsageLabel = sessionSummary.usageKind === 'actual'
    ? 'Actual usage'
    : sessionSummary.usageKind === 'estimated'
      ? 'Estimated usage'
      : null;

  const timelineEntries = useMemo(() => {
    if (!timeline) return [] as TimelineEntry[];

    const entries: TimelineEntry[] = [];
    const session = timeline.session;

    const events = Array.isArray(timeline.events) ? [...timeline.events] : [];
    // Sort chronologically by timestamp to reflect the real emission order; fall back to
    // sequence/_id when timestamps collide or are missing.
    events.sort((a, b) => {
      const aTimestamp = typeof a.timestamp === 'number' ? a.timestamp : Number.MIN_SAFE_INTEGER;
      const bTimestamp = typeof b.timestamp === 'number' ? b.timestamp : Number.MIN_SAFE_INTEGER;
      if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;
      if (a.sequence !== b.sequence) return a.sequence - b.sequence;
      return a._id.localeCompare(b._id);
    });

    for (const event of events) {
      const kind = (event.kind as AgentEventKind) ?? 'message_logged';
      let status: TimelineEntry['status'] = 'default';
      const payload = event.payload ?? {};
      const meta: Array<{ label: string; value: string }> = [];
      let title = describeEventKind(kind);
      let subtitle: string | undefined;
      let preview: string | undefined;

      switch (kind) {
        case 'session_started': {
          const personaMode = typeof payload.personaMode === 'boolean' ? payload.personaMode : session?.personaMode;
          const attachments = typeof payload.attachmentsCount === 'number' ? payload.attachmentsCount : session?.attachmentsCount;
          const toolNames = Array.isArray(payload.toolNames)
            ? (payload.toolNames as string[])
            : session && Array.isArray((session as unknown as { toolNames?: string[] }).toolNames)
              ? (((session as unknown as { toolNames?: string[] }).toolNames) ?? [])
              : [];
          const messagePreviews = Array.isArray(payload.messagePreviews)
            ? (payload.messagePreviews as AgentMessagePreview[])
            : [];
          meta.push(
            { label: 'Persona Mode', value: personaMode ? 'Enabled' : 'Disabled' },
            { label: 'Attachments', value: attachments ? formatNumber(attachments) : '0' },
            { label: 'Tools', value: toolNames.length ? formatList(toolNames) : '—' },
          );
          if (payload.userIdentifier || session?.userIdentifier) {
            meta.push({ label: 'User', value: (payload.userIdentifier as string) ?? session?.userIdentifier ?? '—' });
          }
          if (messagePreviews.length > 0) {
            preview = messagePreviews
              .map((previewItem) => `${capitalize(previewItem.role)}: ${truncateText(previewItem.textPreview, 80)}`)
              .join(' • ');
          }
          subtitle = toolNames.length ? `Tools: ${formatList(toolNames)}` : undefined;
          break;
        }

        case 'message_logged': {
          const role = typeof payload.role === 'string' ? capitalize(payload.role) : 'Message';
          const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : undefined;
          title = `${role} message logged`;
          if (stepIndex !== undefined) subtitle = `Step ${stepIndex}`;
          if (typeof payload.charCount === 'number') meta.push({ label: 'Characters', value: formatNumber(payload.charCount) });
          if (typeof payload.tokenEstimate === 'number') meta.push({ label: 'Tokens (est)', value: formatNumber(payload.tokenEstimate) });
          if (typeof payload.textPreview === 'string') {
            preview = truncateText(payload.textPreview, 260);
          }
          break;
        }

        case 'step_finished': {
          const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : undefined;
          const finishReason = typeof payload.finishReason === 'string' ? payload.finishReason : undefined;
          const finishReasonLabel = (() => {
            switch (finishReason) {
              case 'tool-calls':
                return 'Tool call queued';
              case 'stop':
                return 'Step completed';
              case 'length':
                return 'Token limit reached';
              case 'content_filter':
                return 'Blocked by content filter';
              default:
                return finishReason ? `Finished (${finishReason})` : 'Step finished';
            }
          })();
          title = finishReasonLabel;
          if (finishReason) {
            subtitle = `Finish reason: ${finishReason}`;
          }
          if (stepIndex !== undefined) {
            meta.push({ label: 'Step Index', value: formatNumber(stepIndex) });
          }
          if (typeof payload.toolCallsCount === 'number') meta.push({ label: 'Tool Calls', value: formatNumber(payload.toolCallsCount) });
          if (typeof payload.toolResultsCount === 'number') meta.push({ label: 'Tool Results', value: formatNumber(payload.toolResultsCount) });
          const usage = payload.usage as Nullable<UsageRecord>;
          if (usage) {
            meta.push({ label: 'Tokens', value: usageSummary(usage) });
          }
          if (typeof payload.generatedTextPreview === 'string') {
            preview = truncateText(payload.generatedTextPreview, 260);
          }
          break;
        }

        case 'tool_call_started': {
          const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'Tool call';
          title = `Tool call started: ${toolName}`;
          const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : undefined;
          if (stepIndex !== undefined) subtitle = `Step ${stepIndex}`;
          const inputSummary = (payload.inputSummary ?? {}) as Record<string, unknown>;
          if (typeof inputSummary.tokenEstimate === 'number') {
            meta.push({ label: 'Input tokens (est)', value: formatNumber(inputSummary.tokenEstimate as number) });
          }
          if (typeof inputSummary.charCount === 'number') {
            meta.push({ label: 'Input chars', value: formatNumber(inputSummary.charCount as number) });
          }
          const sanitized = inputSummary.sanitized as Record<string, unknown> | undefined;
          if (sanitized && Object.keys(sanitized).length > 0) {
            preview = truncateText(safeJsonStringify(sanitized, 0), 260);
          }
          break;
        }

        case 'tool_call_outbound': {
          const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'Tool call';
          title = `Tool Call → ${toolName}`;
          const stepIndex = typeof payload.stepIndex === 'number' ? payload.stepIndex : undefined;
          if (stepIndex !== undefined) subtitle = `Step ${stepIndex}`;
          const argsSummary = (payload.argsSummary ?? {}) as Record<string, unknown>;
          const inputTokens = typeof argsSummary.tokenEstimate === 'number' ? (argsSummary.tokenEstimate as number) : undefined;
          const inputChars = typeof argsSummary.charCount === 'number' ? (argsSummary.charCount as number) : undefined;
          if (inputTokens !== undefined) meta.push({ label: 'Input tokens (est)', value: formatNumber(inputTokens) });
          if (inputChars !== undefined) meta.push({ label: 'Input chars', value: formatNumber(inputChars) });
          if (typeof payload.estimatedCostUSD === 'number') {
            meta.push({ label: 'Cost est.', value: formatCost(payload.estimatedCostUSD as number) });
          }
          const sanitized = argsSummary.sanitized as Record<string, unknown> | undefined;
          if (sanitized && Object.keys(sanitized).length > 0) {
            preview = truncateText(safeJsonStringify(sanitized, 0), 260);
          }
          break;
        }

        case 'tool_call_inbound': {
          const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'Tool call';
          title = `Tool Result ← ${toolName}`;
          const duration = typeof payload.durationMs === 'number' ? (payload.durationMs as number) : undefined;
          if (duration !== undefined) {
            subtitle = `Duration ${formatDuration(duration)}`;
            meta.push({ label: 'Duration', value: formatDuration(duration) });
          }
          const resultSummary = (payload.resultSummary ?? {}) as Record<string, unknown>;
          const tokenUsage = payload.tokenUsage as Nullable<UsageRecord>;
          const resultTokens = typeof resultSummary.tokenEstimate === 'number' ? (resultSummary.tokenEstimate as number) : undefined;
          const resultChars = typeof resultSummary.charCount === 'number' ? (resultSummary.charCount as number) : undefined;
          if (tokenUsage) {
            meta.push({ label: 'Tokens', value: usageSummary(tokenUsage) });
          } else if (resultTokens !== undefined) {
            meta.push({ label: 'Output tokens (est)', value: formatNumber(resultTokens) });
          }
          if (resultChars !== undefined) {
            meta.push({ label: 'Output chars', value: formatNumber(resultChars) });
          }
          if (typeof payload.costUSD === 'number') {
            meta.push({ label: 'Cost', value: formatCost(payload.costUSD as number) });
          }
          const isError = Boolean((resultSummary.isError as boolean | undefined) ?? false);
          status = isError ? 'error' : 'success';
          const errorMessage = typeof resultSummary.errorMessage === 'string' ? (resultSummary.errorMessage as string) : undefined;
          if (errorMessage) {
            meta.push({ label: 'Error', value: errorMessage });
          }
          const sanitized = resultSummary.sanitized as Record<string, unknown> | undefined;
          if (sanitized && Object.keys(sanitized).length > 0) {
            preview = truncateText(safeJsonStringify(sanitized, 0), 260);
          }
          break;
        }

        case 'tool_call_finished': {
          const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'Tool call';
          title = `Tool call finished: ${toolName}`;
          const duration = typeof payload.durationMs === 'number' ? payload.durationMs : undefined;
          if (duration !== undefined) {
            subtitle = `Duration ${formatDuration(duration)}`;
            meta.push({ label: 'Duration', value: formatDuration(duration) });
          }
          const usage = payload.tokenUsage as Nullable<UsageRecord>;
          if (usage) {
            meta.push({ label: 'Tokens', value: usageSummary(usage) });
          }
          if (typeof payload.costUSD === 'number') {
            meta.push({ label: 'Cost', value: formatCost(payload.costUSD) });
          }
          const resultSummary = (payload.resultSummary ?? {}) as Record<string, unknown>;
          const isError = Boolean((resultSummary.isError as boolean | undefined) ?? false);
          status = isError ? 'error' : 'success';
          const errorMessage = typeof resultSummary.errorMessage === 'string' ? resultSummary.errorMessage : undefined;
          if (errorMessage) {
            meta.push({ label: 'Error', value: errorMessage });
          }
          const sanitized = resultSummary.sanitized as Record<string, unknown> | undefined;
          if (sanitized && Object.keys(sanitized).length > 0) {
            preview = truncateText(safeJsonStringify(sanitized, 0), 260);
          }
          break;
        }

        case 'session_finished': {
          const finishReason = typeof payload.finishReason === 'string' ? payload.finishReason : undefined;
          title = finishReason ? `Session finished: ${finishReason}` : 'Session finished';
          if (typeof payload.sessionDurationMs === 'number') {
            meta.push({ label: 'Duration', value: formatDuration(payload.sessionDurationMs) });
          }
          if (typeof payload.stepCount === 'number') meta.push({ label: 'Steps', value: formatNumber(payload.stepCount) });
          if (typeof payload.toolCallCount === 'number') meta.push({ label: 'Tool Calls', value: formatNumber(payload.toolCallCount) });
          if (payload.estimatedUsage) {
            meta.push({ label: 'Estimated Tokens', value: usageSummary(payload.estimatedUsage as UsageRecord) });
          }
          if (payload.actualUsage) {
            meta.push({ label: 'Actual Tokens', value: usageSummary(payload.actualUsage as UsageRecord) });
          }
          if (typeof payload.estimatedCostUSD === 'number') {
            meta.push({ label: 'Estimated Cost', value: formatCost(payload.estimatedCostUSD) });
          }
          if (typeof payload.actualCostUSD === 'number') {
            meta.push({ label: 'Actual Cost', value: formatCost(payload.actualCostUSD) });
          }
          break;
        }

        default: {
          preview = truncateText(safeJsonStringify(payload, 0), 260);
          break;
        }
      }

      const accent = getEventAccent(kind, status);

      entries.push({
        id: event._id,
        kind,
        title,
        subtitle,
        timestamp: event.timestamp,
        status,
        accent,
        meta,
        preview,
        payload,
        payloadString: safeJsonStringify(payload),
        sequence: event.sequence,
      });
    }

    return entries;
  }, [timeline]);

  const handleRowToggle = (entryId: string) => {
    setExpandedEntries((prev) => {
      const isExpanded = Boolean(prev[entryId]);
      const next = { ...prev };
      if (isExpanded) {
        delete next[entryId];
        setExpandedPayloads((payloadPrev) => {
          if (!(entryId in payloadPrev)) return payloadPrev;
          const { [entryId]: _removed, ...rest } = payloadPrev;
          return rest;
        });
      } else {
        next[entryId] = true;
      }
      return next;
    });
  };

  const handlePayloadToggle = (event: MouseEvent<HTMLButtonElement>, entryId: string) => {
    event.stopPropagation();
    setExpandedPayloads((prev) => ({
      ...prev,
      [entryId]: !prev[entryId],
    }));
  };

  const handleEntryContainerClick = (
    event: MouseEvent<HTMLDivElement>,
    entryId: string,
    isExpanded: boolean,
  ) => {
    if (!isExpanded) return;
    const element = event.target as HTMLElement | null;
    if (element && element.closest('button')) return;
    handleRowToggle(entryId);
  };

  const handleSessionKeyDown = (event: KeyboardEvent<HTMLDivElement>, sessionId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSessionSelect(sessionId);
    }
  };

  const handleSessionDetailToggle = (event: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation();
    event.preventDefault();
    setExpandedSessions((prev) => ({
      ...prev,
      [sessionId]: !prev[sessionId],
    }));
  };

  function getSessionTitle(session: SessionListItem): { title: string; subtitle: string } {
    const previews = Array.isArray(session.messagePreviews) ? session.messagePreviews : [];
    const userPreview = previews.find((preview) => preview.role === 'user' && preview.textPreview?.trim());
    if (userPreview) {
      const trimmed = userPreview.textPreview.trim();
      return {
        title: truncateText(trimmed, 120),
        subtitle: `Session ${shortId(session.sessionId)}`,
      };
    }

    return {
      title: `Session ${shortId(session.sessionId)}`,
      subtitle: session.model ? `Model ${session.model}` : '—',
    };
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Agent Diagnostics Dashboard</h1>
          <p className="text-muted-foreground text-sm">Live metrics for tool usage, token spend, and session timelines.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsSidebarOpen((open) => !open)}>
          {isSidebarOpen ? 'Hide Session History' : 'Show Session History'}
        </Button>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {isSidebarOpen && (
          <aside className="w-full lg:w-80 lg:flex-shrink-0 lg:self-start">
            <Card className="overflow-hidden gap-1">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Session History</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hidden lg:inline-flex"
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    Hide
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {!sessions && (
                  <div className="py-4 text-sm text-muted-foreground">Loading sessions...</div>
                )}
                {sessions && sessions.length === 0 && (
                  <div className="py-4 text-sm text-muted-foreground">No sessions recorded yet.</div>
                )}
                {sessions && sessions.length > 0 && (
                  <div className="space-y-3 pt-1 pb-3">
                    {sessions.map((session) => {
                      const isSelected = session.sessionId === selectedSessionId;
                      const estimatedTokens = tokensFromUsage(session.estimatedUsage, 'totalTokens');
                      const actualTokens = tokensFromUsage(session.actualUsage, 'totalTokens');
                      const completedStatusClasses = 'bg-green-100 text-green-800 border-green-200';
                      const { title: sessionTitle, subtitle: sessionSubtitle } = getSessionTitle(session);
                      const isSessionDetailsExpanded = Boolean(expandedSessions[session.sessionId]);
                      const sessionTag = sessionTags[session.sessionId]?.trim();
                      const isTagEditing = editingTagSessionId === session.sessionId;
                      const hasCustomTitle = Boolean(sessionTag);
                      const displayTitle = sessionTag && sessionTag.length > 0 ? sessionTag : sessionTitle;

                      return (
                        <div
                          key={session.sessionId}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSessionSelect(session.sessionId)}
                          onKeyDown={(event) => handleSessionKeyDown(event, session.sessionId)}
                          className={cn(
                            'w-full rounded-md border p-3 text-left transition-colors',
                            'hover:border-primary/60',
                            isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background'
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="group inline-flex max-w-full items-center gap-2">
                                {isTagEditing ? (
                                  <input
                                    ref={tagInputRef}
                                    value={tagDraftValue}
                                    onChange={(event) => setTagDraftValue(event.target.value)}
                                    onBlur={(event) => handleTagInputBlur(event, session.sessionId)}
                                    onKeyDown={(event) => handleTagInputKeyDown(event, session.sessionId)}
                                    onClick={(event) => event.stopPropagation()}
                                    placeholder="Name this session"
                                    className="h-7 w-full max-w-xs bg-transparent px-0 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-0"
                                  />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="group inline-flex max-w-full items-center gap-2 text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        beginTagEdit(session.sessionId);
                                      }}
                                    >
                                      <span className="line-clamp-2" title={displayTitle}>
                                        {displayTitle}
                                      </span>
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-80" />
                                    </button>
                                    {hasCustomTitle ? (
                                      <button
                                        type="button"
                                        className="text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          clearSessionName(session.sessionId);
                                        }}
                                      >
                                        Reset
                                      </button>
                                    ) : null}
                                  </>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground" title={sessionSubtitle}>
                                {sessionSubtitle}
                              </span>
                              {hasCustomTitle ? (
                                <span className="text-[11px] text-muted-foreground/80 line-clamp-1" title={sessionTitle}>
                                  Based on: {sessionTitle}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1">
                              {session.status === 'completed' && (
                                <Badge variant="outline" className={completedStatusClasses}>
                                  {session.status.toUpperCase()}
                                </Badge>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground"
                                aria-label={isSessionDetailsExpanded ? 'Hide session details' : 'Show session details'}
                                aria-expanded={isSessionDetailsExpanded}
                                onClick={(event) => handleSessionDetailToggle(event, session.sessionId)}
                              >
                                {isSessionDetailsExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                          {isSessionDetailsExpanded && (
                            <>
                              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                                <div className="flex flex-col">
                                  <span className="text-muted-foreground">Model</span>
                                  <span>{session.model ?? '—'}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-muted-foreground">Tool Calls</span>
                                  <span>{formatNumber(session.toolCallCount)} (steps {formatNumber(session.stepCount)})</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-muted-foreground">Tokens</span>
                                  <span>{formatNumber(estimatedTokens)} est. / {formatNumber(actualTokens)} actual</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-muted-foreground">Cost</span>
                                  <span>{formatCost(session.estimatedCostUSD)} est. / {formatCost(session.actualCostUSD)}</span>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>Started {formatTimestamp(session.sessionStartedAt)}</span>
                                <span>{session.durationMs ? `Duration ${formatDuration(session.durationMs)}` : 'In progress'}</span>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        )}

        <main className="flex-1 min-w-0 space-y-6">
          <section className="space-y-4">
            {selectedSessionId ? (
              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">Session Summary</CardTitle>
                    {summaryUsageLabel ? (
                      <Badge variant="outline" className="text-[11px] uppercase tracking-wide">
                        {summaryUsageLabel}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No usage data yet</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-sm">
                    {usageSummaryRows.length > 0 && (
                      <>
                        <div className="px-4 pb-1 pt-3 text-xs uppercase tracking-wide text-muted-foreground">
                          <div className="ml-auto flex gap-3 sm:justify-end">
                            <span className="min-w-[6rem] text-right">Tokens</span>
                            <span className="min-w-[6rem] text-right">Cost</span>
                          </div>
                        </div>
                        <div className="divide-y">
                          {usageSummaryRows.map((row) => (
                            <div
                              key={row.key}
                              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <span className="text-sm font-medium text-foreground">{row.label}</span>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground sm:justify-end">
                                <span className="tabular-nums text-foreground min-w-[6rem] text-right">{row.value}</span>
                                <span className="tabular-nums min-w-[6rem] text-right">{row.secondary}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {auxiliarySummaryRows.length > 0 && (
                      <div className={cn('divide-y', usageSummaryRows.length > 0 ? 'mt-4' : '')}>
                        {auxiliarySummaryRows.map((row) => (
                          <div
                            key={row.key}
                            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="text-sm font-medium text-foreground">{row.label}</span>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                              <span className="tabular-nums text-foreground">{row.value}</span>
                              <span className="tabular-nums">{row.secondary}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">
                  Session Timeline{selectedSessionTitle ? `: ${selectedSessionTitle}` : ''}
                </h2>
                <p className="text-sm text-muted-foreground">Audit every API call, tool action, and stream emitted by the agent.</p>
              </div>
              {selectedSession && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    selectedSession.status === 'completed'
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-yellow-100 text-yellow-800 border-yellow-200'
                  )}
                >
                  {selectedSession.status.toUpperCase()}
                </Badge>
              )}
            </div>

            {!selectedSessionId && (
              <Card>
                <CardContent>
                  <div className="py-6 text-sm text-muted-foreground">Select a session from the history to inspect its timeline.</div>
                </CardContent>
              </Card>
            )}

            {selectedSessionId && timeline === undefined && (
              <Card>
                <CardContent>
                  <div className="py-6 text-sm text-muted-foreground">Loading timeline…</div>
                </CardContent>
              </Card>
            )}

            {selectedSessionId && timeline === null && (
              <Card>
                <CardContent>
                  <div className="py-6 text-sm text-muted-foreground">Session not found. It may have been archived.</div>
                </CardContent>
              </Card>
            )}

            {selectedSessionId && timeline && (
              <Card className="min-w-0">
                <CardContent>
                  {timelineEntries.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No events recorded for this session yet.
                    </div>
                  ) : (
                    <div className="space-y-2 py-3">
                      {timelineEntries.map((entry) => {
                        const isExpanded = Boolean(expandedEntries[entry.id]);
                        const isPayloadExpanded = Boolean(expandedPayloads[entry.id]);
                        const hasPayload = Boolean(entry.payloadString && entry.payloadString.trim().length > 2);
                        const timestampLabel = entry.timestamp ? formatTimestamp(entry.timestamp) : '—';
                        const statusBadge = (() => {
                          if (entry.status === 'error') return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
                          if (entry.status === 'success') return <Badge variant="outline" className="text-[10px]">Success</Badge>;
                          return null;
                        })();

                        return (
                          <div
                            key={entry.id}
                            className="rounded-md border border-border bg-background/80 p-3 shadow-sm"
                            onClick={(event) => handleEntryContainerClick(event, entry.id, isExpanded)}
                          >
                            <button
                              type="button"
                              className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                              onClick={() => handleRowToggle(entry.id)}
                              onMouseDown={(event) => event.preventDefault()}
                              aria-expanded={isExpanded}
                            >
                              <div className="flex min-w-0 flex-1 items-start gap-2">
                                <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center">
                                  <span className={cn('h-2.5 w-2.5 rounded-full', entry.accent)} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">{entry.title}</span>
                                    {statusBadge}
                                  </div>
                                  {isExpanded && entry.subtitle && (
                                    <div className="mt-1 text-xs text-muted-foreground">{entry.subtitle}</div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                <span>{timestampLabel}</span>
                                <span className="text-base leading-none text-muted-foreground">{isExpanded ? '-' : '+'}</span>
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="mt-3 space-y-2">
                                {entry.meta && entry.meta.length > 0 && (
                                  <dl className="grid gap-2 text-xs md:grid-cols-2">
                                    {entry.meta.map((item) => (
                                      <div key={`${entry.id}-${item.label}`} className="flex justify-between gap-3">
                                        <dt className="text-muted-foreground">{item.label}</dt>
                                        <dd className="text-right font-medium text-foreground">{item.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}

                                {entry.preview && (
                                  <div className="whitespace-pre-wrap break-words rounded-md bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                                    {entry.preview}
                                  </div>
                                )}

                                {hasPayload && (
                                  <div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={(event) => handlePayloadToggle(event, entry.id)}
                                    >
                                      {isPayloadExpanded ? 'Hide payload' : 'Show payload'}
                                    </Button>
                                    {isPayloadExpanded && (
                                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                                        {entry.payloadString}
                                      </pre>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </section>
        </main>
      </div>
    </div>
  );

}
