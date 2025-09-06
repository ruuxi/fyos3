import { convertToModelMessages, streamText, UIMessage, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import {
  TOOL_NAMES,
  FSFindInput,
  FSReadInput,
  FSWriteInput,
  FSMkdirInput,
  FSRmInput,
  ExecInput,
  CreateAppInput,
  RenameAppInput,
  RemoveAppInput,
  ValidateProjectInput,
  SubmitPlanInput,
  WebSearchInput,
} from '@/lib/agentTools';
import Exa from 'exa-js';

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log('🔵 [AGENT] Incoming request with messages:', messages.map(m => ({
    role: m.role,
    content: 'content' in m && typeof m.content === 'string' ? (m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content) : '[non-text content]',
    toolCalls: 'toolCalls' in m && Array.isArray(m.toolCalls) ? m.toolCalls.length : 0
  })));

  const result = streamText({
    model: 'alibaba/qwen3-coder',
    providerOptions: {
      gateway: {
        order: ['cerebras', 'alibaba'], // Try Amazon Bedrock first, then Anthropic
      },
    },
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(15),
    onFinish: (event) => {
      console.log('🎯 [AI] Response finished:', {
        finishReason: event.finishReason,
        usage: event.usage,
        text: event.text?.length > 200 ? event.text.substring(0, 200) + '...' : event.text,
        toolCalls: event.toolCalls?.length || 0,
        toolResults: event.toolResults?.length || 0
      });

      if (event.toolCalls?.length) {
        console.log('🔧 [AI] Tool calls made:', event.toolCalls.map((tc: any) => ({
          name: tc.toolName,
          input: tc.input ?? tc.args,
          id: tc.toolCallId?.substring(0, 8)
        })));
        
        // Log file operation details
        event.toolCalls.forEach((tc: any) => {
          if (tc.toolName.startsWith('web_fs_') || ['create_app', 'remove_app', 'rename_app'].includes(tc.toolName)) {
            const args = tc.input || tc.args || {};
            switch (tc.toolName) {
              case 'web_fs_write':
                console.log(`📝 [AI-Tool] WRITE: ${args.path} (${args.content?.length || 0} chars)`);
                break;
              case 'web_fs_read':
                console.log(`👁️ [AI-Tool] READ: ${args.path}`);
                break;
              case 'web_fs_mkdir':
                console.log(`📁 [AI-Tool] MKDIR: ${args.path}`);
                break;
              case 'web_fs_rm':
                console.log(`🗑️ [AI-Tool] REMOVE: ${args.path}`);
                break;
              case 'create_app':
                console.log(`🆕 [AI-Tool] CREATE_APP: "${args.name}" (${args.icon || '📦'})`);
                break;
              case 'remove_app':
                console.log(`❌ [AI-Tool] REMOVE_APP: ${args.id}`);
                break;
              case 'rename_app':
                console.log(`✏️ [AI-Tool] RENAME_APP: ${args.id} -> "${args.name}"`);
                break;
            }
          }
        });
      }

      if (event.toolResults?.length) {
        console.log('📋 [AI] Tool results received:', event.toolResults.map((tr: any) => ({
          name: tr.toolName,
          success: !tr.result?.error,
          id: tr.toolCallId?.substring(0, 8)
        })));
        
        // Log file operation results
        event.toolResults.forEach((tr: any) => {
          if (tr.toolName.startsWith('web_fs_') || ['create_app', 'remove_app', 'rename_app'].includes(tr.toolName)) {
            const result = tr.result || {};
            if (result.error) {
              console.error(`❌ [AI-Result] ${tr.toolName.toUpperCase()} FAILED:`, result.error);
            } else {
              switch (tr.toolName) {
                case 'web_fs_write':
                  console.log(`✅ [AI-Result] WRITE SUCCESS: ${result.path} (${result.size || 'unknown size'})`);
                  break;
                case 'web_fs_read':
                  console.log(`✅ [AI-Result] READ SUCCESS: ${result.path} (${result.size || 'unknown size'})`);
                  break;
                case 'create_app':
                  console.log(`✅ [AI-Result] APP CREATED: "${result.name}" at ${result.path}`);
                  break;
                case 'remove_app':
                  console.log(`✅ [AI-Result] APP REMOVED: "${result.name}" (${result.id})`);
                  break;
                case 'rename_app':
                  console.log(`✅ [AI-Result] APP RENAMED: "${result.oldName}" -> "${result.newName}"`);
                  break;
              }
            }
          }
        });
      }
    },
    system:
      [
        'You are a proactive engineering agent operating inside a WebContainer-powered workspace.',
        'You can read and modify files, create apps, and run package installs/commands. Never run dev, build, or start server commands.',
        'Project is a Vite React app: source in src/, public assets in public/.',
        'When creating apps: provide a kebab-case id (e.g., "notes-app", "calculator") and place code in src/apps/<id>/index.tsx. The system will automatically handle duplicate names by adding "(1)", "(2)" etc.',
        'STYLING & LAYOUT: Apps run inside a resizable desktop window in an iframe. The iframe passes Tailwind + desktop UI CSS; base CSS is disabled. Your component should fill the available height and scroll internally. Always wrap content in a full-height container (e.g., <div class="h-full overflow-auto">). Prefer Tailwind utilities; avoid injecting global CSS.',
        'WINDOW AWARENESS: Assume the app is mounted within a window of ~600x380 by default and may be resized smaller. Avoid fixed viewport units for height; use flex or h-full and internal scrolling. Keep sticky headers within the app, not the top window. Do not rely on window.top styling.',
        'HOW TO USE AI IN APPS:\n- Image (FAL): import { callFluxSchnell } from "/src/ai"; await callFluxSchnell({ prompt: "a cat photo" }).\n- Explicit model: import { callFal } from "/src/ai"; await callFal("fal-ai/flux-1/schnell", { prompt: "..." }).\n- Music (ElevenLabs): import { composeMusic } from "/src/ai"; await composeMusic({ prompt: "intense electronic track", musicLengthMs: 60000 }).\nThese route through the message bridge and server proxies (/api/ai/fal, /api/ai/eleven); keys stay on the server.',
        'Prefer enhancing an existing app if it matches the requested name (e.g., Notes) rather than creating a duplicate; ask for confirmation before duplicating.',
        'When you need dependencies, use the web_exec tool to run package manager commands (e.g., pnpm add <pkg>, pnpm install). Wait for the web_exec result (which includes exitCode) before proceeding to the next step.',
        'If an install command fails (non-zero exitCode), report the error and suggest a fix or an alternative.'
      ].join(' '),
    tools: {
      // Step 1 – file discovery
      [TOOL_NAMES.web_fs_find]: {
        description: 'List files and folders recursively starting at a directory.',
        inputSchema: FSFindInput,
      },
      // File reads
      [TOOL_NAMES.web_fs_read]: {
        description: 'Read a file from the filesystem.',
        inputSchema: FSReadInput,
      },
      // Writes and mkdirs
      [TOOL_NAMES.web_fs_write]: {
        description: 'Write file contents. Creates parent directories when needed.',
        inputSchema: FSWriteInput,
      },
      [TOOL_NAMES.web_fs_mkdir]: {
        description: 'Create a directory (optionally recursive).',
        inputSchema: FSMkdirInput,
      },
      [TOOL_NAMES.web_fs_rm]: {
        description: 'Remove a file or directory (recursive by default).',
        inputSchema: FSRmInput,
      },
      // Process execution
      [TOOL_NAMES.web_exec]: {
        description: 'Run shell commands. Prefer pnpm for installs. Never run dev/build/start.',
        inputSchema: ExecInput,
      },
      // High-level: create app folder structure with custom id
      [TOOL_NAMES.create_app]: {
        description: 'Create a new app under src/apps/<id> + update public/apps/registry.json.',
        inputSchema: CreateAppInput,
      },
      // Update registry: rename an app by id
      [TOOL_NAMES.rename_app]: {
        description: 'Rename an app in public/apps/registry.json by id.',
        inputSchema: RenameAppInput,
      },
      // Remove an app from disk and registry
      [TOOL_NAMES.remove_app]: {
        description: 'Remove an app folder and its registry entry by id.',
        inputSchema: RemoveAppInput,
      },
      // Validate project health (typecheck/lint/build quick checks)
      [TOOL_NAMES.validate_project]: {
        description:
          'Run validation checks (TypeScript noEmit; optionally ESLint on files; full also runs build).',
        inputSchema: ValidateProjectInput,
      },
      // Planning helper – capture a plan before execution
      [TOOL_NAMES.submit_plan]: tool({
        description: 'Submit a structured execution plan before making changes.',
        inputSchema: SubmitPlanInput,
        async execute({ steps }) {
          console.log('🛠️ [TOOL] submit_plan executed with steps:', steps);
          const result = { accepted: true, steps };
          console.log('✅ [TOOL] submit_plan result:', result);
          return result;
        },
      }),

      // Web search with Exa (server-side tool)
      [TOOL_NAMES.web_search]: tool({
        description: 'Search the web for up-to-date information.',
        inputSchema: WebSearchInput,
        async execute({ query }) {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            return { error: 'Missing EXA_API_KEY in environment.' };
          }
          try {
            const exa = new Exa(apiKey);
            const { results } = await exa.searchAndContents(query, {
              livecrawl: 'always',
              numResults: 3,
            } as any);
            return (results || []).map((r: any) => ({
              title: r.title,
              url: r.url,
              content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined,
              publishedDate: r.publishedDate,
            }));
          } catch (err: unknown) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
      }),
    },
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
