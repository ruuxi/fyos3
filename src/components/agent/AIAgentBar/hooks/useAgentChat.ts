import { useEffect, useRef } from 'react';
import type React from 'react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type TextUIPart, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';
import { agentLogger } from '@/lib/agentLogger';
import { persistAssetsFromAIResult, extractOriginalMediaUrlsFromResult, type MediaScope } from '@/utils/ai-media';
import { autoIngestInputs } from '@/utils/auto-ingest';
import { guessContentTypeFromFilename } from '@/lib/agent/agentUtils';
import type { TCodeEditAstInput } from '@/lib/agentTools';

type WebContainerFns = {
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  readdirRecursive: (path?: string, maxDepth?: number) => Promise<{ path: string; type: 'file' | 'dir' }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  spawn: (command: string, args?: string[], opts?: { cwd?: string }) => Promise<{ exitCode: number; output: string }>;
};

type UseAgentChatOptions = {
  id: string;
  initialMessages?: UIMessage[];
  activeThreadId: string | null;
  getActiveThreadId?: () => string | null;
  wc: {
    instanceRef: React.MutableRefObject<WebContainerAPI | null>;
    fnsRef: React.MutableRefObject<WebContainerFns>;
  };
  media: {
    loadMedia: () => Promise<void>;
  };
  runValidation: (files?: string[]) => Promise<void>;
  attachmentsProvider?: () => Array<{ name: string; publicUrl: string; contentType: string }>;
  onFirstToolCall?: () => void;
  onToolProgress?: (toolName: string) => void;
};

type WebFsFindInput = {
  root?: string;
  maxDepth?: number;
  glob?: string;
  prefix?: string;
  limit?: number;
  offset?: number;
};

type WebExecInput = {
  command: string;
  args?: string[];
  cwd?: string;
};

type AiGenerateInput = {
  provider: 'fal' | 'eleven';
  task?: 'image' | 'video' | 'music' | 'audio' | '3d';
  input: Record<string, unknown>;
  scope?: MediaScope;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

// Use shared tool input type to ensure selector/payload are correctly typed
type CodeEditAstInput = TCodeEditAstInput;

const isTextPart = (part: UIMessage['parts'][number]): part is TextUIPart => part.type === 'text';

type MutableWindow = Window & {
  __FYOS_FIRST_TOOL_CALLED_REF?: { current: boolean };
};

const getMutableWindow = (): MutableWindow | null => {
  if (typeof window === 'undefined') return null;
  return window as MutableWindow;
};

const AGENT_APP_CREATED_EVENT = 'fyos:agent-app-created';

export function useAgentChat(opts: UseAgentChatOptions) {
  const {
    id,
    initialMessages,
    activeThreadId,
    getActiveThreadId,
    wc,
    runValidation,
    attachmentsProvider,
    onFirstToolCall,
    onToolProgress,
  } = opts;
  const mutableWindow = getMutableWindow();
  const firstToolCalledRef = mutableWindow?.__FYOS_FIRST_TOOL_CALLED_REF ?? { current: false };
  if (mutableWindow) {
    mutableWindow.__FYOS_FIRST_TOOL_CALLED_REF = firstToolCalledRef;
  }

  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);
  const { messages, sendMessage, status, stop, addToolResult, setMessages } = useChat<UIMessage>({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/agent',
      prepareSendMessagesRequest({ messages, id }) {
        const body: {
          id: string;
          messages: UIMessage[];
          threadId?: string;
          attachmentHints?: Array<{ contentType: string; url: string }>;
        } = { id, messages };
        const threadForRequest = typeof getActiveThreadId === 'function'
          ? getActiveThreadId()
          : activeThreadIdRef.current;
        if (threadForRequest) body.threadId = threadForRequest;
        // Include attachment hints so server-side classifier can detect media ops
        try {
          if (typeof attachmentsProvider === 'function') {
            const hints = attachmentsProvider()?.map((attachment) => ({ contentType: attachment.contentType, url: attachment.publicUrl })) || [];
            if (hints.length > 0) body.attachmentHints = hints;
          }
        } catch {}
        return { body };
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const instanceRef = wc.instanceRef;
      const fnsRef = wc.fnsRef;

      // Signal first tool call once per run to allow HMR gating only for tool-using runs
      try {
        if (!firstToolCalledRef.current && typeof onFirstToolCall === 'function') {
          firstToolCalledRef.current = true;
          onFirstToolCall();
        }
      } catch {}

      // Notify UI on each tool call to update progress indicator word
      try {
        if (typeof onToolProgress === 'function') {
          onToolProgress(toolCall.toolName);
        }
      } catch {}

      const waitForInstance = async (timeoutMs = 6000, intervalMs = 120): Promise<WebContainerAPI | null> => {
        const start = Date.now();
        while (!instanceRef.current && Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, intervalMs));
        }
        return instanceRef.current;
      };

      if (!instanceRef.current) {
        await waitForInstance();
      }
      if (!instanceRef.current) {
        addToolResult({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: { error: 'WebContainer is not ready yet. Still initializing, try again in a moment.' } });
        return;
      }

      type AgentToolCall = { toolName: string; toolCallId: string; input: unknown };
      const tc: AgentToolCall = toolCall;

      const startTime = Date.now();
      const logAndAddResult = async (output: unknown) => {
        const duration = Date.now() - startTime;
        addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output });
        try {
          await agentLogger.logToolCall('client', tc.toolName, tc.toolCallId, tc.input, output, duration);
        } catch {}
      };

      try {
        switch (tc.toolName) {
          case 'web_fs_find': {
            const findInput = isPlainObject(tc.input) ? (tc.input as Partial<WebFsFindInput>) : {};
            const { root = '.', maxDepth = 10, glob, prefix, limit = 200, offset = 0 } = findInput;
            const results = await fnsRef.current.readdirRecursive(root, maxDepth);
            const paths = results.map(r => r.path);
            const filterByPrefix = (p: string) => (prefix ? p.startsWith(prefix) : true);
            const globToRegExp = (pattern: string) => {
              let re = '^';
              for (let i = 0; i < pattern.length; i++) {
                const ch = pattern[i];
                if (ch === '*') {
                  if (pattern[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
                } else if (ch === '?') {
                  re += '.';
                } else {
                  re += /[\\.^$+()|{}\[\]\-]/.test(ch) ? `\\${ch}` : ch;
                }
              }
              re += '$';
              return new RegExp(re);
            };
            const regex = glob ? globToRegExp(glob) : null;
            const filterByGlob = (p: string) => (regex ? regex.test(p) : true);
            const filtered = paths.filter((p: string) => filterByPrefix(p) && filterByGlob(p));
            const start = Math.max(0, offset || 0);
            const end = Math.min(filtered.length, start + Math.max(1, Math.min(limit || 200, 5000)));
            const page = filtered.slice(start, end);
            const nextOffset = end < filtered.length ? end : null;
            await logAndAddResult({ files: page, count: page.length, total: filtered.length, root, offset: start, nextOffset, hasMore: end < filtered.length, applied: { glob: !!glob, prefix: !!prefix } });
            break;
          }
          case 'web_fs_read': {
            const { path, encoding = 'utf-8' } = tc.input as { path: string; encoding?: 'utf-8' | 'base64' };
            const content = await fnsRef.current.readFile(path, encoding);
            const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
            await logAndAddResult({ content, path, size: `${sizeKB}KB` });
            break;
          }
          case 'web_fs_write': {
            const { path, content, createDirs = true } = tc.input as { path: string; content: string; createDirs?: boolean };
            const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
            if (createDirs) {
              const dir = path.split('/').slice(0, -1).join('/') || '.';
              await fnsRef.current.mkdir(dir, true);
            }
            await fnsRef.current.writeFile(path, content);
            await logAndAddResult({ ok: true, path, size: `${sizeKB}KB` });
            try {
              const lower = path.toLowerCase();
              const isMedia = /(\.png|\.jpg|\.jpeg|\.webp|\.gif|\.mp3|\.wav|\.m4a|\.aac|\.mp4|\.webm|\.mov)$/i.test(lower);
              if (isMedia) {
                (async () => {
                  try {
                    const base64 = btoa(unescape(encodeURIComponent(content)));
                    const contentType = lower.endsWith('.png') ? 'image/png'
                      : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg'
                      : lower.endsWith('.webp') ? 'image/webp'
                      : lower.endsWith('.gif') ? 'image/gif'
                      : lower.endsWith('.mp3') ? 'audio/mpeg'
                      : lower.endsWith('.wav') ? 'audio/wav'
                      : lower.endsWith('.m4a') ? 'audio/m4a'
                      : lower.endsWith('.aac') ? 'audio/aac'
                      : lower.endsWith('.mp4') ? 'video/mp4'
                      : lower.endsWith('.webm') ? 'video/webm'
                      : lower.endsWith('.mov') ? 'video/quicktime'
                      : undefined;
                    await fetch('/api/media/ingest', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ base64, contentType, metadata: { sourcePath: path } }),
                    });
                  } catch {}
                })();
              }
            } catch {}
            break;
          }
          case 'web_fs_rm': {
            const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
            await fnsRef.current.remove(path, { recursive });
            addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });
            break;
          }
          case 'web_exec': {
            const execInput = (isPlainObject(tc.input) ? tc.input : {}) as Partial<WebExecInput>;
            let { command = '', args = [] } = execInput;
            const { cwd } = execInput;
            const splitCommandLine = (line: string): string[] => {
              const out: string[] = []; let cur = ''; let quote: '"' | "'" | null = null;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (quote) {
                  if (ch === quote) { quote = null; }
                  else if (ch === '\\' && i + 1 < line.length) { i++; cur += line[i]; }
                  else { cur += ch; }
                } else {
                  if (ch === '"' || ch === "'") { quote = ch as '"' | "'"; }
                  else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
                  else if (ch === '\\' && i + 1 < line.length) { i++; cur += line[i]; }
                  else { cur += ch; }
                }
              }
              if (cur) out.push(cur);
              return out;
            };
            if ((!args || args.length === 0) && /\s/.test(command)) {
              const tokens = splitCommandLine(command);
              if (tokens.length > 0) { command = tokens[0]; args = tokens.slice(1); }
            }
            const cmdLower = command.toLowerCase();
            const firstArg = (args[0] || '').toLowerCase();
            const isPkgMgr = /^(pnpm|npm|yarn|bun)$/.test(cmdLower);
            const isInstallLike = /^(add|install|update|remove|uninstall|i)$/i.test(firstArg);
            if (isPkgMgr && isInstallLike) {
              if (cmdLower === 'pnpm' && !args.some(a => a.startsWith('--reporter='))) args = [...args, '--reporter=silent', '--color=false'];
              else if (cmdLower === 'npm' && !args.includes('--silent')) args = [...args, '--silent', '--no-progress', '--color=false'];
              else if (cmdLower === 'yarn' && !args.includes('--silent')) args = [...args, '--silent', '--no-progress', '--color=false'];
              else if (cmdLower === 'bun' && !args.includes('--silent')) args = [...args, '--silent'];
            }
            const fullCommand = `${command} ${args.join(' ')}`.trim();
            const result = await fnsRef.current.spawn(command, args, { cwd });
            const isPkgMgrCmd = /(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update)/i.test(fullCommand);
            const maxChars = 8000; const maxLines = 120;
            const lastLines = (s: string, n: number) => s.split(/\r?\n/).slice(Math.max(0, s.split(/\r?\n/).length - n)).join('\n');
            const trimChars = (s: string) => (s.length > maxChars ? `${s.slice(0, 2000)}\n...\n${s.slice(-6000)}` : s);
            if (isPkgMgrCmd) {
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { command: fullCommand, exitCode: result.exitCode, ok: result.exitCode === 0, outputTail: trimChars(lastLines(result.output, maxLines)) } });
            } else {
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { command: fullCommand, exitCode: result.exitCode, output: trimChars(result.output), cwd } });
            }
            break;
          }
          case 'validate_project': {
            const { files = [] } = tc.input as { files?: string[] };
            await runValidation(files);
            addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, files } });
            break;
          }
          case 'ai_generate': {
            const generateInput = tc.input as AiGenerateInput;
            const { provider, task, input, scope } = generateInput;
            try {
              const { processedInput, ingestedCount } = await autoIngestInputs(input, scope);
              if (provider === 'fal') {
                const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const res = await fetch('/api/ai/fal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: processedInput, task, requestId }) });
                if (!res.ok) throw new Error(`FAL API error: ${res.status} ${res.statusText}`);
                const json = await res.json();
                // Immediately surface provider URLs for inline rendering (ephemeral)
                try {
                  const originals = extractOriginalMediaUrlsFromResult(json);
                  const ephemeralAssets = originals.map(({ url }) => {
                    const fileName = url.split('#')[0].split('?')[0].split('/').pop() || '';
                    const ct = guessContentTypeFromFilename(fileName);
                    return { publicUrl: url, contentType: ct };
                  });
                  if (ephemeralAssets.length > 0) {
                    addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, ephemeralAssets } });
                  }
                } catch {}
                // Enrich scope with threadId/requestId for ingestion tracking
                const enrichedScope: MediaScope & { threadId?: string; requestId: string } = {
                  ...(scope ?? {}),
                  threadId: activeThreadId ?? undefined,
                  requestId,
                };
                const { result: updated, persistedAssets } = await persistAssetsFromAIResult(json, enrichedScope);
                addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, result: updated, persistedAssets, autoIngestedCount: ingestedCount } });
              } else if (provider === 'eleven') {
                const res = await fetch('/api/ai/eleven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(processedInput) });
                if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${res.statusText}`);
                const json = await res.json();
                const { result: updated, persistedAssets } = await persistAssetsFromAIResult(json, scope);
                addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, result: updated, persistedAssets, autoIngestedCount: ingestedCount } });
              } else {
                throw new Error(`Unsupported provider: ${String(provider)}`);
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { error: message } });
            }
            break;
          }
          case 'media_list': {
            const input = tc.input as { type?: string; appId?: string; desktopId?: string; from?: string; to?: string; limit?: number };
            try {
              const params = new URLSearchParams();
              if (input.type) params.set('type', input.type);
              if (input.appId) params.set('appId', input.appId);
              if (input.desktopId) params.set('desktopId', input.desktopId);
              if (input.from) params.set('from', input.from);
              if (input.to) params.set('to', input.to);
              if (input.limit) params.set('limit', input.limit.toString());
              const res = await fetch(`/api/media/list?${params.toString()}`);
              if (!res.ok) throw new Error(`Media list error: ${res.status} ${res.statusText}`);
              const result = await res.json();
              addToolResult({ tool: 'media_list', toolCallId: tc.toolCallId, output: { items: result.items || [] } });
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              addToolResult({ tool: 'media_list', toolCallId: tc.toolCallId, output: { error: message } });
            }
            break;
          }
          case 'code_edit_ast': {
            const input = tc.input as CodeEditAstInput;
            try {
              const content = await fnsRef.current.readFile(input.path, 'utf-8');
              const { applyAstEdit } = await import('@/lib/code-edit/recastEdit');
              const result = await applyAstEdit({ ...input, content });
              if (result.applied) {
                await fnsRef.current.writeFile(input.path, result.code);
              }
              addToolResult({ tool: 'code_edit_ast', toolCallId: tc.toolCallId, output: { ok: true, applied: result.applied, edits: result.edits, previewDiff: result.previewDiff, path: input.path, elapsedMs: result.elapsedMs, bytesChanged: result.applied ? Math.abs(result.code.length - content.length) : 0 } });
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              addToolResult({ tool: 'code_edit_ast', toolCallId: tc.toolCallId, output: { ok: false, error: message, path: input.path } });
            }
            break;
          }
          case 'app_manage': {
            const { action, id: requestedId, name, icon } = tc.input as { action: 'create'|'rename'|'remove'; id: string; name?: string; icon?: string };
            if (action === 'create') {
              const id = requestedId;
              if (!name) throw new Error('app_manage.create requires name');
              let registry: Array<{ id: string; name: string; icon?: string; path: string }> = [];
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                registry = JSON.parse(regRaw);
              } catch {}
              let finalName = name;
              let finalId = id;
              const existingNames = new Set(registry.map(app => app.name));
              const existingIds = new Set(registry.map(app => app.id));
              let counter = 1;
              while (existingNames.has(finalName)) { finalName = `${name} (${counter})`; counter++; }
              counter = 1;
              while (existingIds.has(finalId)) { finalId = `${id}-${counter}`; counter++; }
              const base = `src/apps/${finalId}`;
              await fnsRef.current.mkdir(base, true);
              const metadata = { id: finalId, name: finalName, icon: icon ?? '📦', createdAt: Date.now() } as const;
              await fnsRef.current.writeFile(`${base}/metadata.json`, JSON.stringify(metadata, null, 2));
              const appIndexTsx = `import React from 'react'\nimport '/src/tailwind.css'\nimport './styles.css'\nexport default function App(){\n  return (\n    <div className=\"h-full overflow-auto bg-gradient-to-b from-white to-slate-50\">\n      <div className=\"sticky top-0 bg-white/80 backdrop-blur border-b px-3 py-2\">\n        <div className=\"font-semibold tracking-tight\">${finalName}</div>\n      </div>\n      <div className=\"p-3 space-y-3\">\n        <div className=\"rounded-lg border bg-white shadow-sm p-3\">\n          <p className=\"text-slate-600 text-sm\">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>\n        </div>\n      </div>\n    </div>\n  )\n}`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              const appStylesCss = `/* App-specific theme variables */\n:root {\n  --app-accent: #22c55e;\n  --app-secondary: #64748b;\n  --app-background: #ffffff;\n  --app-surface: #f8fafc;\n  --app-border: #e2e8f0;\n  --app-text: #1e293b;\n  --app-text-muted: #64748b;\n  --app-hover: #16a34a;\n}\n\n/* Base app styling */\nbody {\n  font-family: Inter, ui-sans-serif, system-ui, Arial, sans-serif;\n}\n\n/* App-specific utility classes */\n.app-button {\n  background: var(--app-accent);\n  color: white;\n  transition: all 0.2s ease;\n}\n\n.app-button:hover {\n  background: var(--app-hover);\n  transform: translateY(-1px);\n}\n\n.app-surface {\n  background: var(--app-surface);\n  border: 1px solid var(--app-border);\n}\n\n/* Links */\na {\n  color: var(--app-accent);\n  text-decoration: none;\n}\n\n.a:hover {\n  color: var(--app-hover);\n  text-decoration: underline;\n}`;
              await fnsRef.current.writeFile(`${base}/styles.css`, appStylesCss);
              const registryEntry = { id: finalId, name: finalName, icon: metadata.icon, path: `/${base}/index.tsx` };
              registry.push(registryEntry);
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              if (typeof window !== 'undefined') {
                try {
                  window.dispatchEvent(new CustomEvent(AGENT_APP_CREATED_EVENT, { detail: registryEntry }));
                } catch {}
              }
              // Auto-open of newly created app has been removed to avoid mid-run UI changes
              // The desktop will reflect the new app via registry refresh.
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, id: finalId, name: finalName, base } });
              break;
            }
            if (action === 'rename') {
              const { id, name: newName } = tc.input as { action: 'rename'; id: string; name: string };
              const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
              const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>;
              const idx = registry.findIndex((r) => r.id === id);
              if (idx === -1) { addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: false, error: `App not found: ${id}` } }); break; }
              const oldName = registry[idx].name;
              registry[idx].name = newName;
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, id, oldName, newName } });
              break;
            }
            if (action === 'remove') {
              const { id } = tc.input as { action: 'remove'; id: string };
              let reg: Array<{ id: string; name: string; icon?: string; path: string }> = []; let appName = 'Unknown';
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                reg = JSON.parse(regRaw);
                const app = reg.find(r => r.id === id); if (app) appName = app.name;
              } catch {}
              const next = reg.filter((r) => r.id !== id);
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(next, null, 2));
              const p1 = `src/apps/${id}`; const p2 = `src/apps/app-${id}`;
              try { await fnsRef.current.remove(p1, { recursive: true }); } catch {}
              try { await fnsRef.current.remove(p2, { recursive: true }); } catch {}
              addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, id, name: appName, removedPaths: [p1, p2] } });
              break;
            }
            addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: false, error: `Unsupported action: ${String(action)}` } });
            break;
          }
          default: {
            await logAndAddResult({ error: `Unhandled client tool: ${tc.toolName}` });
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await logAndAddResult({ error: message });
      }
    },
  });


    const initialMessagesSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!Array.isArray(initialMessages)) return;
    const signature = JSON.stringify(
      initialMessages.map(m => ({
        id: m?.id,
        role: m?.role,
        text: Array.isArray(m?.parts)
          ? m.parts.filter(isTextPart).map((part) => part.text).join('')
          : '',
      }))
    );
    if (signature === initialMessagesSignatureRef.current) return;
    initialMessagesSignatureRef.current = signature;
    setMessages(initialMessages);
  }, [initialMessages, setMessages]);

  return { messages, sendMessage, status, stop, addToolResult } as const;
}
