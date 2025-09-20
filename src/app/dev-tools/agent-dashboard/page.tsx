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
  durationMs?: number | null;
  endToEndStartedAt?: number | null;
  endToEndFinishedAt?: number | null;
  endToEndDurationMs?: number | null;
  attachmentsCount: number;
  messagePreviews: AgentMessagePreview[] | null | undefined;
  tags: string[];
  customTitle?: string | null;
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

const formatTimeOfDay = (ts?: number | null): string => {
  if (typeof ts !== 'number' || Number.isNaN(ts)) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts));
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
  durationMs?: number;
  subtitle?: string;
  status?: 'default' | 'success' | 'warning' | 'error';
  accent: string;
  meta?: Array<{ label: string; value: string }>;
  preview?: string;
  payload?: Record<string, unknown>;
  payloadString?: string;
  sequence?: number;
};

type ToolCallSummaryRow = {
  id: string;
  name: string;
  tokensLabel: string;
  costLabel: string;
  accentClass: string;
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

  const timelineSessionId =
    typeof timeline?.session?.sessionId === 'string' ? timeline.session.sessionId : null;
  const timelineMatchesSelection = Boolean(selectedSessionId && timelineSessionId === selectedSessionId);
  const timelineStaleForSelection = Boolean(
    selectedSessionId && timeline && timelineSessionId !== selectedSessionId,
  );
  const timelineLoading = Boolean(
    selectedSessionId && (timeline === undefined || timelineStaleForSelection),
  );
  const activeTimeline = timelineMatchesSelection ? timeline : null;
  const showTimelineNotFound = Boolean(selectedSessionId && !timelineLoading && timeline === null);

  const setSessionTagMutation = useMutation(convexApi.agentMetrics.setSessionTag);
  const addSessionTagMutation = useMutation(convexApi.agentMetrics.addSessionTag);
  const removeSessionTagMutation = useMutation(convexApi.agentMetrics.removeSessionTag);

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

  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [sessionTagLists, setSessionTagLists] = useState<Record<string, string[]>>({});

  const selectedSessionTitle = useMemo(() => {
    if (!selectedSession) return null;
    const override = sessionTitles[selectedSession.sessionId]?.trim();
    if (override) return override;
    return getSessionTitle(selectedSession).title;
  }, [selectedSession, sessionTitles]);

  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [editingTitleSessionId, setEditingTitleSessionId] = useState<string | null>(null);
  const [titleDraftValue, setTitleDraftValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTitleCommitRef = useRef(false);
  const pendingTitleMutationsRef = useRef(new Set<string>());
  const pendingTagListMutationsRef = useRef(new Set<string>());
  const [activeTagInputSessionId, setActiveTagInputSessionId] = useState<string | null>(null);
  const [newTagDraftValue, setNewTagDraftValue] = useState('');
  const newTagInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingTagRemovalKeys, setPendingTagRemovalKeys] = useState<Record<string, number>>({});
  const tagRemovalTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (editingTitleSessionId && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitleSessionId]);

  useEffect(() => {
    if (activeTagInputSessionId && newTagInputRef.current) {
      newTagInputRef.current.focus();
      newTagInputRef.current.select();
    }
  }, [activeTagInputSessionId]);

  useEffect(() => {
    if (!sessions) return;
    setSessionTitles((prev) => {
      const next = { ...prev };
      let didChange = false;
      const activeIds = new Set(sessions.map((session) => session.sessionId));

      for (const session of sessions) {
        const sessionId = session.sessionId;
        if (pendingTitleMutationsRef.current.has(sessionId)) {
          continue;
        }
        const serverTitle = typeof session.customTitle === 'string' ? session.customTitle.trim() : '';
        if (serverTitle) {
          const trimmed = serverTitle.trim();
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
        if (!activeIds.has(sessionId) && !pendingTitleMutationsRef.current.has(sessionId)) {
          delete next[sessionId];
          didChange = true;
        }
      }

      return didChange ? next : prev;
    });
  }, [sessions]);

  useEffect(() => {
    if (!sessions) return;

    const arraysEqual = (a: string[] | undefined, b: string[]): boolean => {
      if (!a) return b.length === 0;
      if (a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    };

    setSessionTagLists((prev) => {
      const next = { ...prev };
      let didChange = false;
      const activeIds = new Set(sessions.map((session) => session.sessionId));

      for (const session of sessions) {
        const sessionId = session.sessionId;
        if (pendingTagListMutationsRef.current.has(sessionId)) {
          continue;
        }
        const serverTags = Array.isArray(session.tags)
          ? session.tags
              .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
              .filter((tag) => tag.length > 0)
          : [];

        if (serverTags.length > 0) {
          if (!arraysEqual(next[sessionId], serverTags)) {
            next[sessionId] = serverTags;
            didChange = true;
          }
        } else if (next[sessionId] !== undefined) {
          delete next[sessionId];
          didChange = true;
        }
      }

      for (const sessionId of Object.keys(next)) {
        if (!activeIds.has(sessionId) && !pendingTagListMutationsRef.current.has(sessionId)) {
          delete next[sessionId];
          didChange = true;
        }
      }

      return didChange ? next : prev;
    });
  }, [sessions]);

  useEffect(() => {
    if (!sessions) return;
    if (editingTitleSessionId && !sessions.some((session) => session.sessionId === editingTitleSessionId)) {
      setEditingTitleSessionId(null);
      setTitleDraftValue('');
    }
  }, [editingTitleSessionId, sessions]);

  useEffect(() => {
    if (!sessions) return;
    if (activeTagInputSessionId && !sessions.some((session) => session.sessionId === activeTagInputSessionId)) {
      setActiveTagInputSessionId(null);
      setNewTagDraftValue('');
    }
  }, [activeTagInputSessionId, sessions]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(tagRemovalTimersRef.current)) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const persistTitle = (sessionId: string, value: string | null) => {
    const normalizedInput = typeof value === 'string' ? value.trim() : '';
    const finalValue = normalizedInput.length > 0 ? normalizedInput : null;
    const previousValue = sessionTitles[sessionId];
    const previousNormalized = typeof previousValue === 'string' && previousValue.trim().length > 0 ? previousValue : null;

    if (previousNormalized === finalValue) {
      return;
    }

    pendingTitleMutationsRef.current.add(sessionId);

    setSessionTitles((prev) => {
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
        setSessionTitles((prev) => {
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
        pendingTitleMutationsRef.current.delete(sessionId);
      });
  };

  const commitTitleEdit = (sessionId: string) => {
    persistTitle(sessionId, titleDraftValue);
    setEditingTitleSessionId(null);
    setTitleDraftValue('');
  };

  const cancelTitleEdit = () => {
    skipTitleCommitRef.current = true;
    setEditingTitleSessionId(null);
    setTitleDraftValue('');
    setTimeout(() => {
      skipTitleCommitRef.current = false;
    }, 0);
  };

  const handleTitleInputBlur = (_event: FocusEvent<HTMLInputElement>, sessionId: string) => {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false;
      return;
    }
    commitTitleEdit(sessionId);
  };

  const handleTitleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, sessionId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitleEdit(sessionId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTitleEdit();
    }
  };

  const beginTitleEdit = (sessionId: string) => {
    skipTitleCommitRef.current = false;
    setEditingTitleSessionId(sessionId);
    setTitleDraftValue(sessionTitles[sessionId] ?? '');
  };

  const clearSessionName = (sessionId: string) => {
    skipTitleCommitRef.current = true;
    setEditingTitleSessionId((current) => (current === sessionId ? null : current));
    setTitleDraftValue('');
    persistTitle(sessionId, null);
    setTimeout(() => {
      skipTitleCommitRef.current = false;
    }, 0);
  };

  const addTagToSession = (sessionId: string, rawValue: string) => {
    const normalized = rawValue.trim();
    if (normalized.length === 0) {
      return;
    }

    const previousTags = [...(sessionTagLists[sessionId] ?? [])];
    if (previousTags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
      return;
    }

    pendingTagListMutationsRef.current.add(sessionId);

    setSessionTagLists((prev) => {
      const existing = prev[sessionId] ?? [];
      return {
        ...prev,
        [sessionId]: [...existing, normalized],
      };
    });

    void addSessionTagMutation({ sessionId, tag: normalized })
      .catch((error) => {
        console.error('Failed to add session tag', error);
        setSessionTagLists((prev) => {
          const current = prev[sessionId] ?? [];
          const hasOptimistic = current.some((tag) => tag === normalized);
          if (!hasOptimistic) {
            return prev;
          }
          if (previousTags.length === 0) {
            const { [sessionId]: _removed, ...rest } = prev;
            return rest;
          }
          return {
            ...prev,
            [sessionId]: previousTags,
          };
        });
      })
      .finally(() => {
        pendingTagListMutationsRef.current.delete(sessionId);
      });
  };

  const removeTagFromSession = (sessionId: string, rawValue: string) => {
    const normalized = rawValue.trim();
    if (normalized.length === 0) {
      return;
    }

    const previousTags = [...(sessionTagLists[sessionId] ?? [])];
    if (!previousTags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
      return;
    }

    pendingTagListMutationsRef.current.add(sessionId);

    setSessionTagLists((prev) => {
      const existing = prev[sessionId] ?? [];
      const next = existing.filter((tag) => tag.toLowerCase() !== normalized.toLowerCase());
      if (next.length === 0) {
        const { [sessionId]: _removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [sessionId]: next,
      };
    });

    void removeSessionTagMutation({ sessionId, tag: normalized })
      .catch((error) => {
        console.error('Failed to remove session tag', error);
        setSessionTagLists((prev) => {
          if (previousTags.length === 0) {
            return prev;
          }
          return {
            ...prev,
            [sessionId]: previousTags,
          };
        });
      })
      .finally(() => {
        pendingTagListMutationsRef.current.delete(sessionId);
      });
  };

  const beginNewTagForSession = (sessionId: string) => {
    if (activeTagInputSessionId && activeTagInputSessionId !== sessionId) {
      const pendingValue = newTagDraftValue.trim();
      if (pendingValue.length > 0) {
        addTagToSession(activeTagInputSessionId, pendingValue);
      }
    }
    setActiveTagInputSessionId(sessionId);
    setNewTagDraftValue('');
  };

  const cancelNewTag = () => {
    setActiveTagInputSessionId(null);
    setNewTagDraftValue('');
  };

  const commitNewTagForSession = (sessionId: string) => {
    const value = newTagDraftValue.trim();
    setActiveTagInputSessionId(null);
    setNewTagDraftValue('');
    if (value.length === 0) {
      return;
    }
    addTagToSession(sessionId, value);
  };

  const handleNewTagInputBlur = (_event: FocusEvent<HTMLInputElement>, sessionId: string) => {
    commitNewTagForSession(sessionId);
  };

  const handleNewTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, sessionId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNewTagForSession(sessionId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelNewTag();
    }
  };

  const getTagRemovalKey = (sessionId: string, tag: string) => `${sessionId}::${tag.toLowerCase()}`;

  const isTagRemovalPending = (sessionId: string, tag: string) => {
    const key = getTagRemovalKey(sessionId, tag);
    return Boolean(pendingTagRemovalKeys[key]);
  };

  const handleTagRemoveClick = (
    event: MouseEvent<HTMLButtonElement>,
    sessionId: string,
    tag: string,
  ) => {
    event.stopPropagation();
    const key = getTagRemovalKey(sessionId, tag);

    if (pendingTagRemovalKeys[key]) {
      const timerId = tagRemovalTimersRef.current[key];
      if (timerId) {
        clearTimeout(timerId);
        delete tagRemovalTimersRef.current[key];
      }
      setPendingTagRemovalKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      removeTagFromSession(sessionId, tag);
      return;
    }

    setPendingTagRemovalKeys((prev) => ({ ...prev, [key]: Date.now() }));
    const timerId = window.setTimeout(() => {
      setPendingTagRemovalKeys((prev) => {
        if (!(key in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete tagRemovalTimersRef.current[key];
    }, 2000);
    tagRemovalTimersRef.current[key] = timerId;
  };

  const sessionSummary = useMemo(() => {
    const sessionSource = (selectedSession ?? (activeTimeline?.session as SessionListItem | null | undefined) ?? null) as
      | SessionListItem
      | null;

    const sessionDoc = (activeTimeline?.session as (SessionListItem & DocId) | null | undefined) ?? null;

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
    const aggregatedDuration =
      typeof sessionSource?.endToEndDurationMs === 'number'
        ? sessionSource.endToEndDurationMs
        : typeof sessionDoc?.endToEndDurationMs === 'number'
          ? sessionDoc.endToEndDurationMs
          : null;

    const events = activeTimeline && Array.isArray(activeTimeline.events) ? activeTimeline.events : [];

    let durationMs: number | null = typeof aggregatedDuration === 'number' && aggregatedDuration >= 0 ? aggregatedDuration : null;

    if (durationMs === null) {
      // Fall back to scanning the timeline for legacy sessions without Convex timing
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

      if (
        typeof startTimestamp === 'number' &&
        typeof endTimestamp === 'number' &&
        endTimestamp >= startTimestamp
      ) {
        durationMs = endTimestamp - startTimestamp;
      }
    }

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
  }, [selectedSession, activeTimeline]);

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

  const toolCallSummaryRows = useMemo(() => {
    if (!activeTimeline?.toolCalls || activeTimeline.toolCalls.length === 0) return [] as ToolCallSummaryRow[];

    const completedCalls = activeTimeline.toolCalls.filter((call) => call.status === 'completed');
    if (completedCalls.length === 0) return [] as ToolCallSummaryRow[];

    const compareMaybeNumber = (a?: number, b?: number) => {
      const aHas = typeof a === 'number';
      const bHas = typeof b === 'number';
      if (aHas && bHas) {
        if ((a as number) < (b as number)) return -1;
        if ((a as number) > (b as number)) return 1;
        return 0;
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    };

    const sortedCalls = [...completedCalls].sort((a, b) => {
      const startOrder = compareMaybeNumber(a.startedAt, b.startedAt);
      if (startOrder !== 0) return startOrder;

      if (typeof a.stepIndex === 'number' && typeof b.stepIndex === 'number') {
        if (a.stepIndex < b.stepIndex) return -1;
        if (a.stepIndex > b.stepIndex) return 1;
      }

      const endOrder = compareMaybeNumber(a.completedAt, b.completedAt);
      if (endOrder !== 0) return endOrder;

      const aId = typeof a.toolCallId === 'string' ? a.toolCallId : a._id;
      const bId = typeof b.toolCallId === 'string' ? b.toolCallId : b._id;
      return aId.localeCompare(bId);
    });

    const palette = [
      'border-l-2 border-l-sky-500/60 bg-sky-500/5 dark:border-l-sky-300/50 dark:bg-sky-500/10',
      'border-l-2 border-l-emerald-500/60 bg-emerald-500/5 dark:border-l-emerald-300/50 dark:bg-emerald-500/10',
      'border-l-2 border-l-amber-500/60 bg-amber-500/10 dark:border-l-amber-300/50 dark:bg-amber-500/15',
      'border-l-2 border-l-purple-500/60 bg-purple-500/10 dark:border-l-purple-300/50 dark:bg-purple-500/15',
      'border-l-2 border-l-rose-500/60 bg-rose-500/10 dark:border-l-rose-300/50 dark:bg-rose-500/15',
      'border-l-2 border-l-indigo-500/60 bg-indigo-500/10 dark:border-l-indigo-300/50 dark:bg-indigo-500/15',
    ];

    const assignment = new Map<string, string>();
    let paletteIndex = 0;

    return sortedCalls.map((call) => {
      const usage = call.tokenUsage as Nullable<UsageRecord>;
      let totalTokens = usage ? tokensFromUsage(usage, 'totalTokens') : 0;
      if (totalTokens === 0 && usage) {
        totalTokens = tokensFromUsage(usage, 'promptTokens') + tokensFromUsage(usage, 'completionTokens');
      }

      const costUSD = typeof call.costUSD === 'number' && Number.isFinite(call.costUSD) ? call.costUSD : null;

      const name = call.toolName || call.toolCallId || 'Tool call';
      const id = call._id ?? call.toolCallId ?? `${name}-${call.stepIndex}`;

      const assignmentKey = name.toLowerCase();
      if (!assignment.has(assignmentKey)) {
        const paletteClass = palette[paletteIndex % palette.length];
        assignment.set(assignmentKey, paletteClass);
        paletteIndex += 1;
      }

      const accentClass = assignment.get(assignmentKey) ?? palette[0];

      return {
        id,
        name,
        tokensLabel: `${formatNumber(totalTokens)} tokens`,
        costLabel: formatCostExact(costUSD),
        accentClass,
      } satisfies ToolCallSummaryRow;
    });
  }, [activeTimeline]);

  const timelineEntries = useMemo(() => {
    if (!activeTimeline) return [] as TimelineEntry[];

    const entries: TimelineEntry[] = [];
    const session = activeTimeline.session;

    const events = Array.isArray(activeTimeline.events) ? [...activeTimeline.events] : [];
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
      let durationMs: number | undefined;

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
          durationMs = typeof payload.durationMs === 'number' && payload.durationMs >= 0 ? payload.durationMs : undefined;
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
          if (durationMs !== undefined) {
            meta.push({ label: 'Duration', value: formatDuration(durationMs) });
          }
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
          status = isError ? 'error' : 'default';
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
          status = isError ? 'error' : 'default';
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
        durationMs,
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
  }, [activeTimeline]);

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
                      const sessionTitleOverride = sessionTitles[session.sessionId]?.trim();
                      const isTitleEditing = editingTitleSessionId === session.sessionId;
                      const hasCustomTitle = Boolean(sessionTitleOverride);
                      const displayTitle = hasCustomTitle ? sessionTitleOverride : sessionTitle;
                      const tagValues = sessionTagLists[session.sessionId] ?? [];
                      const isAddingTag = activeTagInputSessionId === session.sessionId;
                      const sessionDurationMs =
                        typeof session.endToEndDurationMs === 'number'
                          ? session.endToEndDurationMs
                          : typeof session.durationMs === 'number'
                            ? session.durationMs
                            : null;

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
                                {isTitleEditing ? (
                                  <input
                                    ref={titleInputRef}
                                    value={titleDraftValue}
                                    onChange={(event) => setTitleDraftValue(event.target.value)}
                                    onBlur={(event) => handleTitleInputBlur(event, session.sessionId)}
                                    onKeyDown={(event) => handleTitleInputKeyDown(event, session.sessionId)}
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
                                        beginTitleEdit(session.sessionId);
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
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {tagValues.map((tag) => {
                                  const removalPending = isTagRemovalPending(session.sessionId, tag);
                                  return (
                                    <div
                                      key={tag}
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors',
                                        removalPending
                                          ? 'border-destructive/70 bg-destructive/10 text-destructive'
                                          : 'border-border/70 bg-muted/40 text-muted-foreground'
                                      )}
                                    >
                                      <span className="max-w-[140px] truncate" title={tag}>
                                        {tag}
                                      </span>
                                      <button
                                        type="button"
                                        className={cn(
                                          'inline-flex h-4 w-4 items-center justify-center rounded-full border border-transparent text-[10px] text-muted-foreground transition-colors',
                                          removalPending ? 'border-destructive/80 text-destructive' : 'hover:text-destructive/90'
                                        )}
                                        onClick={(event) => handleTagRemoveClick(event, session.sessionId, tag)}
                                        aria-label={removalPending ? `Click again to remove tag ${tag}` : `Remove tag ${tag}`}
                                        title={removalPending ? 'Click again to remove' : 'Remove tag'}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  );
                                })}
                                {isAddingTag ? (
                                  <input
                                    ref={newTagInputRef}
                                    value={newTagDraftValue}
                                    onChange={(event) => setNewTagDraftValue(event.target.value)}
                                    onBlur={(event) => handleNewTagInputBlur(event, session.sessionId)}
                                    onKeyDown={(event) => handleNewTagInputKeyDown(event, session.sessionId)}
                                    onClick={(event) => event.stopPropagation()}
                                    placeholder="Tag name"
                                    className="h-7 w-28 rounded-full border border-dashed border-primary/70 bg-transparent px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-0"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="inline-flex h-7 items-center rounded-full border border-dashed border-muted-foreground/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/70 hover:text-primary focus-visible:outline-none"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      beginNewTagForSession(session.sessionId);
                                    }}
                                  >
                                    + add tag
                                  </button>
                                )}
                              </div>
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
                                <span>
                                  {sessionDurationMs !== null
                                    ? `Duration ${formatDuration(sessionDurationMs)}`
                                    : 'In progress'}
                                </span>
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
                    <h2 className="text-xl font-semibold">
                      {`Session Summary${selectedSessionTitle ? `: ${selectedSessionTitle}` : ''}`}
                    </h2>
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
                    {toolCallSummaryRows.length > 0 && (
                      <div
                        className={cn(
                          'mt-4',
                          usageSummaryRows.length > 0 || auxiliarySummaryRows.length > 0
                            ? 'border-t border-border/60 pt-4'
                            : ''
                        )}
                      >
                        <div className="rounded-md border border-border">
                          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                            <span>Tool Call</span>
                            <span className="text-right">Tokens</span>
                            <span className="text-right">Cost</span>
                          </div>
                          <div className="divide-y">
                            {toolCallSummaryRows.map((row) => (
                              <div
                                key={row.id}
                                className={cn(
                                  'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-sm transition-colors',
                                  row.accentClass,
                                )}
                              >
                                <span className="truncate font-medium text-foreground" title={row.name}>
                                  {row.name}
                                </span>
                                <span className="tabular-nums text-right text-foreground">{row.tokensLabel}</span>
                                <span className="tabular-nums text-right text-foreground">{row.costLabel}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">Session Timeline</h2>
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

            {selectedSessionId && timelineLoading && (
              <Card>
                <CardContent>
                  <div className="py-6 text-sm text-muted-foreground">Loading timeline…</div>
                </CardContent>
              </Card>
            )}

            {selectedSessionId && showTimelineNotFound && (
              <Card>
                <CardContent>
                  <div className="py-6 text-sm text-muted-foreground">Session not found. It may have been archived.</div>
                </CardContent>
              </Card>
            )}

            {selectedSessionId && activeTimeline && (
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
                        const timestampLabel = formatTimeOfDay(entry.timestamp);
                        const timestampTitle = entry.timestamp ? formatTimestamp(entry.timestamp) : undefined;
                        const durationLabel =
                          entry.kind === 'step_finished' && typeof entry.durationMs === 'number' && entry.durationMs > 0
                            ? formatDuration(entry.durationMs)
                            : null;
                        const statusBadge = (() => {
                          if (entry.status === 'error') {
                            return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
                          }
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
                                {durationLabel ? (
                                  <span className="tabular-nums text-foreground" title="Step duration">
                                    {durationLabel}
                                  </span>
                                ) : null}
                                <span title={timestampTitle}>{timestampLabel}</span>
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
