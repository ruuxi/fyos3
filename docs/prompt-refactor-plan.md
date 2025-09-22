# Modular System Prompts Refactor Plan

## Goals
- Reduce error rate and token pressure by splitting the monolithic engineering system prompt into intent‑specific segments.
- Improve tool selection and step budgeting by scoping prompts and tools to the current workflow.
- Preserve current behavior as a baseline, then unlock optional tool gating and preflight classification.

## Current State
- Monolithic prompt: `src/lib/prompts.ts:1` exported as `SYSTEM_PROMPT` and used in `src/app/api/agent/route.ts:545`.
- Persona vs agent classification: `CLASSIFIER_PROMPT` used in `src/app/api/agent/route.ts:392`.
- Client hints: sets `intent='create-app'` and `forceAgentMode=true` when heuristics match app creation at `src/components/agent/AIAgentBar/hooks/useAgentChat.ts:305`.
- `DESKTOP_PREFLIGHT_PROMPT` exists but is not wired.

Risks: instruction dilution, unnecessary sections included (media, styling, desktop, editing) for unrelated intents; larger context → higher chance of tool misuse.

## Proposed Architecture

### Files & Layout
- `src/lib/prompts/index.ts` — prompt builder entry and types
- `src/lib/prompts/persona.ts` — `PERSONA_PROMPT`
- `src/lib/prompts/classifier.ts` — `CLASSIFIER_PROMPT`, `DESKTOP_PREFLIGHT_PROMPT`
- `src/lib/prompts/system/`
  - `base.ts` — core rules: role, safety, brevity, no dev servers, token discipline
  - `webcontainer.ts` — environment specifics and constraints
  - `tools-selection.ts` — small, general heuristics for choosing tools
- `src/lib/prompts/intents/`
  - `create.ts` — Fast scaffold two‑phase flow, avoid `validate_project`/`web_exec` initially
  - `edit.ts` — AST‑first edits, minimal reads, targeted validation
  - `media.ts` — `ai_generate`‑first, upload to public URL, persistence and inline rendering
  - `desktop.ts` — `desktop_customize` guidance only
- `src/lib/prompts/addenda/`
  - `ui-checklist.ts` — interaction/a11y checklist (only for UI work)
  - `styling.ts` — styling philosophy and examples (only for UI work)
  - `attachments.ts` — how to treat attachments/URLs

### Builder API
`buildSystemPrompt(ctx: {
  intent: 'create' | 'edit' | 'media' | 'desktop';
  hasAttachments?: boolean;
  includeStylingDetails?: boolean; // default true for create/edit
  installedApps?: string[];        // optional list to append (capped to N)
}): string`

Behavior:
- Always include: `system/base`, `system/webcontainer`, `system/tools-selection`.
- Intent‑specific section: one of `intents/*`.
- Addenda:
  - `ui-checklist` + `styling` for `create`/`edit` only (unless `includeStylingDetails=false`).
  - `attachments` when `hasAttachments=true` or intent is `media`.
- Append a short “Current apps installed” list (top 10) when provided.

### Intent Routing
- Client (existing): `useAgentChat` sets `intent='create-app'` for creation; extend heuristics:
  - `intent='media'` when attachments present and verbs like generate/edit image/video/audio/3D.
  - `intent='desktop'` for theme/background/wallpaper/layout/windowing requests.
- Server: infer when client intent absent or ambiguous:
  - If attachments and media verbs → `media`.
  - If desktop keywords → `desktop`.
  - If “create app” regex (already present) → `create`.
  - Else → `edit`.
  - Optionally call `DESKTOP_PREFLIGHT_PROMPT` when classification is unclear.

### Optional Tool Subsetting (Phase 2)
- `create`: `fast_app_create`, `app_manage`, `web_fs_*`, `media_list` (no `validate_project`/`web_exec` initially).
- `edit`: full toolset; keep `validate_project`/`web_exec` gated by scheduler.
- `media`: `ai_generate`, `media_list` by default; allow fs tools only if the user asks to integrate results.
- `desktop`: `desktop_customize` (+ `media_list` optional).

## Implementation Plan

1) Introduce modular prompt files and builder
- Add files and export `buildSystemPrompt` from `src/lib/prompts/index.ts`.
- Move `PERSONA_PROMPT`, `CLASSIFIER_PROMPT`, `DESKTOP_PREFLIGHT_PROMPT` to `persona.ts`/`classifier.ts`.
- Keep legacy `SYSTEM_PROMPT` export for transition with a deprecation note (returns the joined segments for `intent='edit'` to match current behavior).

2) Wire the builder into the server route
- In `src/app/api/agent/route.ts`, compute `intent` from client hint or server heuristic.
- Replace `systemPrompt = SYSTEM_PROMPT` with:
  - `systemPrompt = buildSystemPrompt({ intent, hasAttachments: hints.length>0, includeStylingDetails: intent==='create'||intent==='edit', installedApps })`.
- Cap appended installed apps to the most recent/top 10 to save tokens.

3) (Optional) Tool subsetting by intent
- Build `const tools = pickToolsForIntent(intent, allTools)`.
- Start with no subsetting (feature flag off) to preserve baseline; enable after validation.

4) Extend client intent hints (low risk)
- In `useAgentChat.prepareSendMessagesRequest` (`src/components/agent/AIAgentBar/hooks/useAgentChat.ts`), set:
  - `intent='media'` on attachments + media verbs.
  - `intent='desktop'` on desktop/theme keywords.
  - Keep `intent='create-app'` logic.

5) Logging & observability
- Log derived `intent`, selected toolset size, and builder segment list per session id.
- Ensure cost telemetry still aggregates.

6) Testing & rollout
- Unit: builder selects correct segments for each intent.
- Integration: simulate requests for each intent; confirm tools chosen and prompts contain only relevant sections.
- A/B (optional): flag to fall back to legacy monolith for quick rollback.

7) Migration & cleanup
- After rollout confidence, remove legacy `SYSTEM_PROMPT` usages.
- Keep `PERSONA_PROMPT` as-is.

## Acceptance Criteria
- Prompt length reduced ≥40% for each intent compared to current monolith.
- No regressions in app creation/editing workflows.
- Media tasks prefer `ai_generate` and do not include unrelated engineering sections.
- Desktop customization requests do not include app/file editing guidance.
- Tool misuse rate (unexpected `web_exec`/`validate_project` at create time) decreases.

## Rollback Plan
- Feature flag to switch back to legacy `SYSTEM_PROMPT` and full toolset without code changes.
- Keep old exports available for one release.

## Tasks Checklist
- [ ] Create `src/lib/prompts/*` folder structure and move content into modules
- [ ] Implement `buildSystemPrompt` and legacy `SYSTEM_PROMPT` shim
- [ ] Replace `systemPrompt` assembly in `src/app/api/agent/route.ts`
- [ ] Add lightweight server heuristic for `intent`
- [ ] (Optional) Wire `DESKTOP_PREFLIGHT_PROMPT` for ambiguous desktop requests
- [ ] (Optional) Subset tools by intent (feature flag)
- [ ] Extend client intent hints (media/desktop)
- [ ] Add logs and metrics for prompt segments and toolset size
- [ ] Tests for builder and intent routing
- [ ] Delete old monolithic prompt after stabilization

