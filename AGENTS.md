# Repository Guidelines

## Project Structure & Module Organization
- `src/app/`: Next.js App Router (routes, API like `api/agent/route.ts`), and global styles (`app/globals.css`).
- `src/components/`: Reusable UI; primitives live in `components/ui/` (e.g., `button.tsx`).
- `src/lib/`: Small helpers and utilities (e.g., `utils.ts`).
- `src/utils/`: WebContainer and runtime helpers (e.g., `webcontainer-snapshot.ts`).
- `src/data/`: Static data (e.g., `webcontainer-files.ts`).
- `public/`: Static assets. `docs/ai-sdk/`: AI SDK notes and examples.

## Build, Test, and Development Commands
- `pnpm i`: Install dependencies (repo uses `pnpm-lock.yaml`).
- `pnpm dev`: Start local dev with Turbopack at `http://localhost:3000`.
- `pnpm build`: Production build of the Next.js app.
- `pnpm start`: Run the production server.
- `pnpm lint`: ESLint (extends Next core‑web‑vitals + TypeScript).

## Coding Style & Naming Conventions
- Language: TypeScript (strict, no emit). Indent: 2 spaces.
- Components: PascalCase filenames (e.g., `AIAgentBar.tsx`, `WebContainer.tsx`).
- Primitives in `components/ui/`: lowercase filenames (e.g., `button.tsx`).
- Functions/vars: `camelCase`; types/interfaces: `PascalCase`.
- Prefer function components + hooks; import via alias `@/*`.
- Run `pnpm lint` and fix warnings before committing.

## Testing Guidelines
- At minimum, validate changed flows manually and ensure ESLint passes.

## Security & Configuration Tips
- Do not commit real secrets. Use `.env.local` (git‑ignored) and provide redacted values; add new keys to a `.env.example`.
- Keep COEP/COOP headers in `next.config.ts` (required for WebContainer) unless you know the implications.
- Agent changes live in `src/app/api/agent/route.ts`: document new tools, keep the system prompt focused.

### AI Providers (FAL, ElevenLabs)
- Add `FAL_API_KEY` and `ELEVENLABS_API_KEY` to your `.env.local`.
- Server proxies:
  - `POST /api/ai/fal` → proxies to `https://fal.run/<model>`
  - `POST /api/ai/eleven` → proxies to `https://api.elevenlabs.io/v1/music`
- In WebContainer apps, import helpers from `/src/ai` instead of calling providers directly:
  - `callFluxSchnell(input)` → FLUX.1 [schnell] via FAL
  - `callFal(model, input)` → generic FAL model call
  - `composeMusic(params)` → ElevenLabs Music
These route through a message bridge and keep keys on the server.

## Agent Tools
- web_fs_find: List files/folders in WebContainer
- web_fs_read: Read a file
- web_fs_write: Write a file (creates dirs)
- web_fs_mkdir: Create a directory
- web_fs_rm: Remove a file/folder
- web_exec: Spawn a process (e.g., `pnpm add react`)
- install_packages: Install npm packages; input: `{ packages: string[], dev?: boolean, manager?: 'pnpm'|'npm'|'yarn'|'bun' }`
- create_app: Scaffold an app entry in `src/apps/<id>` and update registry
- rename_app: Rename app in registry by id
- remove_app: Remove app folder and registry entry

## Automatic Validation & Self‑Healing
- After any file change (`web_fs_write`, `web_fs_mkdir`, `web_fs_rm`, app scaffold edits), a debounced validator runs:
  - TypeScript: `pnpm exec tsc --noEmit`
  - ESLint: for changed files only `pnpm exec eslint --max-warnings=0 <changed files>`
- On failures, a diagnostic message with condensed logs is auto‑posted to the agent (no user click required). The agent can then fix the errors.
- Preview errors: WebContainer is booted with `forwardPreviewErrors` and `src/components/WebContainer.tsx` dispatches a `wc-preview-error` event on uncaught exceptions/unhandled rejections. These are auto‑posted (once per unique error) to the agent silently (no UI alert).
- Manual trigger: The agent can explicitly call the `validate_project` tool (scope: `quick` or `full`) to run checks on demand.
