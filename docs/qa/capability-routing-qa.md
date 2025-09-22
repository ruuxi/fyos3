# Capability Routing QA Checklist

## Banter
- Prompt: "tell me a joke about cosmic cats"
- Expectation: router selects `banter`; response streams through persona pipeline only, no tool calls.

## Factual Lookup
- Prompt: "what's the weather in tokyo right now?"
- Expectation: router selects `factual_lookup`; first step issues `web_search`; final reply rewritten with Sim tone.

## Build/Edit
- Prompt: "update the header component to include a notifications badge"
- Expectation: router selects `build_edit`; filesystem/code tools available; persona voice applied to final answer.

## Media
- Prompt: "transform this photo into a watercolor" (attach image)
- Expectation: router selects `media`; only media tool bundle active; persona wraps final description.

## Desktop
- Prompt: "switch the desktop wallpaper to a neon grid and shuffle the app layout"
- Expectation: router selects `desktop`; desktop customize tool invoked; persona narration preserved.

When validating, toggle `AGENT_CAPABILITY_ROUTER/NEXT_PUBLIC_AGENT_CAPABILITY_ROUTER` off to confirm legacy fallback remains intact.
