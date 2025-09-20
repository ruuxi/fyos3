'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { WebContainerProvider, useWebContainer } from '@/components/WebContainerProvider';
import WebContainer from '@/components/WebContainer';
import { useAgentChat } from '@/components/agent/AIAgentBar/hooks/useAgentChat';
import { useValidationDiagnostics } from '@/components/agent/AIAgentBar/hooks/useValidationDiagnostics';
import type { UIMessage } from 'ai';
import { buildDesktopSnapshot, restoreDesktopSnapshot } from '@/utils/desktop-snapshot';
import { useConvexClient } from '@/lib/useConvexClient';
import { api as convexApi } from '../../../../convex/_generated/api';

type BatchJob = {
  id: string;
  sessionId: string;
  prompt: string;
  index: number;
};

type RunnerState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'running'; currentIndex: number; total: number; currentSessionId?: string }
  | { kind: 'stopped' }
  | { kind: 'finished' };

type RunRecord = {
  jobId: string;
  sessionId: string;
  prompt: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  error?: string | null;
};

function useHeadlessBatchRunner() {
  const { instance, waitForDepsReady, spawn, writeFile, readFile, readdirRecursive, remove, mkdir } = useWebContainer();
  const instanceRef = useRef(instance);
  useEffect(() => { instanceRef.current = instance; }, [instance]);

  const fnsRef = useRef({ spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady });
  useEffect(() => { fnsRef.current = { spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady }; }, [spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady]);

  const statusRef = useRef<string>('ready');
  const sendMessageRef = useRef<(content: string) => Promise<void>>(async () => {});
  const currentRunIdRef = useRef<string | null>(null);

  const { runValidation } = useValidationDiagnostics({
    spawn: (command, args, opts) => fnsRef.current.spawn(command, args, opts),
    sendMessage: (content) => sendMessageRef.current(content),
    getStatus: () => statusRef.current,
  });

  const noopLoadMedia = useCallback(async () => {}, []);

  const {
    messages,
    sendMessage: sendMessageRaw,
    status,
    stop,
    setMessages,
  } = useAgentChat({
    id: 'dev-batch-runner',
    initialMessages: [] as UIMessage[],
    activeThreadId: null,
    getActiveThreadId: () => null,
    getRunId: () => currentRunIdRef.current,
    wc: { instanceRef, fnsRef },
    media: { loadMedia: noopLoadMedia },
    runValidation,
    attachmentsProvider: () => [],
    onFirstToolCall: () => {},
    onToolProgress: () => {},
  });

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = (content: string) => sendMessageRaw({ text: content }); }, [sendMessageRaw]);

  const [runner, setRunner] = useState<RunnerState>({ kind: 'idle' });
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [baseline, setBaseline] = useState<{ gz: Uint8Array; size: number; fileCount: number; contentSha256: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopFlagRef = useRef(false);

  const captureBaseline = useCallback(async () => {
    if (!instanceRef.current) throw new Error('WebContainer not ready');
    const snap = await buildDesktopSnapshot(instanceRef.current);
    setBaseline(snap);
    return snap;
  }, []);

  const restoreBaselineIfNeeded = useCallback(async () => {
    if (!baseline || !instanceRef.current) return;
    await restoreDesktopSnapshot(instanceRef.current, baseline.gz);
  }, [baseline]);

  const waitForCompletion = useCallback(async () => {
    // Poll status until it returns to 'ready' and stays stable briefly
    const idleWindowMs = 200;
    let lastReadyAt = 0;
    const start = Date.now();
    // safety timeout: 5 minutes
    const timeoutMs = 5 * 60 * 1000;
    while (Date.now() - start < timeoutMs) {
      if (stopFlagRef.current) throw new Error('Stopped');
      if (statusRef.current === 'ready') {
        if (lastReadyAt === 0) lastReadyAt = Date.now();
        if (Date.now() - lastReadyAt > idleWindowMs) return;
      } else {
        lastReadyAt = 0;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    throw new Error('Run timed out');
  }, []);

  const start = useCallback(async (jobs: BatchJob[], opts: { restoreBaseline: boolean; delayMs: number; tags: string[] }) => {
    setError(null);
    stopFlagRef.current = false;
    setRunner({ kind: 'preparing' });
    const deps = await waitForDepsReady(45000, 120);
    if (!deps) throw new Error('WebContainer dependencies not ready');
    if (opts.restoreBaseline && !baseline) {
      await captureBaseline();
    }

    setRunner({ kind: 'running', currentIndex: 0, total: jobs.length });

    const results: RunRecord[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (stopFlagRef.current) break;

      if (opts.restoreBaseline) {
        try { await restoreBaselineIfNeeded(); } catch {}
      }

      setMessages([]);
      currentRunIdRef.current = job.sessionId;
      setRunner({ kind: 'running', currentIndex: i + 1, total: jobs.length, currentSessionId: job.sessionId });
      const startedAt = Date.now();
      let errorMsg: string | null = null;
      try {
        await sendMessageRaw({ text: job.prompt });
        await waitForCompletion();
      } catch (e: unknown) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
      const finishedAt = Date.now();
      results.push({
        jobId: job.id,
        sessionId: job.sessionId,
        prompt: job.prompt,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        error: errorMsg,
      });

      if (opts.delayMs > 0 && i < jobs.length - 1) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
    }

    setRecords((prev) => [...prev, ...results]);
    setRunner(stopFlagRef.current ? { kind: 'stopped' } : { kind: 'finished' });
  }, [baseline, captureBaseline, restoreBaselineIfNeeded, sendMessageRaw, setMessages, waitForCompletion, waitForDepsReady]);

  const stopRunner = useCallback(() => {
    stopFlagRef.current = true;
    try { stop(); } catch {}
  }, [stop]);

  return {
    messages,
    runner,
    records,
    error,
    baseline,
    captureBaseline,
    start,
    stop: stopRunner,
    clear: () => { setRecords([]); setRunner({ kind: 'idle' }); },
  } as const;
}

function formatTs(ts: number) {
  try { return new Date(ts).toLocaleTimeString(); } catch { return String(ts); }
}

function AgentBatchInner() {
  const { client: convex, ready: convexReady } = useConvexClient();
  const runner = useHeadlessBatchRunner();

  const [promptsText, setPromptsText] = useState('create a paint app\ncreate a todo app');
  const [runsPerPrompt, setRunsPerPrompt] = useState(1);
  const [restoreBaseline, setRestoreBaseline] = useState(true);
  const [delayMs, setDelayMs] = useState(250);
  const [customTags, setCustomTags] = useState('batch');
  const [batchId, setBatchId] = useState(() => `batch_${Date.now().toString(36)}`);

  const prompts = useMemo(() => {
    return promptsText
      .split(/\r?\n/) 
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }, [promptsText]);

  const jobs = useMemo<BatchJob[]>(() => {
    const out: BatchJob[] = [];
    let idx = 0;
    for (const p of prompts) {
      for (let i = 0; i < Math.max(1, runsPerPrompt); i++) {
        const id = `${batchId}:${idx.toString().padStart(3, '0')}`;
        const sessionId = `session_${batchId}_${idx.toString().padStart(3, '0')}`;
        out.push({ id, sessionId, prompt: p, index: idx });
        idx += 1;
      }
    }
    return out;
  }, [batchId, prompts, runsPerPrompt]);

  const start = useCallback(async () => {
    if (jobs.length === 0) return;
    const tags = [
      'batch',
      `batch:${batchId}`,
      ...customTags.split(',').map((t) => t.trim()).filter(Boolean),
    ];

    // Clear previous
    runner.clear();
    await runner.start(jobs, { restoreBaseline, delayMs, tags });

    // After completion, tag sessions best-effort
    try {
      if (convex && convexReady) {
        for (const job of jobs) {
          for (const tag of tags) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              await convex.mutation(convexApi.agentMetrics.addSessionTag, { sessionId: job.sessionId, tag });
            } catch {}
          }
        }
      }
    } catch {}
  }, [batchId, convex, convexReady, customTags, delayMs, jobs, restoreBaseline, runner]);

  const running = runner.runner.kind === 'running' || runner.runner.kind === 'preparing';

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agent Batch Runner (Dev)</h1>
        <Link className="text-blue-600 underline" href="/dev-tools/agent-dashboard">Diagnostics</Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-3">
          <label className="block text-sm font-medium">Prompts (one per line)</label>
          <textarea
            className="w-full min-h-36 border p-2 font-mono text-sm"
            value={promptsText}
            onChange={(e) => setPromptsText(e.target.value)}
            disabled={running}
          />
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">Runs per prompt</label>
          <input
            type="number"
            min={1}
            className="w-full border p-1"
            value={runsPerPrompt}
            onChange={(e) => setRunsPerPrompt(Math.max(1, Number(e.target.value) || 1))}
            disabled={running}
          />
          <label className="block text-sm font-medium">Delay between runs (ms)</label>
          <input
            type="number"
            min={0}
            className="w-full border p-1"
            value={delayMs}
            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            disabled={running}
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restoreBaseline} onChange={(e) => setRestoreBaseline(e.target.checked)} disabled={running} />
            Restore baseline before each run
          </label>
          <div>
            <label className="block text-sm font-medium">Batch ID</label>
            <input className="w-full border p-1 font-mono text-xs" value={batchId} onChange={(e) => setBatchId(e.target.value.trim())} disabled={running} />
          </div>
          <div>
            <label className="block text-sm font-medium">Additional tags (comma-separated)</label>
            <input className="w-full border p-1" value={customTags} onChange={(e) => setCustomTags(e.target.value)} disabled={running} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="px-3 py-2 bg-black text-white disabled:opacity-60"
          onClick={() => void start()}
          disabled={running || jobs.length === 0}
        >
          Start Batch ({jobs.length} runs)
        </button>
        <button
          className="px-3 py-2 border disabled:opacity-60"
          onClick={() => runner.stop()}
          disabled={!running}
        >
          Stop
        </button>
      </div>

      <div className="text-sm">
        <div>State: {runner.runner.kind}
          {runner.runner.kind === 'running' && (
            <>
              {' '}— {runner.runner.currentIndex}/{(runner.runner as any).total}
              {runner.runner.currentSessionId ? ` (session ${runner.runner.currentSessionId})` : ''}
            </>
          )}
        </div>
        {runner.error && <div className="text-red-600">Error: {runner.error}</div>}
        {runner.baseline && (
          <div className="text-gray-600">Baseline: {runner.baseline.fileCount} files, {runner.baseline.size} bytes</div>
        )}
      </div>

      <div className="space-y-2">
        <div className="font-medium">Results</div>
        {runner.records.length === 0 && <div className="text-sm text-gray-600">No results yet.</div>}
        {runner.records.length > 0 && (
          <div className="text-sm">
            {runner.records.map((rec) => (
              <div key={rec.jobId} className="border p-2 mb-2">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs">{rec.sessionId}</div>
                  <Link className="text-blue-600 underline text-xs" href={`/dev-tools/agent-dashboard?sessionId=${rec.sessionId}`}>Open diagnostics</Link>
                </div>
                <div className="text-xs text-gray-700">{rec.prompt}</div>
                <div className="text-xs">{formatTs(rec.startedAt)} → {formatTs(rec.finishedAt)} ({rec.durationMs} ms)</div>
                {rec.error && <div className="text-xs text-red-600">Error: {rec.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentBatchPage() {
  return (
    <WebContainerProvider>
      {/* Hidden desktop initializer to boot WebContainer headlessly */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        <WebContainer />
      </div>
      <AgentBatchInner />
    </WebContainerProvider>
  );
}
