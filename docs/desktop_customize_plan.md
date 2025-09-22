# Desktop Customize Tooling Plan

## Goals
- Deliver a deterministic `desktop_customize` toolchain that mirrors `fast_app_create` UX while focusing on layout/theme mutations.
- Detect creative customization intents early so the agent either gathers clarifications or executes in one call.
- Preserve user safety and state integrity via validation, optimistic updates, and reversible diffs.

## Current Reference (fast_app_create)
- Client intercepts tool calls inside `useAgentChat` and logs invocation metadata before executing.
- `performFastAppCreate` writes generated files, updates `public/apps/registry.json`, and returns a manifest of artifacts.
- System prompt instructs models to ship `metadata.json`, causing redundant retries and inflated token usage.

## Intent Detection Matrix
- **Layout Ops**: add/remove/move windows, split panes, rearrange app order, resize frames.
- **Theme Ops**: change backgrounds, color palettes, typography, icon packs, ambient audio.
- **Behavior Ops**: auto-launch apps, pin to dock, schedule toggles, notification routing.
- **Data Wiring**: bind widgets to feeds/APIs, connect media sources, inject live metrics.
- **Meta Controls**: preview, undo/redo, share desktop, schedule temporary scenes.
- **Out-of-Scope Flags**: system admin, destructive host actions, unsafe media, publishing flows.

## Tool Definition & Payload
- **Tool Name**: `desktop_customize`
- **Parameters** (JSON schema sketch):
  ```json
  {
    "type": "object",
    "properties": {
      "metadata": { "type": "object" },
      "layoutMutations": { "type": "array", "items": { "$ref": "#/$defs/layoutMutation" } },
      "themeMutations": { "type": "array", "items": { "$ref": "#/$defs/themeMutation" } },
      "assets": { "type": "array", "items": { "$ref": "#/$defs/asset" } },
      "followUps": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["metadata"],
    "$defs": {
      "layoutMutation": { "type": "object", "required": ["target", "action"], "properties": { "target": {"type": "string"}, "action": {"type": "string"}, "payload": {"type": "object"} } },
      "themeMutation": { "type": "object", "required": ["token", "value"], "properties": { "token": {"type": "string"}, "value": {"type": "string"}, "confidence": {"type": "number"} } },
      "asset": { "type": "object", "required": ["path", "contents"], "properties": { "path": {"type": "string"}, "contents": {"type": "string"}, "encoding": {"type": "string", "enum": ["utf-8", "base64"]} } }
    }
  }
  ```
- Ensure payload declares reversibility metadata (e.g., prior state hash) for undo.

## Prompting Strategy
- **Preflight Classifier Prompt**: lightweight judgment over user turn → {`fast_app_create`, `desktop_customize`, `chat_only`} with rationale; reject low-confidence results.
- **Main Reasoning Prompt**: reinforce single-call execution, forbid redundant `metadata.json`, require validation of mutation feasibility before emitting.
- **Clarification Protocol**: when intent lacks constraints (e.g., "make dreamlike desktop"), agent must ask for palette/mood/assets instead of guessing.
- **Creativity Handling**: encourage reuse of existing assets, propose references, note optionality of new media downloads.

## Execution Flow
- Intercept `desktop_customize` tool calls in `useAgentChat` similar to `fast_app_create` logging.
- Route payload to new `performDesktopCustomize`:
  1. Validate schema + authorization context (authed vs anon).
  2. Snapshot current desktop state for rollback and diffing.
  3. Apply mutations in memory; verify layout graph remains consistent.
  4. Persist accepted changes to desktop store (e.g., `public/apps/registry.json` or dedicated `data/desktops/` tree).
  5. Return a manifest (applied mutations, generated assets, follow-up prompts) to mirror existing client expectations.
- Surface errors back through chat with actionable remediation steps.

## Data & Persistence Model
- Store desktops as structured JSON (layout tree, theme tokens, behavior rules) to keep diffs small and auditable.
- Maintain versioned snapshots keyed by user + timestamp for undo and multi-device sync.
- Defer heavy media to existing media tools; persist references/IDs in desktop state instead of binaries.
- For anon users, keep state ephemeral in memory or browser storage; skip Convex writes.

## Edge Cases & Safeguards
- **Ambiguous Requests**: enforce clarifier questions before tool invocation; log unresolved intents.
- **Conflict Detection**: if mutation targets missing widgets or locked themes, respond with resolution options (replace, create, abort).
- **Resource Checks**: guard asset size/type; require opt-in for external fetches or premium content.
- **Temporal Scenes**: allow scheduled activation/deactivation; ensure cleanup jobs revert to previous snapshot.
- **Error Recovery**: implement automatic rollback on validation failure, and message user with summary of reverted actions.

## Metrics & Observability
- Extend token estimation logs to cover classifier + main prompt cost, success/failure counts, retry reasons.
- Add structured analytics for mutation categories, clarification frequency, undo usage, and latency.
- Flag high-risk intents (e.g., repeated unsafe media requests) for human review via agent logger.

## Next Steps
1. Prototype preflight classifier prompt and evaluation script (extend `scripts/test-app-intent.js`).
2. Define `desktop_customize` schema in code, scaffold `performDesktopCustomize` with no-op handlers.
3. Integrate logging + manifest return path in `useAgentChat` and Convex actions.
4. Write automated simulations covering creative/ambiguous/unsafe scenarios to harden prompts.
5. Iterate on prompts + validation logic before enabling writes for production users.
