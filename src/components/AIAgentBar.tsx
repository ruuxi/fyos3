'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, ChevronDown, MessageCircle, ArrowDown, Square } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';
import { enqueuePersist, persistNow } from '@/utils/vfs-persistence';

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [latestMessageId, setLatestMessageId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousMessageCount = useRef(0);
  
  // TODO(human): Add user preference learning system here
  // Consider implementing adaptive scroll behavior based on user patterns:
  // - Track manual scroll frequency vs auto-scroll acceptance
  // - Adjust "nearBottom" threshold (currently 100px) based on user behavior
  // - Store preferences in localStorage for session persistence
  // - Learn from scroll timing patterns (quick scroll = intentional viewing)
  // This could significantly improve UX by personalizing the scroll experience
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  // Keep latest instance and fs helpers in refs so tool callbacks don't capture stale closures
  const instanceRef = useRef(instance);
  const fnsRef = useRef({ mkdir, writeFile, readFile, readdirRecursive, remove, spawn });
  useEffect(() => { instanceRef.current = instance; }, [instance]);
  useEffect(() => { fnsRef.current = { mkdir, writeFile, readFile, readdirRecursive, remove, spawn }; }, [mkdir, writeFile, readFile, readdirRecursive, remove, spawn]);

  // Scroll management functions
  const checkScrollPosition = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    const nearBottom = distanceFromBottom <= 100;
    const shouldShowButton = distanceFromBottom > 50;
    
    setIsNearBottom(nearBottom);
    setShowScrollToBottom(shouldShowButton);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!messagesContainerRef.current) return;
    
    messagesContainerRef.current.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    setHasNewMessage(false);
    setShowScrollToBottom(false);
  }, []);

  // Keyboard shortcut for scroll to bottom (Ctrl/Cmd + End)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'End') {
        event.preventDefault();
        scrollToBottom();
      }
    };

    if (!isCollapsed) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isCollapsed, scrollToBottom]);

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
              } catch {
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

  // Auto-scroll for new messages when user is near bottom
  useEffect(() => {
    if (messages.length > previousMessageCount.current) {
      const lastMessage = messages[messages.length - 1];
      const hasNewAgentMessage = lastMessage?.role === 'assistant';
      
      if (hasNewAgentMessage) {
        setHasNewMessage(true);
        setLatestMessageId(lastMessage.id);
        
        // Auto-scroll if user is near bottom, otherwise just show indicator
        if (isNearBottom) {
          setTimeout(() => scrollToBottom(), 100);
        }
        
        // Clear highlight after 3 seconds
        setTimeout(() => setLatestMessageId(null), 3000);
      }
      
      previousMessageCount.current = messages.length;
    }
  }, [messages, isNearBottom, scrollToBottom]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  const handleSendStopClick = () => {
    if (status === 'submitted' || status === 'streaming') {
      stop();
    } else {
      if (!input.trim()) return;
      sendMessage({ text: input });
      setInput('');
    }
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

          {/* Messages */}
          <div 
            ref={messagesContainerRef}
            onScroll={checkScrollPosition}
            className="max-h-72 overflow-auto px-4 pt-2 space-y-3 relative custom-scrollbar"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(96, 165, 250, 0.3) transparent'
            }}
          >
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
                      case 'tool-create_app': {
                        const id = (part as { toolCallId: string }).toolCallId;
                        const label = part.type.replace('tool-', '');
                        switch (part.state) {
                          case 'input-streaming':
                            return <div key={id} className="text-xs text-white/60">{label}...</div>;
                          case 'input-available':
                            return (
                              <pre key={id} className="text-xs bg-[rgba(5,7,11,0.6)] border border-white/10 rounded p-2 overflow-auto max-h-40 text-white/80">{JSON.stringify((part as { input?: unknown }).input, null, 2)}</pre>
                            );
                          case 'output-available':
                            return (
                              <pre key={id} className="text-xs bg-[rgba(96,165,250,0.1)] border border-[#60a5fa]/30 rounded p-2 overflow-auto max-h-40 text-white/90">{JSON.stringify((part as { output?: unknown }).output, null, 2)}</pre>
                            );
                          case 'output-error':
                            return <div key={id} className="text-xs text-[#ff5f57]">Error: {(part as { errorText?: string }).errorText}</div>;
                        }
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
                  onClick={() => scrollToBottom()}
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
                  placeholder="Ask the AI agent… Try: ‘Create a Notes app on the desktop and install zustand’"
                  className="min-h-[40px] max-h-32 resize-none pr-12 bg-[rgba(5,7,11,0.5)] border-white/20 text-white placeholder:text-white/50 focus-visible:border-[#60a5fa]/50 focus-visible:ring-[#60a5fa]/20"
                  rows={1}
                  disabled={status === 'submitted' || status === 'streaming'}
                />
                <div className="absolute right-2 bottom-2 text-xs text-gray-400">
                  {input.length > 0 && status === 'ready' ? `${input.length} chars` : ''}
                </div>
              </div>

              <Button 
                type="button" 
                onClick={handleSendStopClick}
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
