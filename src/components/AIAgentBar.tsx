'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Search, Store, Monitor, Image as ImageIcon } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';
import ChatAlert from './ChatAlert';
// Persistence is handled by WebContainer visibility/unload hooks

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'appstore' | 'visit' | 'media'>('chat');
  const [appsListing, setAppsListing] = useState<Array<{ _id: string; name: string; description?: string; icon?: string }>>([]);
  const [desktopsListing, setDesktopsListing] = useState<Array<{ _id: string; title: string; description?: string; icon?: string }>>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [desktopsLoading, setDesktopsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [desktopsError, setDesktopsError] = useState<string | null>(null);
  const [personaActive, setPersonaActive] = useState(false);
  const [didAnimateWelcome, setDidAnimateWelcome] = useState(false);
  const [bubbleAnimatingIds, setBubbleAnimatingIds] = useState<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  // Chat scroll management
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const scrollAnimRef = useRef<number | null>(null);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const MIN_CONTAINER_HEIGHT = 72; // px
  const MAX_CONTAINER_HEIGHT = 520; // px
  const barAreaRef = useRef<HTMLDivElement | null>(null);
  const isOpen = mode !== 'compact';
  const prevOpenRef = useRef(isOpen);
  const isOpening = isOpen && !prevOpenRef.current;
  const isClosing = !isOpen && prevOpenRef.current;
  useEffect(() => { prevOpenRef.current = isOpen; }, [isOpen]);
  const forceFollowRef = useRef(false);
  const [suppressBubbleAnimation, setSuppressBubbleAnimation] = useState(false);

  // Suppress bubble animations while panel is opening/closing to avoid re-pop animations
  useEffect(() => {
    if (!(isOpening || isClosing)) return;
    setSuppressBubbleAnimation(true);
    const duration = isOpening ? 340 : isClosing ? 220 : 300;
    const t = setTimeout(() => setSuppressBubbleAnimation(false), duration + 60);
    return () => clearTimeout(t);
  }, [isOpening, isClosing]);

  function isUserNearBottom(el: HTMLElement, threshold = 48): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  function cancelScrollAnimation() {
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  }

  function smoothScrollToBottom(el: HTMLElement, durationMs = 550) {
    // Respect reduced motion
    const prefersReduced =
      typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (durationMs <= 0 || prefersReduced) {
      const snapTarget = el.scrollHeight - el.clientHeight;
      el.scrollTop = snapTarget;
      return;
    }
    // If an animation is already in progress, let it continue and dynamically follow the target
    if (scrollAnimRef.current !== null) {
      return;
    }
    const startTop = el.scrollTop;
    const startTime = performance.now();

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      // Recompute target continuously to account for container height/content changes
      const dynamicTarget = el.scrollHeight - el.clientHeight;
      el.scrollTop = startTop + (dynamicTarget - startTop) * eased;
      if (t < 1) {
        scrollAnimRef.current = requestAnimationFrame(step);
      } else {
        scrollAnimRef.current = null;
      }
    };
    scrollAnimRef.current = requestAnimationFrame(step);
  }

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { fnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  // Track if user is near bottom while scrolling
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = isUserNearBottom(el, 56);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Initialize state
    isNearBottomRef.current = isUserNearBottom(el, 56);
    return () => el.removeEventListener('scroll', onScroll as EventListener);
  }, []);

  // Observe content size and grow container height smoothly up to a max (viewport-based)
  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesInnerRef.current;
    if (!container || !content) return;

    const updateHeight = () => {
      const contentHeight = content.scrollHeight;
      const viewportCap = typeof window !== 'undefined' ? Math.round(window.innerHeight * (personaActive ? 0.72 : 0.6)) : (personaActive ? 720 : MAX_CONTAINER_HEIGHT);
      const next = Math.min(viewportCap, Math.max(MIN_CONTAINER_HEIGHT, contentHeight));
      setContainerHeight(next);
    };

    updateHeight();

    const ro = new ResizeObserver(() => {
      updateHeight();
    });
    ro.observe(content);
    const onResize = () => updateHeight();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [personaActive]);

  // Cleanup scroll animation on unmount
  useEffect(() => () => cancelScrollAnimation(), []);

  // One-time welcome animation flag: allow initial pop-in to play, then disable
  useEffect(() => {
    const t = setTimeout(() => setDidAnimateWelcome(true), 500);
    return () => clearTimeout(t);
  }, []);

  // moved below useChat to avoid referencing messages before declaration

  async function waitForInstance(timeoutMs = 4000, intervalMs = 100) {
    const start = Date.now();
    while (!instanceRef.current && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return instanceRef.current;
  }

  // Lean reloads: rely on dev server HMR; no manual refresh orchestration

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

              // Async media ingest hook (non-blocking)
              try {
                const lower = path.toLowerCase();
                const isMedia = /\.(png|jpg|jpeg|webp|gif|mp3|wav|m4a|aac|mp4|webm|mov)$/i.test(lower);
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
            case 'web_fs_mkdir': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] web_fs_mkdir: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.mkdir(path, recursive);
              addToolResult({ tool: 'web_fs_mkdir', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });
              break;
            }
            case 'web_fs_rm': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] web_fs_rm: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.remove(path, { recursive });
              addToolResult({ tool: 'web_fs_rm', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });
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
                      // handle simple escapes inside quotes
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

              // No package manager fallback to keep behavior strict
              console.log(`📊 [Agent] web_exec result: exit ${result.exitCode}, output ${result.output.length} chars`);

              // Avoid flooding LLM with huge logs; compact install/update outputs
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
              break;
            }
            case 'create_app': {
              const { id: requestedId, name, icon } = tc.input as { id: string; name: string; icon?: string };
              
              // Handle duplicate names by adding (1), (2), etc.
              let finalName = name;
              let finalId = requestedId;
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>;
                
                // Check for duplicate names
                const existingNames = new Set(registry.map(app => app.name));
                let counter = 1;
                while (existingNames.has(finalName)) {
                  finalName = `${name} (${counter})`;
                  counter++;
                }
                
                // Check for duplicate IDs
                const existingIds = new Set(registry.map(app => app.id));
                counter = 1;
                while (existingIds.has(finalId)) {
                  finalId = `${requestedId}-${counter}`;
                  counter++;
                }
              } catch (e) {
                // Registry doesn't exist yet, use original name and id
              }
              
              const base = `src/apps/${finalId}`;
              console.log(`🔧 [Agent] create_app: "${finalName}" -> ${base} (${icon ?? '📦'})`);
              
              await fnsRef.current.mkdir(base, true);
              const metadata = {
                id: finalId,
                name: finalName,
                icon: icon ?? '📦',
                createdAt: Date.now(),
              };
              await fnsRef.current.writeFile(`${base}/metadata.json`, JSON.stringify(metadata, null, 2));
              // minimal entry file (tsx)
              const appIndexTsx = `import React from 'react'\nexport default function App(){\n  return (\n    <div className=\"h-full overflow-auto\">\n      <div className=\"sticky top-0 bg-white/70 backdrop-blur border-b px-3 py-2\">\n        <div className=\"font-semibold\">${finalName}</div>\n      </div>\n      <div className=\"p-3 space-y-3\">\n        <p className=\"text-gray-600 text-sm\">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>\n      </div>\n    </div>\n  )\n}`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              // update registry
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>
                registry.push({ id: finalId, name: finalName, icon: metadata.icon, path: `/${base}/index.tsx` });
                await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              } catch (e) {
                // If registry missing, create it
                await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify([
                  { id: finalId, name: finalName, icon: metadata.icon, path: `/${base}/index.tsx` }
                ], null, 2));
              }
              // Notify desktop to open the newly created app immediately
              try {
                const appIndexPath = `/${base}/index.tsx`;
                if (typeof window !== 'undefined') {
                  window.postMessage({ type: 'FYOS_OPEN_APP', app: { id: finalId, name: finalName, icon: metadata.icon, path: appIndexPath } }, '*');
                }
              } catch {}
              console.log(`✅ [Agent] App created: ${finalName} (${finalId})`);
              addToolResult({ tool: 'create_app', toolCallId: tc.toolCallId, output: { id: finalId, path: base, name: finalName, icon: metadata.icon } });
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
              break;
            }
            case 'validate_project': {
              const { scope = 'quick', files = [] } = tc.input as { scope?: 'quick' | 'full'; files?: string[] };
              console.log(`🔧 [Agent] validate_project: scope=${scope} files=${files.length}`);
              await runValidation(scope, files);
              addToolResult({ tool: 'validate_project', toolCallId: tc.toolCallId, output: { ok: true, scope, files } });
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

  // Persona stream: separate chat hooked to persona endpoint, only user messages considered on server
  const {
    messages: personaMessages,
    sendMessage: sendPersonaMessage,
    status: personaStatus,
    stop: stopPersona,
  } = useChat({
    id: 'persona-chat',
    transport: new DefaultChatTransport({ api: '/api/agent?persona=1' }),
  });
  const hasConversation = personaMessages.length > 0;

  // Recompute container height when returning to chat or when conversation state changes
  useEffect(() => {
    if (mode !== 'chat') return;
    const content = messagesInnerRef.current;
    if (!content) return;
    const contentHeight = content.scrollHeight;
    const viewportCap = typeof window !== 'undefined' ? Math.round(window.innerHeight * (hasConversation ? 0.72 : 0.6)) : (hasConversation ? 720 : MAX_CONTAINER_HEIGHT);
    const next = Math.min(viewportCap, Math.max(MIN_CONTAINER_HEIGHT, contentHeight));
    setContainerHeight(next);
  }, [hasConversation, mode]);
  useEffect(() => { setPersonaActive(personaMessages.length > 0); }, [personaMessages.length]);

  // Add pop animation to newly added bubbles (both user and assistant)
  useEffect(() => {
    const currentIds = new Set(personaMessages.map(m => m.id));
    const unseen: string[] = [];
    for (const id of currentIds) {
      if (!seenMessageIdsRef.current.has(id)) unseen.push(id);
    }
    if (unseen.length === 0) return;

    // mark as seen to avoid re-animating on re-renders
    unseen.forEach(id => seenMessageIdsRef.current.add(id));

    // start animation for these ids
    setBubbleAnimatingIds(prev => {
      const next = new Set(prev);
      unseen.forEach(id => next.add(id));
      return next;
    });

    const timeout = setTimeout(() => {
      setBubbleAnimatingIds(prev => {
        const next = new Set(prev);
        unseen.forEach(id => next.delete(id));
        return next;
      });
    }, 450);

    return () => clearTimeout(timeout);
  }, [personaMessages]);

  // Host-side fetchers for listings (driven by mode)
  useEffect(() => {
    if (mode !== 'appstore') return;
    setAppsLoading(true); setAppsError(null);
    fetch('/api/store/apps')
      .then(r => r.json())
      .then(j => setAppsListing((j?.apps || []).map((a: any) => ({ _id: String(a._id), name: a.name, description: a.description, icon: a.icon }))))
      .catch(e => setAppsError(e?.message || 'Failed'))
      .finally(() => setAppsLoading(false));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'visit') return;
    setDesktopsLoading(true); setDesktopsError(null);
    fetch('/api/visit/desktops')
      .then(r => r.json())
      .then(j => setDesktopsListing((j?.desktops || []).map((d: any) => ({ _id: String(d._id), title: d.title, description: d.description, icon: d.icon }))))
      .catch(e => setDesktopsError(e?.message || 'Failed'))
      .finally(() => setDesktopsLoading(false));
  }, [mode]);

  async function hostInstallApp(appId: string) {
    try {
      const res = await fetch(`/api/store/apps/${appId}/bundle`);
      if (!res.ok) throw new Error(`Bundle fetch failed`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const { installAppFromBundle } = await import('@/utils/app-install');
      if (!instanceRef.current) await waitForInstance(6000, 120);
      if (!instanceRef.current) throw new Error('WebContainer not ready');
      await installAppFromBundle(instanceRef.current, buf);
    } catch (e) {
      console.error('Install failed', e);
    }
  }

  // Auto-scroll or preserve position on new messages and height changes (chat mode)
  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    // Refresh near-bottom state in case container height changed without user scroll
    isNearBottomRef.current = isUserNearBottom(el, 56);

    const prevScrollHeight = prevScrollHeightRef.current || 0;
    const newScrollHeight = el.scrollHeight;

    // First run: jump to bottom
    if (prevScrollHeight === 0) {
      // Smoothly settle to bottom on initial mount as the container grows
      smoothScrollToBottom(el, 700);
      prevScrollHeightRef.current = newScrollHeight;
      forceFollowRef.current = false;
      return;
    }

    const shouldFollow = forceFollowRef.current || isNearBottomRef.current;
    if (shouldFollow) {
      // Defer one frame so layout/height settle before scrolling
      requestAnimationFrame(() => smoothScrollToBottom(el, 600));
    } else {
      // Preserve visual position by offsetting the growth
      const delta = newScrollHeight - prevScrollHeight;
      if (delta > 0) {
        el.scrollTop += delta;
      }
    }

    prevScrollHeightRef.current = el.scrollHeight;
    // Reset forced follow after handling
    forceFollowRef.current = false;
  }, [personaMessages.length, containerHeight]);

  // Keyboard shortcuts: Cmd/Ctrl+K to open chat, Esc to close overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === 'k';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setMode('chat');
      }
      if (e.key === 'Escape' && mode !== 'compact') {
        e.preventDefault();
        setMode('compact');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Overlay click handled via a fixed backdrop element in the JSX

  // === Automatic diagnostics ===
  // Preview error -> show alert and auto-post to AI once per unique error
  const [previewAlert, setPreviewAlert] = useState<{
    source: 'preview';
    title: string;
    description?: string;
    content: string;
  } | null>(null);

  // Removed automatic validation loop; validation runs only via validate_project tool
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

  // No per-change validation debounce

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
    forceFollowRef.current = true;
    // Send to hidden agent (tools-enabled)
    sendMessage({ text: input });
    // Send to persona stream (UI-only)
    sendPersonaMessage({ text: input });
    setInput('');
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        onClick={() => setMode('compact')}
        aria-hidden="true"
      />
      <div className="flex justify-center">
        <div className="w-full max-w-4xl mx-4 relative z-50" ref={barAreaRef}>
          {/* Unified rim wrapper around panel + bar */}
          <div className={`rounded-none border border-sky-400/70 supports-[backdrop-filter]:backdrop-blur-xl backdrop-saturate-150 bg-neutral-950/70 text-white ${isOpen ? 'shadow-[0_0_0_1px_rgba(56,189,248,0.50),0_12px_28px_rgba(0,0,0,0.28),0_24px_56px_rgba(0,0,0,0.38)]' : 'shadow-[0_0_0_1px_rgba(56,189,248,0.45),0_8px_24px_rgba(56,189,248,0.22)]'} transition-shadow overflow-hidden`}>
            <div className="flex flex-col-reverse">
              {/* Bottom bar with single input (no inner border; inherits rim) */}
              <div className="rounded-none px-4 py-3 bg-transparent">
              <form onSubmit={onSubmit}>
                <div className="flex items-center gap-2">
                  {/* Left cluster */}
                  <TooltipProvider>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg-white/10" onClick={() => setMode('appstore')}>
                            <Store className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-none">App Store</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg-white/10" onClick={() => setMode('visit')}>
                            <Monitor className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-none">Visit Desktops</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg-white/10" onClick={() => setMode('media')}>
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-none">Media</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>

                  {/* Center chat input */}
                  <div className="flex-1 relative">
                    <Search className="absolute left-16 top-1/2 -translate-y-1/2 h-4 w-4 text-white" />
                    <Textarea
                      value={input}
                      onFocus={() => setMode('chat')}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (input.trim() && status === 'ready') {
                            onSubmit(e as any);
                          }
                        }
                      }}
                      placeholder="Ask the AI agent… Try: 'Create a Notes app, Change my background!'"
                      className="pl-24 pr-12 h-10 min-h-0 py-2 resize-none rounded-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none text-white placeholder:text-white/60 caret-sky-300 text-base leading-6"
                      rows={1}
                      disabled={status === 'submitted' || status === 'streaming' || personaStatus === 'submitted' || personaStatus === 'streaming'}
                    />
                  </div>

                  {/* Right cluster */}
                  <div className="flex items-center gap-2">
                    {(status === 'submitted' || status === 'streaming' || personaStatus === 'submitted' || personaStatus === 'streaming') && (
                      <Button type="button" onClick={() => { stop(); stopPersona(); }} variant="ghost" size="sm" className="h-10 rounded-none">Stop</Button>
                    )}
                    <Button type="submit" disabled={!input.trim() || !(status === 'ready' && personaStatus === 'ready')} size="sm" className="h-10 rounded-none text-white hover:bg-white/10">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </form>
            </div>

            {/* Inline expansion content above the bar */}
            <div
              className={`grid origin-bottom will-change-[transform] transition-[grid-template-rows,transform] ${isOpening ? 'duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : isClosing ? 'duration-[220ms] ease-[cubic-bezier(0.4,0,1,1)]' : 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'} ${isOpen ? 'grid-rows-[1fr] translate-y-0 scale-100' : 'grid-rows-[0fr] translate-y-1 scale-[0.995]'} motion-reduce:transition-none`}
              aria-hidden={!isOpen}
            >
              <div className="overflow-hidden" style={{ maxHeight: personaActive ? '80vh' : '70vh' }}>
                <div className="bg-transparent text-white">

                {mode === 'chat' && (
                  <div className="px-4 pt-3">
                    <div className="space-y-2">
                      {previewAlert && (
                        <ChatAlert
                          alert={previewAlert}
                          onAsk={(msg) => {
                            void sendMessage({ text: msg });
                            void sendPersonaMessage({ text: msg });
                            setPreviewAlert(null);
                          }}
                          onDismiss={() => setPreviewAlert(null)}
                        />
                      )}
                    </div>

                    <div
                      ref={messagesContainerRef}
                      className="overflow-auto pt-2 pb-1 modern-scrollbar pr-3"
                      style={{
                        height: containerHeight > 0 ? `${containerHeight}px` : undefined,
                        maxHeight: personaActive ? '72vh' : '60vh',
                        transition: 'height 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                        willChange: 'height',
                        scrollBehavior: 'auto',
                        paddingLeft: '12px',
                        paddingRight: '22px',
                      }}
                    >
                      <div ref={messagesInnerRef} className="space-y-3 px-1">
                        <div className="text-sm flex justify-start" aria-label="Welcome message">
                          <div className="max-w-full flex-1">
                            <div className="text-xs mb-1 text-white/60 pl-1">Sim</div>
                            <div className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words bg-white/10 border border-white/15 text-white ${!didAnimateWelcome ? 'ios-pop' : ''}`}>
                              {"Hey. I'm Sim. Tell me what you want, I'll make it happen."}
                            </div>
                          </div>
                        </div>
                        {personaMessages.map(m => (
                          <div key={m.id} className={`text-sm flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`${m.role === 'user' ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                              <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                                {m.role === 'user' ? 'You' : 'Sim'}
                              </div>
                              <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'} ${!suppressBubbleAnimation && bubbleAnimatingIds.has(m.id) ? 'ios-pop' : ''}`}>
                                {m.parts.map((part, index) => {
                                  switch (part.type) {
                                    case 'text':
                                      return (
                                        <span key={index}>{part.text}</span>
                                      );
                                  }
                                })}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <style jsx>{`
                      .ios-pop { animation: iosPop 420ms cubic-bezier(0.22, 1, 0.36, 1) both; transform-origin: bottom left; }
                      @keyframes iosPop {
                        0% { transform: scale(0.92); opacity: 0; }
                        60% { transform: scale(1.02); opacity: 1; }
                        100% { transform: scale(1); opacity: 1; }
                      }
                      @media (prefers-reduced-motion: reduce) {
                        .ios-pop { animation-duration: 1ms; }
                      }
                    `}</style>
                    <style jsx global>{`
                      .modern-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(56,189,248,0.45) transparent; }
                      .modern-scrollbar::-webkit-scrollbar { width: 9px; height: 9px; }
                      .modern-scrollbar::-webkit-scrollbar-track { background: transparent; }
                      .modern-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(56,189,248,0.45); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
                      .modern-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(56,189,248,0.65); }
                    `}</style>
                  </div>
                )}

                {mode === 'appstore' && (
                  <div className="px-4 py-3">
                    <div className="font-medium mb-2">App Store</div>
                    {appsLoading && <div className="text-sm text-gray-500">Loading…</div>}
                    {appsError && <div className="text-sm text-red-600">{appsError}</div>}
                    {!appsLoading && !appsError && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {appsListing.map((a) => (
                          <div key={a._id} className="border border-white/10 dark:border-white/10 p-2 bg-white text-black hover:bg-white/90 transition-colors">
                            <div className="flex items-center gap-2">
                              <div>{a.icon || '📦'}</div>
                              <div className="font-medium truncate" title={a.name}>{a.name}</div>
                            </div>
                            {a.description && <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{a.description}</div>}
                            <div className="mt-2 flex items-center gap-2">
                              <Button size="sm" className="rounded-none" onClick={() => hostInstallApp(a._id)}>Install</Button>
                              <a href={`/api/store/apps/${a._id}/bundle`} target="_blank" className="text-xs px-2 py-1 border">Download</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {mode === 'visit' && (
                  <div className="px-4 py-3">
                    <div className="font-medium mb-2">Visit Desktops</div>
                    {desktopsLoading && <div className="text-sm text-gray-500">Loading…</div>}
                    {desktopsError && <div className="text-sm text-red-600">{desktopsError}</div>}
                    {!desktopsLoading && !desktopsError && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {desktopsListing.map((d) => (
                          <div key={d._id} className="border border-white/10 dark:border-white/10 p-2 bg-white text-black hover:bg-white/90 transition-colors">
                            <div className="flex items-center gap-2">
                              <div>{d.icon || '🖥️'}</div>
                              <div className="font-medium truncate" title={d.title}>{d.title}</div>
                            </div>
                            {d.description && <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{d.description}</div>}
                            <div className="mt-2 flex items-center gap-2">
                              <a href={`/d/${d._id}`} className="text-xs px-2 py-1 bg-black text-white">Open</a>
                              <a href={`/api/visit/desktops/${d._id}/snapshot`} target="_blank" className="text-xs px-2 py-1 border">Download</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {mode === 'media' && (
                  <div className="px-4 py-6">
                    <div className="font-medium mb-2">Media Library</div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">Coming soon. Browse, upload, and use media in prompts.</div>
                  </div>
                )}
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
