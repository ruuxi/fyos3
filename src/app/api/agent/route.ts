import { convertToModelMessages, streamText, UIMessage, stepCountIs, tool, generateText } from 'ai';
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
  WebSearchInput,
  AiGenerateInput,
  MediaListInput,
  CodeEditAstInput,
  SubmitPlanInput,
} from '@/lib/agentTools';
import { agentLogger } from '@/lib/agentLogger';
import {
  emitSessionInit,
  emitUserMessage,
  emitAssistantMessage,
  emitStepUsage,
  emitTotalUsage,
} from '@/lib/metrics/store';
import { 
  SYSTEM_PROMPT,
  PERSONA_PROMPT
} from '@/lib/prompts';
import { promises as fs } from 'fs';
import path from 'path';
import { api as convexApi } from '../../../../convex/_generated/api';
import { getInstalledAppNames, getConvexClientOptional } from '@/lib/agent/server/agentServerHelpers';
import { buildServerTools } from '@/lib/agent/server/agentServerTools';

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  const { messages, threadId, attachmentHints }: { messages: UIMessage[]; threadId?: string; attachmentHints?: Array<{ contentType: string; url: string }> } = body as any;
  const clientChatId: string | undefined = (body as any)?.id;
  // Allow client to provide a per-request metrics session id to ensure all events are scoped
  const providedSessionId: string | undefined = (body as any)?.metricsSessionId;

  // If the client provided attachment hints, append them to the last user message
  const hints: Array<{ contentType: string; url: string }> = Array.isArray(attachmentHints) ? attachmentHints : [];
  const messagesWithHints: UIMessage[] = Array.isArray(messages) ? [...messages] : [];
  console.log('🧩 [AGENT] attachmentHints received:', Array.isArray(hints) ? hints : 'none');
  // Also detect client-side appended hint user message
  try {
    const last = messagesWithHints[messagesWithHints.length - 1] as any;
    if (last?.role === 'user' && Array.isArray(last.parts)) {
      const txt = last.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('');
      if (/^Attached\s+/i.test((txt || '').trim())) {
        console.log('🧩 [AGENT] client-appended hints present in last message');
      }
    }
  } catch {}
  if (messagesWithHints.length > 0) {
    const lastUserIdx = (() => {
      for (let i = messagesWithHints.length - 1; i >= 0; i--) {
        if ((messagesWithHints[i] as any)?.role === 'user') return i;
      }
      return -1;
    })();
    if (lastUserIdx >= 0) {
      let appended = false;
      if (hints.length > 0) {
        const lines = hints
          .filter(h => typeof h?.url === 'string' && /^https?:\/\//i.test(h.url))
          .map(h => `Attached ${h.contentType || 'file'}: ${h.url}`);
        if (lines.length > 0) {
          const hintText = `\n${lines.join('\n')}`;
          const target: any = messagesWithHints[lastUserIdx];
          if (Array.isArray(target.parts)) {
            target.parts = [...target.parts, { type: 'text', text: hintText }];
          } else if (typeof target.content === 'string') {
            target.content = (target.content || '') + hintText;
          } else {
            target.content = hintText.trimStart();
          }
          appended = true;
        }
      }
      // Fallback: parse legacy Attachments block in the last user message and synthesize lines
      if (!appended) {
        const target: any = messagesWithHints[lastUserIdx];
        const text = Array.isArray(target.parts)
          ? target.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
          : (typeof target.content === 'string' ? target.content : '');
        const m = text && text.match(/Attachments:\s*\n([\s\S]*)$/i);
        if (m) {
          const section = (m[1] || '').split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
          const urls: string[] = [];
          for (const line of section) {
            const mm = line.match(/^[-•]\s*(.+?):\s*(\S+)\s*$/);
            if (!mm) continue;
            const url = mm[2].trim();
            if (/^https?:\/\//i.test(url)) urls.push(url);
          }
          if (urls.length > 0) {
            const lines = urls.map(u => `Attached file: ${u}`).join('\n');
            const hintText = `\n${lines}`;
            if (Array.isArray(target.parts)) {
              target.parts = [...target.parts, { type: 'text', text: hintText }];
            } else if (typeof target.content === 'string') {
              target.content = (target.content || '') + hintText;
            } else {
              target.content = hintText.trimStart();
            }
          }
        }
      }
    }
  }
  
  // Generate or honor provided session ID for this conversation
  const sessionId = providedSessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // Map clientChatId -> sessionId (dev metrics)
  if (clientChatId) {
    try { emitSessionInit({ sessionId, clientChatId, source: 'server' }); } catch {}
  }
  
  // Log the incoming user message
  const lastMessage = messagesWithHints[messagesWithHints.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    const content = lastMessage.parts?.map(p => p.type === 'text' ? p.text : '').join('') || '';
    await agentLogger.logMessage(sessionId, lastMessage.id, 'user', content);
    // Emit metrics event for user message
    try { emitUserMessage({ sessionId, clientChatId, messageId: lastMessage.id, content, source: 'server' }); } catch {}
    // Persist user message to Convex if threadId and auth are present
    if (threadId) {
      try {
        const client = await getConvexClientOptional();
        if (client) {
          await client.mutation(convexApi.chat.appendMessage as any, { threadId: threadId as any, role: 'user', content } as any);
        }
      } catch {}
    }
  }

  // Sanitize/dedupe messages to avoid downstream gateway duplicate-id issues
  const seenHashes = new Set<string>();
  const sanitizedMessages: UIMessage[] = [] as any;
  for (const m of messagesWithHints) {
    const text = (m as any).parts?.map((p: any) => (p.type === 'text' ? p.text : '')).join('') || (m as any).content || '';
    const key = `${m.role}|${text}`;
    if (seenHashes.has(key)) continue;
    seenHashes.add(key);
    const { id: _omit, ...rest } = m as any;
    sanitizedMessages.push(rest);
  }

  console.log('🔵 [AGENT] Incoming request with messages:', sanitizedMessages.map(m => {
    const raw = (m as any);
    const text = typeof raw.content === 'string' && raw.content
      ? raw.content
      : Array.isArray(raw.parts)
        ? raw.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
        : '';
    const preview = text ? (text.length > 160 ? text.slice(0, 160) + '…' : text) : '[non-text content]';
    return {
      role: m.role,
      textPreview: preview,
      toolCalls: 'toolCalls' in m && Array.isArray((m as any).toolCalls) ? (m as any).toolCalls.length : 0,
    };
  }));


  // Persona-only mode: returns a parallel, personality-driven stream that does not use tools
  const url = new URL(req.url);
  const personaMode = url.searchParams.get('persona') === '1' || url.searchParams.get('mode') === 'persona';
  if (personaMode) {
    const personaSystem = PERSONA_PROMPT;

    // Only provide user messages as context; ignore assistant/tool messages entirely
    const personaMessages = messages.filter(m => m.role === 'user');

    const result = streamText({
      model: 'google/gemini-2.0-flash',
      messages: convertToModelMessages(personaMessages),
      system: personaSystem,
      onFinish: ({ usage, finishReason, text }: any) => {
        console.log('🎭 [PERSONA] Response finished:', {
          finishReason,
          textLength: text?.length || 0,
          messagesCount: personaMessages.length,
        });
        
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

  // Maintain step index for per-step usage events
  let stepIndexCounter = -1;
  // Accumulate tool call ids between model steps to attribute the FOLLOW-UP
  // model usage to the prior tools whose results it consumed.
  let pendingToolCallIds: string[] = [];

  const result = streamText({
    model: 'openai/gpt-5',
    providerOptions: {
      gateway: {
        order: ['cerebras', 'alibaba'], // Try Amazon Bedrock first, then Anthropic
      },
      openai: {
        reasoningEffort: 'low',
      },
    },
    messages: convertToModelMessages(sanitizedMessages as any),
    stopWhen: stepCountIs(15),
    onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage }: any) => {
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
      // Attribution model:
      // - Collect toolCallIds as they are issued by the model.
      // - Attribute the NEXT step's token usage to the PREVIOUSLY issued tools
      //   (whose results the model just consumed).
      // - This aligns per-call cost with the work that produced the context.
      try {
        stepIndexCounter += 1;

        const newToolIds: string[] = Array.isArray(toolCalls)
          ? toolCalls.map((tc: any) => tc.toolCallId).filter(Boolean)
          : [];

        const inputTokens = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        const totalTokens = usage?.totalTokens ?? (inputTokens + outputTokens);

        const hasUsage = (inputTokens || outputTokens || totalTokens) > 0;

        // If we have usage, attribute it to the tools accumulated since the last step.
        // We purposely do NOT attribute usage to tools created in this same step,
        // since that usage typically represents the follow-up reasoning step.
        const attributedIds: string[] = hasUsage ? [...pendingToolCallIds] : [];

        // Emit step usage with the attributed tool ids (may be empty for pure-reasoning steps)
        emitStepUsage({
          sessionId,
          clientChatId,
          stepIndex: stepIndexCounter,
          inputTokens,
          outputTokens,
          totalTokens,
          toolCallIds: attributedIds,
          source: 'server',
        });

        // Update pending set: once we attribute, clear and start a new round.
        // Always add newly requested tool ids to be attributed on the next step.
        if (hasUsage) {
          pendingToolCallIds = [];
        }
        if (newToolIds.length > 0) {
          // Deduplicate while preserving order
          const seen = new Set(pendingToolCallIds);
          for (const id of newToolIds) {
            if (!seen.has(id)) { pendingToolCallIds.push(id); seen.add(id); }
          }
        }
      } catch {}
    },
    onFinish: async (event) => {
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
        try { emitAssistantMessage({ sessionId, clientChatId, messageId: `assistant_${Date.now()}`, content: event.text, source: 'server' }); } catch {}
        // Persist assistant message to Convex if threadId and auth are present
        if (threadId) {
          try {
            const client = await getConvexClientOptional();
            if (client) {
              await client.mutation(convexApi.chat.appendMessage as any, { threadId: threadId as any, role: 'assistant', content: event.text } as any);
            }
          } catch {}
        }
      }

      // Tool calls are now logged in onStepFinish with proper timing and results
      // No need to duplicate logging here

      // Detailed token usage logging + metrics total
      if (event.usage) {
        console.log('📊 [USAGE-TOTAL] Token consumption:', {
          inputTokens: event.usage.inputTokens || 0,
          outputTokens: event.usage.outputTokens || 0,
          totalTokens: event.usage.totalTokens || 0,
          reasoningTokens: event.usage.reasoningTokens || 0,
          cachedInputTokens: event.usage.cachedInputTokens || 0,
        });

        // Calculate cost estimates based on model pricing
        // Gpt-5
        const inputCostPerMillion = 1.25; // $2.00 per 1M input tokens
        const outputCostPerMillion = 10.00; // $2.00 per 1M output tokens
        const estimatedCost = 
          ((event.usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
          ((event.usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
        
        console.log('💰 [USAGE-COST] GPT-5 estimated cost: $' + estimatedCost.toFixed(6));
        
        // Log token usage and cost to file
        await agentLogger.logTokenUsage(
          sessionId,
          event.usage.inputTokens || 0,
          event.usage.outputTokens || 0,
          event.usage.totalTokens || 0,
          'openai/gpt-5',
          estimatedCost
        );

        // Emit metrics total_usage using model and pricing
        try {
          emitTotalUsage({
            sessionId,
            clientChatId,
            inputTokens: event.usage.inputTokens || 0,
            outputTokens: event.usage.outputTokens || 0,
            totalTokens: event.usage.totalTokens || 0,
            model: 'openai/gpt-5',
            source: 'server',
          });
        } catch {}
      }

      // Log step-by-step breakdown if multiple steps
      if (event.steps && event.steps.length > 1) {
        console.log('📈 [USAGE-STEPS] Step breakdown:');
        event.steps.forEach((step: any, index: number) => {
          console.log(`  Step ${index}: ${step.text?.length || 0} chars, ${step.toolCalls?.length || 0} tools`);
        });
      }

      // Console logging for development (tool calls already logged in onStepFinish)
      if (event.toolCalls?.length) {
        console.log('🔧 [AI] Tool calls made:', event.toolCalls.map((tc: any) => ({
          name: tc.toolName,
          input: tc.input ?? tc.args,
          id: tc.toolCallId?.substring(0, 8)
        })));
      }

      if (event.toolResults?.length) {
        console.log('📋 [AI] Tool results received:', event.toolResults.map((tr: any) => ({
          name: tr.toolName,
          success: !tr.result?.error,
          id: tr.toolCallId?.substring(0, 8)
        })));
      }
    },
    system: systemPrompt,
    tools,
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
