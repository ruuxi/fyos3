# FYOS Agent Refactor Plan

Target: Reduce `src/components/AIAgentBar.tsx` (~2k LOC) into small, focused modules and slim down `src/app/api/agent/route.ts` without feature regressions. Keep behavior identical, improve readability, testability, and maintainability.

---

## Goals & Non‑Goals

- Goals
  - Cut `AIAgentBar.tsx` to < 400–600 LOC by extracting hooks, UI subcomponents, and utilities.
  - Keep the same public API (default export, no breaking prop changes) and UI/UX.
  - Centralize tool‑call dispatching and validation logic into reusable hooks.
  - Decompose `api/agent/route.ts` by extracting helpers and tool wiring into lib modules.
  - Pass `pnpm lint` and TypeScript strict checks.
- Non‑Goals
  - No visual redesign or feature additions.
  - No change to tool schemas (`src/lib/agentTools.ts`) or API routes contract.
  - No changes to COEP/COOP headers or security posture.

---

## Constraints & References

- Follow project guidelines (TypeScript strict, imports via `@/*`, components PascalCase, UI primitives lowercase in `components/ui/`).
- Agent tool names and schemas live in `src/lib/agentTools.ts` and must remain the source of truth.
- WebContainer integration remains via `WebContainerProvider` hooks.
- AI chat uses `@ai-sdk/react` + `DefaultChatTransport` with client‑side tool execution.

---

## High‑Level Decomposition

AIAgentBar currently mixes:
- Chat transport management (useChat), tool call dispatching, and logging.
- Thread CRUD (Convex).
- Media ingest/list and global drag & drop.
- Validation (TS + ESLint) + preview error auto‑diagnostics.
- Scrolling/auto‑follow and responsive UI measurements.
- Complex JSX for the bar, tabs, messages, and media panel.

We will split by responsibility:

1) Hooks (stateful logic)
- useAgentChat: encapsulate `useChat` wire‑up, `prepareSendMessagesRequest`, `onToolCall`, and `addToolResult` coupling.
- useThreads: Convex thread list/create/load and derived state.
- useMediaLibrary: list, upload, ingest by URL, and local attachments mgmt.
- useGlobalDrop: global drag‑and‑drop and routing of dropped content to attachments/ingest.
- useValidationDiagnostics: `runValidation`, auto post diagnostics, and `wc-preview-error` listener.
- useScrollSizing: container height calculation, smooth scroll, and near‑bottom detection.

2) UI subcomponents (presentational, minimal logic)
- AgentBarShell: outer chrome, open/close/expand animations.
- Toolbar: mode switcher (chat/visit/media) and quick actions.
- ChatComposer: textarea, send/stop, file picker, attachments tray.
- ChatTabs: thread tabs and create/new interactions.
- MessagesPane: message list rendering and scroll anchors.
- MediaPane: filters, grid/list, ingest form, upload button.

3) Utilities & Types (pure, shared)
- agentTypes.ts: `ChatThread`, `MediaItem`, and small shared types.
- agentUtils.ts: `formatBytes`, `guessContentTypeFromFilename`, `JSONSafe`, `stableHash`, small safe string helpers.

4) Server helpers (for `api/agent/route.ts`)
- agentServerHelpers.ts: `getInstalledAppNames`, `sanitizeToolInput`, `getConvexClientOptional`.
- agentServerTools.ts: `allTools` mapping; keep server‑side `web_search` execute here.

---

## File/Folder Layout (proposed)

- src/components/agent/
  - AIAgentBar/
    - AIAgentBar.tsx (new thin orchestrator)
    - ui/
      - AgentBarShell.tsx
      - Toolbar.tsx
      - ChatComposer.tsx
      - ChatTabs.tsx
      - MessagesPane.tsx
      - MediaPane.tsx
    - hooks/
      - useAgentChat.ts
      - useThreads.ts
      - useMediaLibrary.ts
      - useGlobalDrop.ts
      - useValidationDiagnostics.ts
      - useScrollSizing.ts
- src/lib/agent/
  - agentTypes.ts
  - agentUtils.ts
  - server/
    - agentServerHelpers.ts
    - agentServerTools.ts

Note: Keep the public import path `@/components/AIAgentBar` by exporting the new component from `src/components/AIAgentBar.tsx` that re‑exports the orchestrator from `src/components/agent/AIAgentBar/AIAgentBar.tsx`.

---

## Step‑By‑Step Plan

Phase 1 — Extract Pure Utilities & Types
4. Create `src/lib/agent/agentTypes.ts` with:
   - `export type ChatThread = { _id: string; title: string; updatedAt?: number; lastMessageAt?: number }`.
   - `export type MediaItem = { _id: string; contentType: string; publicUrl?: string; r2Key: string; createdAt: number; size?: number }`.
5. Create `src/lib/agent/agentUtils.ts` with:
   - `formatBytes`, `guessContentTypeFromFilename`, `JSONSafe`, `stableHash`, and trim helpers.
6. Replace in‑file implementations in `AIAgentBar.tsx` with imports from `agentUtils.ts`.

Phase 2 — Hooks: Threads, Media, Drop, Scroll/Sizing
7. Create `useThreads.ts`:
   - Move `loadThreads`, `loadMessagesForThread`, `createNewThread`, and associated `useEffect` lifecycles.
   - Expose `{ threads, threadsLoading, threadsError, activeThreadId, setActiveThreadId, initialChatMessages, chatSessionKey, refreshThreads }`.
8. Create `useMediaLibrary.ts`:
   - Move `loadMedia`, `handleUploadFiles`, `handleIngestFromUrl`, attachments state, `mediaType` filter, and error/loading flags.
   - Expose `{ mediaItems, attachments, setAttachments, mediaType, setMediaType, loadMedia, uploadFiles, ingestFromUrl, busyFlags }`.
9. Create `useGlobalDrop.ts`:
   - Encapsulate window dragenter/over/leave/drop listeners and `handleGlobalDrop` logic.
   - Accept callbacks to add attachments or call `ingestFromUrl`.
10. Create `useScrollSizing.ts`:
    - Move container/inner refs, `isNearBottom`, smooth scroll, resize observers, animation cleanup.
    - Expose refs + helpers + computed `containerHeight`.

Phase 3 — Hooks: Chat + Tool Dispatch + Validation
11. Create `useValidationDiagnostics.ts`:
    - Move `runValidation`, ESLint/TS parsers, and the `wc-preview-error` listener + `autoPostDiagnostic`.
    - Expose `runValidation(changedFiles?: string[])` and side‑effect registration.
12. Create `useAgentChat.ts`:
    - Instantiate `useChat` with `DefaultChatTransport` + `sendAutomaticallyWhen`.
    - Move `onToolCall` switch: dispatch to WebContainer methods and helpers from `useMediaLibrary` and `useValidationDiagnostics`.
    - Keep logging via `agentLogger`.
    - Accept dependencies: `threads`, `activeThreadId`, `classificationRef`, and WebContainer fns via context.
    - Expose `{ messages, sendMessage, status, stop, addToolResult }`.

Phase 4 — UI Subcomponents
13. Create `AgentBarShell.tsx`:
    - Holds open/close state, transitions, overlay/backdrop handlers.
14. Create `Toolbar.tsx`:
    - Mode switcher: compact/chat/visit/media and small controls (store, home, monitor, image, etc.).
15. Create `ChatTabs.tsx`:
    - Renders browser‑style tabs from `threads`; new thread button; set active id.
16. Create `MessagesPane.tsx`:
    - Receives `messages`, `status`, scroll refs from `useScrollSizing`, and renders message list.
17. Create `ChatComposer.tsx`:
    - Textarea, Send/Stop buttons, file input, attachments grid (move JSX from AIAgentBar).
18. Create `MediaPane.tsx`:
    - Filters, ingest by URL, upload button, grid rendering with remove/preview.

Phase 5 — Orchestrate in AIAgentBar
19. Replace `src/components/AIAgentBar.tsx` body with a thin component that:
    - Uses: `useThreads`, `useMediaLibrary`, `useValidationDiagnostics`, `useScrollSizing`, `useAgentChat`, `useGlobalDrop`.
    - Composes: `AgentBarShell`, `Toolbar`, `MessagesPane`, `ChatTabs`, `ChatComposer`, `MediaPane`.
    - Preserves keyboard shortcuts (Esc to compact, Enter to send) via local handlers or a small `useKeybinds` inline hook.
20. Keep default export and all external behavior stable; no renames in import paths elsewhere.

Phase 6 — Server Route Slimming
21. Add `src/lib/agent/server/agentServerHelpers.ts` with:
    - `getInstalledAppNames`, `sanitizeToolInput`, `getConvexClientOptional` moved from route.
22. Add `src/lib/agent/server/agentServerTools.ts` with:
    - `allTools` mapping, including `web_search` tool `execute` implementation.
23. Update `src/app/api/agent/route.ts` to:
    - Import helpers and tools from lib files.
    - Retain: request parsing, persona mode branch, classification‑based system prompt composition, `streamText` call, logging via `agentLogger`, and `maxDuration` export.
24. Verify this remains a Node runtime route (uses `fs`, Convex client) — no Edge constraints introduced.

Phase 7 — Validation & Clean‑up
25. Run quick validation: `pnpm exec tsc --noEmit`.
26. Lint changed files: `pnpm exec eslint --max-warnings=0 <changed files>`.
27. Manual flows:
    - Send a prompt; tool calls still work (fs, exec, app_manage).
    - Upload files; attachments show; media list renders; ingest by URL works.
    - Preview error surfaces an automatic diagnostic once.
    - Threads list loads/creates; switching threads loads messages.
28. Remove dead code from the original file, ensure no duplicate utilities remain.
29. Update any internal imports to use `@/components/agent/...` or `@/lib/agent/...`.

---

## Acceptance Criteria

- AIAgentBar:
  - New file size: < 600 LOC; organizes logic via hooks and subcomponents.
  - Keyboard, drag‑and‑drop, upload, media, and threads behavior unchanged.
  - `useChat` tool dispatch remains functional; validation tool still triggers TSC/ESLint and posts diagnostics.
- Agent route:
  - `route.ts` reduced in size and focuses on request orchestration.
  - Server helper logic and tool wiring extracted and imported.
- Quality:
  - TypeScript strict passes, ESLint passes on all changed files.
  - No changes to public tool schemas or API behavior.

---

## Risk Mitigation

- Introduce hooks/components incrementally and validate after each extraction.
- Keep names and JSX structure identical where practical to avoid CSS/behavior drift.
- Do not change tool names or schemas (server and client must agree).
- Maintain logging calls (`agentLogger`) at prior call sites; wrap in utilities to prevent accidental removal.

---

## Rollout Plan (PRs)

- PR 1: Utilities + Types + Threads/Media hooks; no UI changes.
- PR 2: Chat/Tool/Validation hooks; wire AIAgentBar to new hooks.
- PR 3: UI subcomponents and final orchestrator; delete inlined code.
- PR 4: Server route extraction to helpers/tools; import in `route.ts`.

Each PR runs quick validation and manual checks. Keep commits small and reviewable.

---

## Notes

- Keep imports via `@/*` and adhere to naming conventions from Repository Guidelines.
- UI primitives remain in `components/ui/`; new subcomponents under `components/agent/...` are feature‑level and can use primitives.
- When in doubt, prefer small, pure helpers in `src/lib/agent/` instead of inline functions.

