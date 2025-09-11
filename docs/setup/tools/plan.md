# Agent Bar Content Tools — Implementation Plan

This plan adds first‑class agent tools for media generation and management, and updates the Agent Bar UI to support uploads and rich media rendering.

## 1) Extend Tool Schemas

Edit `src/lib/agentTools.ts`.

- Add input schemas:
  - `AiFalInput`
  - `ElevenMusicInput`
  - `MediaIngestInput`
  - `MediaListInput`
- Add to `TOOL_NAMES`:
  - `ai_fal`, `ai_eleven_music`, `media_ingest`, `media_list`
- Export new types.

Implementation notes:
- Keep `AiFalInput.input` as `z.record(z.any())` to avoid over‑constraining.
- `MediaIngestInput` allows `sourceUrl` OR `base64`; the server route enforces XOR, so the schema can be permissive with clear descriptions.

## 2) Register Tools on the Server

Edit `src/app/api/agent/route.ts`.

- Import the new schemas and update the tools map passed to `streamText()`:
  - `[TOOL_NAMES.ai_fal]`: `{ description, inputSchema: AiFalInput }`
  - `[TOOL_NAMES.ai_eleven_music]`: `{ description, inputSchema: ElevenMusicInput }`
  - `[TOOL_NAMES.media_ingest]`: `{ description, inputSchema: MediaIngestInput }`
  - `[TOOL_NAMES.media_list]`: `{ description, inputSchema: MediaListInput }`
- Do not add `execute` for these four; they will execute on the client (Agent Bar) using existing server proxies and the media ingest routes.
- Keep `search` as a server‑executed tool.

Update the system prompt string:
- Add a concise “AI Media Tools” section that explains when to use `ai_fal`, `ai_eleven_music`, `media_ingest`, and `media_list`.
- State explicitly that models requiring file inputs must receive durable public URLs via `media_ingest` before invoking `ai_fal` when needed.
- Keep tone minimal; the UI will render media.

## 3) Implement Client Tool Execution

Edit `src/components/AIAgentBar.tsx`.

- Add import: `import { persistAssetsFromAIResult } from '@/utils/ai-media';`
- In `useChat({ onToolCall })` switch, add cases:

1. `ai_fal`
   - Input: `{ model, input, scope }`.
   - `const res = await fetch('/api/ai/fal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });`
   - Parse JSON, call `await persistAssetsFromAIResult(json, scope)`.
   - `addToolResult({ tool: 'ai_fal', toolCallId, output: { ok: true, result: updated, persistedAssets } })`.

2. `ai_eleven_music`
   - Input: `{ ...params, scope? }`.
   - `const res = await fetch('/api/ai/eleven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });`
   - Parse JSON, call `persistAssetsFromAIResult(json, scope)`.
   - `addToolResult({ tool: 'ai_eleven_music', toolCallId, output: { ok: true, result: updated, persistedAssets } })`.

3. `media_ingest`
   - Input: `{ sourceUrl? base64? contentType? scope? metadata? }`.
   - `const res = await fetch('/api/media/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });`
   - `addToolResult({ tool: 'media_ingest', toolCallId, output: await res.json() })` (or `{ error }` on non‑OK).

4. `media_list`
   - Input: `{ type?, appId?, desktopId?, from?, to?, limit? }`.
   - Build URLSearchParams and `GET /api/media/list`.
   - `addToolResult({ tool: 'media_list', toolCallId, output: { items } })`.

All four handlers must follow the existing pattern: log concise console messages, catch errors, and return `{ error: message }` when failing.

## 4) Render Media in Chat

Edit `src/components/AIAgentBar.tsx` message renderer.

- Extend the `m.parts.map(...)` switch to handle tool results:
  - Add `case 'tool-result':` and extract `const payload = (part as any).result ?? (part as any).output ?? null;`
  - If `payload?.persistedAssets?.length`:
    - Render a vertical stack of players:
      - `image/*` → `<img src={asset.publicUrl} />`
      - `audio/*` → `<audio controls src={asset.publicUrl} />`
      - `video/*` → `<video controls src={asset.publicUrl} />`
    - Show small caption with `contentType` and size if provided.
  - Else if `payload?.publicUrl && payload?.contentType`:
    - Render a single player as above based on `contentType`.
  - Else:
    - Render a compact `<pre>` with `JSON.stringify(payload, null, 2)` inside the bubble.

Use the existing bubble container styles; keep elements responsive and within current max‑width.

## 5) Add Prompt Attachments (Uploads)

Edit `src/components/AIAgentBar.tsx` input bar.

- State: `const [attachments, setAttachments] = useState<Array<{ name: string; publicUrl: string; contentType: string }>>([]);`
- UI:
  - Add a small file input button (paperclip icon) in the right cluster next to Send.
  - On `onChange`, for each selected file:
    - Read as base64 via FileReader.
    - `POST /api/media/ingest` with `{ base64, contentType: file.type, metadata: { filename: file.name } }`.
    - On success, `setAttachments((prev) => [...prev, { name: file.name, publicUrl, contentType }])`.
  - Show inline chips with filename (truncate) before the Textarea when attachments exist; provide an “x” to remove a chip (local only).
- Submit hook (`onSubmit`):
  - If `attachments.length > 0`, append a single line at the end of the message: `\n\nAttachments:\n${attachments.map(a => `- ${a.name}: ${a.publicUrl}`).join('\n')}`.
  - Call `sendMessage({ text })` and clear `attachments`.

## 6) Minor Styling

- Keep the media players within the existing bubble width using utility classes (e.g., `w-full`, `rounded`, `mt-2`).
- Use the existing `modern-scrollbar` and transitions; no new global styles required.

## 7) Types and Imports

- Ensure `AIAgentBar.tsx` imports `persistAssetsFromAIResult` from `@/utils/ai-media`.
- Ensure `src/app/api/agent/route.ts` imports the new schemas and `TOOL_NAMES` keys.
- Ensure `src/lib/agentTools.ts` exports the new types alongside existing ones.

## 8) Linting and Typecheck

- Run existing repo commands to validate the changes locally during development: `pnpm lint` and `pnpm exec tsc --noEmit`.

