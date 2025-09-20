import { api as convexApi } from '../../../../convex/_generated/api';
import { getConvexClientOptional } from './agentServerHelpers';
import type {
  AgentEventKind,
  AgentIngestEvent,
  AgentSessionFinishedEvent,
  AgentSessionMeta,
  AgentSessionStartedEvent,
  AgentStepFinishedEvent,
  AgentToolCallFinishedEvent,
  AgentToolCallStartedEvent,
  AgentMessageLoggedEvent,
} from '@/lib/agent/metrics/types';

interface EmitOptions {
  timestamp?: number;
  dedupeKey?: string;
  source?: 'api/agent' | 'client';
  sequence?: number;
}

interface FlushOptions {
  timeoutMs?: number;
}

type PayloadFor<K extends AgentEventKind> =
  Extract<AgentIngestEvent, { kind: K }>['payload'];

export class AgentEventEmitter {
  private readonly clientPromise = getConvexClientOptional();
  private readonly dedupeKeys = new Set<string>();
  private sequence: number;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly meta: AgentSessionMeta, initialSequence = 0) {
    this.sequence = initialSequence;
  }

  emit(kind: 'session_started', payload: PayloadFor<'session_started'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'session_finished', payload: PayloadFor<'session_finished'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'step_finished', payload: PayloadFor<'step_finished'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'tool_call_started', payload: PayloadFor<'tool_call_started'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'tool_call_finished', payload: PayloadFor<'tool_call_finished'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'tool_call_outbound', payload: PayloadFor<'tool_call_outbound'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'tool_call_inbound', payload: PayloadFor<'tool_call_inbound'>, options?: EmitOptions): Promise<void>;
  emit(kind: 'message_logged', payload: PayloadFor<'message_logged'>, options?: EmitOptions): Promise<void>;
  emit(kind: AgentEventKind, payload: PayloadFor<AgentEventKind>, options?: EmitOptions): Promise<void> {
    const timestamp = options?.timestamp ?? Date.now();
    const source = options?.source ?? 'api/agent';
    const useSequence = options?.sequence ?? this.sequence++;
    const dedupeKey = options?.dedupeKey;

    if (dedupeKey) {
      if (this.dedupeKeys.has(dedupeKey)) {
        return Promise.resolve();
      }
      this.dedupeKeys.add(dedupeKey);
    }

    const base = {
      sessionId: this.meta.sessionId,
      requestId: this.meta.requestId,
      model: this.meta.model,
      threadId: this.meta.threadId,
      personaMode: this.meta.personaMode,
      userIdentifier: this.meta.userIdentifier,
      source,
      timestamp,
      sequence: useSequence,
      kind,
    } as const;

    const event = { ...base, payload } as AgentIngestEvent;

    this.pending = this.pending.then(async () => {
      try {
        const client = await this.clientPromise;
        if (!client) return;
        await client.mutation(convexApi.agentMetrics.ingestEvent, { event });
      } catch (error) {
        console.warn('[AgentEventEmitter] Failed to emit event', kind, error);
      }
    });

    return this.pending;
  }

  async flush(options: FlushOptions = {}): Promise<void> {
    const { timeoutMs } = options;
    const pending = this.pending;

    if (typeof timeoutMs === 'number' && timeoutMs >= 0) {
      try {
        await Promise.race([
          pending.catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
      } catch {
        // Swallow errors to keep logging best-effort
      }
      return;
    }

    try {
      await pending;
    } catch {
      // already logged during emit
    }
  }
}

export type {
  AgentSessionStartedEvent,
  AgentSessionFinishedEvent,
  AgentStepFinishedEvent,
  AgentToolCallFinishedEvent,
  AgentToolCallStartedEvent,
  AgentMessageLoggedEvent,
};
