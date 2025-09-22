import type { SystemPromptIntent } from '@/lib/prompts';

type Confidence = 'low' | 'medium' | 'high';

export type CapabilityIntent = 'banter' | 'factual_lookup' | 'build_edit' | 'media' | 'desktop';

export interface AttachmentHint {
  contentType?: string | null;
  url: string;
}

export interface CapabilityHeuristicDecision {
  intent: CapabilityIntent;
  confidence: Confidence;
  reason: string;
}

const normalizeText = (text: string): string => text.trim().toLowerCase();

const NON_APP_CONTENT_REGEX = /(poem|poetry|story|essay|email|message|note|lyrics|song|music|melody|image|picture|photo|art|video|animation|tweet|post|bio|joke|summary|summar(?:y|ise|ize)|article|blog|outline|script|recipe|caption|code snippet|application\s+(letter|form|draft|checklist)|site\s+(visit|report|plan)|project\s+(report|update|recap|name|draft)|website\s+draft)/i;
const CREATE_APP_REGEX = /\b(build|create|scaffold|make|generate|spin\s*up|draft|design|code|write)\b(?:\s+\w+){0,6}?\s+\b(app|apps|application|applications|website|web\s*site|web\s*app|ui|interface|dashboard|tool)\b/i;
const NEW_APP_REGEX = /\bnew\s+(app|apps|application|applications|project|tool)\b/i;
const SOFTWARE_NOUN_REGEX = /(app|application|code|component|feature|widget|window|panel|layout|page|screen|view|ui|ux|function|hook|api|endpoint|module|package|script|style|css|theme|palette|button|form|editor|canvas|project|repo|repository|file|folder|model|agent|desktop)/i;
const BUILD_OR_EDIT_VERBS = /(build|create|scaffold|generate|draft|design|implement|code|write|add|integrate|hook|connect|wire|setup|set\s*up|configure|install|import|migrate|refactor|review|improve|adjust|tweak|modify|change|update|polish|enhance|fix|debug|resolve|patch|optimize|clean|cleanup|clean\s*up|extend|expand)/i;

const MEDIA_VERB_REGEX = /(generate|create|make|produce|render|draw|paint|compose|remix|stylize|transform|edit|enhance|upscale|riff|animate|record|shoot|film|write)/i;
const MEDIA_NOUN_REGEX = /(image|images|photo|photos|picture|art|visual|graphic|logo|icon|poster|banner|illustration|video|videos|clip|clips|animation|animations|gif|music|song|audio|sound|voice|track|sfx|effect|3d|model|asset|texture)/i;
const MEDIA_ATTACHMENT_REGEX = /\.(png|jpe?g|gif|bmp|webp|mp4|mov|m4v|avi|mp3|wav|flac|ogg|glb|gltf|obj)$/i;

const DESKTOP_KEYWORD_REGEX = /(desktop|workspace|fromyou|from\s*you|launcher|window|wallpaper|background|theme|palette|layout|grid|arrangement|dock|taskbar|ambient|vibe|icon\s*pack|icon\s*set|widgets?)/i;
const DESKTOP_ACTION_REGEX = /(customize|refresh|change|tweak|restyle|retheme|recolor|set|apply|switch|update|arrange|move|organize|pin|unpin|resize|layout|rearrange)/i;
const DESKTOP_APP_PHRASE_REGEX = /desktop\s+(app|application)/i;

const FACTUAL_KEYWORD_REGEX = /(weather|temperature|forecast|humidity|sunrise|sunset|time|date|day|population|capital|currency|exchange rate|convert|conversion|definition|define|meaning|explain|history|origin|distance|travel time|time zone|timezone|news|update|score|scores|stock|price|market|quote|stat(s|istics)?|latest|current|trend|report|schedule|release|age|birthday|when|where|who|how\s+many|how\s+much|does it|should i|can i)/i;
const QUESTION_FRAGMENTS_REGEX = /(what|when|where|who|how|which|tell\s+me|show\s+me|give\s+me|do\s+you\s+know|is\s+it|are\s+there|does\s+it|could\s+you)/i;

const hasMediaAttachment = (hints: AttachmentHint[]): boolean => {
  return hints.some((hint) => {
    const type = (hint.contentType || '').toLowerCase();
    if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) {
      return true;
    }
    if (type === 'model/gltf+json' || type === 'model/obj' || type === 'model/glb') {
      return true;
    }
    return MEDIA_ATTACHMENT_REGEX.test(hint.url);
  });
};

const isMediaRequestText = (text: string): boolean => {
  if (!text) return false;
  return MEDIA_NOUN_REGEX.test(text) && MEDIA_VERB_REGEX.test(text);
};

const isDesktopCustomizationText = (text: string): boolean => {
  if (!text) return false;
  if (DESKTOP_APP_PHRASE_REGEX.test(text)) return false;
  const mentionsWallpaperOrTheme = /(wallpaper|background|theme|palette|ambient|vibe|accent)/i.test(text);
  const mentionsDesktopContext = DESKTOP_KEYWORD_REGEX.test(text);
  const mentionsAction = DESKTOP_ACTION_REGEX.test(text) || mentionsWallpaperOrTheme;
  if (mentionsWallpaperOrTheme && mentionsDesktopContext) return true;
  if (mentionsDesktopContext && mentionsAction) return true;
  if (mentionsWallpaperOrTheme) return true;
  return false;
};

const isLikelyAppBuildText = (text: string): boolean => {
  if (!text) return false;
  if (NON_APP_CONTENT_REGEX.test(text)) return false;
  return CREATE_APP_REGEX.test(text) || NEW_APP_REGEX.test(text);
};

const isLikelySoftwareEditText = (text: string): boolean => {
  if (!text) return false;
  if (!BUILD_OR_EDIT_VERBS.test(text)) return false;
  return SOFTWARE_NOUN_REGEX.test(text);
};

const isFactualLookupText = (text: string): boolean => {
  if (!text) return false;
  if (!FACTUAL_KEYWORD_REGEX.test(text)) return false;
  if (!QUESTION_FRAGMENTS_REGEX.test(text)) {
    const imperativeFactual = /(lookup|look\s*up|check|give|provide|show|summarize|summarise|summarize)\b.*(weather|temperature|time|date|population|capital|definition|meaning|history|news|score|stock|price|convert|conversion|exchange|distance|timezone)/i;
    if (!imperativeFactual.test(text)) {
      return false;
    }
  }
  if (isLikelyAppBuildText(text)) return false;
  if (/\b(app|project|build)\b/.test(text) && /(make|create|build)/.test(text)) {
    return false;
  }
  return true;
};

export const capabilityIntentToSystemPromptIntent = (capability: CapabilityIntent): SystemPromptIntent => {
  switch (capability) {
    case 'media':
      return 'media';
    case 'desktop':
      return 'desktop';
    case 'factual_lookup':
    case 'banter':
    case 'build_edit':
    default:
      return 'edit';
  }
};

export interface CapabilityHeuristicInput {
  text: string;
  hints?: AttachmentHint[];
}

export const evaluateCapabilityHeuristics = ({ text, hints = [] }: CapabilityHeuristicInput): CapabilityHeuristicDecision => {
  const normalized = normalizeText(text || '');
  const hasText = normalized.length > 0;
  const hasHints = hints.length > 0;

  if (hasText && isDesktopCustomizationText(normalized)) {
    return {
      intent: 'desktop',
      confidence: 'high',
      reason: 'desktop-keywords',
    };
  }

  const mediaAttachmentDetected = hasHints ? hasMediaAttachment(hints) : false;
  const mediaLanguageDetected = hasText ? isMediaRequestText(normalized) : false;

  if (mediaAttachmentDetected && mediaLanguageDetected) {
    return {
      intent: 'media',
      confidence: 'high',
      reason: 'media-language+attachments',
    };
  }

  if (mediaAttachmentDetected && !isLikelyAppBuildText(normalized)) {
    return {
      intent: 'media',
      confidence: 'medium',
      reason: 'media-attachments',
    };
  }

  if (mediaLanguageDetected && !isLikelyAppBuildText(normalized)) {
    return {
      intent: 'media',
      confidence: 'medium',
      reason: 'media-language',
    };
  }

  if (hasText && isLikelyAppBuildText(normalized)) {
    return {
      intent: 'build_edit',
      confidence: 'high',
      reason: 'app-build-language',
    };
  }

  if (hasText && isLikelySoftwareEditText(normalized)) {
    return {
      intent: 'build_edit',
      confidence: 'medium',
      reason: 'software-edit-language',
    };
  }

  if (hasText && isFactualLookupText(normalized)) {
    return {
      intent: 'factual_lookup',
      confidence: 'medium',
      reason: 'factual-question',
    };
  }

  return {
    intent: 'banter',
    confidence: 'low',
    reason: hasText ? 'default-banter' : 'empty-message',
  };
};

export {
  hasMediaAttachment,
  isMediaRequestText,
  isDesktopCustomizationText,
  isLikelyAppBuildText,
  isLikelySoftwareEditText,
  isFactualLookupText,
};
