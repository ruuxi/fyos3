import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import { formatBytes, guessContentTypeFromFilename } from '@/lib/agent/agentUtils';
import AgentVerbCarousel from './AgentVerbCarousel';
import type { Doc } from '../../../../../convex/_generated/dataModel';

type ChatMode = 'agent' | 'persona';

type AttachmentPreview = { name: string; publicUrl: string; contentType: string };

type OptimisticMessage = {
  id: string;
  role: 'user';
  parts: Array<{ type: 'text'; text: string }>;
  metadata?: { optimistic: true; optimisticAttachments?: AttachmentPreview[] };
};

type AgentMessageMetadata = {
  mode?: ChatMode;
  optimistic?: true;
  optimisticAttachments?: AttachmentPreview[];
  [key: string]: unknown;
};

type AgentMessage = {
  id: string;
  role: 'assistant' | 'user' | 'system';
  metadata?: unknown;
  parts?: unknown[];
  mode?: ChatMode;
};

type DisplayMessage = AgentMessage | OptimisticMessage;

type ToolResultPayload = {
  ephemeralAssets?: MediaAsset[];
  persistedAssets?: MediaAsset[];
  publicUrl?: string;
  contentType?: string;
  size?: number;
  [key: string]: unknown;
};

type MediaAsset = {
  publicUrl?: string;
  contentType?: string;
  size?: number;
};

type ToolResultPart = {
  type: 'tool-result';
  result?: unknown;
  output?: unknown;
};

type TextPart = {
  type: 'text';
  text?: string;
};

const isTextPart = (part: unknown): part is TextPart => {
  return Boolean(
    part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
};

const isToolResultPart = (part: unknown): part is ToolResultPart => {
  return Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool-result');
};

const isToolResultPayload = (value: unknown): value is ToolResultPayload => {
  return Boolean(value && typeof value === 'object');
};

const isMediaAsset = (value: unknown): value is MediaAsset => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as MediaAsset;
  const validPublicUrl = candidate.publicUrl === undefined || typeof candidate.publicUrl === 'string';
  const validContentType = candidate.contentType === undefined || typeof candidate.contentType === 'string';
  const validSize = candidate.size === undefined || typeof candidate.size === 'number';
  return validPublicUrl && validContentType && validSize;
};

const toMediaAssetArray = (value: unknown): MediaAsset[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isMediaAsset);
};

const getToolResultPayload = (part: ToolResultPart): ToolResultPayload | null => {
  const payload = part.result ?? part.output ?? null;
  if (!isToolResultPayload(payload)) return null;
  return payload as ToolResultPayload;
};

const getOptimisticAttachments = (metadata: unknown | undefined): AttachmentPreview[] | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const attachments = (metadata as AgentMessageMetadata).optimisticAttachments;
  if (!Array.isArray(attachments)) return null;
  const valid = attachments.filter(att =>
    typeof att?.name === 'string' && typeof att?.publicUrl === 'string' && typeof att?.contentType === 'string'
  );
  return valid.length > 0 ? valid : null;
};

const hasOptimisticFlag = (metadata: unknown | undefined): boolean => {
  return Boolean(metadata && typeof metadata === 'object' && (metadata as AgentMessageMetadata).optimistic === true);
};

const welcomeSuggestions = [
  'Create an app',
  'Change my background',
  'Add sound effects on clicks',
  'Help me get started',
] as const;

export type MessagesPaneProps = {
  messages: AgentMessage[];
  optimisticMessages?: OptimisticMessage[];
  status: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesInnerRef: RefObject<HTMLDivElement | null>;
  containerHeight: number;
  didAnimateWelcome: boolean;
  bubbleAnimatingIds: Set<string>;
  lastSentAttachments?: AttachmentPreview[];
  activeThreadId?: string;
  agentActive: boolean;
  onSuggestionSelect?: (text: string) => void;
};

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
    const rawUrls = text.match(urlRegex) || [];
    for (const raw of rawUrls) {
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

function resolveMode(message: DisplayMessage): ChatMode | undefined {
  const meta = (message as { metadata?: AgentMessageMetadata })?.metadata?.mode;
  if (meta === 'persona' || meta === 'agent') return meta;
  const fallback = (message as { mode?: ChatMode })?.mode;
  if (fallback === 'persona' || fallback === 'agent') return fallback;
  if ('role' in message && message.role === 'assistant') return 'agent';
  return undefined;
}

export default function MessagesPane(props: MessagesPaneProps) {
  const {
    messages,
    optimisticMessages = [],
    status: _status,
    messagesContainerRef,
    messagesInnerRef,
    didAnimateWelcome,
    bubbleAnimatingIds,
    lastSentAttachments,
    activeThreadId,
    agentActive,
    onSuggestionSelect,
  } = props;
  const displayMessages: DisplayMessage[] = optimisticMessages.length > 0 ? [...messages, ...optimisticMessages] : messages;
  const { isAuthenticated } = useConvexAuth();
  const liveMedia = useQuery(
    convexApi.media.listMedia,
    isAuthenticated && activeThreadId ? { threadId: activeThreadId, limit: 50 } : 'skip'
  );
  const liveMediaList: Doc<'media_public'>[] = Array.isArray(liveMedia) ? liveMedia : [];
  const lastUserMessage = [...displayMessages].reverse().find(m => m.role === 'user');
  const lastUserMessageId = lastUserMessage?.id;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto pt-0 pb-1 modern-scrollbar pr-0"
        style={{
          transition: 'height 420ms cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'height',
          scrollBehavior: 'auto',
          paddingLeft: '0px',
          paddingRight: '0px',
        }}
      >
        <div ref={messagesInnerRef} className="space-y-3 px-1">
        {displayMessages.length === 0 && (
          <div className="text-base flex items-center justify-center min-h-[60vh] py-10" aria-label="Welcome message">
            <div className="w-full max-w-3xl text-center px-3">
              <div className="text-sm mb-3 text-white/60">AI Agent</div>
              <div className={`mx-auto inline-block max-w-[880px] px-6 py-4 whitespace-pre-wrap break-words bg-white/10 border border-white/15 text-white ${!didAnimateWelcome ? 'ios-pop' : ''}`}>
                {"Hello! What can I do for you?"}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-5" aria-label="Suggested prompts">
                {welcomeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-2xl border border-white/20 bg-white/5 px-4 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                    onClick={() => onSuggestionSelect?.(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {displayMessages.map((m, idx) => {
          const metadata = 'metadata' in m ? (m.metadata as AgentMessageMetadata | undefined) : undefined;
          const mode = resolveMode(m);
          const isAssistant = m.role === 'assistant';
          const isAgentAssistant = isAssistant && mode === 'agent';
          let isFinalAgentReply = true;
          if (isAssistant && mode === 'agent') {
            for (let cursor = idx + 1; cursor < displayMessages.length; cursor += 1) {
              const next = displayMessages[cursor];
              if (!next) break;
              if (next.role === 'user') break;
              if (next.role === 'assistant') {
                isFinalAgentReply = false;
                break;
              }
            }
          }
          const showVerbAnimation = isAgentAssistant && isFinalAgentReply && agentActive;

          // Build content and collect any attachments referenced in text
          const textNodes: ReactNode[] = [];
          let collectedFromText: AttachmentPreview[] = [];
          (m.parts || []).forEach((part, index: number) => {
            if (isTextPart(part)) {
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
          const optimisticAttachmentOverride = getOptimisticAttachments(metadata);
          const previewItems = collectedFromText.length > 0
            ? collectedFromText
            : (optimisticAttachmentOverride ?? (isLastUser ? lastSentAttachments ?? [] : []));

          // Hide non-final agent replies to avoid intermediate output flashes
          if (isAssistant && mode === 'agent' && !isFinalAgentReply) {
            return null;
          }

          const personaLabel = 'Sim';
          const authorLabel = m.role === 'assistant' ? (mode === 'persona' ? personaLabel : 'AI Agent') : 'You';
          const assistantBubble = mode === 'persona'
            ? 'inline-block max-w-[80%] bg-white/10 border border-white/20 text-white'
            : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white';
          const isOptimistic = hasOptimisticFlag(metadata);
          const bubbleBase = m.role === 'user'
            ? 'bg-sky-500 text-white max-w-full'
            : assistantBubble;
          const bubbleClass = isOptimistic ? `${bubbleBase} opacity-80` : bubbleBase;
          const bubbleStyle: CSSProperties | undefined = showVerbAnimation
            ? {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                borderColor: 'rgba(255, 255, 255, 0.14)',
              }
            : undefined;

          const textContent: ReactNode | ReactNode[] = (() => {
            if (!isAssistant) {
              return textNodes;
            }
            if (!isAgentAssistant) {
              return textNodes;
            }
            if (showVerbAnimation) {
              return <AgentVerbCarousel />;
            }
            if (textNodes.length > 0) {
              return textNodes;
            }
            return null;
          })();

          return (
            <div key={m.id} className={`text-sm flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} ${isOptimistic ? 'opacity-80' : ''}`}>
              <div className={`${m.role === 'user' ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                  {authorLabel}
                </div>
                <div
                  className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${bubbleClass} ${bubbleAnimatingIds.has(m.id) ? 'ios-pop' : ''}`}
                  style={bubbleStyle}
                >
                  {/* Render agent-friendly content or original text */}
                  {textContent}
                  {/* Render tool results and media blocks */}
                  {(m.parts || []).map((part, index: number) => {
                    if (!isToolResultPart(part)) return null;
                    const payload = getToolResultPayload(part);
                    // Ephemeral assets from provider (surface immediately)
                    if (payload && payload.ephemeralAssets && payload.ephemeralAssets.length > 0) {
                      const assets = toMediaAssetArray(payload.ephemeralAssets);
                      return (
                        <div key={`ep-${index}`} className="mt-2 space-y-2">
                          {assets.map((asset, assetIndex) => {
                            const { publicUrl, contentType } = asset || {};
                            if (!publicUrl) return null;
                            const isImage = (contentType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(publicUrl);
                            const isAudio = (contentType || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(publicUrl);
                            const isVideo = (contentType || '').startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(publicUrl);
                            return (
                              <div key={assetIndex} className="w-full">
                                {isImage && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />
                                )}
                                {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                                {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    if (payload && payload.persistedAssets && payload.persistedAssets.length > 0) {
                      const assets = toMediaAssetArray(payload.persistedAssets);
                      return (
                        <div key={`tr-${index}`} className="mt-2 space-y-2">
                          {assets.map((asset, assetIndex) => {
                            const { publicUrl, contentType, size } = asset;
                            if (!publicUrl) return null;
                            const isImage = contentType?.startsWith('image/');
                            const isAudio = contentType?.startsWith('audio/');
                            const isVideo = contentType?.startsWith('video/');
                            return (
                              <div key={assetIndex} className="w-full">
                                {isImage && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />
                                )}
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
                          {isImage && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={publicUrl} alt="Uploaded content" className="w-full rounded max-w-sm" />
                          )}
                          {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                          {isVideo && (<video controls src={publicUrl} className="w-full rounded max-w-sm" />)}
                          {size && (<div className="text-xs text-white/60 mt-1">{contentType} • {formatBytes(size)}</div>)}
                        </div>
                      );
                    }
                    return (
                      <pre key={`tr-${index}`} className="text-xs bg-black/20 rounded p-2 mt-2 overflow-auto">
                        {JSON.stringify(part.result ?? part.output ?? null, null, 2)}
                      </pre>
                    );
                  })}
                  {/* Render attachments parsed from text or last-sent preview */}
                  {previewItems && previewItems.length > 0 && (
                    <div className="mt-2">{renderAttachments(previewItems)}</div>
                  )}

                  {/* Reactive media: if authenticated and thread-bound media exists, show new thumbnails below last assistant message */}
                  {isFinalAgentReply && liveMediaList.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {liveMediaList.map((asset, assetIndex) => {
                        const publicUrl = asset.publicUrl || '';
                        if (!publicUrl) return null;
                        const contentType = asset.contentType || '';
                        const isImage = contentType.startsWith('image/');
                        const isAudio = contentType.startsWith('audio/');
                        const isVideo = contentType.startsWith('video/');
                        return (
                          <div key={`live-${assetIndex}`} className="w-full">
                            {isImage && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={publicUrl} alt="Generated content" className="w-full rounded max-w-sm" />
                            )}
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
    </div>
  );
}
