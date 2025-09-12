'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Search, Store, Monitor, Image as ImageIcon, Home, Paperclip, X } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';
import { useScreens } from './ScreensProvider';
import { persistAssetsFromAIResult } from '@/utils/ai-media';
import { autoIngestInputs } from '@/utils/auto-ingest';
import { agentLogger } from '@/lib/agentLogger';
// Persistence is handled by WebContainer visibility/unload hooks

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'compact' | 'chat' | 'visit' | 'media'>('chat');
  const [attachments, setAttachments] = useState<Array<{ name: string; publicUrl: string; contentType: string }>>([]);
  const { goTo, activeIndex } = useScreens();
  const [desktopsListing, setDesktopsListing] = useState<Array<{ _id: string; title: string; description?: string; icon?: string }>>([]);
  const [desktopsLoading, setDesktopsLoading] = useState(false);
  const [desktopsError, setDesktopsError] = useState<string | null>(null);
  const [didAnimateWelcome, setDidAnimateWelcome] = useState(false);
  const [bubbleAnimatingIds, setBubbleAnimatingIds] = useState<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  // Media panel state
  type MediaItem = { _id: string; contentType: string; publicUrl?: string; r2Key: string; createdAt: number; size?: number };
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaType, setMediaType] = useState<string>('');
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');

  function formatBytes(n?: number): string {
    if (!n || n <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  async function loadMedia() {
    if (mode !== 'media') return;
    setMediaLoading(true); setMediaError(null);
    try {
      const params = new URLSearchParams();
      if (mediaType) params.set('type', mediaType);
      params.set('limit', '100');
      const res = await fetch(`/api/media/list?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setMediaItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      setMediaError(e?.message || 'Failed to load');
    } finally {
      setMediaLoading(false);
    }
  }

  useEffect(() => { if (mode === 'media') { void loadMedia(); } }, [mode, mediaType]);

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadBusy(true); setUploadError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Read failed'));
          reader.readAsDataURL(file);
        });
        const body: any = { base64, contentType: file.type || undefined, metadata: { filename: file.name } };
        const res = await fetch('/api/media/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Upload failed (${res.status})`);
        }
        // Optional: const json = await res.json();
      }
      await loadMedia();
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleIngestFromUrl() {
    const url = ingestUrl.trim();
    if (!url) return;
    setUploadBusy(true); setUploadError(null);
    try {
      const res = await fetch('/api/media/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl: url }) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Ingest failed (${res.status})`);
      }
      setIngestUrl('');
      await loadMedia();
    } catch (e: any) {
      setUploadError(e?.message || 'Ingest failed');
    } finally {
      setUploadBusy(false);
    }
  }

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
      const viewportCap = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : MAX_CONTAINER_HEIGHT;
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
  });

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

  // Store classification in a ref so it persists across renders
  const classificationRef = useRef<any>(null);

  const { messages, sendMessage, status, stop, addToolResult } = useChat({
    id: 'agent-chat',
    transport: new DefaultChatTransport({ 
      api: '/api/agent',
      prepareSendMessagesRequest({ messages, id }) {
        // Include classification if available
        const body: any = { messages, id };
        if (classificationRef.current) {
          body.classification = classificationRef.current;
          // Clear classification after use
          classificationRef.current = null;
        }
        return { body };
      }
    }),
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
        const startTime = Date.now();
        
        // Helper function to log tool call and add result
        const logAndAddResult = async (output: any) => {
          const duration = Date.now() - startTime;
          addToolResult({ tool: tc.toolName as string, toolCallId: tc.toolCallId, output });
          
          // Log to our simplified conversation flow
          try {
            await agentLogger.logToolCall('client', tc.toolName, tc.toolCallId, tc.input, output, duration);
          } catch (err) {
            console.warn('Failed to log tool call:', err);
          }
        };
        
        try {
          switch (tc.toolName) {
            case 'fs_find': {
              const { root = '.', maxDepth = 10, glob, prefix, limit = 200, offset = 0 } = (tc.input as { root?: string; maxDepth?: number; glob?: string; prefix?: string; limit?: number; offset?: number }) ?? {};
              console.log(`🔧 [Agent] fs_find: ${root} (depth: ${maxDepth}) glob=${glob ?? '-'} prefix=${prefix ?? '-'} limit=${limit} offset=${offset}`);
              const results = await fnsRef.current.readdirRecursive(root, maxDepth);
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
              const filtered = results.filter((p: any) => typeof p === 'string' ? filterByPrefix(p) && filterByGlob(p) : true);
              const start = Math.max(0, offset || 0);
              const end = Math.min(filtered.length, start + Math.max(1, Math.min(limit || 200, 5000)));
              const page = filtered.slice(start, end);
              const nextOffset = end < filtered.length ? end : null;
              console.log(`📊 [Agent] fs_find matched ${filtered.length} items; returning ${page.length} (offset ${start})`);
              await logAndAddResult({ files: page, count: page.length, total: filtered.length, root, offset: start, nextOffset, hasMore: end < filtered.length, applied: { glob: !!glob, prefix: !!prefix } });
              break;
            }
            case 'fs_read': {
              const { path, encoding = 'utf-8' } = tc.input as { path: string; encoding?: 'utf-8' | 'base64' };
              console.log(`🔧 [Agent] fs_read: ${path} (${encoding})`);
              const content = await fnsRef.current.readFile(path, encoding);
              const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
              await logAndAddResult({ content, path, size: `${sizeKB}KB` });
              break;
            }
            case 'fs_write': {
              const { path, content, createDirs = true } = tc.input as { path: string; content: string; createDirs?: boolean };
              const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
              console.log(`🔧 [Agent] fs_write: ${path} (${sizeKB}KB)`);
              
              if (createDirs) {
                const dir = path.split('/').slice(0, -1).join('/') || '.';
                await fnsRef.current.mkdir(dir, true);
              }
              await fnsRef.current.writeFile(path, content);
              await logAndAddResult({ ok: true, path, size: `${sizeKB}KB` });

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
            case 'fs_mkdir': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] fs_mkdir: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.mkdir(path, recursive);
              addToolResult({ tool: 'fs_mkdir', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });
              break;
            }
            case 'fs_rm': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              console.log(`🔧 [Agent] fs_rm: ${path} ${recursive ? '(recursive)' : ''}`);
              await fnsRef.current.remove(path, { recursive });
              addToolResult({ tool: 'fs_rm', toolCallId: tc.toolCallId, output: { ok: true, path, recursive } });
              break;
            }
            case 'exec': {
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
              console.log(`🔧 [Agent] exec: ${fullCommand} ${cwd ? `(cwd: ${cwd})` : ''}`);
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
                  tool: 'exec',
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
                  tool: 'exec',
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
              let registry: Array<{ id: string; name: string; icon?: string; path: string }>; 
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                registry = JSON.parse(regRaw);
              } catch {
                registry = [];
              }
              // Deduplicate name/id using one registry read
              let finalName = name;
              let finalId = requestedId;
              const existingNames = new Set(registry.map(app => app.name));
              const existingIds = new Set(registry.map(app => app.id));
              let counter = 1;
              while (existingNames.has(finalName)) { finalName = `${name} (${counter})`; counter++; }
              counter = 1;
              while (existingIds.has(finalId)) { finalId = `${requestedId}-${counter}`; counter++; }

              const base = `src/apps/${finalId}`;
              console.log(`🔧 [Agent] create_app: "${finalName}" -> ${base} (${icon ?? '📦'})`);

              await fnsRef.current.mkdir(base, true);
              const metadata = { id: finalId, name: finalName, icon: icon ?? '📦', createdAt: Date.now() };
              await fnsRef.current.writeFile(`${base}/metadata.json`, JSON.stringify(metadata, null, 2));
              const appIndexTsx = `import React from 'react'\nimport '/src/tailwind.css'\nimport './styles.css'\nexport default function App(){\n  return (\n    <div className=\"h-full overflow-auto bg-gradient-to-b from-white to-slate-50\">\n      <div className=\"sticky top-0 bg-white/80 backdrop-blur border-b px-3 py-2\">\n        <div className=\"font-semibold tracking-tight\">${finalName}</div>\n      </div>\n      <div className=\"p-3 space-y-3\">\n        <div className=\"rounded-lg border bg-white shadow-sm p-3\">\n          <p className=\"text-slate-600 text-sm\">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>\n        </div>\n      </div>\n    </div>\n  )\n}`;
              await fnsRef.current.writeFile(`${base}/index.tsx`, appIndexTsx);
              const appStylesCss = `:root{--app-accent:#22c55e;}\nbody{font-family:Inter,ui-sans-serif,system-ui,Arial}\na{color:var(--app-accent)}`;
              await fnsRef.current.writeFile(`${base}/styles.css`, appStylesCss);
              
              // Create initial plan.md file
              const planMd = `# ${finalName} Implementation Plan

## Overview
[Brief description of the app's purpose and main functionality]

## Features
- [ ] Feature 1: Description
- [ ] Feature 2: Description
- [ ] Feature 3: Description

## Component Structure
- Main container with scrollable content
- Header with app title
- [Additional components based on app needs]

## Implementation Steps
- [ ] Set up basic app structure and layout
- [ ] Implement core functionality
- [ ] Add interactive elements and state management
- [ ] Style components according to app purpose
- [ ] Add error handling and edge cases
- [ ] Test all features
- [ ] Polish UI and animations

## Technical Considerations
- State management approach
- Data persistence (if needed)
- Performance optimizations
- Accessibility requirements

## UI/UX Design
- Color scheme based on app purpose
- Layout approach
- Interactive feedback patterns
- Responsive design considerations

## Notes
Created: ${new Date().toISOString()}
App ID: ${finalId}
`;
              await fnsRef.current.writeFile(`${base}/plan.md`, planMd);
              
              // Update registry once
              registry.push({ id: finalId, name: finalName, icon: metadata.icon, path: `/${base}/index.tsx` });
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              // Notify desktop to open the newly created app after a short delay
              try {
                const appIndexPath = `/${base}/index.tsx`;
                if (typeof window !== 'undefined') {
                  window.postMessage({ type: 'FYOS_OPEN_APP', delayMs: 2000, app: { id: finalId, name: finalName, icon: metadata.icon, path: appIndexPath } }, '*');
                }
              } catch {}
              console.log(`✅ [Agent] App created: ${finalName} (${finalId})`);
              await logAndAddResult({ id: finalId, path: base, name: finalName, icon: metadata.icon });
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
              const { scope = 'quick', files = [] } = tc.input as { scope?: 'quick'; files?: string[] };
              console.log(`🔧 [Agent] validate_project: scope=${scope} files=${files.length}`);
              await runValidation(scope, files);
              addToolResult({ tool: 'validate_project', toolCallId: tc.toolCallId, output: { ok: true, scope, files } });
              break;
            }
            case 'ai_fal': {
              const { model, input, scope } = tc.input as { model: string; input: Record<string, any>; scope?: { desktopId?: string; appId?: string; appName?: string } };
              console.log(`🔧 [Agent] ai_fal: model=${model}`);
              try {
                // Auto-ingest any external URLs or base64 data in the input
                const { processedInput, ingestedCount } = await autoIngestInputs(input, scope);
                if (ingestedCount > 0) {
                  console.log(`🔄 [Agent] ai_fal: auto-ingested ${ingestedCount} media items`);
                }
                
                const res = await fetch('/api/ai/fal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model, input: processedInput }),
                });
                if (!res.ok) {
                  throw new Error(`FAL API error: ${res.status} ${res.statusText}`);
                }
                const json = await res.json();
                const { result: updated, persistedAssets } = await persistAssetsFromAIResult(json, scope);
                addToolResult({
                  tool: 'ai_fal',
                  toolCallId: tc.toolCallId,
                  output: { ok: true, result: updated, persistedAssets, autoIngestedCount: ingestedCount },
                });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addToolResult({ tool: 'ai_fal', toolCallId: tc.toolCallId, output: { error: message } });
              }
              break;
            }
            case 'ai_eleven_music': {
              const input = tc.input as { prompt: string; musicLengthMs?: number; outputFormat?: string; scope?: { desktopId?: string; appId?: string; appName?: string } };
              const { scope, ...params } = input;
              console.log(`🔧 [Agent] ai_eleven_music: ${params.prompt.slice(0, 50)}...`);
              try {
                // Auto-ingest any external URLs or base64 data in the params
                const { processedInput: processedParams, ingestedCount } = await autoIngestInputs(params, scope);
                if (ingestedCount > 0) {
                  console.log(`🔄 [Agent] ai_eleven_music: auto-ingested ${ingestedCount} media items`);
                }
                
                const res = await fetch('/api/ai/eleven', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(processedParams),
                });
                if (!res.ok) {
                  throw new Error(`ElevenLabs API error: ${res.status} ${res.statusText}`);
                }
                const json = await res.json();
                const { result: updated, persistedAssets } = await persistAssetsFromAIResult(json, scope);
                addToolResult({
                  tool: 'ai_eleven_music',
                  toolCallId: tc.toolCallId,
                  output: { ok: true, result: updated, persistedAssets, autoIngestedCount: ingestedCount },
                });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addToolResult({ tool: 'ai_eleven_music', toolCallId: tc.toolCallId, output: { error: message } });
              }
              break;
            }
            case 'media_list': {
              const input = tc.input as { type?: string; appId?: string; desktopId?: string; from?: string; to?: string; limit?: number };
              console.log(`🔧 [Agent] media_list: type=${input.type || 'all'} limit=${input.limit || 20}`);
              try {
                const params = new URLSearchParams();
                if (input.type) params.set('type', input.type);
                if (input.appId) params.set('appId', input.appId);
                if (input.desktopId) params.set('desktopId', input.desktopId);
                if (input.from) params.set('from', input.from);
                if (input.to) params.set('to', input.to);
                if (input.limit) params.set('limit', input.limit.toString());
                
                const res = await fetch(`/api/media/list?${params.toString()}`);
                if (!res.ok) {
                  throw new Error(`Media list error: ${res.status} ${res.statusText}`);
                }
                const result = await res.json();
                addToolResult({ tool: 'media_list', toolCallId: tc.toolCallId, output: { items: result.items || [] } });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addToolResult({ tool: 'media_list', toolCallId: tc.toolCallId, output: { error: message } });
              }
              break;
            }
            case 'code_edit_ast': {
              const input = tc.input as { path: string; action: 'upsertImport' | 'updateFunctionBody' | 'replaceJsxElement' | 'replaceJsxAttributes' | 'insertAfterLastImport' | 'insertAtTop'; selector?: any; payload?: any; dryRun?: boolean };
              console.log(`🔧 [Agent] code_edit_ast: ${input.action} on ${input.path} (dryRun: ${input.dryRun || false})`);
              try {
                // Read the file content
                const content = await fnsRef.current.readFile(input.path, 'utf-8');
                
                // Lazy-load the AST editor to minimize initial bundle size
                const { applyAstEdit } = await import('@/lib/code-edit/recastEdit');
                
                // Apply the AST transformation
                const result = await applyAstEdit({ ...input, content, dryRun: input.dryRun || false });
                
                // Write back to file if not a dry run and changes were applied
                if (!input.dryRun && result.applied) {
                  await fnsRef.current.writeFile(input.path, result.code);
                }
                
                // Return result with metadata
                addToolResult({
                  tool: 'code_edit_ast',
                  toolCallId: tc.toolCallId,
                  output: {
                    ok: true,
                    applied: result.applied,
                    edits: result.edits,
                    previewDiff: result.previewDiff,
                    path: input.path,
                    elapsedMs: result.elapsedMs,
                    bytesChanged: result.applied ? Math.abs(result.code.length - content.length) : 0,
                  },
                });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addToolResult({
                  tool: 'code_edit_ast',
                  toolCallId: tc.toolCallId,
                  output: { ok: false, error: message, path: input.path },
                });
              }
              break;
            }
            default:
              // Unknown tool on client
              await logAndAddResult({ error: `Unhandled client tool: ${tc.toolName}` });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await logAndAddResult({ error: message });
        }
      };

      // Run tool asynchronously without global queueing
      const p = (async () => { await task(); })();
      pendingToolPromises.current.add(p);
      p.finally(() => pendingToolPromises.current.delete(p));
    },
  });


  // Recompute container height when returning to chat or when conversation state changes
  useEffect(() => {
    if (mode !== 'chat') return;
    const content = messagesInnerRef.current;
    if (!content) return;
    const contentHeight = content.scrollHeight;
    const viewportCap = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : MAX_CONTAINER_HEIGHT;
    const next = Math.min(viewportCap, Math.max(MIN_CONTAINER_HEIGHT, contentHeight));
    setContainerHeight(next);
  }, [messages.length, mode]);

  // Add pop animation to newly added bubbles (both user and assistant)
  useEffect(() => {
    const currentIds = new Set(messages.map(m => m.id));
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
  }, [messages]);

  // Host-side fetchers for listings (driven by mode)

  useEffect(() => {
    if (mode !== 'visit') return;
    setDesktopsLoading(true); setDesktopsError(null);
    fetch('/api/visit/desktops')
      .then(r => r.json())
      .then(j => setDesktopsListing((j?.desktops || []).map((d: any) => ({ _id: String(d._id), title: d.title, description: d.description, icon: d.icon }))))
      .catch(e => setDesktopsError(e?.message || 'Failed'))
      .finally(() => setDesktopsLoading(false));
  }, [mode]);


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
  }, [messages.length, containerHeight]);

  // Keyboard shortcuts: Cmd/Ctrl+K to open chat, Esc to close overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = (e.key ?? '').toLowerCase();
      const isK = key === 'k';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setMode('chat');
      }
      if (key === 'escape' && mode !== 'compact') {
        e.preventDefault();
        setMode('compact');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Overlay click handled via a fixed backdrop element in the JSX

  // === Automatic diagnostics ===

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

  // Listen for preview runtime errors and automatically send to AI
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce?.detail?.source === 'preview') {
        const detail = ce.detail as any;
        const payload = detail?.content || detail?.description || '';
        if (payload) {
          const hash = stableHash(String(payload));
          if (hash !== lastErrorHashRef.current) {
            lastErrorHashRef.current = hash;
            void autoPostDiagnostic(
              `Preview runtime error detected automatically. Please diagnose and fix this error:\n\n\`\`\`txt\n${payload}\n\`\`\`\n`,
            );
          }
        }
      }
    };
    window.addEventListener('wc-preview-error', handler as EventListener);
    return () => window.removeEventListener('wc-preview-error', handler as EventListener);
  }, [status]);

  // No per-change validation debounce

  async function runValidation(scope: 'quick', changed: string[] = []) {
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


      const final = logs.filter(Boolean).join('\n\n');
         if (final.trim().length > 0) {
           const hash = stableHash(final);
           if (hash !== lastErrorHashRef.current) {
             lastErrorHashRef.current = hash;
             await autoPostDiagnostic(
               `Automatic validation detected issues after recent changes (${changed.join(', ')}). Please fix these errors:\n\n\`\`\`txt\n${final}\n\`\`\`\n`,
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

  const handleFileUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        // Read file as base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix to get just base64
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Upload to media ingest API
        const res = await fetch('/api/media/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            contentType: file.type,
            metadata: { filename: file.name },
          }),
        });

        if (res.ok) {
          const result = await res.json();
          setAttachments(prev => [...prev, {
            name: file.name,
            publicUrl: result.publicUrl,
            contentType: file.type,
          }]);
        } else {
          console.error('Failed to upload file:', file.name);
        }
      } catch (error) {
        console.error('Error uploading file:', file.name, error);
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    forceFollowRef.current = true;
    let userText = input;
    
    // Append attachments if any
    if (attachments.length > 0) {
      userText += '\n\nAttachments:\n' + attachments.map(a => `- ${a.name}: ${a.publicUrl}`).join('\n');
    }
    
    try {
      // First, classify the user's message
      console.log('🏷️ [AIAgentBar] Classifying message...');
      const classifyResponse = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userText, 
          messages: messages // Include conversation history for context
        }),
      });
      
      if (classifyResponse.ok) {
        const classification = await classifyResponse.json();
        console.log('🏷️ [AIAgentBar] Classification result:', classification.taskType);
        // Store classification in ref for the transport to use
        classificationRef.current = classification;
      } else {
        console.error('Classification failed, using default settings');
        classificationRef.current = null;
      }
    } catch (error) {
      console.error('Error classifying message:', error);
      classificationRef.current = null;
    }
    
    // Send message - the transport will include classification if available
    void sendMessage({ text: userText });
    
    setInput('');
    setAttachments([]);
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
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-10 w-10 rounded-none text-white hover:bg-white/10" 
                            onClick={() => goTo(activeIndex === 0 ? 1 : 0)}
                          >
                            {activeIndex === 0 ? (
                              <Home className="h-4 w-4" />
                            ) : (
                              <Store className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-none">
                          {activeIndex === 0 ? 'Back to Desktop' : 'App Store'}
                        </TooltipContent>
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
                    {/* Attachment chips */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2 px-16">
                        {attachments.map((attachment, index) => (
                          <div key={index} className="flex items-center gap-1 bg-white/20 rounded px-2 py-1 text-xs text-white">
                            <span className="truncate max-w-32">{attachment.name}</span>
                            <button
                              onClick={() => removeAttachment(index)}
                              className="hover:bg-white/20 rounded p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
                      disabled={status === 'submitted' || status === 'streaming'}
                    />
                  </div>

                  {/* Right cluster */}
                  <div className="flex items-center gap-2">
                    {(status === 'submitted' || status === 'streaming') && (
                      <Button type="button" onClick={() => { stop(); }} variant="ghost" size="sm" className="h-10 rounded-none">Stop</Button>
                    )}
                    {/* File upload button */}
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*,video/*,audio/*"
                        multiple
                        onChange={(e) => {
                          if (e.target.files) {
                            handleFileUpload(e.target.files);
                            e.target.value = ''; // Reset for re-uploads
                          }
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        id="file-upload"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 rounded-none text-white hover:bg-white/10"
                        asChild
                      >
                        <label htmlFor="file-upload" className="cursor-pointer">
                          <Paperclip className="w-4 h-4" />
                        </label>
                      </Button>
                    </div>
                    <Button type="submit" disabled={!input.trim() || status !== 'ready'} size="sm" className="h-10 rounded-none text-white hover:bg-white/10">
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
              <div className="overflow-hidden" style={{ maxHeight: '70vh' }}>
                <div className="bg-transparent text-white">

                 {mode === 'chat' && (
                   <div className="px-4 pt-3">

                    <div
                      ref={messagesContainerRef}
                      className="overflow-auto pt-2 pb-1 modern-scrollbar pr-3"
                      style={{
                        height: containerHeight > 0 ? `${containerHeight}px` : undefined,
                        maxHeight: '60vh',
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
                            <div className="text-xs mb-1 text-white/60 pl-1">AI Agent</div>
                            <div className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words bg-white/10 border border-white/15 text-white ${!didAnimateWelcome ? 'ios-pop' : ''}`}>
                              {"Hello! I'm your AI assistant. I can help you create apps, modify files, and manage your WebContainer workspace."}
                            </div>
                          </div>
                        </div>
                        {messages.map(m => (
                          <div key={m.id} className={`text-sm flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`${m.role === 'user' ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                              <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                                {m.role === 'user' ? 'You' : 'AI Agent'}
                              </div>
                              <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'} ${bubbleAnimatingIds.has(m.id) ? 'ios-pop' : ''}`}>
                                {m.parts.map((part, index) => {
                                  switch (part.type) {
                                    case 'text':
                                      return (
                                        <span key={index}>{part.text}</span>
                                      );
                                    case 'tool-result': {
                                      const payload = (part as any).result ?? (part as any).output ?? null;
                                      
                                      // Render persisted assets as media players
                                      if (payload?.persistedAssets?.length) {
                                        return (
                                          <div key={index} className="mt-2 space-y-2">
                                            {payload.persistedAssets.map((asset: any, assetIndex: number) => {
                                              const { publicUrl, contentType, size } = asset;
                                              if (!publicUrl) return null;
                                              
                                              const isImage = contentType?.startsWith('image/');
                                              const isAudio = contentType?.startsWith('audio/');
                                              const isVideo = contentType?.startsWith('video/');
                                              
                                              return (
                                                <div key={assetIndex} className="w-full">
                                                  {isImage && (
                                                    <img 
                                                      src={publicUrl} 
                                                      alt="Generated content"
                                                      className="w-full rounded max-w-sm"
                                                    />
                                                  )}
                                                  {isAudio && (
                                                    <audio 
                                                      controls 
                                                      src={publicUrl}
                                                      className="w-full"
                                                    />
                                                  )}
                                                  {isVideo && (
                                                    <video 
                                                      controls 
                                                      src={publicUrl}
                                                      className="w-full rounded max-w-sm"
                                                    />
                                                  )}
                                                  {contentType && size && (
                                                    <div className="text-xs text-white/60 mt-1">
                                                      {contentType} • {formatBytes(size)}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      }
                                      
                                      // Render single media item (from media_ingest)
                                      if (payload?.publicUrl && payload?.contentType) {
                                        const { publicUrl, contentType, size } = payload;
                                        const isImage = contentType.startsWith('image/');
                                        const isAudio = contentType.startsWith('audio/');
                                        const isVideo = contentType.startsWith('video/');
                                        
                                        return (
                                          <div key={index} className="mt-2">
                                            {isImage && (
                                              <img 
                                                src={publicUrl} 
                                                alt="Uploaded content"
                                                className="w-full rounded max-w-sm"
                                              />
                                            )}
                                            {isAudio && (
                                              <audio 
                                                controls 
                                                src={publicUrl}
                                                className="w-full"
                                              />
                                            )}
                                            {isVideo && (
                                              <video 
                                                controls 
                                                src={publicUrl}
                                                className="w-full rounded max-w-sm"
                                              />
                                            )}
                                            {size && (
                                              <div className="text-xs text-white/60 mt-1">
                                                {contentType} • {formatBytes(size)}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      }
                                      
                                      // Fallback: render JSON payload
                                      return (
                                        <pre key={index} className="text-xs bg-black/20 rounded p-2 mt-2 overflow-auto">
                                          {JSON.stringify(payload, null, 2)}
                                        </pre>
                                      );
                                    }
                                    default:
                                      return null;
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
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <select
                        value={mediaType}
                        onChange={(e)=> setMediaType(e.target.value)}
                        className="text-black rounded-none px-2 py-1 text-sm"
                      >
                        <option value="">All</option>
                        <option value="image">Images</option>
                        <option value="audio">Audio</option>
                        <option value="video">Video</option>
                      </select>
                      <Button size="sm" className="rounded-none" onClick={()=>void loadMedia()} disabled={mediaLoading}>Refresh</Button>
                      <div className="ml-auto flex items-center gap-2">
                        <input
                          type="file"
                          multiple
                          onChange={(e)=> void handleUploadFiles(e.target.files)}
                          disabled={uploadBusy}
                          className="text-xs"
                        />
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={ingestUrl}
                            onChange={(e)=> setIngestUrl(e.target.value)}
                            placeholder="Ingest from URL"
                            className="rounded-none text-black px-2 py-1 text-xs w-[220px]"
                            disabled={uploadBusy}
                          />
                          <Button size="sm" className="rounded-none" onClick={()=> void handleIngestFromUrl()} disabled={uploadBusy || !ingestUrl.trim()}>Add</Button>
                        </div>
                      </div>
                    </div>
                    {mediaLoading && <div className="text-sm text-gray-500">Loading…</div>}
                    {mediaError && <div className="text-sm text-red-600">{mediaError}</div>}
                    {uploadError && <div className="text-sm text-red-600">{uploadError}</div>}
                    {!mediaLoading && !mediaError && mediaItems.length === 0 && (
                      <div className="text-sm text-gray-300">No media found.</div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {mediaItems.map((m) => (
                        <div key={m._id} className="border border-white/10 bg-white/5 p-2">
                          <div className="text-xs text-white/70">
                            {new Date(m.createdAt).toLocaleString()} • {formatBytes(m.size)}
                          </div>
                          <div className="mt-2">
                            {m.contentType.startsWith('image/') && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/media/${m._id}`} alt={m.r2Key} className="w-full h-auto" />
                            )}
                            {m.contentType.startsWith('audio/') && (
                              <audio controls src={`/api/media/${m._id}`} className="w-full" />
                            )}
                            {m.contentType.startsWith('video/') && (
                              <video controls src={`/api/media/${m._id}`} className="w-full" />
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <a href={`/api/media/${m._id}`} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border rounded-none">Open</a>
                            <div className="text-xs text-white/70 truncate" title={m.r2Key}>{m.r2Key}</div>
                          </div>
                        </div>
                      ))}
                    </div>
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

