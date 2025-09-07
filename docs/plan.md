## FYOS App Store + Visit: Step-by-Step Implementation Plan

This plan turns the research in `docs/research.md` into actionable steps with acceptance criteria. Work is grouped into phases that can be shipped incrementally while preserving a smooth UX.

References used: Cloudflare R2 Convex Component [https://www.convex.dev/components/cloudflare-r2](https://www.convex.dev/components/cloudflare-r2)

---

### Phase 0 – Foundations (Convex + R2 + Schemas)

1) Add Convex R2 component
   - Files:
     - `convex/convex.config.ts`: install and `app.use(r2)` from `@convex-dev/r2/convex.config` per docs.
     - `convex/r2.ts`: instantiate `R2` client with `components.r2` and re-export helper methods if needed.
   - Env:
     - Add to `.env.example`: `R2_TOKEN=`, `R2_ACCESS_KEY_ID=`, `R2_SECRET_ACCESS_KEY=`, `R2_ENDPOINT=`, `R2_BUCKET=`.
   - Acceptance:
     - Can run Convex with R2 hooked up; `r2.getUrl` and `r2.generateUploadUrl` functional via a simple test mutation.

2) Define Convex schema
   - File: `convex/schema.ts`
   - Tables:
     - `apps_public`: id, ownerId, name, icon, version, description, tags[], size, r2KeyTar, manifestHash, depsHash, createdAt, updatedAt, visibility.
     - `desktops_public`: id, ownerId, title, description, icon, size, r2KeySnapshot, manifestHash, lockfileHash, createdAt, updatedAt, visibility.
     - `installs`: userId, targetType ('desktop'|'app'), targetId, version, installedAt, installMeta.
   - Acceptance:
     - `npx convex dev` regenerates `_generated` without type errors; basic insert/query works.

3) Server functions (Convex)
   - Files: `convex/apps.ts`, `convex/desktops.ts`
   - Apps:
     - `publishAppStart` (mutation): validates auth; returns signed PUT URL + expected `r2Key`.
     - `publishAppFinalize` (mutation): writes/updates `apps_public` record with metadata and `r2KeyTar`.
     - `listApps` (query): search/sort/paginate public apps.
     - `getApp` (query): fetch by id.
   - Desktops:
     - `publishDesktopStart` (mutation): returns signed PUT URL + `r2KeySnapshot`.
     - `publishDesktopFinalize` (mutation): upsert `desktops_public` record.
     - `listDesktops` (query): public/unlisted listing.
     - `getDesktop` (query): fetch by id.
   - Acceptance:
     - End-to-end: obtain signed URL, upload a small blob, and finalize; items appear in listings.

4) Next.js server routes (proxies)
   - Files:
     - `src/app/api/store/apps/route.ts` (GET list, query Convex).
     - `src/app/api/store/apps/[id]/bundle/route.ts` (GET → resolve signed GET URL from Convex, stream from R2).
     - `src/app/api/visit/desktops/route.ts` (GET list via Convex).
     - `src/app/api/visit/desktops/[id]/snapshot/route.ts` (GET → resolve signed GET URL, stream from R2).
     - `src/app/api/publish/app/route.ts` (POST → call Convex start, upload, finalize).
     - `src/app/api/publish/desktop/route.ts` (POST → call Convex start, upload, finalize).
   - Acceptance:
     - Curl-able endpoints returning JSON or binary streams; basic error codes on missing records.

---

### Phase 1 – App Publish and Install

5) App manifest + packaging (client)
   - Build `app.manifest.json` for a selected `src/apps/<id>`.
   - Derive dependencies:
     - Start with a minimal explicit form (manual entry UI), later augment with import scanning.
   - Create `app.tar.gz` in-browser using `fflate` (or similar) including:
     - `src/apps/<id>/**`
     - `app.manifest.json`
   - Acceptance:
     - Produces a reproducible tarball; size roughly equals app folder + manifest.

6) App publish flow (client + server)
   - UI: “Publish App” in an Admin/Tools panel or in `AIAgentBar` action.
   - Steps:
     1. Request signed PUT from `/api/publish/app`.
     2. Upload tar.gz to signed URL.
     3. Call finalize; show shareable card.
   - Acceptance:
     - New app appears in `GET /api/store/apps` with metadata; bundle is downloadable.

7) App Store app (baseline app in desktop)
   - Create `src/apps/app-store/index.tsx` in the WebContainer template.
   - Fetch `/api/store/apps`; render grid with name, icon, install button.
   - Acceptance:
     - Renders list; clicking an app opens details view and shows Install.

8) App installation (delta dependencies)
   - Steps:
     1. Download and untar `app.tar.gz` into `src/apps/<id>` inside WebContainer.
     2. Conflict handling: if `id` or `name` exists, auto-rename (`name (1)`, `id-1`), aligning with existing `create_app` behavior.
     3. Update `public/apps/registry.json` with canonical entry.
     4. Compute missing deps: compare `manifest.dependencies` with local `package.json`/`node_modules`.
     5. Run `pnpm add <missing@version>` (silent reporter) via `web_exec`.
   - Acceptance:
     - App icon appears on desktop; opens and runs; only missing deps were installed (verified by logs).

---

### Phase 2 – Desktop Publish and Visit

9) Desktop publish (snapshot path + fallback)
   - Preferred: export a binary `snapshot.bin` of the current WebContainer (fast mount). If direct snapshot export isn’t available, fall back to a tarball of the full FS.
   - Steps:
     1. Client collects snapshot data (binary or tar) and calls `/api/publish/desktop` for signed upload.
     2. Upload; finalize via Convex; return `/d/{desktopId}`.
   - Acceptance:
     - A large artifact can be uploaded; metadata visible in `GET /api/visit/desktops`.

10) Visit route `/d/[id]`
   - File: `src/app/d/[id]/page.tsx`.
   - Behavior:
     - Fetch desktop record and signed snapshot URL via server route.
     - Spin up an isolated WebContainer instance for the visited desktop (separate from user’s workspace) and mount snapshot (or reconstruct if fallback). Render in an iframe container similar to current desktop embedding.
     - Provide a “Return to My Desktop” control.
   - Acceptance:
     - Visiting another desktop does not mutate the user’s own desktop; loads within a few seconds; apps inside visited desktop are operable.

11) Visit app (baseline app in desktop)
   - Create `src/apps/visit/index.tsx` to browse `GET /api/visit/desktops` with search, owner filter, and “Open” (navigates to `/d/{id}`).
   - Acceptance:
     - Lists public desktops; clicking opens the visit route.

---

### Phase 3 – Polish, Perf, and Safety

12) Caching and content addressing
   - Add `ETag`/`Cache-Control` on proxy routes; ensure R2 objects have stable keys.
   - Use `manifestHash`/`depsHash` in records for dedupe and future prefetching.
   - Acceptance:
     - Repeat downloads are cache hits; hashes stable across re-publishes without content changes.

13) Progress and telemetry
   - Stream compact logs during install (reuse `web_exec` tailing logic).
   - Record simple metrics in Convex (install counts, durations) with a daily cap.
   - Acceptance:
     - Users see progress; operators can query basic stats.

14) Security
   - Ensure snapshots and app bundles never include secrets (`.env*`, tokens).
   - Visibility controls: public / unlisted / private for apps/desktops.
   - Signed URL TTLs; ownership checks on publish/finalize.
   - Acceptance:
     - Private items not listable; access requires owner; bundles validated for excluded files.

15) Dependency accuracy improvements
   - Enhance dependency detection via static import scanning and `package.json` introspection.
   - Add warning UI for ambiguous peer deps.
   - Acceptance:
     - Common frameworks install cleanly without manual edits.

16) Baseline template updates
   - Add `app-store` and `visit` to `templates/webcontainer/public/apps/registry.json` and create minimal UIs.
   - Confirm COOP/COEP headers stay intact.
   - Acceptance:
     - New installs show the two default apps by default.

---

### Developer Tasks Checklist (condensed)
- Convex setup: R2, schema, actions/queries (apps/desktops).
- Next.js API proxies: list, artifact proxying, publish start/finalize.
- Client packaging: tar.gz creation, manifest, signed upload flow.
- App Store app: listing + install flow (delta deps + registry update + conflict-safe IDs).
- Desktop publish: snapshot/tar export + upload.
- Visit route `/d/[id]`: isolated WebContainer instance + snapshot mount.
- Visit app: browse and open.
- Perf and security hardening.

---

### Testing & Acceptance Criteria Summary
- Publish App: create, upload, finalize, listable, installable, launches without errors.
- Install App: only missing deps installed; no global pollution; icon appears and opens.
- Publish Desktop: produces artifact; shareable `/d/{id}`.
- Visit Desktop: loads separate instance; user’s own desktop untouched.
- Conflict handling: duplicate app names/ids auto-renamed and appear in registry.
- No secrets in artifacts; visibility rules enforced.


