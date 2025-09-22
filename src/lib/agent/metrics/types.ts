import type { CapabilityIntent } from '@/lib/agent/intents/capabilityHeuristics';
import type { SystemPromptIntent } from '@/lib/prompts';

export type PersonaPostProcessReason =
  | 'skipped-disabled'
  | 'skipped-empty'
  | 'skipped-structured'
  | 'skipped-persona-mode'
  | 'skipped-banter'
  | 'skipped-error'
  | 'applied';

export type AgentEventKind =
  | 'session_started'
  | 'session_finished'
  | 'step_finished'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'tool_call_outbound'
  | 'tool_call_inbound'
  | 'message_logged'
  | 'classification_decided'
  | 'capability_routed'
  | 'persona_post_processed';

export interface AgentUsageEstimates {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  charCount?: number;
}

export interface AgentUsageCostBreakdown {
  promptCostUSD: number;
  completionCostUSD: number;
  totalCostUSD: number;
}

export interface AgentEventBase {
  sessionId: string;
  requestId: string;
  timestamp: number;
  sequence: number;
  kind: AgentEventKind;
  source: 'api/agent' | 'client';
  model?: string;
  threadId?: string;
  personaMode?: boolean;
  dedupeKey?: string;
  userIdentifier?: string;
}

export interface AgentMessagePreview {
  role: string;
  textPreview: string;
  charCount: number;
  toolCallCount: number;
}

export interface AgentSessionStartedEvent extends AgentEventBase {
  kind: 'session_started';
  payload: {
    personaMode: boolean;
    attachmentsCount: number;
    messagePreviews: AgentMessagePreview[];
    toolNames: string[];
    userIdentifier?: string;
    sessionStartedAt: number;
  };
}

export interface AgentMessageLoggedEvent extends AgentEventBase {
  kind: 'message_logged';
  payload: {
    role: 'user' | 'assistant' | 'system';
    messageId: string;
    textPreview: string;
    charCount: number;
    tokenEstimate?: number;
    stepIndex?: number;
  };
}

export interface AgentStepFinishedEvent extends AgentEventBase {
  kind: 'step_finished';
  payload: {
    stepIndex: number;
    finishReason?: string;
    textLength: number;
    toolCallsCount: number;
    toolResultsCount: number;
    usage?: AgentUsageEstimates;
    generatedTextPreview?: string;
  };
}

export interface AgentToolCallStartedEvent extends AgentEventBase {
  kind: 'tool_call_started';
  payload: {
    stepIndex: number;
    toolCallId: string;
    toolName: string;
    inputSummary: {
      sanitized: Record<string, unknown>;
      charCount: number;
      tokenEstimate: number;
    };
  };
}

export interface AgentToolCallOutboundEvent extends AgentEventBase {
  kind: 'tool_call_outbound';
  payload: {
    stepIndex: number;
    toolCallId: string;
    toolName: string;
    argsSummary: {
      sanitized: Record<string, unknown>;
      charCount: number;
      tokenEstimate: number;
    };
    estimatedCostUSD?: number;
  };
}

export interface AgentToolCallFinishedEvent extends AgentEventBase {
  kind: 'tool_call_finished';
  payload: {
    stepIndex: number;
    toolCallId: string;
    toolName: string;
    durationMs: number;
    inputSummary: {
      sanitized: Record<string, unknown>;
      charCount: number;
      tokenEstimate: number;
    };
    resultSummary: {
      sanitized: Record<string, unknown>;
      charCount: number;
      tokenEstimate: number;
      isError: boolean;
      errorMessage?: string;
    };
    tokenUsage: AgentUsageEstimates;
    costUSD: number;
    modelMessage?: Record<string, unknown>;
    modelMessageJson?: string;
  };
}

export interface AgentToolCallInboundEvent extends AgentEventBase {
  kind: 'tool_call_inbound';
  payload: {
    stepIndex: number;
    toolCallId: string;
    toolName: string;
    durationMs?: number;
    resultSummary: {
      sanitized: Record<string, unknown>;
      charCount: number;
      tokenEstimate: number;
      isError: boolean;
      errorMessage?: string;
    };
    tokenUsage?: AgentUsageEstimates;
    costUSD?: number;
    modelMessage?: Record<string, unknown>;
    modelMessageJson?: string;
  };
}

export interface AgentSessionFinishedEvent extends AgentEventBase {
  kind: 'session_finished';
  payload: {
    finishReason?: string;
    stepCount: number;
    toolCallCount: number;
    sessionDurationMs: number;
    estimatedUsage: AgentUsageEstimates;
    actualUsage?: AgentUsageEstimates;
    estimatedCostUSD: number;
    actualCostUSD?: number;
  };
}

export interface AgentClassificationDecidedEvent extends AgentEventBase {
  kind: 'classification_decided';
  payload: {
    model: string;
    result: 'agent' | 'persona';
    durationMs: number;
    startedAt: number;
    finishedAt: number;
    inputCharCount: number;
    attachmentsCount: number;
    usage?: AgentUsageEstimates;
    estimatedCostUSD?: number;
    rawOutputPreview?: string;
    error?: string;
  };
}

export interface AgentCapabilityRoutedEvent extends AgentEventBase {
  kind: 'capability_routed';
  payload: {
    capabilityIntent: CapabilityIntent;
    confidence: 'low' | 'medium' | 'high';
    source: 'heuristic' | 'model';
    reason: string;
    modelId?: string;
    heuristicIntent?: CapabilityIntent;
    heuristicReason?: string;
    resolvedAgentIntent: SystemPromptIntent;
    toolNames: string[];
  };
}

export interface AgentPersonaPostProcessedEvent extends AgentEventBase {
  kind: 'persona_post_processed';
  payload: {
    applied: boolean;
    reason: PersonaPostProcessReason;
    originalCharCount: number;
    finalCharCount: number;
    modelId?: string;
    durationMs?: number;
    capabilityIntent?: CapabilityIntent;
  };
}

export type AgentIngestEvent =
  | AgentSessionStartedEvent
  | AgentSessionFinishedEvent
  | AgentStepFinishedEvent
  | AgentToolCallStartedEvent
  | AgentToolCallFinishedEvent
  | AgentToolCallOutboundEvent
  | AgentToolCallInboundEvent
  | AgentMessageLoggedEvent
  | AgentClassificationDecidedEvent
  | AgentCapabilityRoutedEvent
  | AgentPersonaPostProcessedEvent;

export interface AgentSessionMeta {
  sessionId: string;
  requestId: string;
  model: string;
  threadId?: string;
  personaMode: boolean;
  userIdentifier?: string;
  toolNames: string[];
  sessionStartedAt: number;
}
