### Goal
Implement automatic, durable media persistence (images, audio, music, video) for WebContainer apps without per‑app code, while preserving current behavior.

### High‑level phases
1) Server ingest route and storage plumbing
2) AI bridge auto‑persist (no app changes)
3) Optional: attribution context and agent write hooks
4) Optional: discovery APIs and a simple Media app

### Step‑by‑step plan

Phase 1 — Server ingest and storage
1. Create `src/app/api/media/ingest/route.ts` (POST):
   - Input: `{ sourceUrl?: string, base64?: string, contentType?: string, filenameHint?: string, scope?: { desktopId?: string, appId?: string }, metadata?: Record<string,string> }`.
   - Validation: exactly one of `sourceUrl` or `base64`. Enforce size limit, type allowlist (image/*, audio/*, video/*), deny known risky content types.
   - Fetch/Decode: If `sourceUrl`, fetch bytes via server; if `base64`, decode.
   - Detect: Determine `contentType` from headers or sniff; choose extension. Compute SHA‑256 of bytes.
   - De‑dup: Use Convex DB to check by hash; if exists, return existing record.
   - Upload: Call Convex `generateUploadUrl` to R2 (new `convex/media.ts` mutations or extend existing R2 wrapper). PUT bytes to signed URL. Store record (`ownerId`, `desktopId`, `appId`, `sha256`, `size`, `contentType`, `r2Key`, `publicUrl`, timestamps, metadata) and return `{ ok, publicUrl, r2Key, sha256, size, contentType }`.
   - Security: Validate `sourceUrl` host allowlist or proxy through controlled domains; timeouts; size caps.

2. Convex schema and functions:
   - Add a `media_public` table: fields above, indexes by `ownerId`, `sha256`, `(ownerId, appId)`, `(ownerId, desktopId)`.
   - Mutations: `startIngest` (returns signed URL + r2Key), `finalizeIngest` (upsert by `ownerId+sha256`).
   - Queries: `listMedia` (filters: type, appId, desktopId, date range, limit), `getMediaByHash`.

3. Configuration:
   - Ensure R2 bucket binding in Convex (`convex/r2.ts`) is available; if separate bucket for media is preferred, add a second client.
   - `.env.example`: add any media‑related env keys (CDN base URL if applicable).

Phase 2 — AI bridge auto‑persist
4. In `src/components/WebContainer.tsx`, enhance the `AI_REQUEST` branch:
   - After provider response is received, call a new helper `persistAssetsFromAIResult(result, scope)`.
   - Detection heuristics:
     - Images: scan for common URL fields: `url`, `image`, `images[]`, `output[]`, deep paths like `data.images[0].url`.
     - Audio: handle `{ contentType, audioBase64 }` (from ElevenLabs proxy) and any `audioUrl`/`audio` fields.
     - Video: `video`, `videos[]`, `url` with `video/*` content type.
   - For each found asset, call `/api/media/ingest` with `{ sourceUrl }` or `{ base64, contentType }` and include `{ appId, appName }` in `scope` when available.
   - Replace original references in `result` with `{ url: publicUrl }` and collect a `persistedAssets` array for transparency.
   - Reply to the iframe with the augmented `result`.

5. Add `persistAssetsFromAIResult` util (file co‑located or under `src/utils/ai-media.ts`):
   - Pure function that walks the result graph, extracts candidate media, dedupes, ingests, and returns `{ result: updated, persistedAssets }`.

Phase 3 — Attribution context and agent write hooks (optional but recommended)
6. In `templates/webcontainer/src/ai/index.ts`, include `{ appId, appName }` in `AI_REQUEST`:
   - Parse `id`/`name` from `location.search` in the iframe.
   - Extend payload to `{ ..., scope: { appId, appName } }`.
   - This is a platform helper change, not per‑app code.

7. Agent file writes hook:
   - Option A: In `AIAgentBar.tsx` `web_fs_write` branch, if path ends with a media extension, read the file bytes and POST to `/api/media/ingest` (base64) asynchronously; log the returned `publicUrl`.
   - Option B: In `WebContainerProvider.writeFile`, add an optional callback/hook invoked on write; outside, wire a listener that detects media extensions and triggers ingest.
   - Optionally maintain `/public/media/index.json` with entries for offline discovery.

Phase 4 — Discovery APIs and Media app (optional)
8. Routes:
   - `GET /api/media/list?type=&appId=&desktopId=&from=&to=&limit=` → use Convex query.
   - `GET /api/media/:id` → redirect to CDN/public URL or stream via proxy.

9. Media app:
   - Create `src/apps/media/index.tsx` to browse thumbnails, filter by app/date/type, and open/download assets.

Testing & roll‑out
10. Unit tests for ingest route (validation, dedup, extension inference).
11. Integration tests: mock FAL and ElevenLabs responses; verify URLs are replaced and assets exist in storage.
12. Manual E2E: generate an image/audio from an app; confirm persisted URL is used; reload session and verify durability.

Performance & limits
13. Add size limits (e.g., 25–100 MB per asset); stream upload when possible; upgrade to multipart if large videos become common.
14. Rate limiting on ingest route to prevent abuse.

Security
15. Strictly validate `sourceUrl` (allowed providers), sanitize filename hints, and enforce content type allowlist.
16. Keep buckets private by default; serve via signed/public CDN URLs as policy dictates.

Backwards compatibility
17. Apps keep using `@/ai` helpers; they automatically get persisted URLs without changes.
18. Agent writes continue to work; optional hook only adds remote persistence for media files.


