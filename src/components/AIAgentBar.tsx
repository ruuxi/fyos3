'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, ChevronDown, MessageCircle } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';
import { enqueuePersist, persistNow } from '@/utils/vfs-persistence';

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { fnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  async function waitForInstance(timeoutMs = 4000, intervalMs = 100) {
    const start = Date.now();
    while (!instanceRef.current && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return instanceRef.current;
  }

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

      const p = (async () => {
        try {
          switch (tc.toolName) {
            case 'web_fs_find': {
              const { root = '.', maxDepth = 10 } = (tc.input as { root?: string; maxDepth?: number }) ?? {};
              const results = await fnsRef.current.readdirRecursive(root, maxDepth);
              addToolResult({ tool: 'web_fs_find', toolCallId: tc.toolCallId, output: results });
              break;
            }
            case 'web_fs_read': {
              const { path, encoding = 'utf-8' } = tc.input as { path: string; encoding?: 'utf-8' | 'base64' };
              const content = await fnsRef.current.readFile(path, encoding);
              addToolResult({ tool: 'web_fs_read', toolCallId: tc.toolCallId, output: content });
              break;
            }
            case 'web_fs_write': {
              const { path, content, createDirs = true } = tc.input as { path: string; content: string; createDirs?: boolean };
              if (createDirs) {
                const dir = path.split('/').slice(0, -1).join('/') || '.';
                await fnsRef.current.mkdir(dir, true);
              }
              await fnsRef.current.writeFile(path, content);
              addToolResult({ tool: 'web_fs_write', toolCallId: tc.toolCallId, output: { ok: true } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              break;
            }
            case 'web_fs_mkdir': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              await fnsRef.current.mkdir(path, recursive);
              addToolResult({ tool: 'web_fs_mkdir', toolCallId: tc.toolCallId, output: { ok: true } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              break;
            }
            case 'web_fs_rm': {
              const { path, recursive = true } = tc.input as { path: string; recursive?: boolean };
              await fnsRef.current.remove(path, { recursive });
              addToolResult({ tool: 'web_fs_rm', toolCallId: tc.toolCallId, output: { ok: true } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              break;
            }
            case 'web_exec': {
              const { command, args = [], cwd } = tc.input as { command: string; args?: string[]; cwd?: string };
              const result = await fnsRef.current.spawn(command, args, { cwd });
              addToolResult({ tool: 'web_exec', toolCallId: tc.toolCallId, output: result });
              // Heuristically persist after package manager or file-changing commands
              try {
                if (instanceRef.current) {
                  const cmd = `${command} ${args.join(' ')}`;
                  if (/(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update)|git\s+(checkout|switch|merge|apply)/i.test(cmd)) {
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
              addToolResult({ tool: 'create_app', toolCallId: tc.toolCallId, output: { id, path: base } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              break;
            }
            case 'rename_app': {
              const { id, name } = tc.input as { id: string; name: string };
              const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
              const registry = JSON.parse(regRaw) as Array<{ id: string; name: string; icon?: string; path: string }>;
              const idx = registry.findIndex((r) => r.id === id);
              if (idx === -1) throw new Error('App not found in registry');
              registry[idx].name = name;
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(registry, null, 2));
              addToolResult({ tool: 'rename_app', toolCallId: tc.toolCallId, output: { ok: true } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
              break;
            }
            case 'remove_app': {
              const { id } = tc.input as { id: string };
              // Remove from registry
              let reg: Array<{ id: string; name: string; icon?: string; path: string }> = [];
              try {
                const regRaw = await fnsRef.current.readFile('public/apps/registry.json', 'utf-8');
                reg = JSON.parse(regRaw);
              } catch {}
              const next = reg.filter((r) => r.id !== id);
              await fnsRef.current.writeFile('public/apps/registry.json', JSON.stringify(next, null, 2));
              // Remove folder: try src/apps/<id> first, then src/apps/app-<id>
              const p1 = `src/apps/${id}`;
              const p2 = `src/apps/app-${id}`;
              try { await fnsRef.current.remove(p1, { recursive: true }); } catch {}
              try { await fnsRef.current.remove(p2, { recursive: true }); } catch {}
              addToolResult({ tool: 'remove_app', toolCallId: tc.toolCallId, output: { ok: true } });
              try { if (instanceRef.current) enqueuePersist(instanceRef.current); } catch {}
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
      })();
      pendingToolPromises.current.add(p);
      p.finally(() => pendingToolPromises.current.delete(p));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <div className="bg-gray-600 hover:bg-gray-700 text-white rounded-full p-3 shadow-lg cursor-pointer transition-all duration-200 hover:scale-105">
          <Button
            onClick={() => setIsCollapsed(false)}
            variant="ghost"
            size="sm"
            className="p-0 h-auto text-white hover:text-white hover:bg-transparent relative"
          >
            <MessageCircle className="w-6 h-6" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
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
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between p-3 text-black">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm">AI Agent</span>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                onClick={() => setIsCollapsed(true)}
                variant="ghost"
                size="sm"
                className="p-1 h-auto text-white hover:text-white bg-gray-400 hover:bg-gray-800"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="max-h-72 overflow-auto px-4 pt-2 space-y-3">
            {messages.map(m => (
              <div key={m.id} className="text-sm">
                <div className="font-semibold text-gray-700 mb-1">{m.role === 'user' ? 'You' : 'Agent'}</div>
                <div className="space-y-2">
                  {m.parts.map((part, index) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <div key={index} className="whitespace-pre-wrap text-gray-800">{part.text}</div>
                        );
                      case 'tool-submit_plan': {
                        const id = (part as { toolCallId: string }).toolCallId;
                        if (part.state === 'output-available') {
                          return (
                            <div key={id} className="rounded-md border border-blue-200 bg-blue-50 text-blue-900 p-2">
                              <div className="font-medium">Plan</div>
                              <ul className="list-disc pl-5 text-sm">
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
                      case 'tool-create_app': {
                        const id = (part as { toolCallId: string }).toolCallId;
                        const label = part.type.replace('tool-', '');
                        switch (part.state) {
                          case 'input-streaming':
                            return <div key={id} className="text-xs text-gray-500">{label}...</div>;
                          case 'input-available':
                            return (
                              <pre key={id} className="text-xs bg-gray-50 border rounded p-2 overflow-auto max-h-40">{JSON.stringify((part as { input?: unknown }).input, null, 2)}</pre>
                            );
                          case 'output-available':
                            return (
                              <pre key={id} className="text-xs bg-green-50 border border-green-200 rounded p-2 overflow-auto max-h-40">{JSON.stringify((part as { output?: unknown }).output, null, 2)}</pre>
                            );
                          case 'output-error':
                            return <div key={id} className="text-xs text-red-600">Error: {(part as { errorText?: string }).errorText}</div>;
                        }
                      }
                    }
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Input Bar */}
          <form onSubmit={onSubmit} className="p-4">
            <div className="flex items-center space-x-3">
              <div className="flex-1 relative">
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask the AI agent… Try: ‘Create a Notes app on the desktop and install zustand’"
                  className="min-h-[40px] max-h-32 resize-none pr-12"
                  rows={1}
                  disabled={status === 'submitted' || status === 'streaming'}
                />
                <div className="absolute right-2 bottom-2 text-xs text-gray-400">
                  {status === 'submitted' || status === 'streaming' ? 'Working…' : input.length > 0 ? `${input.length} chars` : ''}
                </div>
              </div>

              <Button type="submit" disabled={!input.trim() || status !== 'ready'} size="sm" className="h-10">
                <Send className="w-4 h-4" />
              </Button>
              {(status === 'submitted' || status === 'streaming') && (
                <Button type="button" onClick={() => stop()} variant="ghost" size="sm" className="h-10">Stop</Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
