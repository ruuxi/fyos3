import { convertToModelMessages, streamText, UIMessage, stepCountIs } from 'ai';
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
} from '@/lib/agentTools';
import { agentLogger } from '@/lib/agentLogger';
import { SYSTEM_PROMPT } from '@/lib/prompts';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api as convexApi } from '../../../../convex/_generated/api';
import { getInstalledAppNames, sanitizeToolInput, getConvexClientOptional } from '@/lib/agent/server/agentServerHelpers';
import { buildServerTools } from '@/lib/agent/server/agentServerTools';

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

type AttachmentHint = { contentType?: string | null; url: string };
type AgentPostPayload = {
  messages: UIMessage[];
  threadId?: string;
  attachmentHints?: AttachmentHint[];
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
}

type StreamFinishEvent = StepEventSummary & { steps?: StepEventSummary[] };

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

export async function POST(req: Request) {
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

  // Generate session ID for this conversation
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

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

  console.log('🔵 [AGENT] Incoming request with messages:', sanitizedMessages.map(message => {
    const text = extractTextFromMessage(message);
    const preview = text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : '[non-text content]';
    return {
      role: message.role,
      textPreview: preview,
      toolCalls: countToolCalls(message),
    };
  }));

  const appendMessageToThread = async (
    role: 'user' | 'assistant',
    content: string
  ) => {
    if (!threadIdRaw) return;
    try {
      const client = await getConvexClientOptional();
      if (client) {
        await client.mutation(convexApi.chat.appendMessage, {
          threadId: threadIdRaw as Id<'chat_threads'>,
          role,
          content,
          mode: role === 'assistant' ? 'agent' : undefined,
        });
      }
    } catch (error) {
      console.warn('⚠️ [AGENT] Failed to append message to thread', error);
    }
  };

  const lastMessage = messagesWithHints[messagesWithHints.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    const content = extractTextFromMessage(lastMessage);
    const messageId = 'id' in lastMessage && typeof lastMessage.id === 'string'
      ? lastMessage.id
      : `user_${Date.now()}`;
    await agentLogger.logMessage(sessionId, messageId, 'user', content);
    await appendMessageToThread('user', content);
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

  // Track tool call timings to avoid duplicate logging
  const toolCallTimings = new Map<string, number>();

  const result = streamText({
    model: 'alibaba/qwen3-coder',
    providerOptions: {
      gateway: {
        order: ['cerebras', 'groq'], // Try Amazon Bedrock first, then Anthropic
      },
      openai: {
        reasoningEffort: 'low',
      },
    },
    messages: convertToModelMessages(sanitizedMessages),
    stopWhen: stepCountIs(15),
    onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage }: StepEventSummary) => {
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
      
      // Track start times for tool calls (for timing)
      if (toolCalls?.length) {
        console.log('🔧 [USAGE-STEP] Tool calls:', toolCalls.map((tc) => ({
          name: tc.toolName,
          id: tc.toolCallId ? tc.toolCallId.slice(0, 8) : 'unknown',
        })));

        // Record start times for duration tracking
        for (const tc of toolCalls) {
          if (tc.toolCallId) {
            toolCallTimings.set(tc.toolCallId, Date.now());
          }
        }
      }

      // Log completed tool calls with results and timing
      if (toolResults?.length) {
        for (const result of toolResults) {
          const toolCallId = result.toolCallId ?? `tool_${Date.now()}`;
          const startTime = toolCallTimings.get(toolCallId) ?? Date.now();
          const duration = Date.now() - startTime;
          
          // Sanitize large content from tool inputs before logging
          const rawInput = (result.args ?? result.input ?? {}) as Record<string, unknown>;
          const sanitizedInput = sanitizeToolInput(result.toolName || 'unknown', rawInput);

          await agentLogger.logToolCall(
            sessionId,
            result.toolName || 'unknown',
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
          
          // Clean up timing tracking
          toolCallTimings.delete(toolCallId);
        }
      }
    },
    onFinish: async (event: StreamFinishEvent) => {
      // Enhanced usage logging
      console.log('🎯 [AI] Response finished:', {
        finishReason: event.finishReason,
        textLength: event.text?.length || 0,
        toolCalls: event.toolCalls?.length || 0,
        toolResults: event.toolResults?.length || 0,
        stepCount: event.steps?.length || 0,
      });

      // Log the complete assistant response including tool calls
      if (event.text) {
        await agentLogger.logMessage(sessionId, `assistant_${Date.now()}`, 'assistant', event.text);
        await appendMessageToThread('assistant', event.text);
      }

      // Tool calls are now logged in onStepFinish with proper timing and results
      // No need to duplicate logging here

      // Detailed token usage logging
      if (event.usage) {
        console.log('📊 [USAGE-TOTAL] Token consumption:', {
          inputTokens: event.usage.inputTokens || 0,
          outputTokens: event.usage.outputTokens || 0,
          totalTokens: event.usage.totalTokens || 0,
          reasoningTokens: event.usage.reasoningTokens || 0,
          cachedInputTokens: event.usage.cachedInputTokens || 0,
        });

        // Calculate cost estimates based on model pricing
        // qwen3-coder: $2.00 per million tokens (input and output)
        const inputCostPerMillion = 2.00; // $2.00 per 1M input tokens
        const outputCostPerMillion = 2.00; // $2.00 per 1M output tokens
        const estimatedCost = 
          ((event.usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
          ((event.usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
        
        console.log('💰 [USAGE-COST] qwen3-coder estimated cost: $' + estimatedCost.toFixed(6));
        
        // Log token usage and cost to file
        await agentLogger.logTokenUsage(
          sessionId,
          event.usage.inputTokens || 0,
          event.usage.outputTokens || 0,
          event.usage.totalTokens || 0,
          'qwen3-coder',
          estimatedCost
        );
      }

      // Log step-by-step breakdown if multiple steps
      if (event.steps && event.steps.length > 1) {
        console.log('📈 [USAGE-STEPS] Step breakdown:');
        event.steps.forEach((step, index) => {
          console.log(`  Step ${index}: ${step.text?.length || 0} chars, ${step.toolCalls?.length || 0} tools`);
        });
      }

      // Console logging for development (tool calls already logged in onStepFinish)
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
    },
    system: systemPrompt,
    tools,
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
