# Desktop Customize State Integration Plan

## Objective
Ship the `desktop_customize` tool end-to-end so mutations persist and the desktop UI reflects changes without manual refreshes.

## Workstream 1 — State Adapter
- Implement a concrete `DesktopStateAdapter` (e.g., `src/lib/apps/desktopCustomize/adapter.ts`).
- `load`: fetch current desktop configuration (layout tree, theme tokens, behavior rules) from Convex or `data/desktops/`.
- `validate`: block unsafe edits (missing widgets, locked panes, asset quotas) and surface warnings.
- `simulate`: apply incoming mutations in memory, returning the next state plus warning strings.
- `persist`: commit the new state, persist generated assets, and log a manifest record for auditing.
- `snapshot`: capture version metadata (id + hash + timestamp) before persisting for undo/redo.
- Update the client handler to pass this adapter into `performDesktopCustomize`.

## Workstream 2 — Renderer Integration
- Ensure the desktop host listens for successful manifests (via agent response or refreshed query).
- When `status: "applied"`, refresh or incrementally apply the mutated state in the WebContainer iframe.
- Display warnings/follow-ups in chat so users know when manual intervention is needed.

## Workstream 3 — Optimistic UX & Recovery
- Optimistically apply mutations client-side while the server persist finishes; fall back to the snapshot on error.
- Maintain manifest + snapshot history to enable undo/redo and scheduled scenes.
- Add telemetry for mutation categories, warnings, and rollback events to monitor stability.

## Verification
- Extend `scripts/simulate-desktop-intents.js` (or a new harness) to assert adapter outputs (warnings, snapshots) across creative, ambiguous, and unsafe scenarios.
- Add integration tests ensuring persisted desktops rehydrate correctly across sessions.
