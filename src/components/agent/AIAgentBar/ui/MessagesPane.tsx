import type { RefObject } from 'react';
import { useState, useEffect, useRef } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api as convexApi } from '../../../../../convex/_generated/api';
import { formatBytes, guessContentTypeFromFilename } from '@/lib/agent/agentUtils';
import type { Doc } from '../../../../../convex/_generated/dataModel';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

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

const actionVerbs = [
  'Building',
  'Creating',
  'Writing',
  'Reading',
  'Installing',
  'Executing',
  'Generating',
  'Compiling',
  'Analyzing',
  'Deploying',
  'Optimizing',
  'Validating',
  'Crafting',
  'Brewing',
  'Cooking',
  'Mixing',
  'Shaping',
  'Polishing',
  'Tuning',
  'Weaving',
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
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((a, idx) => {
        const ct = (a.contentType || '').toLowerCase();
        const isImage = ct.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(a.publicUrl);
        const isVideo = ct.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(a.publicUrl);
        const isAudio = ct.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(a.publicUrl);
        return (
          <div key={idx} className="w-full">
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.publicUrl} alt={a.name} className="w-full max-w-sm rounded" />
            )}
            {isVideo && (
              <video controls src={a.publicUrl} className="w-full max-w-sm rounded" />
            )}
            {isAudio && (
              <audio controls src={a.publicUrl} className="w-full" />
            )}
            {!isImage && !isVideo && !isAudio && (
              <div className="break-all text-xs text-white/70">{a.publicUrl}</div>
            )}
            <div className="mt-1 truncate text-[10px] text-white/60" title={a.name}>{a.name}</div>
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
    status,
    messagesContainerRef,
    messagesInnerRef,
    containerHeight: _containerHeight,
    didAnimateWelcome,
    bubbleAnimatingIds,
    lastSentAttachments,
    activeThreadId,
    agentActive: _agentActive,
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

  // Verb carousel state
  const [currentVerb, setCurrentVerb] = useState<string | null>(null);
  const [showVerbCarousel, setShowVerbCarousel] = useState(false);
  const lastMessageLengthRef = useRef(0);
  const lastToolCallCountRef = useRef(0);
  const lastTextMessageIdRef = useRef<string | null>(null);

  // Monitor messages for tool calls and text content
  useEffect(() => {
    if (displayMessages.length === 0) {
      setShowVerbCarousel(false);
      setCurrentVerb(null);
      return;
    }

    const lastMessage = displayMessages[displayMessages.length - 1];
    
    // Only track assistant messages
    if (lastMessage.role !== 'assistant') {
      return;
    }

    const parts = Array.isArray(lastMessage.parts) ? lastMessage.parts : [];
    
    // Check for text parts with actual content (not just whitespace)
    const hasActualText = parts.some(part => {
      if (!isTextPart(part)) return false;
      const text = (part.text || '').trim();
      return text.length > 0;
    });

    // Check for tool-related parts (tool-result or any part with "tool" in type)
    const toolParts = parts.filter(part => {
      if (!part || typeof part !== 'object') return false;
      const partType = (part as { type?: string }).type || '';
      return partType.startsWith('tool-') || partType === 'tool-result';
    });

    const currentToolCallCount = toolParts.length;

    // If we have a new text part with actual content, hide the carousel
    if (hasActualText && lastMessage.id !== lastTextMessageIdRef.current) {
      lastTextMessageIdRef.current = lastMessage.id;
      setShowVerbCarousel(false);
      setCurrentVerb(null);
      lastToolCallCountRef.current = 0;
      return;
    }

    // If we have new tool calls and no actual text yet, show/update the carousel
    if (currentToolCallCount > lastToolCallCountRef.current && !hasActualText) {
      const randomVerb = actionVerbs[Math.floor(Math.random() * actionVerbs.length)];
      setCurrentVerb(randomVerb);
      setShowVerbCarousel(true);
      lastToolCallCountRef.current = currentToolCallCount;
    }

    // Also check if streaming status indicates active tool use
    if ((status === 'streaming' || status === 'submitted') && !hasActualText && currentToolCallCount > 0) {
      if (!showVerbCarousel) {
        const randomVerb = actionVerbs[Math.floor(Math.random() * actionVerbs.length)];
        setCurrentVerb(randomVerb);
        setShowVerbCarousel(true);
      }
    }

    lastMessageLengthRef.current = displayMessages.length;
  }, [displayMessages, status, showVerbCarousel]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={messagesContainerRef}
        className="modern-scrollbar flex-1 min-h-0 overflow-y-auto pb-1 pr-0 pt-0"
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
          <div className="flex min-h-[60vh] items-center justify-center py-10 text-base" aria-label="Welcome message">
            <div className="w-full max-w-3xl px-3 text-center">
              <div className="mb-3 text-sm text-white/60">AI Agent</div>
              <div className={`mx-auto inline-block max-w-[880px] whitespace-pre-wrap break-words border border-white/15 bg-white/10 px-6 py-4 text-white ${!didAnimateWelcome ? 'ios-pop' : ''}`}>
                {"Hello! What can I do for you?"}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3" aria-label="Suggested prompts">
                {welcomeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-2xl border border-white/20 bg-white/5 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
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

          const isUser = m.role === 'user';
          const isLastUser = isUser && m.id === lastUserMessageId;
          const optimisticAttachmentOverride = getOptimisticAttachments(metadata);
          const personaLabel = 'Sim';
          const authorLabel = m.role === 'assistant' ? (mode === 'persona' ? personaLabel : 'AI Agent') : 'You';
          const isOptimistic = hasOptimisticFlag(metadata);
          const showStreaming = !isUser && (status === 'streaming' || status === 'submitted') && idx === displayMessages.length - 1;
          const showLiveMedia = !isUser && idx === displayMessages.length - 1 && liveMediaList.length > 0;
          // Build content and collect any attachments referenced in text while leaving message content intact
          let collectedFromText: AttachmentPreview[] = [];
          const partNodes = (m.parts || []).map((part, index: number) => {
            if (isTextPart(part)) {
              const { items } = extractAttachmentsFromText(part.text || '');
              if (items.length) {
                collectedFromText = collectedFromText.concat(items);
              }
              return (
                <MessageResponse
                  key={`text-${index}`}
                  parseIncompleteMarkdown={showStreaming}
                  isAnimating={showStreaming}
                >
                  {part.text || ''}
                </MessageResponse>
              );
            }
            if (isToolResultPart(part)) {
              const payload = getToolResultPayload(part);
              if (payload && payload.ephemeralAssets && payload.ephemeralAssets.length > 0) {
                const assets = toMediaAssetArray(payload.ephemeralAssets);
                return (
                  <div key={`tool-${index}`} className="mt-2 space-y-2">
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
                            <img src={publicUrl} alt="Generated content" className="w-full max-w-sm rounded" />
                          )}
                          {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                          {isVideo && (<video controls src={publicUrl} className="w-full max-w-sm rounded" />)}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              if (payload && payload.persistedAssets && payload.persistedAssets.length > 0) {
                const assets = toMediaAssetArray(payload.persistedAssets);
                return (
                  <div key={`tool-${index}`} className="mt-2 space-y-2">
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
                            <img src={publicUrl} alt="Generated content" className="w-full max-w-sm rounded" />
                          )}
                          {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                          {isVideo && (<video controls src={publicUrl} className="w-full max-w-sm rounded" />)}
                          {contentType && size && (<div className="mt-1 text-xs text-white/60">{contentType} • {formatBytes(size)}</div>)}
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
                  <div key={`tool-${index}`} className="mt-2">
                    {isImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={publicUrl} alt="Uploaded content" className="w-full max-w-sm rounded" />
                    )}
                    {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                    {isVideo && (<video controls src={publicUrl} className="w-full max-w-sm rounded" />)}
                    {size && (<div className="mt-1 text-xs text-white/60">{contentType} • {formatBytes(size)}</div>)}
                  </div>
                );
              }
              // Don't render tool result JSON - hide it
              return null;
            }
            // Hide other tool parts like step-start and tool-* types
            if (part && typeof part === 'object' && 'type' in part) {
              const partType = (part as { type?: string }).type || '';
              if (partType.startsWith('tool-') || partType === 'step-start') {
                return null;
              }
            }
            // Don't render raw unknown parts
            return null;
          }).filter(Boolean);
          const previewItems = collectedFromText.length > 0
            ? collectedFromText
            : (optimisticAttachmentOverride ?? (isLastUser ? lastSentAttachments ?? [] : []));

          // Check if there's actual text content (not just whitespace)
          const hasActualText = (m.parts || []).some(part => {
            if (!isTextPart(part)) return false;
            const text = (part.text || '').trim();
            return text.length > 0;
          });

          // Don't render assistant messages that have no visible content (only tool parts or whitespace)
          const hasVisibleContent = hasActualText || (previewItems && previewItems.length > 0) || showLiveMedia;
          if (!isUser && !hasVisibleContent) {
            return null;
          }

          const contentClass = cn(
            'rounded-2xl py-2 whitespace-pre-wrap break-words border max-w-full overflow-x-auto',
            isUser
              ? 'px-3 bg-sky-500 text-white border-sky-400/60 backdrop-blur-md group-[.is-user]:bg-sky-500 group-[.is-user]:text-white group-[.is-user]:px-3 group-[.is-user]:py-2'
              : 'px-4 bg-white/8 !text-white border-white/15',
            bubbleAnimatingIds.has(m.id) && 'ios-pop'
          );

          return (
            <Message key={m.id} from={isUser ? 'user' : 'assistant'} className={cn(isOptimistic && 'opacity-80', !isUser && 'max-w-[95%]')}>
              <div className={cn('text-xs text-white/60', isUser ? 'ml-auto pr-1' : 'pl-1')}>
                {authorLabel}
              </div>
              <MessageContent className={contentClass}>
                {partNodes}
                {previewItems && previewItems.length > 0 && (
                  <div className="mt-2">{renderAttachments(previewItems)}</div>
                )}
                {showLiveMedia && (
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
                            <img src={publicUrl} alt="Generated content" className="w-full max-w-sm rounded" />
                          )}
                          {isAudio && (<audio controls src={publicUrl} className="w-full" />)}
                          {isVideo && (<video controls src={publicUrl} className="w-full max-w-sm rounded" />)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </MessageContent>
            </Message>
          );
        })}
        {showVerbCarousel && currentVerb && (
          <Message key="verb-carousel" from="assistant" className={cn("verb-carousel-message", "max-w-[95%]")}>
            <div className="text-xs text-white/60 pl-1">
              AI Agent
            </div>
            <MessageContent className="rounded-2xl px-3 py-2 whitespace-pre-wrap break-words border bg-white/8 !text-white border-white/15 verb-carousel-bubble">
              <div className="flex items-center gap-2">
                <div className="verb-carousel-spinner">
                  <svg className="animate-spin h-4 w-4 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <span className="verb-carousel-text font-medium text-white/90">{currentVerb}...</span>
              </div>
            </MessageContent>
          </Message>
        )}
        </div>
      </div>
      <style jsx>{`
        @keyframes verb-fade-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .verb-carousel-bubble {
          animation: verb-fade-in 0.3s ease-out;
        }

        .verb-carousel-text {
          animation: verb-fade-in 0.3s ease-out;
        }

        :global(.ios-pop) {
          animation: bubble-pop 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        }

        @keyframes bubble-pop {
          0% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }

        :global([class*="rounded-2xl"]) :global(ul),
        :global([class*="rounded-2xl"]) :global(ol) {
          margin-left: 0 !important;
          padding-left: 1.5rem !important;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          list-style-position: inside;
        }

        :global([class*="rounded-2xl"]) :global(li) {
          margin-left: 0 !important;
          padding-left: 0;
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }
      `}</style>
    </div>
  );
}

