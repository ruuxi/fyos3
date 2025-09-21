# Agent Message Flow Documentation

## Overview
This document describes the complete flow of how user messages are processed through the AI agent system, from user input to final response.

## Flow Stages

### 1. User Submit Path

**Entry Point:** `AIAgentBar` component
- **Handler:** `useAgentController.handleSubmit()` 
  - **Location:** `src/components/agent/AIAgentBar/hooks/useAgentController.ts`
- **Process:**
  1. Hook pushes an optimistic user bubble to UI
  2. Calls `useAgentChat.sendMessage({ text })`
  3. `useAgentChat` wraps `useChat` from `@ai-sdk/react`
     - **Location:** `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
  4. `useChat` adds user message to internal list
  5. Status changes to `submitted`

### 2. Request Sent to Server

**Transport:** `DefaultChatTransport`
- **Endpoint:** `POST /api/agent`
- **Payload:** Full conversation + attachment hints
- **Server Handler:** `src/app/api/agent/route.ts`
  - Calls `streamText()` with:
    - `stopWhen(stepCountIs(15))`
    - Complete tool set
  - Can produce multiple "steps" per request:
    - Text chunks
    - Tool calls  
    - Tool results

### 3. Streaming and Tool Loop

**Streaming Process:**
- `useChat` maintains one assistant message at end of messages array
- Starts empty (causes blank bubble initially)

**Tool Call Handling:**
- Model emits `tool_call` part → `useChat` passes to `onToolCall`
- `useAgentChat` runs tool synchronously:
  - WebContainer operations
  - Media processing
  - Other tools
- Result fed back via `addToolResult`

**Auto-continuation:**
- Setting: `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`
- When all tool calls have matching results:
  - `useChat` automatically triggers new `streamText` request
  - Model continues processing (AI SDK "multi-step" cycle)
- **Loop continues** until model streams text part for assistant
- Text deltas accumulate in trailing assistant message

### 4. Completion

**Stream Termination:**
- Server closes SSE connection
- `useChat` sets `status = 'ready'`
- `useAgentController` detects status change:
  - Clears `agentActive` flag
  - Runs `finishAgentRun()`:
    - Unpauses HMR
    - Auto-opens newly created apps
    - Other cleanup tasks

**Final Transcript Structure:**
1. User message
2. Assistant message(s) with tool-call/tool-result parts (if tools used)
3. Final assistant message with streamed text response
4. **Note:** Multiple tool hops create multiple assistant entries before final text

## User Turn Lifecycle

Each user interaction follows this state progression:

1. **`submitted`** — Request in flight, placeholder assistant message (empty)
2. **`streaming`** — Assistant message updates with tool calls/results or text
3. **Tool Loop** — If tool calls occurred, `useChat` automatically loops back through submitted/streaming until model produces text
4. **`ready`** — Final text in place, run finished, UI accepts next prompt

## Architecture Notes

This implementation follows the AI SDK documentation patterns for:
- `useChat` lifecycle management
- Multi-step tool calling
- Message persistence
- Automatic continuation logic