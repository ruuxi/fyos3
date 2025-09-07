## FYOS App Store and Visit Architecture (Research)

### Goals
- Seamless sharing of either a full desktop ("Visit") or a single app (App Store).
- Correct dependency handling with minimal installs and no extra bloat.
- Fast UX: avoid full reinstall when possible; incremental installs only.
- Simple URLs for visiting: `/d/{id}`.

### Definitions
- Desktop: a complete workspace image (source tree + dependencies) including all apps and configuration. In FYOS terms, “everything”.
- App: a single app folder under `src/apps/<id>` with its own UI code, assets, and an explicit dependency manifest.

### Storage & Infra Overview
- Metadata (discoverability, ownership, listing, and search): Convex.
- Binary/object storage for bundles (desktops and apps): Cloudflare R2 via Convex R2 Component.
  - R2 stores: desktop snapshots, app tarballs, optional lockfiles and dependency manifests.
  - Use signed URLs for upload/download; sync metadata in Convex for listings.
- Why: R2 is cost‑effective S3‑compatible blob storage with good DX and Convex integration.
  - Reference: Cloudflare R2 Convex Component docs: [convex.dev/components/cloudflare-r2](https://www.convex.dev/components/cloudflare-r2)

### Existing Code Touchpoints (FYOS)
- `src/utils/webcontainer-snapshot.ts` and `src/app/api/webcontainer-snapshot/route.ts` serve local snapshot; extend the approach to remote snapshots via signed R2 URLs.
- `src/components/AIAgentBar.tsx` provides tools for FS ops, app creation, and validation; we will add “Publish App/Desktop” and “Install App/Desktop” flows using these client tools + server endpoints.
- `src/app/api/agent/route.ts` tools already support file discovery, writes, installs (`web_exec`), and registry updates; we’ll leverage this for install flows.

### Data Model (Convex)
Tables (names illustrative):
- `users`: id, handle, profile, etc.
- `apps_public`: id, ownerId, name, icon, version, description, tags, size, r2KeyTar, manifestHash, depsHash, createdAt, updatedAt.
- `desktops_public`: id, ownerId, title, description, icon, size, r2KeySnapshot, manifestHash, lockfileHash, createdAt, updatedAt, visibility (public/unlisted/private).
- `installs`: userId, targetType ('desktop'|'app'), targetId, installedAt, version, installMeta.

App artifacts in R2:
- `apps/{ownerId}/{appId}/{version}/app.tar.gz` (only `src/apps/<id>` + manifest; no extra files).
- `apps/{ownerId}/{appId}/{version}/manifest.json` (metadata + dependencies).

Desktop artifacts in R2:
- `desktops/{ownerId}/{desktopId}/{version}/snapshot.bin` (full WebContainer snapshot).
- `desktops/{ownerId}/{desktopId}/{version}/manifest.json` (summary + deps index, optional).
- Optional: `package.json`, `pnpm-lock.yaml` for provenance and diffing.

### Bundle Formats
App bundle tarball (contents):
- `src/apps/<id>/**` (code only)
- `app.manifest.json`:
```json
{
  "schemaVersion": 1,
  "id": "notes",
  "name": "Notes",
  "icon": "📝",
  "entry": "/src/apps/notes/index.tsx",
  "dependencies": {
    "zustand": "^4.5.0"
  },
  "peerDependencies": {},
  "devDependencies": {},
  "tags": ["productivity"],
  "description": "Lightweight notes app"
}
```

Desktop snapshot:
- `snapshot.bin` (full FS state from a baseline; generated server‑side)
- `desktop.manifest.json` (title, icon, owner, list of apps, optional dependency index)
- Optional: `package.json`, `pnpm-lock.yaml` included for provenance (not required to load snapshot).

### Dependency Strategy
Baseline
- FYOS ships with a known baseline defined by `templates/webcontainer/package.json` (React + shadcn + Tailwind, etc.). We assume these are present in the base snapshot.
- We prefer pnpm for installs and deltas to keep installs fast [[uses pnpm]].

Apps (delta installs only)
- Each app declares explicit `dependencies` in `app.manifest.json`.
- On install, compute set‑difference: `app.deps - localInstalled`. Add only missing versions via `pnpm add` with explicit pinned versions.
- Never leak desktop/global dev dependencies into app bundles.
- If multiple apps require the same dep but different versions, prefer the highest semver compatible version; otherwise install both respecting pnpm’s hoisting strategy.

Desktops (visit)
- Preferred fast path: load `snapshot.bin` for the desktop. No install needed because the snapshot already contains the correct `node_modules` state.
- Fallback path: if snapshot missing, reconstruct by diffing the remote desktop’s `package.json`/lock with local baseline and running `pnpm install` for the missing set only (still slower).

Caching & Performance
- Content addressing: include `manifestHash`/`depsHash` (SHA‑256) for dedupe and CDN caching.
- Signed URL downloads from R2; leverage HTTP caching (`Cache-Control`, `ETag`).
- Optional future: pre‑seed a small offline store (e.g., `.pnpm-store`) layers for frequent deps to speed up installs.

### Publish Flows
Publish App (from current desktop)
1. Author selects app folder `src/apps/<id>` and triggers “Publish App”.
2. Build `app.manifest.json` by scanning imports to suggest deps; allow manual edit.
3. Tar only that app folder + manifest.
4. Upload to R2 via Convex action (signed URL). Store metadata in `apps_public` with indexes (name, tags, owner).

Publish Desktop (Visit)
1. Author triggers “Publish Desktop”.
2. Server generates a `snapshot.bin` of the current WebContainer (similar to `src/utils/webcontainer-snapshot.ts`), persists to R2, and records metadata in `desktops_public`.
3. Return share URL `/d/{desktopId}`.

### Install/Visit Flows
Install App from App Store
1. User browses App Store (Convex query) and clicks Install.
2. Download and extract `app.tar.gz` into `src/apps/<id>`.
3. Handle duplicates: if `name` or `id` exists, auto‑rename (`name (1)`, `id-1`) — aligns with existing `create_app` logic in `AIAgentBar.tsx`.
4. Update `public/apps/registry.json` with the canonical entry.
5. Compute missing deps and run `pnpm add` only for the delta (non‑interactive, silent reporter).

Visit Desktop `/d/{id}`
1. Next.js route `src/app/d/[id]/page.tsx` fetches `desktops_public` by id.
2. Download `snapshot.bin` from R2 (signed URL) via an edge/server route that streams the binary (`src/app/api/webcontainer-snapshot/route.ts` is a local analogue).
3. Mount snapshot into a fresh WebContainer instance and render the visited desktop in an isolated iframe.
4. Keep visitor’s own desktop intact and switch contexts in UI (clear affordance to “Return to My Desktop”).

### API & Components
Convex + R2 setup
- Configure Convex R2 component per docs; set env vars: `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
- Provide actions/mutations:
  - `r2.generateUploadUrl`, `r2.getUrl`, `r2.store`, `r2.deleteObject`, `r2.getMetadata`.
  - Publish endpoints wrapping R2 uploads and metadata creation.
- Reference: [convex.dev/components/cloudflare-r2](https://www.convex.dev/components/cloudflare-r2)

Next.js routes (proposed)
- `POST /api/publish/app` → tar app, signed upload, create entry in `apps_public`.
- `POST /api/publish/desktop` → produce `snapshot.bin`, signed upload, create `desktops_public` entry, return `/d/{id}`.
- `GET /api/desktops/:id/snapshot` → signed proxy to R2 for `snapshot.bin`.
- `GET /api/apps/:id/bundle` → signed proxy to R2 for `app.tar.gz`.

Client integration
- Extend `AIAgentBar` tooling with:
  - `publish_app({ appId })`, `publish_desktop()` tools (call the server routes; show progress).
  - `install_app({ appId })` (download, extract, registry update, delta `pnpm add`).
  - `visit_desktop({ desktopId })` (navigate to `/d/{id}` and bootstrap snapshot).

### Security & Isolation
- Visiting desktops runs a separate WebContainer instance to avoid mutating the user’s own workspace.
- Do not import other users’ secrets; snapshots should never include `.env.*`.
- Server‑side validates ownership and visibility before issuing signed URLs.

### UX Notes
- Install progress uses compact logs (already implemented in `web_exec` tool path logging).
- Auto‑rename on conflicts is already implemented for app creation; reuse for installs.
- After app install, append to `public/apps/registry.json` to surface on desktop immediately.

### Open Questions / Future Enhancements
- Optional layered snapshots to minimize binary sizes (baseline + delta layers).
- Shared pnpm store seeded in R2 to dramatically speed up first‑time installs.
- Ratings, versioning, and update flows for apps.

### References
- Cloudflare R2 Convex Component: [https://www.convex.dev/components/cloudflare-r2](https://www.convex.dev/components/cloudflare-r2)
- FYOS files referenced: `src/utils/webcontainer-snapshot.ts`, `src/app/api/webcontainer-snapshot/route.ts`, `src/components/AIAgentBar.tsx`, `src/app/api/agent/route.ts`.


