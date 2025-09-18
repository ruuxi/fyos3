# Agent Metrics Implementation Plan

This is a comprehensive plan for implementing agent metrics tracking with exact file touchpoints and double-counting prevention.

## 🎯 Feasibility Assessment

### Per-Tool Token Counting
- **Current Limitation**: AI SDK only exposes usage at step and final response levels, not per individual tool call
- **Solution**: Implement reliable step-level usage tracking with token attribution to tool calls within each step
- **Attribution Strategy**: Support multiple modes with clear "approximate attribution" labeling:
  - **Default**: Equal split across tools in a step
  - **Duration-weighted**: Based on tool execution time
  - **Payload-size weighted**: Based on input/output content length

## 🔑 Session Identity Management

### Dual ID System
- **Server-generated sessionId**: Continue generating in `src/app/api/agent/route.ts`
- **Client chat ID**: Capture the ID from useChat transport
- **Mapping Strategy**: Maintain server-side map `clientChatId → sessionId`
- **Benefit**: Enables client metric posting without sessionId roundtrip, prevents double counting

## 💰 Pricing Model

### Token Rates (Global)
- **Input tokens**: $1.25 per 1M tokens
- **Output tokens**: $10 per 1M tokens

### Cost Calculation
- Compute per-step and total cost from usage data
- Distribute step costs to tools using same attribution strategy as tokens

## 📊 Implementation Scope

### Development Environment Only
- **Storage**: In-memory store with SSE streaming
- **Log Management**: No truncation (dev environment)
- **Access Control**: Dev-only dashboard and APIs

## 🗃️ Data Model

### Primary Keys
```typescript
{
  sessionId: string,
  clientChatId: string, 
  stepIndex: number,
  toolCallId: string,
  toolName: string,
  timestamp: Date,
  source: 'server' | 'client'
}
```

### Event Types
1. **`session_init`** - Maps clientChatId → sessionId
2. **`user_message`** / **`assistant_message`** - Chat messages
3. **`step_usage`** - Step-level token usage with tool correlation
   ```typescript
   {
     stepIndex: number,
     inputTokens: number,
     outputTokens: number, 
     totalTokens: number,
     toolCallIds: string[]
   }
   ```
4. **`tool_start`** - Tool execution begins
   ```typescript
   {
     toolCallId: string,
     toolName: string,
     inputSummary: string
   }
   ```
5. **`tool_end`** - Tool execution completes
   ```typescript
   {
     toolCallId: string,
     toolName: string,
     durationMs: number,
     success: boolean,
     error?: string,
     outputSummary: string
   }
   ```
6. **`total_usage`** - Final session totals
   ```typescript
   {
     inputTokens: number,
     outputTokens: number,
     totalTokens: number,
     model: string,
     totalCost: number
   }
   ```

### Idempotency & Deduplication
Store ignores duplicates using composite keys:
- **tool_start**: `(sessionId, toolCallId, phase='start')`
- **tool_end**: `(sessionId, toolCallId, phase='end')`
- **step_usage**: `(sessionId, stepIndex)`
- **total_usage**: `(sessionId, 'total')`

## 🔧 Instrumentation Changes

### 1. Server Route: `src/app/api/agent/route.ts`
- **Parse clientChatId**: Extract `{ id }` from request body
- **Emit session_init**: Immediately create clientChatId → sessionId mapping
- **Continue logging**: Keep existing user_message, assistant_message logging
- **onStepFinish changes**:
  - ✅ Emit `step_usage` with stepIndex and toolCallIds for correlation
  - ❌ Remove existing toolResults logging (prevent double-counting)
- **onFinish**: Emit `total_usage` with pricing calculations

### 2. Server Tools: `src/lib/agent/server/agentServerTools.ts`
- **Wrap tool execution**: Add `tool_start` at entry, `tool_end` at return/catch
- **Source attribution**: Continue logging from server source for server-executed tools only (e.g., `web_search`)

### 3. Client Tools: `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- **onToolCall handler**:
  1. Emit `tool_start` with toolCallId
  2. Execute tool
  3. After `addToolResult`, emit `tool_end` with duration and outcome
- **Event posting**: POST to `/api/metrics/ingest` with clientChatId
- **Migration**: Remove current `agentLogger.logToolCall('client', ...)` calls

## 🚌 Metrics Bus & Store (Dev-only)

### New File Structure
```
src/lib/metrics/
├── types.ts      # Event and summary type definitions
├── bus.ts        # In-memory EventEmitter with subscribers
├── store.ts      # In-memory ring buffer per session
└── config.ts     # Dev-only gate switch
```

### Store Capabilities
- **Idempotency checks** on append
- **Derived summaries**: totals, avg durations, tool breakdown
- **Pattern detection**: Repeated sequences (n-gram over toolNames)
- **Timeline generation**: Chronological event ordering
- **Step → tool mapping**: For attribution calculations

### Configuration Gate
```typescript
// Enabled if NODE_ENV !== 'production' OR AGENT_METRICS=1
const metricsEnabled = process.env.NODE_ENV !== 'production' || 
                      process.env.AGENT_METRICS === '1';
```

## 🌐 API Endpoints

### New Routes
1. **`POST /api/metrics/ingest`** (new)
   - Accepts events from client
   - Attaches sessionId via clientChatId mapping
   - Deduplicates and publishes to bus/store

2. **`GET /api/metrics/stream?sessionId=:id`** (new, SSE)
   - Live event streaming for specific session
   - Optional `?all=1` for all sessions

3. **`GET /api/metrics/sessions`** (new)
   - Returns recent sessions with summary fields:
     - Message count, tool calls, total tokens
     - Total cost, avg duration, top tools

4. **`GET /api/metrics/session/:id`** (new)
   - Full session detail for audits
   - Ordered events and derived timeline

## 📊 Dashboard (Dev-only)

### Location
`src/app/dev/agent-metrics/page.tsx`

### Dashboard Panels
1. **Live Timeline**
   - SSE subscription
   - Interleaved `tool_start`/`tool_end` with `step_usage`

2. **Session Summary**
   - Total tokens, cost, steps
   - Average tool duration

3. **Tool Breakdown**
   - Count, avg duration, error rate
   - Highlight top N by cost and execution time

4. **Sequence Viewer**
   - Ordered tool calls by step
   - Highlight repeats and loops

5. **Raw Events**
   - Filterable table for manual tracing

### Access Control
- Renders only if metrics enabled (dev mode)
- Accessible at `/dev/agent-metrics` in development

## 🎯 Attribution Logic

### Default Strategy
Equal split of step's tokens/cost across toolResults in that step

### Alternative Options (UI Configurable)
- **Duration-weighted**: Based on tool execution time
- **Payload-size weighted**: Based on input/output content length

### Transparency
All per-tool token/cost metrics clearly labeled as **"approximate"**

## 🚫 Double-Counting Prevention

### Execution-Based Emission
- **Client tools**: Only client emits `tool_start`/`tool_end`
- **Server tools**: Only server emits `tool_start`/`tool_end`
- **Route changes**: Server route only emits `step_usage` and `total_usage`

### Deduplication
Store automatically deduplicates using idempotency keys

## 🗺️ Minimal Change Map

### File Modifications Required

#### `src/app/api/agent/route.ts`
- ✅ Add clientChatId mapping and emit session_init
- ✅ Emit step_usage, total_usage with new pricing
- ❌ Remove toolResults logging in onStepFinish

#### `src/lib/agent/server/agentServerTools.ts`
- ✅ Add tool_start/tool_end emissions around tool execution

#### `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- ✅ Replace agentLogger direct calls with POST /api/metrics/ingest
- ✅ Include clientChatId in payload for tool_start/tool_end events

#### `src/lib/agentLogger.ts`
- ✅ Keep as thin console logger
- ✅ Core metrics path goes through new metrics bus/store

### New Files Required
- All metrics modules and API routes as listed above

## ✅ Validation Plan

### Manual Testing
Open `/dev/agent-metrics` and run a simple tool flow, verify:
- ✅ Timeline shows start/end events in correct chronological order
- ✅ Step usage data arrives and costs match defined rates
- ✅ No duplicate tool events for same toolCallId

### Automated Checks
- ✅ `pnpm lint` passes
- ✅ TypeScript build succeeds


---

# 🚀 Step-by-Step Implementation Plan

## Phase 1: Core Metrics Library

### 1.1 Implement Metrics Gate
**Files**: `src/lib/metrics/config.ts`
- Add `metricsEnabled = NODE_ENV !== 'production' || process.env.AGENT_METRICS === '1'`
- **Acceptance**: Importable from server code; toggles with `AGENT_METRICS=1`

### 1.2 Define Event Types & Contracts
**Files**: `src/lib/metrics/types.ts`
- Include event unions for:
  - `session_init`, `user_message`, `assistant_message`
  - `step_usage`, `tool_start`, `tool_end`, `total_usage`
  - Derived summary types
- **Acceptance**: `pnpm exec tsc --noEmit` passes

### 1.3 Add In-Memory Bus and Store (Idempotent)
**Files**: `src/lib/metrics/bus.ts`, `src/lib/metrics/store.ts`

**Capabilities**:
- **Append with dedupe keys**:
  - `tool_start`: `(sessionId, toolCallId, 'start')`
  - `tool_end`: `(sessionId, toolCallId, 'end')`
  - `step_usage`: `(sessionId, stepIndex)`
  - `total_usage`: `(sessionId, 'total')`
- **Session mapping**: `clientChatId → sessionId`
- **Query methods**: `getSessionsSummary()`, `getSessionDetail(id)`, `stream via subscribe(cb)`

**Acceptance**: Simple unit-like script (Node) can append and read without duplicates; `pnpm exec tsc --noEmit` passes

## Phase 2: API Surface (Dev-only)

### 2.1 POST Ingest Endpoint
**Files**: `src/app/api/metrics/ingest/route.ts`
- Accept body `{ clientChatId, event }`
- Attach sessionId via mapping (or 400 if missing)
- Dedupe + publish to store
- Gate with `metricsEnabled`; return 404 if disabled
- **Acceptance**: curl/REST client POST creates events; store updated; `pnpm exec tsc --noEmit` passes

### 2.2 SSE Stream Endpoint
**Files**: `src/app/api/metrics/stream/route.ts`
- `GET /api/metrics/stream?sessionId=...` or `?all=1`
- Push events from bus to stream
- **Acceptance**: Browser/terminal can receive events; no memory leaks; `pnpm exec tsc --noEmit` passes

### 2.3 Sessions Summary Endpoint
**Files**: `src/app/api/metrics/sessions/route.ts`
- Returns recent sessions with:
  - Message/tool counts, tokens, total cost
  - Average duration, top tools
- **Acceptance**: Returns sensible JSON; `pnpm exec tsc --noEmit` passes

### 2.4 Session Detail Endpoint
**Files**: `src/app/api/metrics/session/[id]/route.ts`
- Full ordered event list + derived timeline
- Step → tool mapping
- **Acceptance**: Returns structured data matching one session; `pnpm exec tsc --noEmit` passes

## Phase 3: Server Instrumentation

### 3.1 Session Mapping and Init
**Files**: `src/app/api/agent/route.ts`
- Extract `clientChatId` from request body `{ id }`
- Generate `sessionId`; emit `session_init` into store (server-side, no client POST)
- **Acceptance**: After one chat request, sessions map has mapping; summary shows new session

### 3.2 Message Events
**Files**: `src/app/api/agent/route.ts`
- Emit `user_message` before streaming
- Emit `assistant_message` on finish (in addition to existing Convex logging)
- **Acceptance**: Both events appear and are ordered

### 3.3 Step Usage and Totals
**Files**: `src/app/api/agent/route.ts`
- **onStepFinish**: emit `step_usage` with:
  - `stepIndex`, `inputTokens`, `outputTokens`, `totalTokens`
  - `toolCallIds` from that step
  - ❌ **DO NOT log tool results here anymore**
- **onFinish**: emit `total_usage` with model and pricing:
  - Input: $1.25/M tokens
  - Output: $10/M tokens
- **Acceptance**: Step usage appears once per step; total emitted once per session; route no longer double-logs tool results

### 3.4 Remove Duplicate Tool Logging in Route
**Files**: `src/app/api/agent/route.ts`
- Remove current `agentLogger.logToolCall(...)` inside `onStepFinish`
- Keep console prints as needed
- **Acceptance**: No tool_call duplication from route; only `step_usage`/`total_usage` from server route

## Phase 4: Tool Emissions

### 4.1 Server Tools Wrapper
**Files**: `src/lib/agent/server/agentServerTools.ts`
- Wrap each server-executed tool:
  - Emit `tool_start` at entry
  - Emit `tool_end` at completion (duration, success/error, summaries)
- **Acceptance**: For server tool calls (e.g., `web_search`), see start/end pairs and durations; no duplicates

### 4.2 Client Tools
**Files**: `src/components/agent/AIAgentBar.tsx:124`, `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`

Replace `agentLogger.logToolCall(...)` with:
- **Before exec**: POST `tool_start` to `/api/metrics/ingest` with:
  ```typescript
  { clientChatId: id, toolCallId, toolName, inputSummary }
  ```
- **After addToolResult**: POST `tool_end` with:
  ```typescript
  { toolCallId, durationMs, success|error, outputSummary }
  ```

**Acceptance**: Client tool calls produce start/end; no server duplication; `pnpm exec tsc --noEmit` passes

## Phase 5: Attribution + Pricing

### 5.1 Attribution Utilities
**Files**: `src/lib/metrics/store.ts` (or `attribution.ts`)
- Implement **"approximate attribution"**:
  - **Default**: Equal split across toolResults in a step
  - **Options**: Duration-weighted and payload-size weighted
- Label per-tool tokens/cost as **"approximate"**
- **Acceptance**: Derived summaries return per-tool token/cost per chosen strategy; internal unit-like checks for splits

### 5.2 Pricing Constants
**Files**: `src/lib/metrics/config.ts`
- Export global token rates:
  - Input: $1.25/M tokens
  - Output: $10/M tokens
- **Acceptance**: Cost numbers match rates when totals are emitted

## Phase 6: Dashboard (Dev-only)

### 6.1 Page Scaffold
**Files**: `src/app/dev/agent-metrics/page.tsx`

**Render panels**:
1. **Live Timeline** (SSE)
2. **Session Summary** (pull from sessions API)
3. **Tool Breakdown** (derived stats)
4. **Sequence Viewer** (step → tool ordered calls)
5. **Raw Events** (filterable list)

**Gate**: Render only if `metricsEnabled`

**Acceptance**: Visiting `/dev/agent-metrics` shows live events during a chat; no errors in console

### 6.2 Minimal UX Rules
- Interleave `tool_start`/`tool_end` with `step_usage`
- Show cost and tokens totals; highlight errors
- **Acceptance**: Manual checks on live run

## Phase 7: Double-Counting Guarantees

### 7.1 Execution-Based Emission Rule
- **Server route**: Only `session_init`, `user_message`, `assistant_message`, `step_usage`, `total_usage`
- **Server tools**: `tool_start`/`tool_end` for server-only tools
- **Client tools**: `tool_start`/`tool_end` for client-only tools
- **Acceptance**: No duplicate tool events for same `toolCallId`; store dedupe never fires under normal flow

## Phase 8: Validation & Rollout

### 8.1 Manual Tests
Use `/dev/agent-metrics` and run a short tool flow:
- ✅ Timeline in chronological order
- ✅ Step usage shows and costs match rates
- ✅ No duplicate tool events per `toolCallId`

### 8.2 Automated Checks
**Commands**:
```bash
pnpm lint
pnpm exec tsc --noEmit
```

### 8.3 Toggle Strategy
- Keep `metricsEnabled` gating
- In production: routes return 404 and dashboard doesn't render
- **Backward compatibility**: Keep `agentLogger` console logs until fully migrated

---

**Ready to implement?** This plan can be converted into a tracked TODO system and executed starting with Phase 1 scaffolding.

