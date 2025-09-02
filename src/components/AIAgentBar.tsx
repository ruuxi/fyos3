'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, ChevronDown, MessageCircle } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useWebContainer } from './WebContainerProvider';

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pendingToolPromises = useRef(new Set<Promise<void>>());
  const { instance, mkdir, writeFile, readFile, readdirRecursive, remove, spawn } = useWebContainer();

  const { messages, sendMessage, status, stop, addToolResult } = useChat({
    id: 'agent-chat',
    transport: new DefaultChatTransport({ api: '/api/agent' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return; // not expected here, but keep safe

      // Guard: WebContainer must be ready for client tools
      if (!instance) {
        // Immediately fail tool if container is not ready
        addToolResult({
          tool: toolCall.toolName as any,
          toolCallId: toolCall.toolCallId,
          output: { error: 'WebContainer is not ready yet.' },
        });
        return;
      }

      const p = (async () => {
        try {
          switch (toolCall.toolName) {
            case 'web_fs_find': {
              const { root = '.', maxDepth = 10 } = toolCall.input as any;
              const results = await readdirRecursive(root, maxDepth);
              addToolResult({ tool: 'web_fs_find', toolCallId: toolCall.toolCallId, output: results });
              break;
            }
            case 'web_fs_read': {
              const { path, encoding = 'utf-8' } = toolCall.input as any;
              const content = await readFile(path, encoding);
              addToolResult({ tool: 'web_fs_read', toolCallId: toolCall.toolCallId, output: content });
              break;
            }
            case 'web_fs_write': {
              const { path, content, createDirs = true } = toolCall.input as any;
              if (createDirs) {
                const dir = path.split('/').slice(0, -1).join('/') || '.';
                await mkdir(dir, true);
              }
              await writeFile(path, content);
              addToolResult({ tool: 'web_fs_write', toolCallId: toolCall.toolCallId, output: { ok: true } });
              break;
            }
            case 'web_fs_mkdir': {
              const { path, recursive = true } = toolCall.input as any;
              await mkdir(path, recursive);
              addToolResult({ tool: 'web_fs_mkdir', toolCallId: toolCall.toolCallId, output: { ok: true } });
              break;
            }
            case 'web_fs_rm': {
              const { path, recursive = true } = toolCall.input as any;
              await remove(path, { recursive });
              addToolResult({ tool: 'web_fs_rm', toolCallId: toolCall.toolCallId, output: { ok: true } });
              break;
            }
            case 'web_exec': {
              const { command, args = [], cwd } = toolCall.input as any;
              const result = await spawn(command, args, { cwd });
              addToolResult({ tool: 'web_exec', toolCallId: toolCall.toolCallId, output: result });
              break;
            }
            case 'create_app': {
              const { name, icon } = toolCall.input as any;
              const id = crypto.randomUUID();
              const base = `apps/${id}`;
              await mkdir(base, true);
              const metadata = {
                id,
                name,
                icon: icon ?? '📦',
                createdAt: Date.now(),
              };
              await writeFile(`${base}/metadata.json`, JSON.stringify(metadata, null, 2));
              // minimal entry file
              const appIndex = `export default function App(){return React.createElement('div', null, '${name}');}`;
              await writeFile(`${base}/index.js`, appIndex);
              addToolResult({ tool: 'create_app', toolCallId: toolCall.toolCallId, output: { id, path: base } });
              break;
            }
            default:
              // Unknown tool on client
              addToolResult({ tool: toolCall.toolName as any, toolCallId: toolCall.toolCallId, output: { error: `Unhandled client tool: ${toolCall.toolName}` } });
          }
        } catch (err: any) {
          addToolResult({ tool: toolCall.toolName as any, toolCallId: toolCall.toolCallId, output: { error: String(err?.message ?? err) } });
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
                        const id = part.toolCallId;
                        if (part.state === 'output-available') {
                          return (
                            <div key={id} className="rounded-md border border-blue-200 bg-blue-50 text-blue-900 p-2">
                              <div className="font-medium">Plan</div>
                              <ul className="list-disc pl-5 text-sm">
                                {(part.output as any).steps?.map((s: string, i: number) => (
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
                        const id = (part as any).toolCallId;
                        const label = part.type.replace('tool-', '');
                        switch (part.state) {
                          case 'input-streaming':
                            return <div key={id} className="text-xs text-gray-500">{label}...</div>;
                          case 'input-available':
                            return (
                              <pre key={id} className="text-xs bg-gray-50 border rounded p-2 overflow-auto max-h-40">{JSON.stringify((part as any).input, null, 2)}</pre>
                            );
                          case 'output-available':
                            return (
                              <pre key={id} className="text-xs bg-green-50 border border-green-200 rounded p-2 overflow-auto max-h-40">{JSON.stringify((part as any).output, null, 2)}</pre>
                            );
                          case 'output-error':
                            return <div key={id} className="text-xs text-red-600">Error: {(part as any).errorText}</div>;
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
