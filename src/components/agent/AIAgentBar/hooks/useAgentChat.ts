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
import { parse, type ParserPlugin } from '@babel/parser';

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
  runValidation: (scope: 'quick' | 'full', files?: string[]) => Promise<void>;
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

const SYNTAX_CHECKABLE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);
const MAX_SYNTAX_CHECK_BYTES = 600_000;
const BABEL_BASE_PLUGINS: ParserPlugin[] = [
  'jsx',
  'classProperties',
  'classPrivateProperties',
  'dynamicImport',
  'decorators-legacy',
  'topLevelAwait',
  'typescript',
];

const deriveExtension = (path: string): string => {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
};

const shouldSyntaxCheck = (path: string, byteLength: number): boolean => {
  if (byteLength > MAX_SYNTAX_CHECK_BYTES) return false;
  const ext = deriveExtension(path);
  return SYNTAX_CHECKABLE_EXTENSIONS.has(ext);
};

const syntaxCheckSource = (path: string, content: string, byteLength: number): { ok: true } | { ok: false; error: string } => {
  if (!shouldSyntaxCheck(path, byteLength)) {
    return { ok: true };
  }
  try {
    parse(content, {
      sourceType: 'unambiguous',
      plugins: BABEL_BASE_PLUGINS,
      errorRecovery: false,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown syntax error';
    return { ok: false, error: message };
  }
};

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
            const encoder = new TextEncoder();
            const byteLength = encoder.encode(content).length;
            const sizeKB = (byteLength / 1024).toFixed(1);
            if (createDirs) {
              const dir = path.split('/').slice(0, -1).join('/') || '.';
              await fnsRef.current.mkdir(dir, true);
            }
            const syntaxResult = syntaxCheckSource(path, content, byteLength);
            if (!syntaxResult.ok) {
              await logAndAddResult({
                ok: false,
                path,
                error: `Syntax check failed, file unchanged: ${syntaxResult.error}`,
                deferred: true,
              });
              break;
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
            const { scope = 'quick', files = [] } = tc.input as { scope?: 'quick' | 'full'; files?: string[] };
            await runValidation(scope, files);
            addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { ok: true, scope, files } });
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
              const appIndexTsx = `import React from 'react'\nimport './styles.css'\n\nexport default function App(){\n  return (\n    <div className=\"h-full overflow-y-auto bg-slate-950 text-slate-100\">\n      <div className=\"mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-6 py-10\">\n        <header className=\"app-glass flex flex-col gap-6 md:flex-row md:items-center md:justify-between\">\n          <div className=\"space-y-3\">\n            <span className=\"inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-300\">Tailwind ready</span>\n            <h1 className=\"text-3xl font-semibold tracking-tight text-white\">${finalName}</h1>\n            <p className=\"max-w-2xl text-sm text-slate-300\">Tailwind CSS is already wired up inside this workspace. Drop your components here, remix the layout, and keep what you love.</p>\n          </div>\n          <div className=\"flex flex-wrap gap-3\">\n            <button type=\"button\" className=\"app-primary-btn\">Primary action</button>\n            <button type=\"button\" className=\"app-secondary-btn\">Secondary</button>\n          </div>\n        </header>\n\n        <main className=\"app-main\">\n          <section className=\"app-glass space-y-4\">\n            <div>\n              <h2 className=\"app-section-title\">Quick overview</h2>\n              <p className=\"app-section-subtitle\">Swap these cards for your real content. They exist to show off the depth, spacing, and glassmorphism defaults.</p>\n            </div>\n            <div className=\"app-grid\">\n              <article className=\"app-card\">\n                <h3 className=\"text-lg font-semibold text-white\">Drop in widgets</h3>\n                <p className=\"text-sm text-slate-300\">Use the utility classes directly in JSX or create patterns in <code className=\"rounded bg-white/10 px-1.5 py-0.5 text-xs\">styles.css</code> with <code className=\"font-mono text-xs\">@apply</code>.</p>\n              </article>\n              <article className=\"app-card\">\n                <h3 className=\"text-lg font-semibold text-white\">Focus on flow</h3>\n                <p className=\"text-sm text-slate-300\">The shell already handles sticky headers, responsive breathing room, and smooth scroll areas.</p>\n              </article>\n              <article className=\"app-card\">\n                <h3 className=\"text-lg font-semibold text-white\">Ship the vibe</h3>\n                <p className=\"text-sm text-slate-300\">Lean into gradients, neon borders, or whatever fits—Tailwind ships the tokens, you bring the taste.</p>\n              </article>\n            </div>\n          </section>\n\n          <section className=\"app-glass space-y-4\">\n            <div>\n              <h2 className=\"app-section-title\">Suggested next steps</h2>\n              <p className=\"app-section-subtitle\">Keep or toss this list. It’s just a gentle nudge toward building something sick.</p>\n            </div>\n            <ul className=\"app-list\">\n              <li>Wire up real data or fake it with fixtures.</li>\n              <li>Swap the CTA buttons for actions that matter.</li>\n              <li>Layer in media, charts, or anything wild.</li>\n            </ul>\n          </section>\n        </main>\n      </div>\n    </div>\n  )\n}`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              const appStylesCss = `@tailwind components;

@layer components {
  .app-main {
    @apply space-y-6;
  }

  .app-glass {
    @apply rounded-3xl border border-white/10 bg-white/10 p-6 shadow-sim-xl backdrop-blur-2xl transition hover:border-white/20 hover:bg-white/15;
  }

  .app-primary-btn {
    @apply inline-flex items-center justify-center rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.35)] transition hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300;
  }

  .app-secondary-btn {
    @apply inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-100/90 transition hover:border-white/40 hover:text-white;
  }

  .app-section-title {
    @apply text-lg font-semibold text-white;
  }

  .app-section-subtitle {
    @apply text-sm text-slate-300;
  }

  .app-card {
    @apply rounded-2xl border border-white/15 bg-white/[0.08] p-5 transition hover:border-white/30 hover:bg-white/[0.12];
  }

  .app-grid {
    @apply grid gap-4 md:grid-cols-2 xl:grid-cols-3;
  }

  .app-list {
    @apply list-disc space-y-2 pl-6 text-sm text-slate-200/90;
  }
}
`;
              await fnsRef.current.writeFile(`${base}/styles.css`, appStylesCss);
              registry.push({ id: finalId, name: finalName, icon: metadata.icon, path: `/${base}/index.tsx` });
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
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
