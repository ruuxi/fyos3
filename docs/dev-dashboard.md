# Developer Dashboard & Agent Metrics

## Overview
The agent API now emits structured `AgentEvent` payloads whenever the model reasons, starts/finishes a tool call, or completes a session. Events are normalised inside Convex so we can:
- Reconstruct a full timeline (`agent_events`, `agent_steps`, `agent_tool_calls`).
- Persist aggregate stats per session (`agent_sessions`).
- Drive the new UI at `/dev-tools/agent-dashboard` in real time via Convex queries.

## Event Contract
Every event includes the base fields below; kind-specific payloads refine the details.

| Field | Description |
| --- | --- |
| `sessionId` | Stable identifier per POST `/api/agent` request |
| `requestId` | Hash of sanitised messages (dedupe across retries) |
| `sequence` | Monotonic counter emitted from the server |
| `timestamp` | Milliseconds since epoch when the event was produced |
| `kind` | One of `session_started`, `message_logged`, `step_finished`, `tool_call_started`, `tool_call_finished`, `session_finished`, `raw_log` |
| `payload` | Kind-specific data (see `src/lib/agent/metrics/types.ts`) |

Key payload fields:

- `session_started`: persona flag, attachment count, preview of input messages, tool list.
- `step_finished`: step index, tool call counts, optional token usage snapshot.
- `tool_call_started`: step index, sanitised arguments, token estimates.
- `tool_call_finished`: timings, input/output summaries, estimated tokens + cost, error flag.
- `session_finished`: aggregated token/cost totals, duration, finish reason.

## Convex Storage
| Table | Purpose |
| --- | --- |
| `agent_sessions` | Per-session aggregate (start/end, totals, costs, metadata) |
| `agent_steps` | Ordered step breakdown with usage + previews |
| `agent_tool_calls` | Per-call records with durations, cost, sanitised IO |
| `agent_events` | Raw chronological stream for debugging/replay |

Queries live in `convex/agentMetrics.ts`:
- `listSessions` — most recent sessions for the dashboard list.
- `getSessionTimeline` — timeline bundle (session + steps + tool calls + raw events).
- `getSummary` — rolling totals/averages plus a recent tool call feed.

## UI Entry Point
The dashboard is implemented at `src/app/dev-tools/agent-dashboard/page.tsx`. It subscribes to the queries above to render:
- KPI summary cards (sessions, tool calls, tokens, cost).
- Recent sessions list with live status + selection.
- Live recent tool call sidebar.
- Detailed timeline explorer (steps, tool calls, event stream, metadata).

### Scroll containers
- Use `ScrollArea` from `@/components/ui/scroll-area` for every panel that needs an internal scrollbar. The component now clamps overflow on the root element and mirrors border radius + background, which prevents scrollable content from leaking over adjacent cards.
- Pass padding via the `viewportClassName` prop (e.g. `viewportClassName="pr-4"`) instead of applying it to the root. Root-level padding reintroduces clipping issues on narrow breakpoints.
- Always pair a `max-h-*` or `h-*` utility with the scroll area so the viewport can calculate its height. Without an explicit height constraint the Radix scrollbar renders as an overlay again.

## Token Estimation Helpers
Utilities in `src/lib/agent/metrics/tokenEstimation.ts` provide:
- `estimateTokensFromText/Json` — deterministic char→token heuristics.
- `estimateToolCallUsage` — bundles prompt/result estimates.
- `estimateCostUSD` — model-aware cost projection.
- `mergeUsageEstimates` — additive helper for Convex aggregation.

A lightweight test suite (`tests/tokenEstimation.test.ts`) exercises the heuristics using Node's built-in test runner. Run with:

```bash
node --test tests/tokenEstimation.test.ts
```

(If running under TypeScript directly, invoke with `tsx --test` or `ts-node --test` to transpile on the fly.)

## Operational Notes
- Events dedupe via `sequence` + optional `dedupeKey` — retries streaming from the agent won't double count.
- Incomplete tool calls are auto-marked with error summaries when a session closes so loops are visible in the timeline.
- The dashboard is client-only; ensure developer auth guards wrap the `/dev-tools` section when wiring into navigation.
