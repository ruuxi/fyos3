# Agent Tools for Content Generation in the Agent Bar — Research

## Summary
- Goal: Let the agent generate and surface rich media (images, audio, video, 3D) directly in the Agent Bar, including handling uploads with visual previews and rendering outputs in-place.
- Current: The agent primarily has file-system and project-management tools. Apps inside the WebContainer already call AI providers via a host bridge and auto‑persist media. The Agent Bar has a Media Library panel and manual upload, but there are no explicit agent tools for invoking AI providers or ingesting/listing media from chat.
- Proposal: Add first‑class agent tools for content generation and media management, wire them to existing server proxies and ingest routes, and enhance the chat UI to render media outputs.

## What Exists Today

- Agent chat and tools
  - Server: `src/app/api/agent/route.ts` exposes tool schemas via `ai.streamText({ tools: { ... } })`.
    - Tools: `fs_find`, `fs_read`, `fs_write`, `fs_mkdir`, `fs_rm`, `exec`, `create_app`, `rename_app`, `remove_app`, `validate_project`, plus a server‑executed `search` tool.
    - These are described with Zod schemas in `src/lib/agentTools.ts`.
  - Client: `src/components/AIAgentBar.tsx` handles tool execution via `useChat({ onToolCall })` for client‑side ones (fs, exec, create/rename/remove app, validate). It returns results via `addToolResult`.
  - Note: Chat rendering currently outputs only text parts; tool outputs show up as text, not as rich media.

- Media ingestion and library
  - Ingest: `POST /api/media/ingest` stores images/audio/video to R2 and returns `{ id, publicUrl, r2Key, sha256, size, contentType }`. Route at `src/app/api/media/ingest/route.ts` enforces allowed source hosts and type limits.
  - Listing: `GET /api/media/list` queries Convex; route at `src/app/api/media/list/route.ts`.
  - UI: Agent Bar has a “Media Library” mode with upload input and URL ingest; displays image/audio/video tiles (`src/components/AIAgentBar.tsx`).
  - Background ingest on fs writes: `fs_write` tool handler in Agent Bar asynchronously ingests media files written to the VFS so generated assets become durable.

- AI provider bridge for apps (already working)
  - Host/iframe bridge: `src/components/WebContainer.tsx` listens for `AI_REQUEST` from apps, proxies to `POST /api/ai/fal` and `POST /api/ai/eleven`, then runs `persistAssetsFromAIResult()` to auto‑ingest returned URLs/base64 and rewrites results to durable FYOS public URLs.
  - Persistence util: `src/utils/ai-media.ts` detects URLs/base64 in provider responses and calls `/api/media/ingest` for each, returning `persistedAssets` and a result with URLs rewritten.

## Gaps to Close

- No agent‑callable content tools: The agent can’t currently call FAL or ElevenLabs from chat. Apps can, but the Agent Bar lacks those tools.
- No agent‑callable media management: The agent can’t ingest arbitrary URLs/base64, nor list media, via tools.
- Chat UI shows text only: It doesn’t render media in outputs, even when tool results include URLs.
- Uploads are user‑initiated only: There’s an upload control in the Media tab, but no “request an upload” flow inside chat and no file attachments on prompts.

## Proposed Tools (Server declarations + Client execution)

Define schemas in `src/lib/agentTools.ts` and register tools in `src/app/api/agent/route.ts`. For secrets, keep provider calls behind server routes; execute these tools on the client (Agent Bar `onToolCall`) via `fetch()` to existing proxies, then run `persistAssetsFromAIResult()` client‑side to normalize outputs and ingest media.

- ai_fal
  - Purpose: Call any FAL model (image/video/3D/SFX/etc.).
  - Input: `{ model: string; input: Record<string, any>; scope?: { desktopId?: string; appId?: string; appName?: string } }`
  - Execution (client): `POST /api/ai/fal` → JSON; then `persistAssetsFromAIResult(json, scope)` to rewrite URLs and capture `persistedAssets`.
  - Output: `{ ok: true; result; persistedAssets } | { error }`

- ai_eleven_music
  - Purpose: Compose music/audio via ElevenLabs.
  - Input: `ComposeMusicParams`-like shape (keep loose with zod for LLM): `{ prompt?: string; style?: string; musicLengthMs?: number; outputFormat?: 'mp3'|'wav'; ... }`
  - Execution (client): `POST /api/ai/eleven` with JSON; then `persistAssetsFromAIResult(json, scope)` (handles `audioBase64` → `audioUrl`).
  - Output: `{ ok: true; result; persistedAssets } | { error }`

- media_ingest
  - Purpose: Ingest a `sourceUrl` or `base64` payload to durable storage.
  - Input (XOR): `{ sourceUrl: string; contentType?: string; scope?: { desktopId?: string; appId?: string; appName?: string }; metadata?: Record<string,string> }` OR `{ base64: string; contentType?: string; scope?: ...; metadata?: ... }`
  - Execution (client): `POST /api/media/ingest`.
  - Output: `{ ok: true; id; publicUrl; r2Key; sha256; size; contentType } | { error }`

- media_list
  - Purpose: List recent media to reference or display.
  - Input: `{ type?: 'image'|'audio'|'video'; appId?: string; desktopId?: string; from?: number; to?: number; limit?: number }`
  - Execution (client): `GET /api/media/list` with query params.
  - Output: `{ items: Array<{ _id, contentType, publicUrl?, r2Key, createdAt, size? }> } | { error }`

Notes
- Keep schemas permissive (zod `record(any)`) for `ai_fal.input` to avoid over‑constraining the LLM.
- Add concise tool descriptions so the planner selects them appropriately.
- Continue executing `search` on server (already implemented) since it doesn’t require client context.

## Chat UI Enhancements (Display Multiple Formats)

- Attachments on prompts (user uploads)
  - Add an attachments state to `AIAgentBar` input area with drag‑drop/file picker.
  - On send, pre‑ingest files via `/api/media/ingest` and include a concise text summary in the user message (e.g., “Attached: <urls>”), or pass a hidden tool result “media_ingest” prior to the user turn to give the model the durable URLs.
  - Include minimal metadata (filename/contentType) so the model can choose matching tools.

- Render media in messages
  - In `AIAgentBar` message renderer, detect when assistant/tool results include:
    - `persistedAssets: Array<{ kind, publicUrl, contentType }>` and render a compact gallery:
      - `image/*` → `<img>`
      - `audio/*` → `<audio controls>`
      - `video/*` → `<video controls>`
  - For JSON payloads, render a collapsible JSON viewer or pretty‑printed block with copy.
  - Keep text concise; show a “View in Media Library” link to jump to the Media tab filtered by type.

## Execution Model (Where code lives)

- Server (`src/app/api/agent/route.ts`)
  - Add tool entries for `ai_fal`, `ai_eleven_music`, `media_ingest`, `media_list` with Zod input schemas from `src/lib/agentTools.ts`.
  - For provider tools, declare schema/description only (no `execute`) so they run client‑side where we can re‑use `persistAssetsFromAIResult()` and call the existing server proxies.
  - Keep `search` as a server‑executed tool (already implemented with Exa).

- Client (`src/components/AIAgentBar.tsx`)
  - Extend `onToolCall` switch with handlers:
    - `ai_fal`: call `/api/ai/fal`, then `persistAssetsFromAIResult()`, return `{ result, persistedAssets }` via `addToolResult`.
    - `ai_eleven_music`: call `/api/ai/eleven`, then `persistAssetsFromAIResult()`.
    - `media_ingest`: call `/api/media/ingest` (XOR inputs enforced in schema), return ingest info.
    - `media_list`: call `/api/media/list` and return items.
  - Enhance message rendering to show media thumbnails/players based on `persistedAssets` or explicit `publicUrl`s in tool results.

## System Prompt Updates (Agent Guidance)

- Add a short “AI Media Tools” section in the system prompt in `src/app/api/agent/route.ts` explaining:
  - When to use `ai_fal` (model‑agnostic media generation) and `ai_eleven_music` (music/audio).
  - How to use `media_ingest` to turn base64 or external URLs into durable URLs before generation when a model needs public URLs.
  - How to fetch recent assets with `media_list` and reference them.
  - Keep commentary minimal; return concise text and rely on UI to render media.

## Security & Limits

- Secrets remain server‑side: Providers are only called via `/api/ai/fal` and `/api/ai/eleven`.
- Ingest route already restricts allowed hosts and content types and enforces a size cap.
- COOP/COEP headers must remain enabled (for WebContainer).

## Rollout Plan

1) Schemas: Add Zod inputs for `ai_fal`, `ai_eleven_music`, `media_ingest`, `media_list` in `src/lib/agentTools.ts`.
2) Server: Register tool descriptions in `src/app/api/agent/route.ts` tools map.
3) Client: Implement `onToolCall` handlers in `AIAgentBar.tsx` and import `persistAssetsFromAIResult`.
4) UI: Add prompt attachments (upload) + preview; extend message renderer for media.
5) Prompt: Add “AI Media Tools” usage notes in the system prompt.
6) Validate: Use quick `validate_project` tool and manual testing; confirm ESLint/TS pass.

## Nice‑to‑Haves (Later)

- “Request Upload” tool: a no‑op tool whose result instructs the UI to show an inline upload card with accepted types; once user uploads, the UI calls `media_ingest` and re‑invokes the model with the new URLs.
- Thumbnails/transcodes: Background workers to generate thumbnails or audio waveforms for richer previews.
- Pagination and filters in Media tab synced with `media_list` tool invocations from chat.

## Why This Design

- Minimal changes: Reuses existing proxies and ingest pipeline; only adds tool surfaces and light UI.
- Flexible: `ai_fal` is model‑agnostic; new modalities require no new agent code.
- Safe: All provider calls remain server‑side; client calls only our own APIs.

