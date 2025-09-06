import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const maxDuration = 15;

export async function GET() {
  try {
    const { text } = await generateText({
      model: openrouter.chat('google/gemini-2.0-flash-001'),
      providerOptions: {
        gateway: {
          order: ['google', 'vertex'],
        },
      },
      system: `You craft a single, short welcome message for a developer who just opened an AI chat bar.

Goals:
• Sound warm and friendly without fluff or technical jargon
* assume the user has never developed an app or has never used AI before
• Be 1–2 short sentences, max ~25 words total
• Vary phrasing across requests (avoid stock intros)
• Briefly suggest a concrete next step (e.g., “ask me to create an app”)

Do not include greetings like "Hello there!" more than necessary. No emojis, no markdown, no lists. 
Return only the final sentence(s).`,
      prompt: 'Write a single short welcome line with a concrete next step.',
    });
    const message = (text || '').trim();
    if (!message) {
      return Response.json({ message: 'Hey! I can spin up apps or fix issues. Try: “Create a Notes app on the desktop”.' });
    }
    return Response.json({ message });
  } catch (e: unknown) {
    return Response.json({ message: 'Hey! I can spin up apps or fix issues. Try: “Create a Notes app on the desktop”.' }, { status: 200 });
  }
}


