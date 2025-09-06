export const maxDuration = 30;

export async function POST(req: Request) {
  // Deprecated: conversation routing removed per commit alignment
  return new Response('Conversation routing is disabled. Use /api/agent.', { status: 410 });
}