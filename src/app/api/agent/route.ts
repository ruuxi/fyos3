import { convertToModelMessages, streamText, UIMessage, stepCountIs, tool } from 'ai';
import { z } from 'zod';

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
        order: ['cerebras', 'alibaba'],
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
          args: tc.args,
          id: tc.toolCallId?.substring(0, 8)
        })));
        
        // Log file operation details
        event.toolCalls.forEach((tc: any) => {
          if (tc.toolName.startsWith('web_fs_') || ['create_app', 'remove_app', 'rename_app'].includes(tc.toolName)) {

            const args = tc.args || {};
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
        '',
        'CRITICAL: When the user asks to create or change an app, you MUST use the available tools to implement the request. Do not respond with text-only in these cases. Give a one-line acknowledgment, then immediately call tools to do the work.',
        '',
        'Available tools (executed client-side):',
        '- web_fs_find, web_fs_read, web_fs_write, web_fs_mkdir, web_fs_rm — for file discovery and edits',
        '- web_exec — for package manager commands only (e.g., pnpm add <pkg>)',
        '- create_app, rename_app, remove_app — app scaffolding and registry updates',
        '- validate_project — quick TypeScript/ESLint checks (and optional build on full)',
        '- submit_plan — optional planning helper',
        '',
        'Project context:',
        '- Desktop runtime is a Vite React app inside a WebContainer iframe',
        '- Apps live at src/apps/<id>/index.tsx and are registered in public/apps/registry.json',
        '- Styling via Tailwind utilities only; avoid new CSS files unless essential',
        '',
        'Flow you must follow for build/edit requests:',
        '1) Brief acknowledgment (one short sentence).',
        '2) Immediately call the appropriate tools to make concrete changes (scaffold app, write files, install deps if needed).',
        '3) After non-trivial edits, call validate_project.',
        '4) Conclude with a brief success line. Do not expose technical details or file paths to the user.',
        '',
        'Never run dev/build/start servers. Use non-interactive flags for package managers. Prefer enhancing an existing app over duplicating when names collide.',
        '',
        'For AI features inside apps, use the provided helpers from "/src/ai": callFal, callFluxSchnell, composeMusic (they proxy to server routes and keep keys on the server).',
      ].join('\n'),
    tools: {
      // Step 1 – file discovery
      web_fs_find: {
        description: 'List files and folders recursively within the WebContainer workdir.',
        inputSchema: z.object({
          root: z.string().default('.').describe('Root path to start listing'),
          maxDepth: z.number().min(0).max(20).default(10),
        }),
      },
      // File reads
      web_fs_read: {
        description: 'Read a file from the WebContainer filesystem.',
        inputSchema: z.object({
          path: z.string().describe('Absolute or relative file path'),
          encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
        }),
      },
      // Writes and mkdirs
      web_fs_write: {
        description: 'Write file contents to a path. Creates folders if needed.',
        inputSchema: z.object({
          path: z.string(),
          content: z.string().describe('Full new file content'),
          createDirs: z.boolean().optional().default(true),
        }),
      },
      web_fs_mkdir: {
        description: 'Create a directory (optionally recursive).',
        inputSchema: z.object({
          path: z.string(),
          recursive: z.boolean().optional().default(true),
        }),
      },
      web_fs_rm: {
        description: 'Remove a file or directory (recursive by default).',
        inputSchema: z.object({
          path: z.string(),
          recursive: z.boolean().optional().default(true),
        }),
      },
      // Process execution
      web_exec: {
        description:
          'Install a package (e.g. pnpm add <pkg>).',
        inputSchema: z.object({
          command: z.string(),
          args: z.array(z.string()).optional().default([]),
          cwd: z.string().optional(),
        }),
      },
      // High-level: create app folder structure with custom id
      create_app: {
        description:
          'Create a new app in apps/<id> with metadata and an icon. Provide a suitable id based on the app name.',
        inputSchema: z.object({
          id: z.string().describe('App id (should be kebab-case based on app name, e.g. "notes-app", "calculator")'),
          name: z.string().describe('Display name of the app'),
          icon: z.string().optional().describe('Icon character or SVG string'),
        }),
      },
      // Update registry: rename an app by id
      rename_app: {
        description: 'Rename an app in registry.json by id.',
        inputSchema: z.object({
          id: z.string().describe('App id to rename'),
          name: z.string().describe('New display name'),
        }),
      },
      // Remove an app from disk and registry
      remove_app: {
        description: 'Remove an app from apps/<id> (or app-<id>) and registry.json by id.',
        inputSchema: z.object({
          id: z.string().describe('App id to remove'),
        }),
      },
      // Validate project health (typecheck/lint/build quick checks)
      validate_project: {
        description:
          'Run validation checks on the project (TypeScript noEmit, and optionally ESLint on specific files). Use\nafter non-trivial edits.',

        inputSchema: z.object({
          scope: z.enum(['quick', 'full']).optional().default('quick'),
          files: z.array(z.string()).optional().describe('Files to lint specifically (optional)'),
        }),
      },
      // Planning helper – capture a plan before execution
      submit_plan: tool({
        description: 'Submit a structured execution plan before making changes.',
        inputSchema: z.object({ steps: z.array(z.string()) }),
        async execute({ steps }) {
          console.log('🛠️ [TOOL] submit_plan executed with steps:', steps);
          const result = { accepted: true, steps };
          console.log('✅ [TOOL] submit_plan result:', result);
          return result;
        },
      }),
    },
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
