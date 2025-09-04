import { generateText } from 'ai';
import { WELCOME_MESSAGE_SYSTEM_PROMPT } from '@/lib/aiPrompts';

export const maxDuration = 15;

export async function GET() {
  try {
    const { text } = await generateText({
      model: 'google/gemini-2.0-flash',
      providerOptions: {
        gateway: {
          order: ['google', 'vertex'],
        },
      },
      system: WELCOME_MESSAGE_SYSTEM_PROMPT,
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


