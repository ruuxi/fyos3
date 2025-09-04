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
