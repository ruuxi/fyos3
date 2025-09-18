import { metricsEnabled } from '@/lib/metrics/config';
import { metricsBus } from '@/lib/metrics/bus';

export async function GET(req: Request) {
  if (!metricsEnabled) return new Response('Not Found', { status: 404 });

  const { searchParams } = new URL(req.url);
  const all = searchParams.get('all') === '1' || searchParams.get('all') === 'true';
  const sessionId = searchParams.get('sessionId') || undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (payload: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      // Initial hello (include timestamp to avoid client sorting errors)
      write({ type: 'hello', sessionId: sessionId || null, all, timestamp: new Date().toISOString(), source: 'server' });

      // Subscribe to bus
      const unsub = all || !sessionId
        ? metricsBus.subscribe(ev => write(ev))
        : metricsBus.subscribeToSession(sessionId, ev => write(ev));

      // Heartbeat to keep connection alive
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch {}
      }, 15000);

      // Cleanup
      // @ts-ignore - TS doesn't know about cancel callback context here
      this._cleanup = () => { clearInterval(hb); unsub(); };
    },
    cancel() {
      // @ts-ignore
      if (this._cleanup) this._cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // CORS open in dev (optional). Same-origin should be fine; include if needed.
      // 'Access-Control-Allow-Origin': '*',
    },
  });
}
