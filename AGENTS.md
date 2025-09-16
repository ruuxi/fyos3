# Repository Guidelines

## Platform Overview & Intent
FYOS is an AI-first "infinite creation" desktop: users describe outcomes, `AIAgentBar` selects tools, and apps materialize inside a WebContainer iframe seeded from `templates/webcontainer`. The host hides code behind a visual desktop while media tools persist assets without touching the workspace. Users can publish desktops, install shared apps, visit others, and add friends.

## Project Structure & Module Organization
- Next.js host in `src/`: `app/page.tsx` binds the desktop iframe and agent bar; `components/` houses agent UI; `lib/`/`utils/` hold prompts, tool handlers, media ingest, snapshots; `data/` keeps WebContainer seeds.
- Convex backend (`convex/`) powers persistence, publishing, visits, media, and friends/DMs.
- Default desktop bundle lives in `templates/webcontainer/`; static assets in `public/`, docs in `docs/`, scripts in `scripts/`.

## Build, Test, and Development Commands
- `pnpm dev` — start the Next.js host (Turbopack); run `npx convex dev` for backend APIs. Use `pnpm build` → `pnpm start` for production.
- `pnpm run verify:webcontainer` (and `generate:snapshot` after template edits) — keep WebContainer sources valid.
- `node test-auto-ingest.js` / `node test-auto-ingest-simple.js` — smoke tests for media ingestion helpers.

## Coding Style & Naming Conventions
- TypeScript + React 19 on Next.js 15; prefer the `@/*` alias.
- Components use PascalCase filenames; helpers favor kebab/camel case (e.g., `auto-ingest.ts`).
- Keep UI code declarative and user-facing—avoid exposing raw source in the experience.
- API routes live under `src/app/api/**/route.ts`; keep them slim, typed, and side-effect aware, and run `pnpm lint` before pushing.

## Testing Guidelines
- Current coverage relies on node scripts; keep additions deterministic, mocking Convex, fetch, and AI providers.
- For media tooling, assert FYOS URL rewrites and ingest counts; place new `*.test.ts` next to the feature or under `src/**/__tests__`.

