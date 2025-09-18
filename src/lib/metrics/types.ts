// Core metrics event types and summaries

export type MetricSource = 'server' | 'client';

export type BaseEvent = {
  type:
    | 'session_init'
    | 'user_message'
    | 'assistant_message'
    | 'step_usage'
    | 'tool_start'
    | 'tool_end'
    | 'total_usage';
  sessionId: string;
  clientChatId?: string;
  timestamp: string; // ISO string
  source: MetricSource;
};

export type SessionInitEvent = BaseEvent & {
  type: 'session_init';
  clientChatId: string; // required for session_init
};

export type UserMessageEvent = BaseEvent & {
  type: 'user_message';
  messageId?: string;
  content: string;
};

export type AssistantMessageEvent = BaseEvent & {
  type: 'assistant_message';
  messageId?: string;
  content: string;
};

export type StepUsageEvent = BaseEvent & {
  type: 'step_usage';
  stepIndex: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallIds: string[]; // correlates tool calls within the step
};

export type ToolStartEvent = BaseEvent & {
  type: 'tool_start';
  toolCallId: string;
  toolName: string;
  inputSummary?: string;
};

export type ToolEndEvent = BaseEvent & {
  type: 'tool_end';
  toolCallId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  outputSummary?: string;
};

export type TotalUsageEvent = BaseEvent & {
  type: 'total_usage';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  totalCost: number;
};

export type MetricEvent =
  | SessionInitEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | StepUsageEvent
  | ToolStartEvent
  | ToolEndEvent
  | TotalUsageEvent;

export type SessionSummary = {
  sessionId: string;
  clientChatId?: string;
  startedAt?: string;
  lastEventAt?: string;
  messageCount: number;
  toolCalls: number; // counted by tool_end events
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  avgToolDurationMs: number;
  topTools: Array<{ name: string; count: number }>; // sorted desc by count
};

export type SessionDetail = {
  sessionId: string;
  clientChatId?: string;
  events: MetricEvent[]; // ordered chronologically
  timeline: MetricEvent[]; // alias for events (explicit for clarity)
  stepToToolMap: Record<number, string[]>; // stepIndex -> toolCallIds
  toolDurations: Record<string, number>; // toolCallId -> durationMs
};

