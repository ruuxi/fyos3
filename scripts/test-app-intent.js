#!/usr/bin/env node
/*
 Desktop intent classifier sandbox.
 Mirrors the client/server preflight logic so we can quickly
 inspect how prompts get bucketed into fast_app_create vs
 desktop_customize vs chat_only.
*/

const NON_APP_CONTENT_REGEX = /(poem|poetry|story|essay|email|message|note|lyrics|song|music|melody|image|picture|photo|art|video|animation|tweet|post|bio|joke|summary|summar(?:y|ise|ize)|article|blog|outline|script|recipe|caption|code snippet)/i;
const CREATE_APP_REGEX = /\b(build|create|scaffold|make|generate|spin\s*up|draft)\b(?:\s+\w+){0,6}?\s+\b(app|apps|application|applications|project|site|website|web\s*app|ui)\b/i;
const NEW_APP_REGEX = /\bnew\s+(app|apps|application|applications)\b/i;

const DESKTOP_SUBJECT_REGEX = /(desktop|workspace|layout|window|windows|pane|panes|dock|homescreen|home\s*screen|scene|canvas|dashboard|grid|workspace)/i;
const THEME_TOKEN_REGEX = /(theme|wallpaper|background|color|palette|gradient|typography|font|icon\s*pack|icons|aesthetic|vibe|mood|ambient\s*(audio|sound)|skin|retint|reskin)/i;
const LAYOUT_ACTION_REGEX = /(add|remove|move|rearrange|arrange|organize|group|split|stack|tile|resize|expand|compress|dock|pin|float|swap|replace|position|align)/i;
const BEHAVIOR_TOKEN_REGEX = /(auto[-\s]?launch|autostart|schedule|toggle|notification|route|automation|timer|temporal|scene|preview|undo|redo|share|publish)/i;
const DATA_WIRING_REGEX = /(bind|connect|hook|wire|link|sync|feed|ingest)/i;
const TARGET_TOKEN_REGEX = /(widget|window|panel|card|app|dock|row|column|pane|theme|background|wallpaper|desktop|workspace|scene|grid)/i;
const VAGUE_DESCRIPTOR_REGEX = /(dreamy|dreamlike|magical|cool|awesome|better|nicer|cute|pretty|modern|futuristic|vibe|aesthetic|ambience|mood|feel)/i;

const CONFIDENCE = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

function detectFastAppCreate(text) {
  if (NON_APP_CONTENT_REGEX.test(text)) {
    return { match: false, reason: 'non-app-content', confidence: CONFIDENCE.LOW };
  }
  if (CREATE_APP_REGEX.test(text)) {
    return { match: true, reason: 'create-app-proximity', confidence: CONFIDENCE.HIGH };
  }
  if (NEW_APP_REGEX.test(text)) {
    return { match: true, reason: 'explicit-new-app', confidence: CONFIDENCE.MEDIUM };
  }
  return { match: false, reason: 'no-app-signal', confidence: CONFIDENCE.MEDIUM };
}

function detectDesktopCustomize(text) {
  // Explicit theme/wallpaper tokens
  if (THEME_TOKEN_REGEX.test(text)) {
    const vague = VAGUE_DESCRIPTOR_REGEX.test(text) && !/(#|rgb|blue|red|green|pink|neon|dark|light|pastel|palette|gradient|pattern|photo|image)/i.test(text);
    return {
      match: true,
      reason: 'theme-token',
      confidence: vague ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH,
      needsClarification: vague,
      clarificationQuestion: vague
        ? 'What colors, assets, or references should the desktop use to feel "dreamlike"?'
        : null,
    };
  }

  const hasDesktopSubject = DESKTOP_SUBJECT_REGEX.test(text) || /wallpaper|background|homescreen|home\s*screen/i.test(text);
  const layoutAction = LAYOUT_ACTION_REGEX.test(text);
  const behaviorSignal = BEHAVIOR_TOKEN_REGEX.test(text);
  const dataSignal = DATA_WIRING_REGEX.test(text) && TARGET_TOKEN_REGEX.test(text);

  if (hasDesktopSubject && (layoutAction || behaviorSignal)) {
    return {
      match: true,
      reason: layoutAction ? 'layout-action' : 'behavior-update',
      confidence: CONFIDENCE.HIGH,
    };
  }

  if (dataSignal) {
    return {
      match: true,
      reason: 'data-wiring',
      confidence: CONFIDENCE.MEDIUM,
    };
  }

  if (hasDesktopSubject && VAGUE_DESCRIPTOR_REGEX.test(text)) {
    return {
      match: true,
      reason: 'desktop-vibe-only',
      confidence: CONFIDENCE.LOW,
      needsClarification: true,
      clarificationQuestion: 'Could you share palette, layout targets, or assets for the new vibe?'
    };
  }

  return { match: false, reason: 'no-desktop-signal', confidence: CONFIDENCE.MEDIUM };
}

function classifyIntent(text) {
  const input = String(text || '').trim();
  if (!input) {
    return {
      intent: 'chat_only',
      confidence: CONFIDENCE.LOW,
      reason: 'empty',
    };
  }

  const normalized = input.toLowerCase();
  const fastApp = detectFastAppCreate(normalized);
  if (fastApp.match) {
    return {
      intent: 'fast_app_create',
      confidence: fastApp.confidence,
      reason: fastApp.reason,
    };
  }

  const customize = detectDesktopCustomize(normalized);
  if (customize.match) {
    return {
      intent: 'desktop_customize',
      confidence: customize.confidence,
      reason: customize.reason,
      needsClarification: Boolean(customize.needsClarification),
      clarificationQuestion: customize.clarificationQuestion || undefined,
    };
  }

  return {
    intent: 'chat_only',
    confidence: normalized.length > 50 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    reason: 'default-to-chat',
  };
}

function formatResult(text, result, expectedIntent) {
  const header = expectedIntent ? `${result.intent}${result.intent === expectedIntent ? '' : ` (expected ${expectedIntent})`}` : result.intent;
  const detail = [`conf=${result.confidence}`, `because=${result.reason}`];
  if (result.needsClarification) {
    detail.push('needsClarification');
  }
  return `- ${header} | ${detail.join(' ')} | ${text}`;
}

const DEFAULT_PROMPTS = [
  { text: 'Create a poem for me about the ocean', expect: 'chat_only' },
  { text: 'Make a song in the style of lo-fi', expect: 'chat_only' },
  { text: 'Generate an image of a sunset over mountains', expect: 'chat_only' },
  { text: 'What can you do for me on this desktop?', expect: 'chat_only' },
  { text: 'Create a new app for tracking tasks', expect: 'fast_app_create' },
  { text: 'Build a simple website that shows my portfolio', expect: 'fast_app_create' },
  { text: 'Spin up an application that fetches weather data', expect: 'fast_app_create' },
  { text: 'Rearrange my desktop windows so docs are on the left and media on the right', expect: 'desktop_customize' },
  { text: 'Set the wallpaper to a neon skyline and use a purple/teal palette', expect: 'desktop_customize' },
  { text: 'Bind the analytics widget to our convex metrics feed', expect: 'desktop_customize' },
  { text: 'Make the desktop feel dreamy', expect: 'desktop_customize' },
];

function runWithDefaults() {
  console.log('Testing default sample prompts:');
  DEFAULT_PROMPTS.forEach(({ text, expect }) => {
    const result = classifyIntent(text);
    console.log(formatResult(text, result, expect));
  });
}

function runWithArgs(args) {
  args.forEach((prompt) => {
    const result = classifyIntent(prompt);
    console.log(formatResult(prompt, result));
  });
}

function runWithStdin() {
  const lines = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    lines.push(chunk);
  });
  process.stdin.on('end', () => {
    const text = lines.join('');
    const prompts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    prompts.forEach((prompt) => {
      const result = classifyIntent(prompt);
      console.log(formatResult(prompt, result));
    });
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--defaults')) {
    runWithDefaults();
    return;
  }

  const filteredArgs = args.filter((arg) => !arg.startsWith('--'));
  if (filteredArgs.length > 0) {
    runWithArgs(filteredArgs);
    return;
  }

  if (process.stdin.isTTY) {
    runWithDefaults();
  } else {
    runWithStdin();
  }
}

if (require.main === module) {
  main();
}

module.exports = { classifyIntent };
