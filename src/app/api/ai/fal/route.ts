import type { NextRequest } from 'next/server';

// POST /api/ai/fal
// Body: { input: any, task?: 'image'|'video'|'audio'|'3d', model?: string }
// Model is optional; when omitted we select a sensible default per task behind the scenes.
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.FAL_API_KEY || process.env.NEXT_PUBLIC_FAL_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'FAL_API_KEY not configured' }), { status: 500 });
    }

    const { model, input, task } = await req.json();

    // Choose default model behind the scenes when none is provided
    const pickDefaultModel = (t?: string): string => {
      switch ((t || '').toLowerCase()) {
        case 'video':
          return 'fal-ai/runway-gen3/turbo/image-to-video';
        case 'image':
          return 'fal-ai/nano-banana';
        case 'audio':
          // Fallback; most audio/music is via ElevenLabs route in this app
          return 'fal-ai/nano-banana';
        case '3d':
          // Fallback default; adjust when a preferred 3D model is adopted
          return 'fal-ai/nano-banana';
        default:
          return 'fal-ai/nano-banana';
      }
    };

    const selectedModel = (typeof model === 'string' && model.trim()) ? model.trim() : pickDefaultModel(task);

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

