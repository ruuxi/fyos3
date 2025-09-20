import { convertToModelMessages, streamText, UIMessage, stepCountIs, generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createHash } from 'crypto';
import { auth } from '@clerk/nextjs/server';
// z is used in tool schemas but not directly here
import {
  TOOL_NAMES,
  WebFsFindInput,
  WebFsReadInput,
  WebFsWriteInput,
  WebFsRmInput,
  WebExecInput,
  AppManageInput,
  ValidateProjectInput,
  AiGenerateInput,
  MediaListInput,
  CodeEditAstInput,
  SubmitPlanInput,
} from '@/lib/agentTools';
import { agentLogger } from '@/lib/agentLogger';
import { 
  SYSTEM_PROMPT,
  PERSONA_PROMPT,
  CLASSIFIER_PROMPT
} from '@/lib/prompts';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api as convexApi } from '../../../../convex/_generated/api';
import { getInstalledAppNames, sanitizeToolInput, getConvexClientOptional, summarizeToolResult } from '@/lib/agent/server/agentServerHelpers';
import { buildServerTools } from '@/lib/agent/server/agentServerTools';
import { AgentEventEmitter } from '@/lib/agent/server/agentEventEmitter';
import type { AgentUsageEstimates, AgentMessagePreview } from '@/lib/agent/metrics/types';
import {
  estimateTokensFromText,
  estimateCostUSD,
  mergeUsageEstimates,
  toUsageEstimates,
  estimateTokensFromJson,
} from '@/lib/agent/metrics/tokenEstimation';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  headers: {
    'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://fromyou.studio',
    'X-Title': process.env.OPENROUTER_APP_TITLE ?? 'FromYou Desktop',
  },
});

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

type AttachmentHint = { contentType?: string | null; url: string };
type AgentPostPayload = {
  messages: UIMessage[];
  threadId?: string;
  attachmentHints?: AttachmentHint[];
  sessionId?: string;
  requestSequence?: number;
};
type SanitizedMessage = Omit<UIMessage, 'id'>;
type MessageEnvelope = (UIMessage | SanitizedMessage) & { content?: string; toolCalls?: unknown[] };
type TextUIPart = { type: 'text'; text: string };

interface TokenUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

interface ToolCallSummary {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
}

interface ToolResultSummary extends ToolCallSummary {
  result?: unknown;
  state?: unknown;
  isError?: boolean;
  errorMessage?: string;
}

interface StepEventSummary {
  text?: string;
  toolCalls?: ToolCallSummary[];
  toolResults?: ToolResultSummary[];
  finishReason?: string;
  usage?: TokenUsageSummary;
  response?: {
    messages?: unknown;
    [key: string]: unknown;
  };
  request?: Record<string, unknown>;
}

type StreamFinishEvent = StepEventSummary & { steps?: StepEventSummary[] };

const computeRequestId = (messages: SanitizedMessage[], fallback: string): string => {
  try {
    const serialized = JSON.stringify(messages);
    const hash = createHash('sha1').update(serialized).digest('hex');
    return `req_${hash.slice(0, 16)}`;
  } catch {
    return fallback;
  }
};

const isAttachmentHint = (value: AttachmentHint | unknown): value is AttachmentHint => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AttachmentHint>;
  return typeof candidate.url === 'string';
};

const isTextPart = (part: unknown): part is TextUIPart => {
  return Boolean(
    part &&
    typeof part === 'object' &&
    'type' in (part as { type?: unknown }) &&
    (part as { type?: unknown }).type === 'text' &&
    'text' in (part as { text?: unknown }) &&
    typeof (part as { text?: unknown }).text === 'string'
  );
};

const extractTextFromMessage = (message: MessageEnvelope): string => {
  const fromParts = Array.isArray(message.parts)
    ? (message.parts as unknown[]).filter(isTextPart).map((part) => (part as TextUIPart).text).join('')
    : '';
  if (fromParts) return fromParts;
  return typeof message.content === 'string' ? message.content : '';
};

const appendHintText = (message: MessageEnvelope, text: string) => {
  if (Array.isArray(message.parts)) {
    const textPart: TextUIPart = { type: 'text', text };
    message.parts = [...message.parts, textPart];
  } else if (typeof message.content === 'string') {
    message.content = message.content + text;
  } else {
    message.content = text.trimStart();
  }
};

const countToolCalls = (message: MessageEnvelope): number => {
  const toolCalls = (message as { toolCalls?: unknown[] }).toolCalls;
  return Array.isArray(toolCalls) ? toolCalls.length : 0;
};

const hasErrorField = (value: unknown): value is { error: unknown } => {
  return typeof value === 'object' && value !== null && 'error' in value;
};

type ToolResultMessageCapture = {
  messageObject?: Record<string, unknown>;
  messageJson?: string;
};

const trySerializeToolMessage = (value: unknown): ToolResultMessageCapture => {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return {};
    return {
      messageJson: json,
      messageObject: JSON.parse(json) as Record<string, unknown>,
    };
  } catch {
    return {};
  }
};

const collectToolResultMessages = (response: unknown): Map<string, ToolResultMessageCapture> => {
  const map = new Map<string, ToolResultMessageCapture>();
  if (!response || typeof response !== 'object') return map;
  const candidates = (response as { messages?: unknown }).messages;
  const messages = Array.isArray(candidates) ? (candidates as unknown[]) : [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = (message as { role?: unknown }).role;
    if (role !== 'tool') continue;

    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    let serialized: ToolResultMessageCapture | null = null;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const partType = (part as { type?: unknown }).type;
      if (partType !== 'tool-result') continue;
      const toolCallId = (part as { toolCallId?: unknown }).toolCallId;
      if (typeof toolCallId !== 'string' || toolCallId.length === 0) continue;
      if (serialized === null) {
        serialized = trySerializeToolMessage(message);
      }
      map.set(toolCallId, serialized ?? {});
    }
  }

  return map;
};

export async function POST(req: Request) {
  let userIdentifier: string | undefined;
  try {
    const authResult = await auth();
    userIdentifier = authResult?.userId ?? undefined;
  } catch {}

  const body: unknown = await req.json();
  const payload = body as Partial<AgentPostPayload>;
  const messages: UIMessage[] = Array.isArray(payload.messages) ? payload.messages : [];
  const threadIdRaw = typeof payload.threadId === 'string' ? payload.threadId : undefined;
  const attachmentHintsRaw = Array.isArray(payload.attachmentHints) ? payload.attachmentHints : [];
  const hints = attachmentHintsRaw.filter(isAttachmentHint);
  const messagesWithHints: MessageEnvelope[] = [...messages];

  console.log('🧩 [AGENT] attachmentHints received:', hints.length > 0 ? hints : 'none');
  // Also detect client-side appended hint user message
  try {
    const last = messagesWithHints[messagesWithHints.length - 1];
    if (last?.role === 'user') {
      const txt = extractTextFromMessage(last);
      if (/^Attached\s+/i.test(txt.trim())) {
        console.log('🧩 [AGENT] client-appended hints present in last message');
      }
    }
  } catch {}

  if (messagesWithHints.length > 0) {
    const lastUserIdx = (() => {
      for (let i = messagesWithHints.length - 1; i >= 0; i--) {
        if (messagesWithHints[i]?.role === 'user') return i;
      }
      return -1;
    })();
    if (lastUserIdx >= 0) {
      let appended = false;
      if (hints.length > 0) {
        const lines = hints
          .filter(hint => /^https?:\/\//i.test(hint.url))
          .map(hint => `Attached ${hint.contentType || 'file'}: ${hint.url}`);
        if (lines.length > 0) {
          const hintText = `\n${lines.join('\n')}`;
          const target = messagesWithHints[lastUserIdx];
          appendHintText(target, hintText);
          appended = true;
        }
      }
      // Fallback: parse legacy Attachments block in the last user message and synthesize lines
      if (!appended) {
        const target = messagesWithHints[lastUserIdx];
        const text = extractTextFromMessage(target);
        const match = text && text.match(/Attachments:\s*\n([\s\S]*)$/i);
        if (match) {
          const section = (match[1] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const urls: string[] = [];
          for (const line of section) {
            const urlMatch = line.match(/^[-•]\s*(.+?):\s*(\S+)\s*$/);
            if (!urlMatch) continue;
            const url = urlMatch[2].trim();
            if (/^https?:\/\//i.test(url)) urls.push(url);
          }
          if (urls.length > 0) {
            const lines = urls.map(u => `Attached file: ${u}`).join('\n');
            const hintText = `\n${lines}`;
            appendHintText(target, hintText);
          }
        }
      }
    }
  }

  const sessionIdFromClient = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : undefined;
  const normalizedSessionId = sessionIdFromClient && sessionIdFromClient.length > 0 ? sessionIdFromClient : undefined;
  const requestSequenceRaw = typeof payload.requestSequence === 'number' && Number.isFinite(payload.requestSequence)
    ? Math.max(0, Math.floor(payload.requestSequence))
    : 0;
  const requestSequence = normalizedSessionId ? requestSequenceRaw : 0;

  // Generate session ID for this conversation
  const sessionId = normalizedSessionId ?? `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let sessionStartedAt: number | null = null;

  // Sanitize/dedupe messages to avoid downstream gateway duplicate-id issues
  const seenHashes = new Set<string>();
  const sanitizedMessages: SanitizedMessage[] = [];
  for (const message of messagesWithHints) {
    const text = extractTextFromMessage(message);
    const key = `${message.role}|${text}`;
    if (seenHashes.has(key)) continue;
    seenHashes.add(key);
    if ('id' in message) {
      const { id: _omit, ...rest } = message;
      sanitizedMessages.push(rest);
    } else {
      sanitizedMessages.push(message);
    }
  }

  const messagePreviews: AgentMessagePreview[] = sanitizedMessages.map((message) => {
    const text = extractTextFromMessage(message as MessageEnvelope);
    const charCount = text.length;
    const textPreview = charCount > 200 ? `${text.slice(0, 200)}...` : (text || '[non-text content]');
    return {
      role: message.role,
      textPreview,
      charCount,
      toolCallCount: countToolCalls(message as MessageEnvelope),
    };
  });

  const requestId = normalizedSessionId
    ? `${normalizedSessionId}:attempt:${requestSequence.toString().padStart(3, '0')}`
    : computeRequestId(sanitizedMessages, sessionId);

  const pendingMessageEvents: Array<{
    role: 'user' | 'assistant' | 'system';
    messageId: string;
    content: string;
    stepIndex?: number;
    timestamp: number;
  }> = [];

  console.log('🔵 [AGENT] Incoming request with messages:', sanitizedMessages.map(message => {
    const text = extractTextFromMessage(message);
    const preview = text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : '[non-text content]';
    return {
      role: message.role,
      textPreview: preview,
      toolCalls: countToolCalls(message),
    };
  }));

  const appendMessageToThread = (
    role: 'user' | 'assistant',
    content: string,
    mode: 'agent' | 'persona'
  ) => {
    if (!threadIdRaw) return;
    void (async () => {
      try {
        const client = await getConvexClientOptional();
        if (!client) return;
        await client.mutation(convexApi.chat.appendMessage, {
          threadId: threadIdRaw as Id<'chat_threads'>,
          role,
          content,
          mode,
        });
      } catch (error) {
        console.warn('⚠️ [AGENT] Failed to append message to thread', error);
      }
    })();
  };


  // Persona-only mode: returns a parallel, personality-driven stream that does not use tools
  const url = new URL(req.url);
  let personaMode = url.searchParams.get('persona') === '1' || url.searchParams.get('mode') === 'persona';

  // If not explicitly forced, auto-classify last user message using CLASSIFIER_PROMPT (0=persona, 1=agent)
  if (!personaMode) {
    try {
      const lastUser = [...sanitizedMessages].reverse().find(m => m.role === 'user');
      const lastText = lastUser ? extractTextFromMessage(lastUser) : '';
      const attachmentsMentioned = hints.length > 0
        ? `\nAttachments:\n${hints.map(h => `- ${h.contentType || 'file'}: ${h.url}`).join('\n')}`
        : '';
      const classifyInput = (lastText || '') + attachmentsMentioned;
      if (classifyInput) {
        const classification = await generateText({
          model: 'google/gemini-2.0-flash',
          system: CLASSIFIER_PROMPT,
          prompt: classifyInput,
        });
        const raw = (classification?.text || '').trim();
        if (raw === '0') personaMode = true;
        else if (raw === '1') personaMode = false;
        // If unexpected output, default to agent (personaMode=false)
      }
    } catch {
      // On classifier error, default to agent mode
    }
  }

  const lastMessage = messagesWithHints[messagesWithHints.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    const content = extractTextFromMessage(lastMessage);
    const messageId = 'id' in lastMessage && typeof lastMessage.id === 'string'
      ? lastMessage.id
      : `user_${Date.now()}`;
    await agentLogger.logMessage(sessionId, messageId, 'user', content);
    appendMessageToThread('user', content, personaMode ? 'persona' : 'agent');
    pendingMessageEvents.push({ role: 'user', messageId, content, timestamp: Date.now() });
  }
  if (personaMode) {
    const personaSystem = PERSONA_PROMPT;

    // Only provide user messages as context; ignore assistant/tool messages entirely
    // Use the last 20 user messages to give the persona adequate context
    const personaMessagesAll = messages.filter(m => m.role === 'user');
    const personaMessages = personaMessagesAll.slice(-20);

    const result = streamText({
      model: 'google/gemini-2.0-flash',
      messages: convertToModelMessages(personaMessages),
      system: personaSystem,
      onFinish: async ({ usage, finishReason, text }: { usage?: TokenUsageSummary; finishReason?: string; text?: string }) => {
        console.log('🎭 [PERSONA] Response finished:', {
          finishReason,
          textLength: text?.length || 0,
          messagesCount: personaMessages.length,
        });
        if (text) {
          await agentLogger.logMessage(sessionId, `assistant_${Date.now()}`, 'assistant', text);
          await appendMessageToThread('assistant', text, 'persona');
        }
        
        if (usage) {
          console.log('📊 [USAGE-PERSONA] Token consumption:', {
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            totalTokens: usage.totalTokens || 0,
            reasoningTokens: usage.reasoningTokens || 0,
            cachedInputTokens: usage.cachedInputTokens || 0,
          });
          
          // Calculate cost for gemini-2.0-flash: $0.10 per million input, $0.40 per million output
          const inputCostPerMillion = 0.10;
          const outputCostPerMillion = 0.40;
          const estimatedCost = 
            ((usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
            ((usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
          
          console.log('💰 [USAGE-COST] gemini-2.0-flash estimated cost: $' + estimatedCost.toFixed(6));
        }
      },
    });

    console.log('📤 [PERSONA] Returning streaming response');
    return result.toUIMessageStreamResponse();
  }

  // Use the comprehensive system prompt
  let systemPrompt = SYSTEM_PROMPT;

  // Attachments guidance is now included in the main SYSTEM_PROMPT

  // Append list of installed apps as plain names (one per line)
  try {
    const installed = await getInstalledAppNames();
    if (installed.length > 0) {
      systemPrompt += '\n\nCurrent apps installed:\n' + installed.map(n => `- ${n}`).join('\n');
    }
  } catch {}

  // Define all available tools
  const allTools = {
    // File operations
    [TOOL_NAMES.web_fs_find]: {
      description: 'List files/folders with glob/prefix and pagination; keep pages small.',
      inputSchema: WebFsFindInput,
    },
    [TOOL_NAMES.web_fs_read]: {
      description: 'Read a single file by exact path; default to concise output.',
      inputSchema: WebFsReadInput,
    },
    [TOOL_NAMES.web_fs_write]: {
      description: 'Write/create files; auto‑mkdir when needed. Prefer precise edits (consider code_edit_ast).',
      inputSchema: WebFsWriteInput,
    },
    [TOOL_NAMES.web_fs_rm]: {
      description: 'Remove a file or directory (recursive by default). Destructive—use with care.',
      inputSchema: WebFsRmInput,
    },
    // Process execution
    [TOOL_NAMES.web_exec]: {
      description: 'Run package manager commands (e.g., pnpm add). Do NOT run dev/build/start.',
      inputSchema: WebExecInput,
    },
    // App management
    [TOOL_NAMES.app_manage]: {
      description: 'Manage apps via action=create|rename|remove; handles scaffolding and registry updates.',
      inputSchema: AppManageInput,
    },
    [TOOL_NAMES.submit_plan]: {
      description: 'Create or update src/apps/<id>/plan.md with structured plan text.',
      inputSchema: SubmitPlanInput,
    },
    // Validation
    [TOOL_NAMES.validate_project]: {
      description: 'Validate the project: typecheck + lint (changed files); full also runs production build.',
      inputSchema: ValidateProjectInput,
    },
    // Web search (server-side implementation)
    ...buildServerTools(sessionId),
    // AI Media Tools (unified)
    [TOOL_NAMES.ai_generate]: {
      description: 'Generate media using provider=fal|eleven with input only. Model selection happens behind the scenes; outputs are auto‑ingested and returned with durable URLs.',
      inputSchema: AiGenerateInput,
    },
    [TOOL_NAMES.media_list]: {
      description: 'List previously generated or ingested media assets with optional filters.',
      inputSchema: MediaListInput,
    },
    // Code editing
    [TOOL_NAMES.code_edit_ast]: {
      description: 'Edit TypeScript/JavaScript via AST transformations (imports, function bodies, JSX, code insertion). Prefer this over full rewrites for precise changes.',
      inputSchema: CodeEditAstInput,
    },
  };

  // Use all available tools
  const tools = allTools;
  const modelId = 'openai/gpt-5';
  const availableToolNames = Object.keys(tools);

  const sessionStartTimestamp = Date.now();
  sessionStartedAt = sessionStartTimestamp;

  const sequenceBase = requestSequence * 10000;

  const eventEmitter = new AgentEventEmitter({
    sessionId,
    requestId,
    model: modelId,
    threadId: threadIdRaw,
    personaMode,
    userIdentifier,
    toolNames: availableToolNames,
    sessionStartedAt: sessionStartTimestamp,
  }, sequenceBase);

  void eventEmitter.emit('session_started', {
    personaMode,
    attachmentsCount: hints.length,
    messagePreviews,
    toolNames: availableToolNames,
    userIdentifier,
    sessionStartedAt: sessionStartTimestamp,
  }, { dedupeKey: `${sessionId}:session_started`, timestamp: sessionStartTimestamp });

  const emitMessageEvent = (
    role: 'user' | 'assistant' | 'system',
    messageId: string,
    content: string,
    step?: number,
    timestamp?: number,
  ) => {
    const preview = content.length > 600 ? `${content.slice(0, 600)}...` : content;
    const estimate = estimateTokensFromText(content, modelId);
    const options = typeof timestamp === 'number' ? { timestamp } : undefined;
    void eventEmitter.emit('message_logged', {
      role,
      messageId,
      textPreview: preview,
      charCount: content.length,
      tokenEstimate: estimate.tokens,
      stepIndex: step,
    }, options);
  };

  if (pendingMessageEvents.length > 0) {
    for (const entry of pendingMessageEvents) {
      emitMessageEvent(entry.role, entry.messageId, entry.content, entry.stepIndex, entry.timestamp);
    }
    pendingMessageEvents.length = 0;
  }

  let stepIndex = 0;
  let sessionUsageActual: AgentUsageEstimates = {};
  let sessionUsageEstimated: AgentUsageEstimates = {};
  let totalEstimatedCostUSD = 0;
  let totalActualCostUSD = 0;
  let totalToolCalls = 0;

  type InflightToolCall = {
    toolName: string;
    stepIndex: number;
    startedAt: number;
    promptTokens: number;
    inputCharCount: number;
    sanitizedInput: Record<string, unknown>;
    rawInput: unknown;
  };

  const inflightToolCalls = new Map<string, InflightToolCall>();
  const processedToolResults = new Set<string>();

  const result = streamText({
    model: openrouter('openai/gpt-5'),
    messages: convertToModelMessages(sanitizedMessages),
    stopWhen: stepCountIs(15),
    onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage, response }: StepEventSummary) => {
      const currentStepIndex = stepIndex;
      const now = Date.now();
      const toolResultMessages = collectToolResultMessages(response);

      console.log('📊 [USAGE-STEP] Step finished:', {
        finishReason,
        textLength: text?.length || 0,
        toolCallsCount: toolCalls?.length || 0,
        toolResultsCount: toolResults?.length || 0,
        usage: usage ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cachedInputTokens,
        } : null,
      });

      let stepUsage: AgentUsageEstimates | undefined;
      if (usage && (
        usage.inputTokens ||
        usage.outputTokens ||
        usage.totalTokens ||
        usage.reasoningTokens ||
        usage.cachedInputTokens
      )) {
        stepUsage = {
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cachedInputTokens,
        };
        sessionUsageActual = mergeUsageEstimates(sessionUsageActual, stepUsage);
      }

      if (toolCalls?.length) {
        console.log('🔧 [USAGE-STEP] Tool calls:', toolCalls.map((tc) => ({
          name: tc.toolName,
          id: tc.toolCallId ? tc.toolCallId.slice(0, 8) : 'unknown',
        })));

        for (const tc of toolCalls) {
          const toolName = tc.toolName || 'unknown';
          const toolCallId = tc.toolCallId ?? `tool_${currentStepIndex}_${Date.now()}`;
          const rawInput = (tc.args ?? tc.input ?? {}) as Record<string, unknown>;
          const sanitizedInput = sanitizeToolInput(toolName, rawInput);
          const inputEstimate = estimateTokensFromJson(rawInput, modelId);
          inflightToolCalls.set(toolCallId, {
            toolName,
            stepIndex: currentStepIndex,
            startedAt: now,
            promptTokens: inputEstimate.tokens,
            inputCharCount: inputEstimate.charCount,
            sanitizedInput,
            rawInput,
          });

          void eventEmitter.emit('tool_call_outbound', {
            stepIndex: currentStepIndex,
            toolCallId,
            toolName,
            argsSummary: {
              sanitized: sanitizedInput,
              charCount: inputEstimate.charCount,
              tokenEstimate: inputEstimate.tokens,
            },
          }, { dedupeKey: `${toolCallId}:outbound` });

          void eventEmitter.emit('tool_call_started', {
            stepIndex: currentStepIndex,
            toolCallId,
            toolName,
            inputSummary: {
              sanitized: sanitizedInput,
              charCount: inputEstimate.charCount,
              tokenEstimate: inputEstimate.tokens,
            },
          }, { dedupeKey: `${toolCallId}:started` });
        }
      }

      if (toolResults?.length) {
        for (const result of toolResults) {
          const toolName = result.toolName || 'unknown';
          const toolCallId = result.toolCallId ?? `tool_${currentStepIndex}_${Date.now()}`;
          if (processedToolResults.has(toolCallId)) continue;
          processedToolResults.add(toolCallId);

          const tracked = inflightToolCalls.get(toolCallId);
          const startTime = tracked?.startedAt ?? now;
          const duration = Math.max(0, Date.now() - startTime);
          const capturedMessage = toolResultMessages.get(toolCallId);
          const rawInputValue = tracked?.rawInput ?? (result.args ?? result.input ?? {});
          const rawInputObject = typeof rawInputValue === 'object' && rawInputValue !== null
            ? rawInputValue as Record<string, unknown>
            : {};
          const sanitizedInput = tracked?.sanitizedInput ?? sanitizeToolInput(toolName, rawInputObject);
          const inputEstimate = tracked
            ? { tokens: tracked.promptTokens, charCount: tracked.inputCharCount }
            : estimateTokensFromJson(rawInputValue, modelId);

          const outputEstimate = estimateTokensFromJson(result.result, modelId);
          const usageEstimate = toUsageEstimates(
            inputEstimate.tokens,
            outputEstimate.tokens,
            { charCount: inputEstimate.charCount + outputEstimate.charCount },
          );

          sessionUsageEstimated = mergeUsageEstimates(sessionUsageEstimated, usageEstimate);
          const costUSD = estimateCostUSD(usageEstimate, modelId);
          totalEstimatedCostUSD = Number((totalEstimatedCostUSD + costUSD).toFixed(6));
          totalToolCalls += 1;

          const sanitizedResult = summarizeToolResult(toolName, result.result);
          if (result.state !== undefined) {
            sanitizedResult.state = summarizeToolResult(`${toolName}:state`, result.state);
          }

          void eventEmitter.emit('tool_call_inbound', {
            stepIndex: tracked?.stepIndex ?? currentStepIndex,
            toolCallId,
            toolName,
            durationMs: duration,
            resultSummary: {
              sanitized: sanitizedResult,
              charCount: outputEstimate.charCount,
              tokenEstimate: outputEstimate.tokens,
              isError: result.isError ?? false,
              errorMessage: result.errorMessage,
            },
            tokenUsage: usageEstimate,
            costUSD,
            modelMessage: capturedMessage?.messageObject,
            modelMessageJson: capturedMessage?.messageJson,
          }, { dedupeKey: `${toolCallId}:inbound` });

          await agentLogger.logToolCall(
            sessionId,
            toolName,
            toolCallId,
            sanitizedInput,
            {
              result: result.result,
              state: result.state,
              isError: result.isError ?? false,
              errorMessage: result.errorMessage,
            },
            duration
          );

          void eventEmitter.emit('tool_call_finished', {
            stepIndex: tracked?.stepIndex ?? currentStepIndex,
            toolCallId,
            toolName,
            durationMs: duration,
            inputSummary: {
              sanitized: sanitizedInput,
              charCount: inputEstimate.charCount,
              tokenEstimate: inputEstimate.tokens,
            },
            resultSummary: {
              sanitized: sanitizedResult,
              charCount: outputEstimate.charCount,
              tokenEstimate: outputEstimate.tokens,
              isError: result.isError ?? false,
              errorMessage: result.errorMessage,
            },
            tokenUsage: usageEstimate,
            costUSD,
            modelMessage: capturedMessage?.messageObject,
            modelMessageJson: capturedMessage?.messageJson,
          }, { dedupeKey: `${toolCallId}:finished` });

          inflightToolCalls.delete(toolCallId);
        }
      }

      const textPreview = text && text.length > 600 ? `${text.slice(0, 600)}...` : text ?? undefined;

      void eventEmitter.emit('step_finished', {
        stepIndex: currentStepIndex,
        finishReason,
        textLength: text?.length || 0,
        toolCallsCount: toolCalls?.length || 0,
        toolResultsCount: toolResults?.length || 0,
        usage: stepUsage,
        generatedTextPreview: textPreview,
      }, { dedupeKey: `${sessionId}:step:${currentStepIndex}` });

      stepIndex += 1;
    },
    onFinish: async (event: StreamFinishEvent) => {
      const finishedAt = Date.now();
      const sessionStart = sessionStartedAt ?? finishedAt;
      const sessionDurationMs = finishedAt - sessionStart;

      console.log('🎯 [AI] Response finished:', {
        finishReason: event.finishReason,
        textLength: event.text?.length || 0,
        toolCalls: event.toolCalls?.length || 0,
        toolResults: event.toolResults?.length || 0,
        stepCount: event.steps?.length || 0,
      });

      if (event.text) {
        const assistantMessageId = `assistant_${Date.now()}`;
        await agentLogger.logMessage(sessionId, assistantMessageId, 'assistant', event.text);
        appendMessageToThread('assistant', event.text, 'agent');
        emitMessageEvent('assistant', assistantMessageId, event.text, stepIndex, finishedAt);
      }

      if (event.usage) {
        console.log('📊 [USAGE-TOTAL] Token consumption:', {
          inputTokens: event.usage.inputTokens || 0,
          outputTokens: event.usage.outputTokens || 0,
          totalTokens: event.usage.totalTokens || 0,
          reasoningTokens: event.usage.reasoningTokens || 0,
          cachedInputTokens: event.usage.cachedInputTokens || 0,
        });

        const finalUsage: AgentUsageEstimates = {
          promptTokens: event.usage.inputTokens ?? undefined,
          completionTokens: event.usage.outputTokens ?? undefined,
          totalTokens: event.usage.totalTokens ?? undefined,
          reasoningTokens: event.usage.reasoningTokens ?? undefined,
          cachedInputTokens: event.usage.cachedInputTokens ?? undefined,
        };

        sessionUsageActual = finalUsage;
        const actualCost = estimateCostUSD(finalUsage, modelId);
        totalActualCostUSD = Number(actualCost.toFixed(6));

        console.log('💰 [USAGE-COST] Estimated cost:', {
          modelId,
          costUSD: actualCost.toFixed(6),
        });

        await agentLogger.logTokenUsage(
          sessionId,
          event.usage.inputTokens || 0,
          event.usage.outputTokens || 0,
          event.usage.totalTokens || 0,
          modelId,
          actualCost
        );
      }

      if (event.steps && event.steps.length > 1) {
        console.log('📈 [USAGE-STEPS] Step breakdown:');
        event.steps.forEach((step, index) => {
          console.log(`  Step ${index}: ${step.text?.length || 0} chars, ${step.toolCalls?.length || 0} tools`);
        });
      }

      if (event.toolCalls?.length) {
        console.log('🔧 [AI] Tool calls made:', event.toolCalls.map((tc) => ({
          name: tc.toolName,
          input: tc.input ?? tc.args,
          id: tc.toolCallId ? tc.toolCallId.slice(0, 8) : 'unknown',
        })));
      }

      if (event.toolResults?.length) {
        console.log('📋 [AI] Tool results received:', event.toolResults.map((tr) => ({
          name: tr.toolName,
          success: !hasErrorField(tr.result),
          id: tr.toolCallId ? tr.toolCallId.slice(0, 8) : 'unknown',
        })));
      }

      const finishReasonIsToolCall = (reason: string | undefined) => reason === 'tool_calls' || reason === 'tool-calls';
      const finalStepFinishReason = event.steps?.[event.steps.length - 1]?.finishReason;
      const waitingOnToolResults = finishReasonIsToolCall(event.finishReason) || finishReasonIsToolCall(finalStepFinishReason);

      if (inflightToolCalls.size > 0) {
        for (const [toolCallId, tracked] of inflightToolCalls.entries()) {
          const duration = Math.max(0, finishedAt - tracked.startedAt);
          const usageEstimate = toUsageEstimates(tracked.promptTokens, 0, {
            charCount: tracked.inputCharCount,
          });
          sessionUsageEstimated = mergeUsageEstimates(sessionUsageEstimated, usageEstimate);
          const costUSD = estimateCostUSD(usageEstimate, modelId);
          totalEstimatedCostUSD = Number((totalEstimatedCostUSD + costUSD).toFixed(6));
          totalToolCalls += 1;

          const summaryLabel = waitingOnToolResults
            ? {
                valueType: 'pending',
                message: 'Tool call awaiting client result',
              }
            : {
                valueType: 'incomplete',
                message: 'Tool call ended without emitted result',
              };
          const summaryRecord = summaryLabel as Record<string, unknown>;
          const stateRecord = waitingOnToolResults ? { pending: true } : { incomplete: true };
          const isError = !waitingOnToolResults;
          const errorMessage = waitingOnToolResults
            ? undefined
            : 'Tool call ended without result before session finished';

          void eventEmitter.emit('tool_call_inbound', {
            stepIndex: tracked.stepIndex,
            toolCallId,
            toolName: tracked.toolName,
            durationMs: duration,
            resultSummary: {
              sanitized: summaryRecord,
              charCount: 0,
              tokenEstimate: 0,
              isError,
              errorMessage,
            },
            tokenUsage: usageEstimate,
            costUSD,
          }, { dedupeKey: `${toolCallId}:inbound` });

          await agentLogger.logToolCall(
            sessionId,
            tracked.toolName,
            toolCallId,
            tracked.sanitizedInput,
            {
              result: null,
              state: stateRecord,
              isError,
              errorMessage,
            },
            duration
          );

          void eventEmitter.emit('tool_call_finished', {
            stepIndex: tracked.stepIndex,
            toolCallId,
            toolName: tracked.toolName,
            durationMs: duration,
            inputSummary: {
              sanitized: tracked.sanitizedInput,
              charCount: tracked.inputCharCount,
              tokenEstimate: tracked.promptTokens,
            },
            resultSummary: {
              sanitized: summaryRecord,
              charCount: 0,
              tokenEstimate: 0,
              isError,
              errorMessage,
            },
            tokenUsage: usageEstimate,
            costUSD,
          }, { dedupeKey: `${toolCallId}:finished` });

        }
        inflightToolCalls.clear();
      }

      const hasActualUsage = Object.values(sessionUsageActual).some((value) => typeof value === 'number' && value > 0);

      void eventEmitter.emit('session_finished', {
        finishReason: event.finishReason,
        stepCount: stepIndex,
        toolCallCount: totalToolCalls,
        sessionDurationMs,
        estimatedUsage: sessionUsageEstimated,
        actualUsage: hasActualUsage ? sessionUsageActual : undefined,
        estimatedCostUSD: Number(totalEstimatedCostUSD.toFixed(6)),
        actualCostUSD: totalActualCostUSD > 0 ? totalActualCostUSD : undefined,
      }, { dedupeKey: `${sessionId}:session_finished` });

      // Flush diagnostics best-effort without blocking the response lifecycle
      void eventEmitter.flush({ timeoutMs: 500 });
    },
    system: systemPrompt,
    tools,
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
