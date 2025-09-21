1. User submit path

  - AIAgentBar → useAgentController.handleSubmit (src/components/agent/AIAgentBar/hooks/useAgentController.ts).
  - The hook pushes an optimistic user bubble, then calls useAgentChat.sendMessage({ text }).
  - useAgentChat is a thin wrapper around useChat from @ai-sdk/react (src/components/agent/AIAgentBar/hooks/useAgentChat.ts). 
  As soon as sendMessage fires, useChat adds the user message to its internal list and flips status to submitted.

  2. Request sent to the server

  - DefaultChatTransport posts to /api/agent with the full conversation plus attachment hints.
  - The route (src/app/api/agent/route.ts) calls streamText with stopWhen(stepCountIs(15)) and our tool set. From the docs, streamText can
  produce multiple “steps” (text chunks, tool calls, tool results) per request.

  3. Streaming and tool loop

  - While the server streams, useChat keeps one assistant message at the end of messages. It starts empty, which is why the bubble shows
  blank immediately.
  - If the model emits a tool_call part, useChat hands it to our onToolCall; useAgentChat runs the tool synchronously (WebContainer, media,
  etc.) and feeds the result back via addToolResult.
  - Because we set sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls, once all tool calls have matching results, useChat
  automatically kicks off another streamText request so the model can continue. That’s the AI SDK “multi-step” cycle from the docs.
  - This repeats until the model finally streams a text part for the assistant. Those text deltas accumulate in the same trailing assistant
  message.

  4. Completion

  - When the stream finishes, the server closes the SSE; useChat marks status = 'ready'. useAgentController sees the status drop, clears
  agentActive, and runs finishAgentRun (unpauses HMR, auto-opens newly created apps, etc.).
  - The transcript now contains:
      - the user message,
      - an assistant message with tool-call/tool-result parts (if tools were used),
      - and a final assistant message with the streamed text response. If the model needed multiple tool hops, there can be multiple
  assistant entries (one per step) before the final text bubble.

  So each user turn is:

  1. submitted — request in flight, placeholder assistant message (empty).
  2. streaming — assistant message updates with tool calls/results or text.
  3. If tool calls happened, useChat automatically loops (back through submitted/streaming) until the model produces text.
  4. ready — final text is in place, run is finished, UI can accept the next prompt.

  That’s exactly how the AI SDK docs describe the useChat lifecycle, multi-step tool calling, and message persistence; our code follows
  that pattern.