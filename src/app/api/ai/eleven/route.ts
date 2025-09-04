import type { NextRequest } from 'next/server';

// POST /api/ai/eleven
// Body: { prompt?: string, composition_plan?: any, music_length_ms?: number, output_format?: string, model?: string }
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), { status: 500 });
    }

    const { prompt, composition_plan, music_length_ms, output_format, model } = await req.json();

    const payload: Record<string, any> = {};
    if (typeof prompt === 'string' && prompt.trim().length > 0) payload.prompt = prompt.trim();
    if (composition_plan && typeof composition_plan === 'object') payload.composition_plan = composition_plan;
    if (typeof music_length_ms === 'number') payload.music_length_ms = music_length_ms;
    if (typeof output_format === 'string') payload.output_format = output_format;
    if (typeof model === 'string' && model.trim()) payload.model_id = model.trim();

    const url = 'https://api.elevenlabs.io/v1/music';
    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!elRes.ok) {
      const text = await elRes.text();
      return new Response(JSON.stringify({ error: 'ElevenLabs error', detail: text }), { status: elRes.status });
    }

    const ct = elRes.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const json = await elRes.json();
      return Response.json(json);
    }
    const arrayBuffer = await elRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return Response.json({ ok: true, contentType: ct || 'audio/mpeg', audioBase64: base64 });
  } catch (err) {
    console.error('ElevenLabs proxy error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}


