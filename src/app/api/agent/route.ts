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
  BASE_SYSTEM_PROMPT,
  CREATE_APP_PROMPT,
  EDIT_APP_PROMPT,
  GENERATION_PROMPT,
  CHAT_PROMPT,
  STYLING_GUIDELINES,
  AI_INTEGRATION_PATTERNS,
  BEST_PRACTICES,
  PERSONA_PROMPT,
  MAIN_SYSTEM_PROMPT 
} from '@/lib/agentPrompts';
import Exa from 'exa-js';

// Helper function to sanitize tool inputs for logging (removes large content)
function sanitizeToolInput(toolName: string, input: any): any {
  try {
    if (toolName === 'web_fs_write' && input?.content) {
      const contentBytes = typeof input.content === 'string' ? new TextEncoder().encode(input.content).length : 0;
      return {
        path: input.path,
        createDirs: input.createDirs,
        contentSize: contentBytes,
        contentSizeKB: Number((contentBytes / 1024).toFixed(1)),
        contentPreview: typeof input.content === 'string' ? input.content.slice(0, 100) + (input.content.length > 100 ? '...' : '') : undefined
      };
    }
    if (toolName === 'web_fs_read') {
      return { path: input?.path, encoding: input?.encoding };
    }
    return input;
  } catch {
    return { sanitizationError: true, originalKeys: Object.keys(input || {}) };
  }
}

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  const { messages, classification }: { messages: UIMessage[], classification?: any } = body;
  
  // Generate session ID for this conversation
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  // Log the incoming user message
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    const content = lastMessage.parts?.map(p => p.type === 'text' ? p.text : '').join('') || '';
    await agentLogger.logMessage(sessionId, lastMessage.id, 'user', content);
  }

  console.log('🔵 [AGENT] Incoming request with messages:', messages.map(m => ({
    role: m.role,
    content: 'content' in m && typeof m.content === 'string' ? (m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content) : '[non-text content]',
    toolCalls: 'toolCalls' in m && Array.isArray(m.toolCalls) ? m.toolCalls.length : 0
  })));

  // Log classification if provided
  if (classification) {
    console.log('🏷️ [AGENT] Using classification:', {
      taskType: classification.taskType,
      toolsCount: classification.availableTools?.length || 0,
      promptSections: classification.promptSections
    });
  }

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

  // Build system prompt based on classification
  let systemPrompt = MAIN_SYSTEM_PROMPT; // Default to full prompt if no classification
  
  if (classification && classification.promptSections) {
    const promptMap: Record<string, string> = {
      'BASE_SYSTEM_PROMPT': BASE_SYSTEM_PROMPT,
      'CREATE_APP_PROMPT': CREATE_APP_PROMPT,
      'EDIT_APP_PROMPT': EDIT_APP_PROMPT,
      'GENERATION_PROMPT': GENERATION_PROMPT,
      'CHAT_PROMPT': CHAT_PROMPT,
      'STYLING_GUIDELINES': STYLING_GUIDELINES,
      'AI_INTEGRATION_PATTERNS': AI_INTEGRATION_PATTERNS,
      'BEST_PRACTICES': BEST_PRACTICES,
    };

    const sections = classification.promptSections
      .map((section: string) => promptMap[section])
      .filter(Boolean);
    
    if (sections.length > 0) {
      systemPrompt = sections.join('\n\n');
    }
  }

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
    // Web search
    [TOOL_NAMES.web_search]: tool({
      description: 'Search the web for current information. ONLY use when the user explicitly requests web search or real-time data—do not use proactively.',
      inputSchema: WebSearchInput,
      async execute({ query }) {
        const startTime = Date.now();
        const toolCallId = `search_${Date.now()}`;
        
        try {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            const error = { error: 'Missing EXA_API_KEY in environment.' };
            await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
            return error;
          }
          
          const exa = new Exa(apiKey);
          const { results } = await exa.searchAndContents(query, {
            livecrawl: 'always',
            numResults: 3,
          } as any);
          
          const output = (results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined,
            publishedDate: r.publishedDate,
          }));
          
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, { results: output.length, data: output }, Date.now() - startTime);
          return output;
        } catch (err: unknown) {
          const error = { error: err instanceof Error ? err.message : String(err) };
          await agentLogger.logError(sessionId, err as Error, { toolName: TOOL_NAMES.web_search, query });
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
          return error;
        }
      },
    }),
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

  // Filter tools based on classification
  let tools: any = allTools;
  if (classification && classification.availableTools && classification.availableTools.length > 0) {
    const allowedTools = new Set(classification.availableTools);
    tools = Object.fromEntries(
      Object.entries(allTools).filter(([toolName]) => allowedTools.has(toolName))
    );
    
    console.log('🔧 [AGENT] Filtered tools:', Object.keys(tools));
  }

  // Track tool call timings to avoid duplicate logging
  const toolCallTimings = new Map<string, number>();

  const result = streamText({
    model: 'alibaba/qwen3-coder',
    providerOptions: {
      gateway: {
        order: ['cerebras', 'alibaba'], // Try Amazon Bedrock first, then Anthropic
      },
    },
    messages: convertToModelMessages(messages),
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
      
      // Track start times for tool calls (for timing)
      if (toolCalls?.length) {
        console.log('🔧 [USAGE-STEP] Tool calls:', toolCalls.map((tc: any) => ({
          name: tc.toolName,
          id: tc.toolCallId?.substring(0, 8),
        })));

        // Record start times for duration tracking
        for (const tc of toolCalls) {
          toolCallTimings.set(tc.toolCallId, Date.now());
        }
      }

      // Log completed tool calls with results and timing
      if (toolResults?.length) {
        for (const result of toolResults) {
          const startTime = toolCallTimings.get(result.toolCallId) || Date.now();
          const duration = Date.now() - startTime;
          
          // Sanitize large content from tool inputs before logging
          const sanitizedInput = sanitizeToolInput(result.toolName || 'unknown', (result as any).args || (result as any).input || {});
          
          await agentLogger.logToolCall(
            sessionId,
            result.toolName || 'unknown',
            result.toolCallId,
            sanitizedInput,
            {
              result: (result as any).result,
              state: (result as any).state,
              isError: (result as any).isError || false,
              errorMessage: (result as any).errorMessage
            },
            duration
          );
          
          // Clean up timing tracking
          toolCallTimings.delete(result.toolCallId);
        }
      }
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
