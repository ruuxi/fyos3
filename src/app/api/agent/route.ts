import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  tool,
  generateId,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
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
  MemoryCheckpointInput,
} from '@/lib/agentTools';
import { agentLogger } from '@/lib/agentLogger';
import { SYSTEM_PROMPT } from '@/lib/prompts';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
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

type MessageMetadata = {
  mode?: string;
  session?: number;
  sessionStart?: boolean;
  control?: string;
  [key: string]: unknown;
};

const PERSONA_TRANSLATOR_SYSTEM_PROMPT = `You rewrite ai assitant/agent responses as "Sim", an edgy, confident teen voice. Keep it playful, sarcastic, and zoomer. Keep outputs short. Never mention underlying tools, models, or raw implementation details. Avoid technical jargon—translate it into everyday language. If the agent output is empty, produce a quick upbeat acknowledgement based on the latest user request and any hints provided.`;

const MEMORY_SUMMARY_SYSTEM_PROMPT = `You archive completed chat sessions. Given a transcript, return a 6-12 word descriptor capturing the main accomplishment. Output only the descriptor.`;

const getMessageMetadata = (message: MessageEnvelope): MessageMetadata | undefined => {
  const metadata = (message as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return metadata as MessageMetadata;
};

const resolveMessageMode = (message: MessageEnvelope): string | undefined => {
  const metadata = getMessageMetadata(message);
  if (metadata && typeof metadata.mode === 'string') return metadata.mode;
  const directMode = (message as { mode?: unknown }).mode;
  return typeof directMode === 'string' ? directMode : undefined;
};

const readSessionFromMetadata = (metadata: MessageMetadata | undefined): number | null => {
  if (!metadata) return null;
  const value = metadata.session;
  return typeof value === 'number' ? value : null;
};

const isSessionStartMetadata = (metadata: MessageMetadata | undefined): boolean => {
  return Boolean(metadata && metadata.sessionStart === true);
};

const stripMessageId = (message: MessageEnvelope): SanitizedMessage => {
  if ('id' in message) {
    const { id: _omit, ...rest } = message as UIMessage;
    return rest;
  }
  return message as SanitizedMessage;
};

type GenericToolCall = {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
};

type GenericToolResult = GenericToolCall & {
  output?: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  preliminary?: boolean;
};

const summarizeToolResults = (toolResults?: GenericToolResult[]): string | null => {
  if (!toolResults || toolResults.length === 0) return null;
  const lines = toolResults.map((result) => {
    const name = result.toolName || 'tool';
    const outcome = result.output;
    if (hasErrorField(outcome)) return `${name} encountered an issue`;
    return `${name} completed successfully`;
  });
  const unique = Array.from(new Set(lines));
  return unique.length > 0 ? unique.join('\n') : null;
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
      for (let i = messagesWithHints.length - 1; i >= 0; i -= 1) {
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
          appendHintText(messagesWithHints[lastUserIdx], `\n${lines.join('\n')}`);
          appended = true;
        }
      }
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
            appendHintText(target, `\n${lines}`);
          }
        }
      }
    }
  }

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  console.log('🔵 [AGENT] Incoming request with messages:', messagesWithHints.map(message => {
    const text = extractTextFromMessage(message);
    const preview = text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : '[non-text content]';
    return {
      role: message.role,
      mode: resolveMessageMode(message) || 'unknown',
      textPreview: preview,
      toolCalls: countToolCalls(message),
    };
  }));

  const convexClient = await getConvexClientOptional();
  let existingMemories: Doc<'chat_memories'>[] = [];
  if (threadIdRaw && convexClient) {
    try {
      existingMemories = await convexClient.query(convexApi.chat.listMemories, {
        threadId: threadIdRaw as Id<'chat_threads'>,
      });
    } catch (error) {
      console.warn('⚠️ [AGENT] Failed to load chat memories', error);
    }
  }

  const recordedSessions = existingMemories
    .map(entry => (typeof entry.session === 'number' ? entry.session : -1))
    .filter(session => session >= 0);
  const highestRecordedSession = recordedSessions.length > 0 ? Math.max(...recordedSessions) : -1;
  const fallbackSession = highestRecordedSession + 1;

  const deriveLatestSession = (): number | null => {
    for (let i = messagesWithHints.length - 1; i >= 0; i -= 1) {
      const session = readSessionFromMetadata(getMessageMetadata(messagesWithHints[i]));
      if (session !== null) return session;
    }
    return null;
  };
  const currentSession = deriveLatestSession() ?? fallbackSession;

  const lastSessionStartIndex = (() => {
    for (let i = messagesWithHints.length - 1; i >= 0; i -= 1) {
      if (isSessionStartMetadata(getMessageMetadata(messagesWithHints[i]))) return i;
    }
    return -1;
  })();
  const sliceStartIndex = lastSessionStartIndex >= 0 ? lastSessionStartIndex + 1 : 0;
  const contextEnvelopes = messagesWithHints.slice(sliceStartIndex);
  const agentContextEnvelopes = contextEnvelopes.filter((message) => {
    if (message.role === 'assistant' && resolveMessageMode(message) === 'persona') {
      return false;
    }
    return true;
  });
  const sanitizedMessages = agentContextEnvelopes.map(stripMessageId);

  let systemPrompt = SYSTEM_PROMPT;
  try {
    const installed = await getInstalledAppNames();
    if (installed.length > 0) {
      systemPrompt += '\n\nCurrent apps installed:\n' + installed.map(n => `- ${n}`).join('\n');
    }
  } catch {}
  if (existingMemories.length > 0) {
    const sortedMemories = [...existingMemories].sort((a, b) => (a.session ?? 0) - (b.session ?? 0));
    const memoryLines = sortedMemories.map((entry) => {
      const label = `Session ${entry.session ?? 0}`;
      return `${label}: ${entry.descriptor}`;
    });
    systemPrompt += '\n\nMemory log:\n' + memoryLines.join('\n');
  }

  const appendMessageToThread = async (
    role: 'user' | 'assistant',
    content: string,
    mode?: 'agent' | 'persona',
    session?: number,
  ) => {
    if (!threadIdRaw || !convexClient) return;
    try {
      await convexClient.mutation(convexApi.chat.appendMessage, {
        threadId: threadIdRaw as Id<'chat_threads'>,
        role,
        content,
        mode,
        session,
      });
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
    await appendMessageToThread('user', content, undefined, currentSession);
  }

  let memoryRecorded = false;
  let recordedDescriptor: string | null = null;
  let recordedMetadata: { userSummary?: string; confidence?: number | null } | null = null;
  let personaSession = currentSession;
  let markSessionStartOnPersona = false;
  const lastUserText = lastMessage?.role === 'user' ? extractTextFromMessage(lastMessage) : '';

  const memoryCheckpointTool = tool({
    description: 'Use when the latest user message introduces a brand-new topic. Summarize the previous session and reset context.',
    inputSchema: MemoryCheckpointInput,
    async execute({ userSummary, confidence }, { messages: toolMessages }) {
      if (!threadIdRaw) {
        return { recorded: false, reset: false, reason: 'no-thread' };
      }
      if (memoryRecorded) {
        return {
          recorded: true,
          descriptor: recordedDescriptor,
          reset: true,
          session: personaSession,
          message: 'Memory already captured. Continue in fresh context.',
        };
      }
      let transcript = '';
      try {
        const segments = Array.isArray(toolMessages)
          ? toolMessages.map((msg) => {
              const content = Array.isArray((msg as { content?: unknown }).content)
                ? ((msg as { content?: { text?: string }[] }).content || []).map(part => (part?.text ?? '')).join('\n')
                : typeof (msg as { content?: unknown }).content === 'string'
                  ? (msg as { content?: string }).content
                  : '';
              return `${msg.role}: ${content}`;
            })
          : [];
        transcript = segments.join('\n').slice(-6000);
      } catch {}

      let descriptor = '';
      try {
        const summaryPrompt = `Transcript:\n${transcript}\n\nUser hint: ${userSummary}`;
        const summaryResult = await generateText({
          model: 'xai/grok-4-fast-non-reasoning',
          system: MEMORY_SUMMARY_SYSTEM_PROMPT,
          prompt: summaryPrompt,
        });
        descriptor = (summaryResult.text || '').trim();
      } catch (error) {
        console.warn('⚠️ [AGENT] Memory summarizer failed', error);
      }
      if (!descriptor) {
        descriptor = userSummary.slice(0, 160) || 'General request archived';
      }

      memoryRecorded = true;
      recordedDescriptor = descriptor;
      recordedMetadata = { userSummary, confidence };
      personaSession = currentSession + 1;
      markSessionStartOnPersona = true;

      if (convexClient) {
        try {
          await convexClient.mutation(convexApi.chat.recordMemory, {
            threadId: threadIdRaw as Id<'chat_threads'>,
            descriptor,
            session: currentSession,
            metadata: recordedMetadata,
          });
        } catch (error) {
          console.warn('⚠️ [AGENT] Failed to record memory', error);
        }
      }

      return {
        recorded: true,
        descriptor,
        reset: true,
        session: personaSession,
        instructions: 'Previous session archived. Treat the latest user request as a fresh conversation and avoid referencing earlier context.',
      };
    },
  });

  const allTools = {
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
    [TOOL_NAMES.web_exec]: {
      description: 'Run package manager commands (e.g., pnpm add). Do NOT run dev/build/start.',
      inputSchema: WebExecInput,
    },
    [TOOL_NAMES.app_manage]: {
      description: 'Manage apps via action=create|rename|remove; handles scaffolding and registry updates.',
      inputSchema: AppManageInput,
    },
    [TOOL_NAMES.validate_project]: {
      description: 'Validate the project: typecheck + lint (changed files); full also runs production build.',
      inputSchema: ValidateProjectInput,
    },
    ...buildServerTools(sessionId),
    [TOOL_NAMES.ai_generate]: {
      description: 'Generate media using provider=fal|eleven with input only. Model selection happens behind the scenes; outputs are auto‑ingested and returned with durable URLs.',
      inputSchema: AiGenerateInput,
    },
    [TOOL_NAMES.media_list]: {
      description: 'List previously generated or ingested media assets with optional filters.',
      inputSchema: MediaListInput,
    },
    [TOOL_NAMES.code_edit_ast]: {
      description: 'Edit TypeScript/JavaScript via AST transformations (imports, function bodies, JSX, code insertion). Prefer this over full rewrites for precise changes.',
      inputSchema: CodeEditAstInput,
    },
    [TOOL_NAMES.memory_checkpoint]: memoryCheckpointTool,
  };

  const tools = allTools;
  const toolCallTimings = new Map<string, number>();

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const agentResult = streamText({
        model: 'xai/grok-code-fast-1',
        providerOptions: {
          gateway: {
            order: ['xai', 'groq'],
          },
          openai: {
            reasoningEffort: 'low',
          },
        },
        messages: convertToModelMessages(sanitizedMessages),
        system: systemPrompt,
        tools,
        stopWhen: stepCountIs(15),
        onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage }) => {
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

          const toolCallsList = (toolCalls ?? []) as GenericToolCall[];
          if (toolCallsList.length > 0) {
            console.log('🔧 [USAGE-STEP] Tool calls:', toolCallsList.map((tc) => ({
              name: tc.toolName,
              id: tc.toolCallId ? tc.toolCallId.slice(0, 8) : 'unknown',
            })));
            for (const tc of toolCallsList) {
              if (tc.toolCallId) {
                toolCallTimings.set(tc.toolCallId, Date.now());
              }
            }
          }

          const toolResultsList = (toolResults ?? []) as GenericToolResult[];
          if (toolResultsList.length > 0) {
            for (const result of toolResultsList) {
              const toolCallId = result.toolCallId ?? `tool_${Date.now()}`;
              const startTime = toolCallTimings.get(toolCallId) ?? Date.now();
              const duration = Date.now() - startTime;
              const sanitizedInput = sanitizeToolInput(result.toolName || 'unknown', (result.input ?? {}) as Record<string, unknown>);
              const output = result.output;
              const isError = hasErrorField(output);
              await agentLogger.logToolCall(
                sessionId,
                result.toolName || 'unknown',
                toolCallId,
                sanitizedInput,
                {
                  result: output,
                  state: undefined,
                  isError,
                  errorMessage: isError ? String((output as { error: unknown }).error) : undefined,
                },
                duration,
              );
              toolCallTimings.delete(toolCallId);
            }
          }
        },
        onFinish: async (event) => {
          console.log('🎯 [AI] Response finished:', {
            finishReason: event.finishReason,
            textLength: event.text?.length || 0,
            toolCalls: event.toolCalls?.length || 0,
            toolResults: event.toolResults?.length || 0,
            stepCount: event.steps?.length || 0,
          });

          const agentText = (event.text || '').trim();
          const finishToolCalls = (event.toolCalls ?? []) as GenericToolCall[];
          const finishToolResults = (event.toolResults ?? []) as GenericToolResult[];
          const requiresFollowUp = event.finishReason === 'tool-calls'
            || (!agentText && finishToolCalls.length > 0);

          if (agentText) {
            await agentLogger.logMessage(sessionId, `assistant_${Date.now()}`, 'assistant', agentText);
            await appendMessageToThread('assistant', agentText, 'agent', personaSession);
          }

          if (event.usage) {
            console.log('📊 [USAGE-TOTAL] Token consumption:', {
              inputTokens: event.usage.inputTokens || 0,
              outputTokens: event.usage.outputTokens || 0,
              totalTokens: event.usage.totalTokens || 0,
              reasoningTokens: event.usage.reasoningTokens || 0,
              cachedInputTokens: event.usage.cachedInputTokens || 0,
            });
            const inputCostPerMillion = 2.00;
            const outputCostPerMillion = 2.00;
            const estimatedCost =
              ((event.usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
              ((event.usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
            console.log('💰 [USAGE-COST] qwen3-coder estimated cost: $' + estimatedCost.toFixed(6));
            await agentLogger.logTokenUsage(
              sessionId,
              event.usage.inputTokens || 0,
              event.usage.outputTokens || 0,
              event.usage.totalTokens || 0,
              'qwen3-coder',
              estimatedCost,
            );
          }

          if (finishToolCalls.length > 0) {
            console.log('🔧 [AI] Tool calls made:', finishToolCalls.map((tc) => ({
              name: tc.toolName,
              input: tc.input,
              id: tc.toolCallId ? tc.toolCallId.slice(0, 8) : 'unknown',
            })));
          }
          if (finishToolResults.length > 0) {
            console.log('📋 [AI] Tool results received:', finishToolResults.map((tr) => ({
              name: tr.toolName,
              success: !hasErrorField(tr.output),
              id: tr.toolCallId ? tr.toolCallId.slice(0, 8) : 'unknown',
            })));
          }

          if (requiresFollowUp) {
            return;
          }

          const toolSummary = summarizeToolResults(finishToolResults);
          const personaSource = agentText || toolSummary || 'Handled your request — no direct response returned.';

          const personaMetadata: MessageMetadata = {
            mode: 'persona',
            session: personaSession,
          };
          if (markSessionStartOnPersona) {
            personaMetadata.sessionStart = true;
          }

          const streamPersona = async () => {
            try {
              const personaResult = streamText({
                model: 'openai/gpt-4o-mini',
                system: PERSONA_TRANSLATOR_SYSTEM_PROMPT,
                messages: [
                  {
                    role: 'user',
                    content: `Latest user request:\n${lastUserText || '(none)'}\n\nAgent notes:\n${personaSource}`,
                  },
                ],
              });

              writer.write({
                type: 'start',
                messageId: generateId(),
                messageMetadata: personaMetadata,
              });
              writer.merge(personaResult.toUIMessageStream({
                sendStart: false,
                messageMetadata: () => personaMetadata,
              }));

              const response = await personaResult.response;
              const personaText = response.messages
                .filter(msg => msg.role === 'assistant')
                .map((msg) => {
                  const content = (msg as { content?: unknown }).content;
                  if (Array.isArray(content)) {
                    return content
                      .map((part) => {
                        if (part && typeof part === 'object' && 'text' in (part as { text?: unknown })) {
                          const textValue = (part as { text?: unknown }).text;
                          return typeof textValue === 'string' ? textValue : '';
                        }
                        return '';
                      })
                      .join('');
                  }
                  if (typeof content === 'string') {
                    return content;
                  }
                  return '';
                })
                .join('')
                .trim();

              if (personaText) {
                await agentLogger.logMessage(sessionId, `persona_${Date.now()}`, 'assistant', personaText);
                await appendMessageToThread('assistant', personaText, 'persona', personaSession);
              }
            } catch (error) {
              console.warn('⚠️ [AGENT] Persona translator failed', error);
              const fallback = 'All set! Let me know what you want next.';
              writer.write({
                type: 'start',
                messageId: generateId(),
                messageMetadata: personaMetadata,
              });
              const fallbackChunk: UIMessageChunk = {
                type: 'text-delta',
                id: generateId(),
                delta: fallback,
              };
              writer.write(fallbackChunk);
              writer.write({
                type: 'finish',
                messageMetadata: personaMetadata,
              });
              await agentLogger.logMessage(sessionId, `persona_${Date.now()}`, 'assistant', fallback);
              await appendMessageToThread('assistant', fallback, 'persona', personaSession);
            }
          };

          await streamPersona();
        },
      });

      writer.merge(agentResult.toUIMessageStream({
        sendReasoning: false,
        messageMetadata: () => ({ mode: 'agent', session: personaSession }),
      }));

      await agentResult.response;
    },
  });

  console.log('📤 [AGENT] Returning streaming response');
  return createUIMessageStreamResponse({ stream });
}
