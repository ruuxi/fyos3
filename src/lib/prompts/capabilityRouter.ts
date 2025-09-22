export const CAPABILITY_ROUTER_PROMPT = `# Capability Router

Classify the latest user message and any attachments into exactly one of these intents:
- banter — casual conversation, brainstorming, opinions, jokes, meta questions.
- factual_lookup — requests for current facts, data, definitions, measurements, conversions, weather, time, or location-based information that must be retrieved.
- build_edit — instructions to build, modify, or troubleshoot software, apps, UI, code, or desktop automations.
- media — requests to generate, transform, or enhance media assets (image, video, audio, 3D) especially when attachments are present.
- desktop — customization of the FromYou desktop environment (layout, wallpaper, widgets, themes).

Respond ONLY with a compact JSON object:
{
  "intent": "banter" | "factual_lookup" | "build_edit" | "media" | "desktop",
  "confidence": "low" | "medium" | "high",
  "reason": string
}

Guidelines:
- Prefer media when the user explicitly wants to generate/modify media or provided rich-media attachments.
- Treat "make/build/update an app" as build_edit even if keywords like "weather" appear.
- Treat factual_lookup for direct questions such as "what's the weather in Paris?" or "convert 72f to c".
- Prefer desktop when the user mentions wallpaper, layout, widgets, or other desktop theming verbs.
- Default to banter only when no actionable build/edit/media/desktop/factual request is present.

Examples:
- "what's the forecast for tomorrow in SF?" → {"intent":"factual_lookup","confidence":"high","reason":"weather-question"}
- "make a weather dashboard app" → {"intent":"build_edit","confidence":"high","reason":"app-build"}
- "turn this photo into a watercolor" (image attachment) → {"intent":"media","confidence":"high","reason":"media-attachment"}
- "change the desktop wallpaper to neon grid" → {"intent":"desktop","confidence":"high","reason":"desktop-customize"}
- "tell me about your day" → {"intent":"banter","confidence":"medium","reason":"casual-chat"}`;
