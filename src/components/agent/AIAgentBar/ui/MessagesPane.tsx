import type { RefObject } from 'react';
import { formatBytes } from '@/lib/agent/agentUtils';

export type MessagesPaneProps = {
  messages: Array<any>;
  status: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesInnerRef: RefObject<HTMLDivElement | null>;
  containerHeight: number;
  didAnimateWelcome: boolean;
  bubbleAnimatingIds: Set<string>;
};

export default function MessagesPane(props: MessagesPaneProps) {
  const { messages, status, messagesContainerRef, messagesInnerRef, containerHeight, didAnimateWelcome, bubbleAnimatingIds } = props;
  return (
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
        {messages.length === 0 && (
          <div className="text-sm flex justify-start" aria-label="Welcome message">
            <div className="max-w-full flex-1">
              <div className="text-xs mb-1 text-white/60 pl-1">AI Agent</div>
              <div className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words bg-white/10 border border-white/15 text-white ${!didAnimateWelcome ? 'ios-pop' : ''}`}>
                {"Hello! I'm your AI assistant. I can help you create apps, modify files, and manage your WebContainer workspace."}
              </div>
            </div>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`text-sm flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`${m.role === 'user' ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
              <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                {m.role === 'user' ? 'You' : 'AI Agent'}
              </div>
              <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'} ${bubbleAnimatingIds.has(m.id) ? 'ios-pop' : ''}`}>
                {m.parts.map((part: any, index: number) => {
                  switch (part.type) {
                    case 'text':
                      return (<span key={index}>{part.text}</span>);
                    case 'tool-result': {
                      const payload = part.result ?? part.output ?? null;
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
                                  {isImage && (<img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />)}
                                  {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                                  {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                                  {contentType && size && (<div className="text-xs text-white/60 mt-1">{contentType} • {formatBytes(size)}</div>)}
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      if (payload?.publicUrl && payload?.contentType) {
                        const { publicUrl, contentType, size } = payload;
                        const isImage = contentType.startsWith('image/');
                        const isAudio = contentType.startsWith('audio/');
                        const isVideo = contentType.startsWith('video/');
                        return (
                          <div key={index} className="mt-2">
                            {isImage && (<img src={publicUrl} alt="Uploaded content" className="w-full rounded max-w-sm" />)}
                            {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                            {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                            {size && (<div className="text-xs text-white/60 mt-1">{contentType} • {formatBytes(size)}</div>)}
                          </div>
                        );
                      }
                      return (<pre key={index} className="text-xs bg-black/20 rounded p-2 mt-2 overflow-auto">{JSON.stringify(payload, null, 2)}</pre>);
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
  );
}


