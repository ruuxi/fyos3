# Transition `fast_app_create` to Client Execution

## Goal
Ensure new apps always land in the WebContainer VFS immediately by making the client handle `fast_app_create` tool calls, while keeping the fast, single-call UX promised by the prompt.

## Current Issues
- Server-side `fast_app_create` runs entirely on the backend, so the browser only sees a streaming mirror payload. Any delay or failure in that payload means the desktop never updates.
- `onToolCall` never fires because the tool is already satisfied server-side.
- The mirror logic duplicates scaffolding code and adds complex retry paths that still fail.

## Strategy Overview
1. **Stop server execution**: unregister the `execute` handler for `fast_app_create` in `buildServerTools`, and expose it as a dynamic tool in the API router so the client must fulfil it.
2. **Share scaffolding logic**: extract the ID/name dedupe + default file creation into a shared helper (e.g., `src/lib/apps/fastAppCreate.ts`) so both client and future server code stay in sync.
3. **Client implementation**: extend `useAgentChat`’s `onToolCall` switch to handle `fast_app_create` via the helper using `fnsRef`, mirroring the existing `app_manage` flow. Return a detailed tool result for logging.
4. **Consistency + logging**: reuse the helper in the server (if we later need persistence), and ensure the client logs tool results, clears caches, and handles dependency gating.
5. **Documentation & testing**: update code comments/prompt references if needed and run targeted lint checks.

## Detailed Tasks
1. **Backend refactor**
   - Remove the `fast_app_create` export from `buildServerTools`.
   - In `src/app/api/agent/route.ts`, define `fast_app_create` as a schema-only tool (no execute) so the AI SDK emits a dynamic tool call.

2. **Shared helper**
   - Create `src/lib/apps/fastAppCreate.ts` with:
     - Input/output types (reuse `FastAppCreateInput`).
     - Logic to dedupe IDs/names, write metadata, default files, requested files, and registry entry.
     - Dependency on an abstract file-system interface (`mkdir`, `writeFile`, `readFile`).
     - Utility to compute mirror payload for logging.

3. **Client onToolCall update**
   - Import the helper into `useAgentChat`.
   - Add a new case in the scheduler switch that waits for deps, runs the helper with `fnsRef`, logs result via `addToolResult`, and updates caches.
   - Ensure registry cache invalidation + optional auto-open still work.

4. **Cleanup + docs**
   - Remove old mirror queue logic if redundant after move (evaluate once client path works).
   - Adjust prompts or comments that claim the server mirrors the VFS automatically.
   - Run `pnpm lint -- src/components/agent/AIAgentBar/hooks/useAgentChat.ts` (and other touched files if needed).

## Acceptance Criteria
- `fast_app_create` tool calls trigger the client handler (verify via console logs / breakpoints).
- Newly created apps appear instantly in the desktop launcher without relying on streamed mirrors.
- No regression to other tools (`app_manage`, `web_fs_*`).
- Linting passes for updated files.

