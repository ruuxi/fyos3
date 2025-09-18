import { metricsEnabled } from '@/lib/metrics/config';
import { appendEvent, emitToolEnd, emitToolStart, getSessionIdForClient } from '@/lib/metrics/store';
import type { MetricEvent } from '@/lib/metrics/types';

export async function POST(req: Request) {
  if (!metricsEnabled) {
    return new Response('Not Found', { status: 404 });
  }

  try {
    const body = await req.json();
    const { clientChatId, sessionId: providedSessionId, event } = body || {};

    if (!event || typeof event !== 'object') {
      return new Response(JSON.stringify({ ok: false, error: 'Missing event payload' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    // Resolve sessionId via mapping if not provided
    let sessionId: string | undefined = providedSessionId;
    if (!sessionId) {
      if (!clientChatId) {
        return new Response(JSON.stringify({ ok: false, error: 'clientChatId required when sessionId is not provided' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      sessionId = getSessionIdForClient(clientChatId);
    }
    if (!sessionId) {
      return new Response(JSON.stringify({ ok: false, error: 'Unknown clientChatId; no session mapping' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    // Only allow tool events from client in this route
    const type = String(event.type || '');
    const base = { sessionId, clientChatId, source: 'client' as const, timestamp: new Date().toISOString() };
    let inserted = false;

    if (type === 'tool_start') {
      const { toolCallId, toolName, inputSummary } = event as any;
      if (!toolCallId || !toolName) {
        return new Response(JSON.stringify({ ok: false, error: 'tool_start requires toolCallId and toolName' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      emitToolStart({ sessionId, clientChatId, toolCallId, toolName, inputSummary, source: 'client' });
      inserted = true;
    } else if (type === 'tool_end') {
      const { toolCallId, toolName, durationMs, success, error, outputSummary } = event as any;
      if (!toolCallId || !toolName || typeof durationMs !== 'number' || typeof success !== 'boolean') {
        return new Response(JSON.stringify({ ok: false, error: 'tool_end requires toolCallId, toolName, durationMs, success' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      emitToolEnd({ sessionId, clientChatId, toolCallId, toolName, durationMs, success, error, outputSummary, source: 'client' });
      inserted = true;
    } else {
      // Optionally allow additional events later; for now, reject to avoid misuse
      return new Response(JSON.stringify({ ok: false, error: `Unsupported event type for client ingest: ${type}` }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, inserted }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

