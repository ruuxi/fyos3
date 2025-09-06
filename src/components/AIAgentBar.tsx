'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, ChevronDown, MessageCircle, ArrowDown, Square } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';
import ChatAlert from './ChatAlert';
import { enqueuePersist } from '@/utils/vfs-persistence';
 

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [latestMessageId, setLatestMessageId] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [welcomeLoaded, setWelcomeLoaded] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousMessageCount = useRef(0);
  const autoScrollEnabled = useRef(true);
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { fnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  // One-time welcome message
  useEffect(() => {
    if (welcomeLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/welcome');
        if (!res.ok) throw new Error(`welcome ${res.status}`);
        const json = await res.json();
        const msg = typeof json?.message === 'string' ? json.message.trim() : '';
        if (!cancelled && msg) {
          setWelcomeMessage(msg);
        }
      } catch {
        if (!cancelled) {
          setWelcomeMessage('Hey! I can spin up apps or fix issues. Try: “Create a Notes app on the desktop”.');
        }
      } finally {
        if (!cancelled) setWelcomeLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [welcomeLoaded]);

  async function waitForInstance(timeoutMs = 4000, intervalMs = 100) {
    const start = Date.now();
    while (!instanceRef.current && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return instanceRef.current;
  }

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleDevRefresh(delayMs = 800) {
    try {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        try { (globalThis as any).devServerControls?.refreshPreview?.(); } catch {}
      }, delayMs);
    } catch {}
  }

  // Scroll management functions
  const scrollToBottom = (smooth = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  const checkScrollPosition = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 50; // pixels from bottom
    const nearBottom = scrollHeight - scrollTop - clientHeight <= threshold;
    
    setIsNearBottom(nearBottom);
    setShowScrollToBottom(!nearBottom);
    
    // Update auto-scroll preference based on user behavior
    autoScrollEnabled.current = nearBottom;
  };

  // Handle scroll events
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      checkScrollPosition();
      // Clear new message indicator when user scrolls
      if (hasNewMessage) {
        setHasNewMessage(false);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasNewMessage]);

  const { messages, sendMessage, status, stop, addToolResult } = useChat({
    id: 'agent-chat',
    transport: new DefaultChatTransport({ api: '/api/agent' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return; // not expected here, but keep safe

      // Guard: WebContainer must be ready for client tools
      if (!instanceRef.current) {
        // wait briefly for initialization to complete
        await waitForInstance(6000, 120);
      }
      if (!instanceRef.current) {
        addToolResult({
          tool: toolCall.toolName as string,
          toolCallId: toolCall.toolCallId,
          output: { error: 'WebContainer is not ready yet. Still initializing, try again in a moment.' },
        });
        return;
      }

      type ToolCall = { toolName: string; toolCallId: string; input: unknown };
      const tc = toolCall as ToolCall;

      const task = async () => {
        try {
          switch (tc.toolName) {
            case 'web_fs_find': {
              const { root = '.', maxDepth = 10 } = (tc.input as { root?: string; maxDepth?: number }) ?? {};
              console.log(`🔧 [Agent] web_fs_find: ${root} (depth: ${maxDepth})`);
              const results = await fnsRef.current.readdirRecursive(root, maxDepth);
              console.log(`📊 [Agent] Found ${results.length} items in ${root}`);
              addToolResult({ tool: 'web_fs_find', toolCallId: tc.toolCallId, output: { files: results, count: results.length, root } });
              break;
            }
            case 'web_fs_read': {
              const { path, encoding = 'utf-8' } = tc.input as { path: string; encoding?: 'utf-8' | 'base64' };
              console.log(`🔧 [Agent] web_fs_read: ${path} (${encoding})`);
              const content = await fnsRef.current.readFile(path, encoding);
              const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
              addToolResult({ tool: 'web_fs_read', toolCallId: tc.toolCallId, output: { content, path, size: `${sizeKB}KB` } });
              break;
            }
            case 'web_fs_write': {
              const { path, content, createDirs = true } = tc.input as { path: string; content: string; createDirs?: boolean };
              const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
              console.log(`🔧 [Agent] web_fs_write: ${path} (${sizeKB}KB)`);
              
              if (createDirs) {
                const dir = path.split('/').slice(0, -1).join('/') || '.';
                await fnsRef.current.mkdir(dir, true);
              }
              await fnsRef.current.writeFile(path, content);
              addToolResult({ tool: 'web_fs_write', toolCallId: tc.toolCallId, output: { ok: true, path, size: `${sizeKB}KB` } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange(path);
              scheduleDevRefresh(600);
              break;
            }
            case 'web_fs_mkdir': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] web_fs_mkdir: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.mkdir(path, recursive);
              addToolResult({ tool: 'web_fs_mkdir', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange(path);
              break;
            }
            case 'web_fs_rm': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] web_fs_rm: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.remove(path, { recursive });
              addToolResult({ tool: 'web_fs_rm', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange(path);
              break;
            }
            case 'web_exec': {
              let { command, args = [], cwd } = tc.input as { command: string; args?: string[]; cwd?: string };

              // If the model sent the entire command as a single string, split into cmd + argv
              const splitCommandLine = (line: string): string[] => {
                const out: string[] = [];
                let cur = '';
                let quote: '"' | "'" | null = null;
                for (let i = 0; i < line.length; i++) {
                  const ch = line[i];
                  if (quote) {
                    if (ch === quote) {
                      quote = null;
                    } else if (ch === '\\' && i + 1 < line.length) {
                      i++;
                      cur += line[i];
                    } else {
                      cur += ch;
                    }
                  } else {
                    if (ch === '"' || ch === "'") {
                      quote = ch as '"' | "'";
                    } else if (/\s/.test(ch)) {
                      if (cur) {
                        out.push(cur);
                        cur = '';
                      }
                    } else if (ch === '\\' && i + 1 < line.length) {
                      i++;
                      cur += line[i];
                    } else {
                      cur += ch;
                    }
                  }
                }
                if (cur) out.push(cur);
                return out;
              };

              if ((!args || args.length === 0) && /\s/.test(command)) {
                const tokens = splitCommandLine(command);
                if (tokens.length > 0) {
                  command = tokens[0];
                  args = tokens.slice(1);
                }
              }
              // Normalize and add non-interactive flags for popular package managers
              const cmdLower = command.toLowerCase();
              const firstArg = (args[0] || '').toLowerCase();
              const isPkgMgr = /^(pnpm|npm|yarn|bun)$/.test(cmdLower);
              const isInstallLike = /^(add|install|update|remove|uninstall|i)$/i.test(firstArg);
              if (isPkgMgr && isInstallLike) {
                if (cmdLower === 'pnpm' && !args.some(a => a.startsWith('--reporter='))) {
                  args = [...args, '--reporter=silent', '--color=false'];
                } else if (cmdLower === 'npm' && !args.includes('--silent')) {
                  args = [...args, '--silent', '--no-progress', '--color=false'];
                } else if (cmdLower === 'yarn' && !args.includes('--silent')) {
                  args = [...args, '--silent', '--no-progress', '--color=false'];
                } else if (cmdLower === 'bun' && !args.includes('--silent')) {
                  args = [...args, '--silent'];
                }
              }
              const fullCommand = `${command} ${args.join(' ')}`.trim();
              console.log(`🔧 [Agent] web_exec: ${fullCommand} ${cwd ? `(cwd: ${cwd})` : ''}`);
              let result = await fnsRef.current.spawn(command, args, { cwd });

              console.log(`📊 [Agent] web_exec result: exit ${result.exitCode}, output ${result.output.length} chars`);

              const isPkgMgrCmd = /(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update)/i.test(fullCommand);
              const maxChars = 8000;
              const maxLines = 120;
              const splitLines = (s: string) => s.split(/\r?\n/);
              const lastLines = (s: string, n: number) => {
                const lines = splitLines(s);
                return lines.slice(Math.max(0, lines.length - n)).join('\n');
              };
              const trimChars = (s: string) => (s.length > maxChars ? `${s.slice(0, 2000)}\n...\n${s.slice(-6000)}` : s);

              if (isPkgMgrCmd) {
                addToolResult({
                  tool: 'web_exec',
                  toolCallId: tc.toolCallId,
                  output: {
                    command: fullCommand,
                    exitCode: result.exitCode,
                    ok: result.exitCode === 0,
                    outputTail: trimChars(lastLines(result.output, maxLines)),
                  },
                });
                if (result.exitCode === 0) {
                  scheduleDevRefresh(800);
                }
              } else {
                addToolResult({
                  tool: 'web_exec',
                  toolCallId: tc.toolCallId,
                  output: {
                    command: fullCommand,
                    exitCode: result.exitCode,
                    output: trimChars(result.output),
                    cwd,
                  },
                });
              }
              // Heuristically persist after package manager or file-changing commands
              try {
                if (instanceRef.current) {
                  if (/(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update)|git\s+(checkout|switch|merge|apply)/i.test(fullCommand)) {
                    enqueuePersist(instanceRef.current);
                  }
                }
              } catch {}
              break;
            }
            case 'create_app': {
              const { name, icon } = tc.input as { name: string; icon?: string };
              const id = crypto.randomUUID();
              const base = `src/apps/${id}`;
              console.log(`🔧 [Agent] create_app: "${name}" -> ${base} (${icon ?? '📦'})`);
              
              await fnsRef.current.mkdir(base, true);
              const metadata = {
                id,
                name,
                icon: icon ?? '📦',
                createdAt: Date.now(),
              };
              await fnsRef.current.writeFile(`${base}/metadata.json`, JSON.stringify(metadata, null, 2));
              // minimal entry file (tsx)
              const appIndexTsx = `export default function App(){ return <div>${name}</div>; }`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              // update registry
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>
                registry.push({ id, name, icon: metadata.icon, path: `/${base}/index.tsx` });
                await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              } catch (e) {
                // If registry missing, create it
                await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify([
                  { id, name, icon: metadata.icon, path: `/${base}/index.tsx` }
                ], null, 2));
              }
              console.log(`✅ [Agent] App created: ${name} (${id})`);
              addToolResult({ tool: 'create_app', toolCallId: tc.toolCallId, output: { id, path: base, name, icon: metadata.icon } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange(`${base}/index.tsx`);
              recordChange('public/apps/registry.json');
              scheduleDevRefresh(800);
              break;
            }
            case 'rename_app': {
              const { id, name } = tc.input as { id: string; name: string };
              console.log(`🔧 [Agent] rename_app: ${id} -> "${name}"`);
              const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
              const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>;
              
              const idx = registry.findIndex((r) => r.id === id);
              if (idx === -1) throw new Error('App not found in registry');
              const oldName = registry[idx].name;
              registry[idx].name = name;
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              console.log(`✅ [Agent] App renamed: "${oldName}" -> "${name}"`);
              addToolResult({ tool: 'rename_app', toolCallId: tc.toolCallId, output: { ok: true, id, oldName, newName: name } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange('public/apps/registry.json');
              break;
            }
            case 'remove_app': {
              const { id } = tc.input as { id: string };
              console.log(`🔧 [Agent] remove_app: ${id}`);
              // Remove from registry
              let reg: Array<{ id: string; name: string; icon?: string; path: string }> = [];
              let appName = 'Unknown';
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                reg = JSON.parse(regRaw);
                const app = reg.find(r => r.id === id);
                if (app) appName = app.name;
              } catch {}
              const next = reg.filter((r) => r.id !== id);
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(next, null, 2));
              // Remove folder: try src/apps/<id> first, then src/apps/app-<id>
              const p1 = `src/apps/${id}`;
              const p2 = `src/apps/app-${id}`;
              try { await fnsRef.current.remove(p1, { recursive: true }); } catch {}
              try { await fnsRef.current.remove(p2, { recursive: true }); } catch {}
              console.log(`✅ [Agent] App removed: "${appName}" (${id})`);
              addToolResult({ tool: 'remove_app', toolCallId: tc.toolCallId, output: { ok: true, id, name: appName, removedPaths: [p1, p2] } });

              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              recordChange('public/apps/registry.json');
              break;
            }
            case 'validate_project': {
              const { scope = 'quick', files = [] } = tc.input as { scope?: 'quick' | 'full'; files?: string[] };
              console.log(`🔧 [Agent] validate_project: scope=${scope} files=${files.length}`);
              await runValidation(scope, files);
              addToolResult({ tool: 'validate_project', toolCallId: tc.toolCallId, output: { ok: true } });
              break;
            }
            default:
              // Unknown tool on client
              addToolResult({ tool: tc.toolName as string, toolCallId: tc.toolCallId, output: { error: `Unhandled client tool: ${tc.toolName}` } });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          addToolResult({ tool: tc.toolName as string, toolCallId: tc.toolCallId, output: { error: message } });
        }
      };

      // Run tool asynchronously without global queueing
      const p = (async () => { await task(); })();
      pendingToolPromises.current.add(p);
      p.finally(() => pendingToolPromises.current.delete(p));
    },
  });

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length === 0) return;
    
    const currentMessageCount = messages.length;
    const hasNewMessages = currentMessageCount > previousMessageCount.current;
    
    if (hasNewMessages) {
      // Track the latest message
      const latestMessage = messages[messages.length - 1];
      if (latestMessage.id !== latestMessageId) {
        setLatestMessageId(latestMessage.id);
        
        // Only auto-scroll if user is near bottom or if it's the first message
        if (autoScrollEnabled.current || previousMessageCount.current === 0) {
          // Small delay to ensure DOM is updated
          setTimeout(() => scrollToBottom(true), 50);
        } else {
          // Show new message indicator if user is scrolled up
          setHasNewMessage(true);
        }
      }
    }
    
    previousMessageCount.current = currentMessageCount;
  }, [messages, latestMessageId]);

  // Initial scroll position check
  useEffect(() => {
    checkScrollPosition();
  }, []);

  // === Automatic diagnostics ===
  // Preview error -> show alert and auto-post to AI once per unique error
  const [previewAlert, setPreviewAlert] = useState<{
    source: 'preview';
    title: string;
    description?: string;
    content: string;
  } | null>(null);

  const changedFilesRef = useRef<Set<string>>(new Set());
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateRunningRef = useRef(false);
  const lastErrorHashRef = useRef<string | null>(null);
  const autoPostBusyRef = useRef(false);

  function stableHash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  async function autoPostDiagnostic(content: string) {
    if (autoPostBusyRef.current) return;
    autoPostBusyRef.current = true;
    try {
      await sendMessage({ text: content });
    } finally {
      const release = () => {
        if (status === 'ready') {
          autoPostBusyRef.current = false;
        } else {
          setTimeout(release, 300);
        }
      };
      release();
    }
  }

  // Listen for preview runtime errors
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce?.detail?.source === 'preview') {
        const detail = ce.detail as any;
        setPreviewAlert(detail);
        const payload = detail?.content || detail?.description || '';
        if (payload) {
          const hash = stableHash(String(payload));
          if (hash !== lastErrorHashRef.current) {
            lastErrorHashRef.current = hash;
            void autoPostDiagnostic(
              `Preview runtime error detected automatically. Please diagnose and fix.\n\n\`\`\`txt\n${payload}\n\`\`\`\n`,
            );
          }
        }
      }
    };
    window.addEventListener('wc-preview-error', handler as EventListener);
    return () => window.removeEventListener('wc-preview-error', handler as EventListener);
  }, [status]);

  function recordChange(path: string) {
    if (!path) return;
    changedFilesRef.current.add(path);
    try {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    } catch {}
    const scheduleRun = () => {
      if (autoPostBusyRef.current || status !== 'ready') {
        validateTimerRef.current = setTimeout(scheduleRun, 700);
        return;
      }
      const paths = Array.from(changedFilesRef.current);
      changedFilesRef.current.clear();
      void runValidation('quick', paths);
    };
    validateTimerRef.current = setTimeout(scheduleRun, 700);
  }

  async function runValidation(scope: 'quick' | 'full', changed: string[] = []) {
    if (!instanceRef.current) return;
    if (validateRunningRef.current) return;
    validateRunningRef.current = true;
    try {
      const logs: string[] = [];
      // TypeScript quick check (only surface likely breaking diagnostics)
      try {
        const tsc = await fnsRef.current.spawn('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false']);
        if (tsc.exitCode !== 0) {
          const breakingTS = extractBreakingTSErrors(tsc.output);
          if (breakingTS) {
            logs.push(`[TypeScript] ${breakingTS}`);
          }
        }
      } catch (e) {
        logs.push(`[TypeScript] failed to run: ${e instanceof Error ? e.message : String(e)}`);
      }

      // ESLint for changed files only
      const lintTargets = changed.filter((p) => /\.(ts|tsx|js|jsx)$/.test(p));
      if (lintTargets.length > 0) {
        try {
          const eslint = await fnsRef.current.spawn('pnpm', [
            'exec',
            'eslint',
            '--format',
            'json',
            '--max-warnings=0',
            ...lintTargets,
          ]);
          if (eslint.exitCode !== 0) {
            const breakingLint = extractBreakingESLint(JSONSafe(eslint.output));
            if (breakingLint) {
              logs.push(`[ESLint] ${breakingLint}`);
            }
          }
        } catch (e) {
          logs.push(`[ESLint] failed to run: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Optional full build (heavier)
      if (scope === 'full') {
        try {
          const build = await fnsRef.current.spawn('pnpm', ['run', 'build']);
          if (build.exitCode !== 0) {
            logs.push(`[Build] exit=${build.exitCode}\n${trimForChat(build.output)}`);
          }
        } catch (e: unknown) {
          logs.push(`[Build] failed to run: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const final = logs.filter(Boolean).join('\n\n');
      if (final.trim().length > 0) {
        const hash = stableHash(final);
        if (hash !== lastErrorHashRef.current) {
          lastErrorHashRef.current = hash;
          await autoPostDiagnostic(
            `Automatic checks found issues after recent changes (${changed.join(', ')}). Please fix.\n\n\`\`\`txt\n${final}\n\`\`\`\n`,
          );
        }
      }
    } finally {
      validateRunningRef.current = false;
    }
  }

  function trimForChat(s: string): string {
    const maxChars = 8000;
    return s.length > maxChars ? `${s.slice(0, 4000)}\n...\n${s.slice(-3500)}` : s;
  }

  function JSONSafe(output: string): string {
    // Some tools may print leading logs; attempt to locate JSON array start
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return output.slice(start, end + 1);
    }
    return '[]';
  }

  function extractBreakingESLint(jsonOutput: string): string | null {
    try {
      const reports: Array<{
        filePath: string;
        messages: Array<{ ruleId: string | null; fatal?: boolean; severity: number; message: string; line?: number; column?: number }>;
      }> = JSON.parse(jsonOutput);
      const breaking: string[] = [];
      for (const rep of reports) {
        for (const m of rep.messages) {
          const isParsing = m.fatal === true || m.ruleId === null || /Parsing error/i.test(m.message);
          if (isParsing) {
            breaking.push(`${rep.filePath}:${m.line ?? 0}:${m.column ?? 0} ${m.message}`);
          }
        }
      }
      if (breaking.length > 0) {
        const body = breaking.slice(0, 25).join('\n');
        return `Parsing errors detected (likely breaking):\n${trimForChat(body)}`;
      }
      return null;
    } catch {
      // Fallback: if JSON parse fails, do not surface to avoid noise
      return null;
    }
  }

  function extractBreakingTSErrors(tscOutput: string): string | null {
    // Only promote syntax/parse and module resolution errors; ignore style/type-safety (e.g., noImplicitAny)
    // Syntax-like TS codes commonly in 1000-1199 range; also include TS2307 (Cannot find module)
    const lines = tscOutput.split(/\r?\n/);
    const selected: string[] = [];
    const codeRe = /error\s+TS(\d+):\s*(.*)/i;
    for (const line of lines) {
      const m = line.match(codeRe);
      if (!m) continue;
      const code = parseInt(m[1], 10);
      const msg = m[2] || '';
      const isSyntax = code >= 1000 && code < 1200; // rough bucket for parsing errors
      const isModule = code === 2307; // Cannot find module
      if (isSyntax || isModule) {
        selected.push(`TS${code}: ${msg}`);
      }
    }
    if (selected.length > 0) {
      return selected.slice(0, 25).join('\n');
    }
    return null;
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
    
    // Enable auto-scroll and scroll to bottom when user sends a message
    autoScrollEnabled.current = true;
    setTimeout(() => scrollToBottom(true), 50);
  };

  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <div className="bg-[radial-gradient(120%_120%_at_50%_0%,rgba(10,13,18,0.9)_0%,rgba(7,10,15,0.85)_55%,rgba(5,7,11,0.8)_100%)] backdrop-blur-sm hover:bg-[radial-gradient(120%_120%_at_50%_0%,rgba(10,13,18,0.95)_0%,rgba(7,10,15,0.9)_55%,rgba(5,7,11,0.85)_100%)] border border-white/10 rounded-full p-3 shadow-xl cursor-pointer transition-all duration-200 hover:scale-105">
          <Button
            onClick={() => setIsCollapsed(false)}
            variant="ghost"
            size="sm"
            className="p-0 h-auto text-[#7dd3fc] hover:text-[#60a5fa] hover:bg-transparent relative"
          >
            <MessageCircle className="w-6 h-6" />
            {messages.length > 0 && (
              <span className={`absolute -top-1 -right-1 bg-[#60a5fa] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center shadow-[0_0_12px_rgba(96,165,250,0.5)] transition-all duration-200 ${hasNewMessage ? 'animate-pulse' : ''}`}>
                {messages.length}
              </span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-4xl mx-4">
        <div className={`bg-[radial-gradient(120%_120%_at_50%_0%,rgba(10,13,18,0.95)_0%,rgba(7,10,15,0.9)_55%,rgba(5,7,11,0.85)_100%)] backdrop-blur-sm rounded-2xl shadow-xl border border-white/15 overflow-hidden transition-all duration-200 ${status === 'streaming' ? 'shadow-[0_0_30px_rgba(96,165,250,0.3)]' : ''}`}>
          <div className="flex items-center justify-between p-3 border-b border-white/10">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm text-[#7dd3fc]">AI Agent</span>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                onClick={() => setIsCollapsed(true)}
                variant="ghost"
                size="sm"
                className="p-1 h-auto text-white/60 hover:text-[#7dd3fc] hover:bg-white/5"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Alerts */}
          <div className="px-4 pt-2 space-y-2">
            {previewAlert && (
              <ChatAlert
                alert={previewAlert}
                onAsk={(msg) => {
                  void sendMessage({ text: msg });
                  setPreviewAlert(null);
                }}
                onDismiss={() => setPreviewAlert(null)}
              />
            )}
          </div>

          {/* Messages */}
          <div 
            ref={messagesContainerRef}
            className="max-h-72 overflow-auto px-4 pt-2 space-y-3 relative custom-scrollbar"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(96, 165, 250, 0.3) transparent'
            }}
          >
            {messages.length === 0 && welcomeMessage && (
              <div className="text-sm transition-all duration-500">
                <div className="font-semibold text-[#7dd3fc] mb-1">Agent</div>
                <div className="space-y-2">
                  <div className="whitespace-pre-wrap text-white/90">{welcomeMessage}</div>
                </div>
              </div>
            )}
            {messages.map(m => (
              <div 
                key={m.id} 
                className={`text-sm transition-all duration-500 ${m.id === latestMessageId && m.role === 'assistant' ? 'bg-[rgba(96,165,250,0.1)] -mx-2 px-2 py-1 rounded-lg border-l-2 border-[#60a5fa]' : ''}`}
              >
                <div className="font-semibold text-[#7dd3fc] mb-1">{m.role === 'user' ? 'You' : 'Agent'}</div>
                <div className="space-y-2">
                  {m.parts.map((part, index) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <div key={index} className="whitespace-pre-wrap text-white/90">{part.text}</div>
                        );
                      case 'tool-submit_plan': {
                        const id = (part as { toolCallId: string }).toolCallId;
                        if (part.state === 'output-available') {
                          return (
                            <div key={id} className="rounded-md border border-white/20 bg-[rgba(125,211,252,0.1)] text-white p-2">
                              <div className="font-medium text-[#7dd3fc]">Plan</div>
                              <ul className="list-disc pl-5 text-sm text-white/90">
                                {(part.output as { steps?: string[] } | undefined)?.steps?.map((s: string, i: number) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          );
                        }
                        return null;
                      }
                      case 'tool-web_fs_find':
                      case 'tool-web_fs_read':
                      case 'tool-web_fs_write':
                      case 'tool-web_fs_mkdir':
                      case 'tool-web_fs_rm':
                      case 'tool-web_exec':
                      case 'tool-create_app':
                      case 'tool-rename_app':
                      case 'tool-remove_app':
                      case 'tool-validate_project': {
                        // Hide tool calls from user - they execute silently in background
                        return null;
                      }
                    }
                  })}
                </div>
              </div>
            ))}
            
            {/* Scroll to bottom button */}
            {showScrollToBottom && (
              <div className="sticky bottom-2 right-2 flex justify-end pointer-events-none">
                <Button
                  onClick={() => {
                    scrollToBottom(true);
                    setHasNewMessage(false);
                    autoScrollEnabled.current = true;
                  }}
                  variant="ghost"
                  size="sm"
                  className={`pointer-events-auto p-2 h-auto bg-[#60a5fa]/90 text-white hover:bg-[#7dd3fc] shadow-[0_0_12px_rgba(96,165,250,0.5)] border-0 rounded-full transition-all duration-200 hover:scale-105 ${hasNewMessage ? 'animate-pulse' : ''}`}
                >
                  <ArrowDown className="w-4 h-4" />
                  {hasNewMessage && (
                    <span className="absolute -top-1 -right-1 bg-[#7dd3fc] text-xs rounded-full w-2 h-2 animate-pulse" />
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Input Bar */}
          <form onSubmit={onSubmit} className="p-4 border-t border-white/10">
            <div className="flex items-center space-x-3">
              <div className="flex-1 relative">
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim() && status === 'ready') {
                        onSubmit(e as any);
                      }
                    }
                  }}
                  placeholder="Ask the AI agent… Try: 'Create a Notes app on the desktop and install zustand'"
                  className="min-h-[40px] max-h-32 resize-none pr-12"
                  rows={1}
                  disabled={status === 'submitted' || status === 'streaming'}
                />
                <div className="absolute right-2 bottom-2 text-xs text-gray-400">
                  {input.length > 0 && status === 'ready' ? `${input.length} chars` : ''}
                </div>
              </div>

              <Button 
                type="button" 
                onClick={() => {
                  if (status === 'submitted' || status === 'streaming') {
                    stop();
                  } else {
                    if (!input.trim()) return;
                    sendMessage({ text: input });
                    setInput('');
                    
                    // Enable auto-scroll and scroll to bottom when user sends a message
                    autoScrollEnabled.current = true;
                    setTimeout(() => scrollToBottom(true), 50);
                  }
                }}
                disabled={(status === 'ready' && !input.trim())}
                size="sm" 
                className="h-10 text-white border-0 transition-all duration-200 bg-[#60a5fa] hover:bg-[#7dd3fc] shadow-[0_0_20px_rgba(96,165,250,0.3)]"
              >
                {status === 'submitted' || status === 'streaming' ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
