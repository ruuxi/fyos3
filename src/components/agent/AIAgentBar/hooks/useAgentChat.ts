import { useEffect, useRef } from 'react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type TextUIPart, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';
import { agentLogger } from '@/lib/agentLogger';
import { persistAssetsFromAIResult, extractOriginalMediaUrlsFromResult, type MediaScope } from '@/utils/ai-media';
import { autoIngestInputs } from '@/utils/auto-ingest';
import { guessContentTypeFromFilename } from '@/lib/agent/agentUtils';
import type { TCodeEditAstInput, TWebFsReadInput } from '@/lib/agentTools';

type WebContainerFns = {
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  readdirRecursive: (path?: string, maxDepth?: number) => Promise<{ path: string; type: 'file' | 'dir' }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  spawn: (command: string, args?: string[], opts?: { cwd?: string }) => Promise<{ exitCode: number; output: string }>;
  waitForDepsReady: (timeoutMs?: number, intervalMs?: number) => Promise<boolean>;
};

type UseAgentChatOptions = {
  id: string;
  initialMessages?: UIMessage[];
  activeThreadId: string | null;
  getActiveThreadId?: () => string | null;
  getRunId?: () => string | null;
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
type WebFsReadInput = TWebFsReadInput;

const isTextPart = (part: UIMessage['parts'][number]): part is TextUIPart => part.type === 'text';

const extractTextFromUiMessage = (message: UIMessage | undefined): string => {
  if (!message) return '';
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return message.parts
      .filter(isTextPart)
      .map((part) => part.text ?? '')
      .join('\n');
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
};

const isLikelyAppBuildMessage = (message: UIMessage | undefined): boolean => {
  const text = extractTextFromUiMessage(message).toLowerCase();
  if (!text) return false;
  const createAppPattern = /\b(build|create|scaffold|make|generate|spin\s*up|draft)\b[\s\S]*\bapp\b/;
  const newAppPattern = /\bnew\s+app\b/;
  return createAppPattern.test(text) || newAppPattern.test(text);
};

type MutableWindow = Window & {
  __FYOS_FIRST_TOOL_CALLED_REF?: { current: boolean };
};

const getMutableWindow = (): MutableWindow | null => {
  if (typeof window === 'undefined') return null;
  return window as MutableWindow;
};

type SchedulerTask<T> = () => Promise<T>;

class ToolScheduler {
  private readonly safeQueue: Array<{
    run: SchedulerTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  private readonly destructiveQueue: Array<{
    run: SchedulerTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  private safeActive = 0;
  private destructiveActive = false;

  constructor(private readonly safeConcurrency: number = 3) {}

  run<T>(toolName: string, task: SchedulerTask<T>): Promise<T> {
    if (SAFE_TOOL_NAMES.has(toolName)) {
      return this.enqueueSafe(task) as Promise<T>;
    }
    return this.enqueueDestructive(task) as Promise<T>;
  }

  private enqueueSafe<T>(task: SchedulerTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.safeQueue.push({ 
        run: task as SchedulerTask<unknown>, 
        resolve: resolve as (value: unknown) => void, 
        reject 
      });
      this.tickSafe();
    });
  }

  private enqueueDestructive<T>(task: SchedulerTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.destructiveQueue.push({ 
        run: task as SchedulerTask<unknown>, 
        resolve: resolve as (value: unknown) => void, 
        reject 
      });
      this.tickDestructive();
    });
  }

  private tickSafe(): void {
    while (this.safeActive < this.safeConcurrency && this.safeQueue.length > 0) {
      const next = this.safeQueue.shift();
      if (!next) break;
      this.safeActive += 1;
      next.run()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          this.safeActive = Math.max(0, this.safeActive - 1);
          this.tickSafe();
        });
    }
  }

  private async tickDestructive(): Promise<void> {
    if (this.destructiveActive) return;
    this.destructiveActive = true;
    while (this.destructiveQueue.length > 0) {
      const next = this.destructiveQueue.shift();
      if (!next) continue;
      try {
        const result = await next.run();
        next.resolve(result);
      } catch (error) {
        next.reject(error);
      }
    }
    this.destructiveActive = false;
  }
}

const SAFE_TOOL_NAMES = new Set<string>([
  'web_fs_find',
  'web_fs_read',
  'web_fs_write',
  'media_list',
  'app_manage',
]);

const EXEC_GATED_TOOL_NAMES = new Set<string>(['web_exec', 'validate_project']);

export function useAgentChat(opts: UseAgentChatOptions) {
  const { id, initialMessages, activeThreadId, wc, runValidation, attachmentsProvider } = opts;
  const mutableWindow = getMutableWindow();
  const firstToolCalledRef = mutableWindow?.__FYOS_FIRST_TOOL_CALLED_REF ?? { current: false };
  if (mutableWindow) {
    mutableWindow.__FYOS_FIRST_TOOL_CALLED_REF = firstToolCalledRef;
  }

  const schedulerRef = useRef<ToolScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new ToolScheduler();
  }

  const dirListingCacheRef = useRef<Map<string, string[] | null>>(new Map());

  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);

  const runDispatchRef = useRef<{ runId: string | null; nextSequence: number }>({ runId: null, nextSequence: 0 });

  const {
    messages: rawMessages,
    sendMessage,
    status,
    stop,
    addToolResult,
    setMessages,
    error,
  } = useChat<UIMessage>({
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
          sessionId?: string;
          requestSequence?: number;
          intent?: string;
          forceAgentMode?: boolean;
        } = { id, messages };
        const threadForRequest = typeof opts.getActiveThreadId === 'function'
          ? opts.getActiveThreadId()
          : activeThreadIdRef.current;
        if (threadForRequest) body.threadId = threadForRequest;
        // Include attachment hints so server-side classifier can detect media ops
        try {
          if (typeof attachmentsProvider === 'function') {
            const hints = attachmentsProvider()?.map((attachment) => ({ contentType: attachment.contentType, url: attachment.publicUrl })) || [];
            if (hints.length > 0) body.attachmentHints = hints;
          }
        } catch {}

        try {
          if (typeof opts.getRunId === 'function') {
            const runId = opts.getRunId();
            if (runId) {
              if (runDispatchRef.current.runId !== runId) {
                runDispatchRef.current = { runId, nextSequence: 0 };
              }
              body.sessionId = runId;
              body.requestSequence = runDispatchRef.current.nextSequence;
              runDispatchRef.current.nextSequence += 1;
            } else if (runDispatchRef.current.runId) {
              runDispatchRef.current = { runId: null, nextSequence: 0 };
            }
          } else {
            runDispatchRef.current = { runId: null, nextSequence: 0 };
          }
        } catch {
          // Swallow run tracking errors to avoid breaking requests
        }

        const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
        if (isLikelyAppBuildMessage(lastUserMessage)) {
          body.intent = 'create-app';
          body.forceAgentMode = true;
        }
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
        if (!firstToolCalledRef.current && typeof opts.onFirstToolCall === 'function') {
          firstToolCalledRef.current = true;
          opts.onFirstToolCall();
        }
      } catch {}

      // Notify UI on each tool call to update progress indicator word
      try {
        if (typeof opts.onToolProgress === 'function') {
          opts.onToolProgress(toolCall.toolName);
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

      const scheduler = schedulerRef.current;
      if (!scheduler) {
        addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output: { error: 'Tool scheduler unavailable' } });
        return;
      }

      await scheduler.run(tc.toolName, async () => {
        let startTime = Date.now();
        const logAndAddResult = async (output: unknown) => {
          const duration = Date.now() - startTime;
          addToolResult({ tool: tc.toolName, toolCallId: tc.toolCallId, output });
          try {
            await agentLogger.logToolCall('client', tc.toolName, tc.toolCallId, tc.input, output, duration);
          } catch {}
        };

        try {
          if (EXEC_GATED_TOOL_NAMES.has(tc.toolName)) {
            try {
              const ready = await fnsRef.current.waitForDepsReady?.(60000, 150);
              if (!ready) {
                await logAndAddResult({ error: 'Dependencies are still installing. Try again shortly.' });
                return;
              }
            } catch (waitError: unknown) {
              const message = waitError instanceof Error ? waitError.message : 'Unable to confirm dependency install status.';
              await logAndAddResult({ error: message });
              return;
            }
          }

          startTime = Date.now();
          switch (tc.toolName) {
            case 'web_fs_find': {
              const findInput = isPlainObject(tc.input) ? (tc.input as Partial<WebFsFindInput>) : {};
              const { root = '.', maxDepth = 10, glob, prefix, limit = 200, offset = 0 } = findInput;
              const instance = instanceRef.current;
              if (!instance) {
                await logAndAddResult({ error: 'WebContainer is not ready for file search.' });
                break;
              }

              const normalizePath = (value: string | undefined): string | undefined => {
                if (!value) return undefined;
                const trimmed = value.trim();
                if (trimmed === '' || trimmed === '.' || trimmed === './') return '.';
                const withoutLeading = trimmed.replace(/^\.\/+/, '').replace(/^\/+/, '');
                const withoutTrailing = withoutLeading.replace(/\/$/, '');
                return withoutTrailing === '' ? '.' : withoutTrailing;
              };

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

              const normalizedRoot = normalizePath(root) ?? '.';
              const normalizedPrefix = normalizePath(prefix);
              const effectiveDepth = Math.max(0, Math.min(maxDepth ?? 10, 20));
              const effectiveLimit = Math.max(1, Math.min(limit ?? 200, 5000));
              const startIndex = Math.max(0, offset ?? 0);
              const globRegex = typeof glob === 'string' && glob.length > 0 ? globToRegExp(glob) : null;

              const matchesPrefix = (candidate: string): boolean => {
                if (!normalizedPrefix || normalizedPrefix === '.') return true;
                if (candidate === normalizedPrefix) return true;
                return candidate.startsWith(`${normalizedPrefix}/`);
              };

              const prefixMayBeInside = (candidate: string): boolean => {
                if (!normalizedPrefix || normalizedPrefix === '.') return true;
                if (candidate === '.') return true;
                return normalizedPrefix.startsWith(`${candidate}/`);
              };

              const EXCLUDED_DIRS = new Set(['node_modules', '.pnpm', '.vite', '.git', 'dist', 'build', '.next', 'out', 'coverage']);
              const listingCache = dirListingCacheRef.current;

              const readDir = async (dirPath: string): Promise<string[] | null> => {
                const key = dirPath === '' ? '.' : dirPath;
                if (listingCache.has(key)) {
                  return listingCache.get(key) ?? null;
                }
                try {
                  const entries = await instance.fs.readdir(key);
                  listingCache.set(key, entries);
                  return entries;
                } catch {
                  listingCache.set(key, null);
                  return null;
                }
              };

              const collected: string[] = [];
              let matchCount = 0;
              let truncated = false;

              const visit = async (dirPath: string, depth: number): Promise<void> => {
                if (truncated || depth > effectiveDepth) return;
                const entries = await readDir(dirPath);
                if (!entries) return;

                for (const name of entries) {
                  if (truncated) break;
                  if (EXCLUDED_DIRS.has(name)) continue;

                  const childPath = dirPath === '.' ? name : `${dirPath}/${name}`;
                  const passesPrefix = matchesPrefix(childPath);
                  const passesGlob = globRegex ? globRegex.test(childPath) : true;

                  if (passesPrefix && passesGlob) {
                    matchCount += 1;
                    if (matchCount > startIndex) {
                      collected.push(childPath);
                    }
                    if (collected.length >= effectiveLimit + 1) {
                      truncated = true;
                    }
                  }

                  const shouldDescend = !truncated
                    && depth < effectiveDepth
                    && (!normalizedPrefix || normalizedPrefix === '.' || prefixMayBeInside(childPath) || passesPrefix);

                  if (shouldDescend) {
                    const childEntries = await readDir(childPath);
                    if (childEntries) {
                      await visit(childPath, depth + 1);
                    }
                  }
                }
              };

              const rootEntries = await readDir(normalizedRoot);
              if (!rootEntries) {
                await logAndAddResult({ error: `Directory not found: ${normalizedRoot}` });
                break;
              }
              listingCache.set(normalizedRoot, rootEntries);
              await visit(normalizedRoot, 0);

              let hasMore = false;
              if (collected.length > effectiveLimit) {
                hasMore = true;
                collected.length = effectiveLimit;
              }

              const count = collected.length;
              const nextOffset = hasMore ? startIndex + count : null;
              const approximateTotal = hasMore ? (nextOffset ?? 0) + 1 : startIndex + count;

              await logAndAddResult({
                files: collected,
                count,
                total: approximateTotal,
                root: normalizedRoot,
                offset: startIndex,
                nextOffset,
                hasMore,
                complete: !hasMore,
                applied: { glob: !!glob, prefix: !!prefix },
              });
              break;
            }
            case 'web_fs_read': {
              const readInput = isPlainObject(tc.input) ? (tc.input as Partial<WebFsReadInput>) : {};
              const path = typeof readInput.path === 'string' ? readInput.path : '';
              const encoding = readInput.encoding ?? 'utf-8';
              const responseFormat = readInput.responseFormat ?? 'concise';
              const rangeInput = isPlainObject(readInput.range) ? (readInput.range as Record<string, unknown>) : undefined;

              if (!path) {
                await logAndAddResult({ error: 'web_fs_read requires a path.' });
                break;
              }

              try {
                const content = await fnsRef.current.readFile(path, encoding);

                if (encoding === 'base64') {
                  const approxBytes = Math.floor((content.length * 3) / 4);
                  await logAndAddResult({
                    path,
                    encoding,
                    content,
                    size: `${(approxBytes / 1024).toFixed(1)}KB`,
                    truncated: false,
                    format: 'detailed',
                  });
                  break;
                }

                const encoder = new TextEncoder();
                const bytes = encoder.encode(content);
                const totalBytes = bytes.length;
                const totalLines = content.split(/\r?\n/).length;
                let excerpt = content;
                const appliedRange: Record<string, number> = {};
                let rangeApplied = false;

                if (rangeInput) {
                  const rawOffset = typeof rangeInput.offset === 'number' ? rangeInput.offset : undefined;
                  const rawLength = typeof rangeInput.length === 'number' ? rangeInput.length : undefined;
                  const rawLineStart = typeof rangeInput.lineStart === 'number' ? rangeInput.lineStart : undefined;
                  const rawLineEnd = typeof rangeInput.lineEnd === 'number' ? rangeInput.lineEnd : undefined;
                  const maxRangeChars = 8000;
                  const maxLineWindow = 200;

                  if (rawLineStart !== undefined || rawLineEnd !== undefined) {
                    const lines = content.split(/\r?\n/);
                    const startLine = Math.max(1, rawLineStart ?? 1);
                    let endLine = rawLineEnd ?? Math.min(lines.length, startLine + maxLineWindow - 1);
                    endLine = Math.min(lines.length, Math.max(endLine, startLine));
                    excerpt = lines.slice(startLine - 1, endLine).join('\n');
                    appliedRange.lineStart = startLine;
                    appliedRange.lineEnd = endLine;
                    rangeApplied = true;
                  } else if (rawOffset !== undefined || rawLength !== undefined) {
                    const start = Math.max(0, rawOffset ?? 0);
                    const desiredLength = rawLength ? Math.max(1, rawLength) : maxRangeChars;
                    const cappedLength = Math.min(desiredLength, maxRangeChars);
                    const end = Math.min(content.length, start + cappedLength);
                    excerpt = content.slice(start, end);
                    appliedRange.offset = start;
                    appliedRange.length = end - start;
                    if (desiredLength > cappedLength) {
                      appliedRange.capped = cappedLength;
                    }
                    rangeApplied = true;
                  }
                }

                let truncated = false;
                if (!rangeApplied && responseFormat !== 'detailed') {
                  const maxChars = 4000;
                  if (excerpt.length > maxChars) {
                    const head = excerpt.slice(0, Math.floor(maxChars * 0.65));
                    const tail = excerpt.slice(-Math.floor(maxChars * 0.25));
                    excerpt = `${head}\n...\n${tail}`;
                    truncated = true;
                  }
                }

                await logAndAddResult({
                  path,
                  encoding,
                  content: excerpt,
                  format: responseFormat,
                  truncated: rangeApplied ? Boolean(appliedRange.capped) : truncated,
                  partial: rangeApplied || undefined,
                  size: `${(totalBytes / 1024).toFixed(1)}KB`,
                  totalBytes,
                  totalLines,
                  range: rangeApplied ? appliedRange : undefined,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await logAndAddResult({ error: message, path });
              }
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
              const appIndexTsx = `import React from 'react'\nimport '/src/tailwind.css'\nimport './styles.css'\nexport default function App(){\n  return (\n    <div className=\"h-full overflow-auto bg-gradient-to-b from-white to-slate-50\">\n      <div className=\"sticky top-0 bg-white/80 backdrop-blur border-b px-3 py-2\">\n        <div className=\"font-semibold tracking-tight\">${finalName}</div>\n      </div>\n      <div className=\"p-3 space-y-3\">\n        <div className=\"rounded-lg border bg-white shadow-sm p-3\">\n          <p className=\"text-slate-600 text-sm\">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>\n        </div>\n      </div>\n    </div>\n  )\n}`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              const appStylesCss = `/* App-specific theme variables */\n:root {\n  --app-accent: #22c55e;\n  --app-secondary: #64748b;\n  --app-background: #ffffff;\n  --app-surface: #f8fafc;\n  --app-border: #e2e8f0;\n  --app-text: #1e293b;\n  --app-text-muted: #64748b;\n  --app-hover: #16a34a;\n}\n\n/* Base app styling */\nbody {\n  font-family: Inter, ui-sans-serif, system-ui, Arial, sans-serif;\n}\n\n/* App-specific utility classes */\n.app-button {\n  background: var(--app-accent);\n  color: white;\n  transition: all 0.2s ease;\n}\n\n.app-button:hover {\n  background: var(--app-hover);\n  transform: translateY(-1px);\n}\n\n.app-surface {\n  background: var(--app-surface);\n  border: 1px solid var(--app-border);\n}\n\n/* Links */\na {\n  color: var(--app-accent);\n  text-decoration: none;\n}\n\n.a:hover {\n  color: var(--app-hover);\n  text-decoration: underline;\n}`;
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
      });
    },
  });

  const messages = Array.isArray(rawMessages) ? rawMessages : [];

  const translatingMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (status !== 'ready') return;
    if (messages.length === 0) return;

    messages.forEach((message) => {
      if (!message || message.role !== 'assistant') return;
      const metadata = (message.metadata ?? {}) as {
        mode?: string;
        translator?: { state?: string };
      };
      const mode = metadata.mode ?? (message as { mode?: string }).mode ?? 'agent';
      if (mode !== 'agent') return;

      const translatorState = metadata.translator?.state;
      if (translatorState === 'done' || translatorState === 'error') return;

      const textParts = Array.isArray(message.parts)
        ? message.parts.filter(isTextPart).map((part) => part.text?.trim()).filter((text): text is string => Boolean(text && text.length > 0))
        : [];
      if (textParts.length === 0) return;

      const messageId = message.id;
      if (!messageId) return;
      if (translatingMessageIdsRef.current.has(messageId)) return;
      translatingMessageIdsRef.current.add(messageId);

      setMessages((prev) => prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        const nextMetadata = { ...(msg.metadata ?? {}) } as Record<string, unknown>;
        const translator = { ...(nextMetadata.translator as Record<string, unknown> ?? {}) };
        translator.state = 'translating';
        nextMetadata.translator = translator;
        return { ...msg, metadata: nextMetadata } as UIMessage;
      }));

      (async () => {
        try {
          const response = await fetch('/api/agent/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts: textParts }),
          });
          if (!response.ok) {
            throw new Error(`Translator returned ${response.status}`);
          }
          const payload = await response.json();
          const translations = Array.isArray(payload?.translations)
            ? payload.translations.map((item: unknown) => (typeof item === 'string' ? item : '')).filter(Boolean)
            : [];

          setMessages((prev) => prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const nextMetadata = { ...(msg.metadata ?? {}) } as Record<string, unknown>;
            nextMetadata.translator = {
              ...(nextMetadata.translator as Record<string, unknown> ?? {}),
              state: 'done',
              outputs: translations,
            };
            return { ...msg, metadata: nextMetadata } as UIMessage;
          }));
        } catch (error) {
          const messageText = error instanceof Error ? error.message : 'Translation failed';
          setMessages((prev) => prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            const nextMetadata = { ...(msg.metadata ?? {}) } as Record<string, unknown>;
            nextMetadata.translator = {
              ...(nextMetadata.translator as Record<string, unknown> ?? {}),
              state: 'error',
              error: messageText,
            };
            return { ...msg, metadata: nextMetadata } as UIMessage;
          }));
        } finally {
          translatingMessageIdsRef.current.delete(messageId);
        }
      })();
    });
  }, [messages, setMessages, status]);

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

  return { messages, sendMessage, status, stop, addToolResult, setMessages, error } as const;
}
