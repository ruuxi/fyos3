'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { useWebContainer } from '@/components/WebContainerProvider';
import { useAgentChat } from '@/components/agent/AIAgentBar/hooks/useAgentChat';
import { useValidationDiagnostics } from '@/components/agent/AIAgentBar/hooks/useValidationDiagnostics';
import { buildDesktopSnapshot, restoreDesktopSnapshot } from '@/utils/desktop-snapshot';

const DEPS_READY_TIMEOUT_MS = 120_000;
const DEPS_READY_INTERVAL_MS = 150;

export type BatchJob = {
  id: string;
  sessionId: string;
  prompt: string;
  index: number;
};

export type RunnerState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'running'; currentIndex: number; total: number; currentSessionId?: string }
  | { kind: 'stopped' }
  | { kind: 'finished' };

export type RunRecord = {
  jobId: string;
  sessionId: string;
  prompt: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  error?: string | null;
};

type BaselineSnapshot = {
  gz: Uint8Array;
  size: number;
  fileCount: number;
  contentSha256: string;
};

type BatchRunnerContextValue = {
  messages: UIMessage[];
  runner: RunnerState;
  records: RunRecord[];
  error: string | null;
  baseline: BaselineSnapshot | null;
  captureBaseline: () => Promise<BaselineSnapshot>;
  start: (jobs: BatchJob[], opts: { restoreBaseline: boolean; delayMs: number; tags: string[] }) => Promise<{ records: RunRecord[]; stopped: boolean }>;
  stop: () => void;
  clear: () => void;
};

const BatchRunnerContext = createContext<BatchRunnerContextValue | null>(null);

function useHeadlessBatchRunner(): BatchRunnerContextValue {
  const { instance, waitForDepsReady, spawn, writeFile, readFile, readdirRecursive, remove, mkdir } = useWebContainer();
  const instanceRef = useRef(instance);
  useEffect(() => {
    instanceRef.current = instance;
  }, [instance]);

  const fnsRef = useRef({ spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady });
  useEffect(() => {
    fnsRef.current = { spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady };
  }, [spawn, writeFile, readFile, readdirRecursive, remove, mkdir, waitForDepsReady]);

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
    error: chatError,
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

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    sendMessageRef.current = (content: string) => sendMessageRaw({ text: content });
  }, [sendMessageRaw]);

  const chatErrorRef = useRef<Error | undefined>(chatError ?? undefined);
  useEffect(() => {
    chatErrorRef.current = chatError ?? undefined;
  }, [chatError]);

  const [runner, setRunner] = useState<RunnerState>({ kind: 'idle' });
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const stopFlagRef = useRef(false);

  const captureBaseline = useCallback(async () => {
    if (!instanceRef.current) {
      throw new Error('WebContainer not ready');
    }
    const snap = await buildDesktopSnapshot(instanceRef.current);
    setBaseline(snap);
    return snap;
  }, []);

  const restoreBaselineIfNeeded = useCallback(async () => {
    if (!baseline || !instanceRef.current) return;
    await restoreDesktopSnapshot(instanceRef.current, baseline.gz);
  }, [baseline]);

  const waitForCompletion = useCallback(async () => {
    const idleWindowMs = 200;
    let lastReadyAt = 0;
    const startTs = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - startTs < timeoutMs) {
      if (stopFlagRef.current) throw new Error('Stopped');
      if (statusRef.current === 'error') {
        const err = chatErrorRef.current;
        throw err ?? new Error('Run failed');
      }
      if (statusRef.current === 'ready') {
        if (lastReadyAt === 0) {
          lastReadyAt = Date.now();
        }
        if (Date.now() - lastReadyAt > idleWindowMs) {
          return;
        }
      } else {
        lastReadyAt = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('Run timed out');
  }, []);

  const start = useCallback<BatchRunnerContextValue['start']>(
    async (jobs, opts) => {
      setRunnerError(null);
      stopFlagRef.current = false;
      setRunner({ kind: 'preparing' });
      const deps = await waitForDepsReady(DEPS_READY_TIMEOUT_MS, DEPS_READY_INTERVAL_MS);
      if (!deps) {
        const message = 'WebContainer is still installing dependencies. Keep this page open until the boot completes, then retry.';
        setRunnerError(message);
        setRunner({ kind: 'stopped' });
        return { records: [], stopped: true };
      }
      if (opts.restoreBaseline && !baseline) {
        await captureBaseline();
      }

      setRunner({ kind: 'running', currentIndex: 0, total: jobs.length });

      const collected: RunRecord[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (stopFlagRef.current) break;

        if (opts.restoreBaseline) {
          try {
            await restoreBaselineIfNeeded();
          } catch {
            // ignore restore errors between jobs
          }
        }

        setMessages([]);
        currentRunIdRef.current = job.sessionId;
        setRunner({ kind: 'running', currentIndex: i + 1, total: jobs.length, currentSessionId: job.sessionId });
        const startedAt = Date.now();
        let errorMsg: string | null = null;
        try {
          await sendMessageRaw({ text: job.prompt });
          await waitForCompletion();
        } catch (error: unknown) {
          errorMsg = error instanceof Error ? error.message : String(error);
        }
        const finishedAt = Date.now();
        const record: RunRecord = {
          jobId: job.id,
          sessionId: job.sessionId,
          prompt: job.prompt,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          error: errorMsg,
        };
        setRecords((prev) => [...prev, record]);
        collected.push(record);
        if (errorMsg) {
          setRunnerError((prev) => prev ?? errorMsg);
        }

        if (opts.delayMs > 0 && i < jobs.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
        }
      }
      const stopped = stopFlagRef.current;
      setRunner(stopped ? { kind: 'stopped' } : { kind: 'finished' });
      return { records: collected, stopped };
    },
    [baseline, captureBaseline, restoreBaselineIfNeeded, sendMessageRaw, setMessages, waitForDepsReady, waitForCompletion],
  );

  const stopRunner = useCallback(() => {
    stopFlagRef.current = true;
    try {
      stop();
    } catch {
      // Swallow stop errors to avoid surface noise in UI
    }
  }, [stop]);

  const clear = useCallback(() => {
    setRecords([]);
    setRunner({ kind: 'idle' });
    setRunnerError(null);
  }, []);

  return useMemo(
    () => ({
      messages,
      runner,
      records,
      error: runnerError,
      baseline,
      captureBaseline,
      start,
      stop: stopRunner,
      clear,
    }),
    [messages, runner, records, runnerError, baseline, captureBaseline, start, stopRunner, clear],
  );
}

export function BatchRunnerProvider({ children }: { children: React.ReactNode }) {
  const value = useHeadlessBatchRunner();
  return <BatchRunnerContext.Provider value={value}>{children}</BatchRunnerContext.Provider>;
}

export function useBatchRunner() {
  const ctx = useContext(BatchRunnerContext);
  if (!ctx) {
    throw new Error('useBatchRunner must be used within a BatchRunnerProvider');
  }
  return ctx;
}
