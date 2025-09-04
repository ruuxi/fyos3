import type { NextRequest } from 'next/server';

// POST /api/ai/fal
// Body: { model: string, input: any }
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.NEXT_PUBLIC_FAL_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'FAL_API_KEY not configured' }), { status: 500 });
    }

    const { model, input } = await req.json();
    const selectedModel = (typeof model === 'string' && model.trim()) ? model : 'fal-ai/flux-1/schnell';
    if (typeof model !== 'string' || !model) {
      return new Response(JSON.stringify({ error: 'Missing model' }), { status: 400 });
    }

    // FAL REST expects model path segments (do not encode slashes)
    const url = `https://fal.run/${selectedModel}`;
    const falRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`,
      },
      body: JSON.stringify(input ?? {}),
    });

    if (!falRes.ok) {
      const text = await falRes.text();
      return new Response(JSON.stringify({ error: 'FAL error', detail: text }), { status: falRes.status });
    }

    // Pass-through JSON result
    const data = await falRes.json();
    return Response.json(data);
  } catch (err) {
    console.error('FAL proxy error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}


