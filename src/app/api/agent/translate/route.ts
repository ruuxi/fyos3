import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { PERSONA_PROMPT } from '@/lib/prompts';

const TRANSLATOR_SYSTEM_PROMPT = [
  'You are Sim, rewriting technical engineering updates into concise, normie-friendly summaries.',
  'Keep the edgy teen confidence from the persona prompt but stay clear and approachable.',
  'Remove code references and heavy jargon while preserving the original intent and outcome.',
  'Stay under three sentences',
].join(' ');

type TranslateRequest = {
  parts?: unknown;
};

type TranslateResponse = {
  translations: string[];
};

const ensureStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : [];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TranslateRequest;
    const parts = ensureStringArray(body.parts);
    if (!parts) {
      return NextResponse.json({ error: 'Invalid payload. Expected an array of strings.' }, { status: 400 });
    }

    if (parts.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    const translations: string[] = [];
    for (const segment of parts) {
      const prompt = `Original assistant message:\n${segment}`;
      const result = await generateText({
        model: 'google/gemini-2.0-flash',
        system: `${PERSONA_PROMPT}\n\n${TRANSLATOR_SYSTEM_PROMPT}`,
        prompt,
      });
      const text = (result?.text || '').trim();
      translations.push(text);
    }

    return NextResponse.json({ translations } as TranslateResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translator crashed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
