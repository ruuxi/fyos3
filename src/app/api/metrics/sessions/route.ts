import { metricsEnabled } from '@/lib/metrics/config';
import { getSessionsSummary } from '@/lib/metrics/store';

export async function GET() {
  if (!metricsEnabled) return new Response('Not Found', { status: 404 });
  const sessions = getSessionsSummary();
  return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'content-type': 'application/json' } });
}

