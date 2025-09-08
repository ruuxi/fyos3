import { convertToModelMessages, streamText, UIMessage, stepCountIs, tool, generateText } from 'ai';
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

  // Classifier mode: return one-word label ("create" | "chat") for the latest user message
  const classifyMode = new URL(req.url).searchParams.get('classify') === '1' || new URL(req.url).searchParams.get('mode') === 'classify';
  if (classifyMode) {
    // Use only the latest user message for classification
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = (lastUser && typeof (lastUser as any).content === 'string') ? (lastUser as any).content : '';
    try {
      const result = await generateText({
        model: 'google/gemini-2.0-flash',
        temperature: 0.1,
        system: [
          'You are a strict classifier. Output exactly one lowercase word: create or chat.',
          'Output create only if the user is asking to create, make, or edit an app.',
          'Otherwise output chat. No punctuation, no extra words. Chat refers to anything else.'
        ].join(' '),
        prompt: userText || ' ',
      });
      const raw = (result.text || '').trim().toLowerCase();
      const label = raw.startsWith('create') ? 'create' : 'chat';
      return new Response(JSON.stringify({ label }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err: unknown) {
      return new Response(JSON.stringify({ label: 'chat', error: err instanceof Error ? err.message : String(err) }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    }
  }

  // Persona-only mode: returns a parallel, personality-driven stream that does not use tools
  const url = new URL(req.url);
  const personaMode = url.searchParams.get('persona') === '1' || url.searchParams.get('mode') === 'persona';
  if (personaMode) {
    const personaSystem = [
      'You are "Sim", an edgy teen persona who chats with the user.',
      'Respond to the user accordingly with your personality, feel free to chat normally.',
      'If the user requests something: narrate what you\'re doing as if you\'re handling their request, with sarcastic, confident teen energy.',
      'NEVER output code, commands, or file paths. Never use backticks or code blocks. No tool calls. No XML or JSON.',
      'Keep it short, vivid, and conversational. It\'s okay to be playful or a little sassy.',
      'Focus on progress and outcomes (e.g., "fine, I\'m wiring up your app"), not the technical details.',
      'Avoid technical jargon like components, functions, build, TypeScript, or APIs. Say things like "hooking things up", "tuning it", "giving it a glow-up" instead.',
      'If the user asks for code or implementation details, just say thats not your job and someone else is handling that.',
    ].join(' ');

    // Only provide user messages as context; ignore assistant/tool messages entirely
    const personaMessages = messages.filter(m => m.role === 'user');

    const result = streamText({
      model: 'google/gemini-2.0-flash',
      messages: convertToModelMessages(personaMessages),
      system: personaSystem,
    });

    console.log('📤 [PERSONA] Returning streaming response');
    return result.toUIMessageStreamResponse();
  }

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
    system: `# WebContainer Engineering Agent

## Role & Capabilities
You are a proactive engineering agent operating inside a **WebContainer-powered workspace**. You can:
- Read and modify files
- Create apps and manage project structure
- Run package installs and commands
- **Never run dev, build, or start server commands**

## Project Structure
- **Vite React App**: Source in \`src/\`, public assets in \`public/\`
- **App Creation**: Provide kebab-case id (e.g., "notes-app", "calculator") and place code in \`src/apps/<id>/index.tsx\`
- **Duplicate Handling**: System automatically adds "(1)", "(2)" etc. for duplicate names

## Styling & Layout Guidelines

### Window Context
- Apps run inside **resizable desktop windows** in an iframe (~600x380 default, may resize smaller)
- Iframe passes Tailwind + desktop UI CSS; base CSS is disabled
- **Always wrap content** in full-height container: \`<div class="h-full overflow-auto">\`
- Avoid fixed viewport units for height; use flex or h-full with internal scrolling
- Keep sticky headers within the app, not the top window
- Do not rely on window.top styling

### Component Library
**Available shadcn/ui components:**
- Button, Badge, Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- DropdownMenu, Input, Select, Tabs, Textarea

**Import syntax:** \`import { Button } from "@/components/ui/button"\`

**Adding new components:** Use \`web_exec\` with \`pnpm dlx shadcn@latest add [component-name]\`

**Avoid:** Injecting global CSS

## AI Integration in Apps

### Image Generation (FAL)
\`\`\`typescript
import { callFluxSchnell } from "/src/ai";
await callFluxSchnell({ prompt: "a cat photo" });
\`\`\`

### Custom Model Calls
\`\`\`typescript
import { callFal } from "/src/ai";
await callFal("fal-ai/flux-1/schnell", { prompt: "..." });
\`\`\`

### Music Generation (ElevenLabs)
\`\`\`typescript
import { composeMusic } from "/src/ai";
await composeMusic({ 
  prompt: "intense electronic track", 
  musicLengthMs: 60000 
});
\`\`\`

**Note:** These route through message bridge and server proxies (/api/ai/fal, /api/ai/eleven); API keys stay secure on the server.

## Best Practices

### App Management
- **Prefer enhancing** existing apps if they match the requested name (e.g., Notes) rather than creating duplicates
- Ask for confirmation before duplicating apps

### Package Management
- Use \`web_exec\` tool for package manager commands (e.g., \`pnpm add <pkg>\`, \`pnpm install\`)
- **Wait for web_exec result** (includes exitCode) before proceeding
- If install fails (non-zero exitCode), report error and suggest fixes or alternatives

### Development Workflow
- Use [[memory:7440552]] pnpm as the preferred package manager
- Focus on creating functional, responsive apps within the window constraints
- Ensure proper error handling and user feedback`,
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
