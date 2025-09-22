export const CLASSIFIER_PROMPT = `# AI Agent Intent Classifier

Decide whether the user's message should:
- 0: Use the chatty persona stream (general chatting/questioning)
- 1: Use the engineering/creation agent (create/edit/generate/modify/open apps or media)

Output: Return ONLY a single character: 0 or 1. No other text.

Assumptions:
- The user speaks in normal, non-technical language and won't mention code or files.
- This classifier is only run for messages sent from the AI Agent Bar.

Return 1 (agent) when the user asks to create, modify, generate, or operate on things, including:
- Build/create/make/set up/add/implement/change/modify/fix/update/tweak/polish/convert/integrate/hook up something
- Create or change an app/tool/window/widget/feature/layout/style/theme/UX
- Open/launch/manage an existing app in the desktop environment
- Generate or edit media (image, video, music, audio, 3D); e.g., "make an image of…", "edit this photo…"
- Transform attached media (photos, videos, audio) into new results using AI
- Provide concrete deliverables like plans-to-implement-now, files, assets, or outputs

Return 0 (persona chat) when the user is only chatting, asking questions, or brainstorming without asking to build/change/generate now, including:
- General Q&A, explanations, comparisons, advice, opinions, jokes, small talk
- Brainstorming or ideation without a request to actually create or modify something now
- Meta questions like "what can you do?" or "how do you work?"

Ambiguity rules:
- If both chit-chat and a concrete action request are present, prefer 1.
- If the user only wants ideas/brainstorming or information with no action requested, choose 0.
- If any URL attachment is present (images, videos, audio, files), ALWAYS return 1, regardless of wording.

Examples (→ expected output):
- "make me a simple to-do app" → 1
- "can you update the colors to be darker?" → 1
- "turn this photo into a vintage look" (with image) → 1
- "generate a 10s video of a sunset" → 1
- "open the media app" → 1
- "explain how pomodoro works" → 0
- "compare React and Vue for beginners" → 0
- "let's brainstorm features for a habit tracker" → 0
- "what's your name?" → 0
- "tell me a joke" → 0

Output format: 0 or 1 only.`;

export const DESKTOP_PREFLIGHT_PROMPT = `# Desktop Intent Classifier

Classify the latest user request into one of these intents:
- fast_app_create — the user wants a brand-new app scaffolded (multi-file create, new id/name/icon)
- desktop_customize — the user wants to change the existing desktop layout, theme, behavior, or bound media/widgets
- chat_only — general conversation, brainstorming, or anything without an immediate build/customize request

Return **one** compact JSON object with:
{
  "intent": "fast_app_create" | "desktop_customize" | "chat_only",
  "confidence": "low" | "medium" | "high",
  "reason": string,
  "needsClarification"?: boolean,
  "clarificationQuestion"?: string
}

Guidance:
- Classify as fast_app_create when the user asks to build/create/generate/scaffold a new app, site, or UI from scratch.
- Classify as desktop_customize when they target existing desktop facets: window layout, pane splits, app ordering, resizing, themes, backgrounds, palettes, typography, icon packs, ambient audio, behavior toggles, automation, previews, undo/redo, sharing.
- Treat wallpaper/background/scene/theme changes as desktop_customize even without the word "desktop" if the scope clearly refers to the FromYou environment.
- If a customization request lacks concrete constraints (e.g., "make it dreamlike" with no palette/assets), keep intent desktop_customize but mark needsClarification=true and suggest a single focused question.
- Prefer chat_only for vague vibes with no action, pure brainstorming, or requests that are out of scope (system admin, destructive host actions, unsafe media).
- When multiple intents appear, choose the highest-impact action (fast_app_create outranks desktop_customize; both outrank chat_only).
- Only mark confidence high when the wording is explicit and unambiguous; otherwise use medium/low.

Strictly output valid JSON with double quotes and no trailing text.`;
