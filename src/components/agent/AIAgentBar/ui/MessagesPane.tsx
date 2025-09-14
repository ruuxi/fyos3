import type { RefObject } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import { formatBytes, guessContentTypeFromFilename } from '@/lib/agent/agentUtils';

export type MessagesPaneProps = {
  messages: Array<any>;
  status: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesInnerRef: RefObject<HTMLDivElement | null>;
  containerHeight: number;
  didAnimateWelcome: boolean;
  bubbleAnimatingIds: Set<string>;
  lastSentAttachments?: Array<{ name: string; publicUrl: string; contentType: string }>;
  activeThreadId?: string;
};

type AttachmentPreview = { name: string; publicUrl: string; contentType: string };

function extractAttachmentsFromText(text: string): { cleanedText: string; items: AttachmentPreview[] } {
  try {
    // Collect attachments from:
    // 1) Legacy block: "Attachments:\n- filename: url"
    // 2) New concise lines: "Attached {contentType}: {url}"
    // 3) Bare media URLs inside the text (e.g., https://.../image.jpg)
    const items: AttachmentPreview[] = [];
    const seenUrls = new Set<string>();
    const bareMediaUrls = new Set<string>();

    const pushItem = (name: string, url: string, contentTypeGuess?: string) => {
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      const guessed = (contentTypeGuess || guessContentTypeFromFilename(name) || '').toLowerCase();
      const isMedia = guessed.startsWith('image/') || guessed.startsWith('audio/') || guessed.startsWith('video/');
      items.push({ name, publicUrl: url, contentType: isMedia ? guessed : (contentTypeGuess || guessed || 'application/octet-stream') });
    };

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Legacy block parsing
    const legacy = text.match(/Attachments:\s*\n([\s\S]*)$/i);
    if (legacy) {
      const section = legacy[1] || '';
      const lines = section.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^[-•]\s*(.+?):\s*(\S+)\s*$/);
        if (!m) continue;
        const name = m[1].trim();
        const url = m[2].trim();
        if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url)) continue;
        const contentType = guessContentTypeFromFilename(name);
        pushItem(name, url, contentType);
      }
    }

    // New concise lines parsing
    const conciseMatches = text.match(/(^|\n)Attached\s+([^:]+):\s+(\S+)/gi) || [];
    for (const line of conciseMatches) {
      const m = line.match(/Attached\s+([^:]+):\s+(\S+)/i);
      if (!m) continue;
      const ct = m[1].trim();
      const url = m[2].trim();
      if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url)) continue;
      pushItem(ct, url, ct);
    }

    // Bare media URLs in free text
    const urlRegex = /https?:\/\/[^\s<>()'"`]+/gi;
    const rawUrls = (text.match(urlRegex) || []) as string[];
    for (let raw of rawUrls) {
      // Trim common trailing punctuation
      const trimmed = raw.replace(/[),.;!?\]\}"']+$/g, '');
      if (!/^https?:\/\//i.test(trimmed)) continue;
      const withoutQuery = trimmed.split('#')[0].split('?')[0];
      const fileName = decodeURIComponent((withoutQuery.split('/').pop() || '').trim());
      const inferred = guessContentTypeFromFilename(fileName);
      const low = (inferred || '').toLowerCase();
      const looksMedia = low.startsWith('image/') || low.startsWith('audio/') || low.startsWith('video/') || /\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|m4v|mkv|mp3|wav|m4a|aac|flac|ogg)$/i.test(withoutQuery);
      if (!looksMedia) continue;
      pushItem(fileName || (inferred || 'media'), trimmed, inferred);
      bareMediaUrls.add(trimmed);
    }

    // Clean text by removing both forms
    let cleanedText = text
      .replace(/\n?Attachments:\s*\n[\s\S]*$/i, '')
      .replace(/\n?The user has uploaded this[^\n]+/gi, '')
      .replace(/\n?Attached\s+[^:]+:\s+\S+/gi, '')
      .trimEnd();

    // Strip recognized bare media URLs from the text
    if (bareMediaUrls.size > 0) {
      for (const u of bareMediaUrls) {
        const re = new RegExp(`\\s*${escapeRegExp(u)}\\s*`, 'g');
        cleanedText = cleanedText.replace(re, match => (match.includes('\n') ? '\n' : ' '));
      }
      cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trimEnd();
    }

    return { cleanedText, items };
  } catch {
    return { cleanedText: text, items: [] };
  }
}

function renderAttachments(items: AttachmentPreview[]) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map((a, idx) => {
        const ct = (a.contentType || '').toLowerCase();
        const isImage = ct.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.publicUrl);
        const isVideo = ct.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(a.publicUrl);
        const isAudio = ct.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(a.publicUrl);
        return (
          <div key={idx} className="w-full">
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.publicUrl} alt={a.name} className="w-full rounded max-w-sm" />
            )}
            {isVideo && (
              <video controls src={a.publicUrl} className="w-full rounded max-w-sm" />
            )}
            {isAudio && (
              <audio controls src={a.publicUrl} className="w-full" />
            )}
            {!isImage && !isVideo && !isAudio && (
              <div className="text-xs text-white/70 break-all">{a.publicUrl}</div>
            )}
            <div className="text-[10px] text-white/60 mt-1 truncate" title={a.name}>{a.name}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function MessagesPane(props: MessagesPaneProps) {
  const { messages, status, messagesContainerRef, messagesInnerRef, containerHeight, didAnimateWelcome, bubbleAnimatingIds, lastSentAttachments, activeThreadId } = props;
  const { isAuthenticated } = useConvexAuth();
  const liveMedia = useQuery(
    convexApi.media.listMedia as any,
    isAuthenticated && activeThreadId ? ({ threadId: activeThreadId as any, limit: 50 } as any) : 'skip'
  ) as Array<{ publicUrl?: string; contentType: string; size?: number; createdAt: number; r2Key: string }> | undefined;
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const lastUserMessageId = lastUserMessage?.id;
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
        {messages.map((m, idx) => {
          // Build content and collect any attachments referenced in text
          const textNodes: any[] = [];
          let collectedFromText: AttachmentPreview[] = [];
          (m.parts || []).forEach((part: any, index: number) => {
            if (part.type === 'text') {
              const { cleanedText, items } = extractAttachmentsFromText(part.text || '');
              if (cleanedText) {
                textNodes.push(<span key={`t-${index}`}>{cleanedText}</span>);
              }
              if (items.length) {
                collectedFromText = collectedFromText.concat(items);
              }
            }
          });
          const isLastUser = m.role === 'user' && m.id === lastUserMessageId;
          const previewItems = collectedFromText.length > 0
            ? collectedFromText
            : (isLastUser && (lastSentAttachments?.length || 0) > 0 ? (lastSentAttachments as AttachmentPreview[]) : []);

          // Determine if this is the last assistant message to attach live media below
          const isAssistant = m.role === 'assistant';
          const isLastAssistant = isAssistant && messages.slice(idx + 1).every(mm => mm.role !== 'assistant');

          return (
            <div key={m.id} className={`text-sm flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`${m.role === 'user' ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                  {m.role === 'user' ? 'You' : 'AI Agent'}
                </div>
                <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'} ${bubbleAnimatingIds.has(m.id) ? 'ios-pop' : ''}`}>
                  {/* Render cleaned text parts first */}
                  {textNodes}
                  {/* Render tool results and media blocks */}
                  {(m.parts || []).map((part: any, index: number) => {
                    if (part.type !== 'tool-result') return null;
                    const payload = part.result ?? part.output ?? null;
                    // Ephemeral assets from provider (surface immediately)
                    if (payload?.ephemeralAssets?.length) {
                      return (
                        <div key={`ep-${index}`} className="mt-2 space-y-2">
                          {payload.ephemeralAssets.map((asset: any, assetIndex: number) => {
                            const { publicUrl, contentType } = asset || {};
                            if (!publicUrl) return null;
                            const isImage = (contentType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(publicUrl);
                            const isAudio = (contentType || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(publicUrl);
                            const isVideo = (contentType || '').startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(publicUrl);
                            return (
                              <div key={assetIndex} className="w-full">
                                {isImage && (<img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />)}
                                {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                                {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    if (payload?.persistedAssets?.length) {
                      return (
                        <div key={`tr-${index}`} className="mt-2 space-y-2">
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
                        <div key={`tr-${index}`} className="mt-2">
                          {isImage && (<img src={publicUrl} alt="Uploaded content" className="w-full rounded max-w-sm" />)}
                          {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                          {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                          {size && (<div className="text-xs text-white/60 mt-1">{contentType} • {formatBytes(size)}</div>)}
                        </div>
                      );
                    }
                    return (<pre key={`tr-${index}`} className="text-xs bg-black/20 rounded p-2 mt-2 overflow-auto">{JSON.stringify(payload, null, 2)}</pre>);
                  })}
                  {/* Render attachments parsed from text or last-sent preview */}
                  {previewItems && previewItems.length > 0 && (
                    <div className="mt-2">{renderAttachments(previewItems)}</div>
                  )}

                  {/* Reactive media: if authenticated and thread-bound media exists, show new thumbnails below last assistant message */}
                  {isLastAssistant && Array.isArray(liveMedia) && liveMedia.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {liveMedia.map((asset, assetIndex) => {
                        const publicUrl = asset.publicUrl || '';
                        if (!publicUrl) return null;
                        const contentType = asset.contentType || '';
                        const isImage = contentType.startsWith('image/');
                        const isAudio = contentType.startsWith('audio/');
                        const isVideo = contentType.startsWith('video/');
                        return (
                          <div key={`live-${assetIndex}`} className="w-full">
                            {isImage && (<img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />)}
                            {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                            {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


