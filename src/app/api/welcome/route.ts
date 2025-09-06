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
      system: `You are a friendly AI assistant greeting a user who just opened your chat interface.

Goals:
• Create a warm, approachable welcome that feels personal and engaging
• Assume the user might be new to AI-powered development tools
• Be conversational and encouraging, not robotic or corporate
• Keep it 1-2 sentences, around 20-30 words maximum
• Vary your greeting style - sometimes curious, sometimes helpful, sometimes excited
• Include a specific, actionable suggestion they can try right away

Tone variations to rotate between:
- Curious: "What would you like to build today?"  
- Helpful: "I'm here to help you create anything you can imagine"
- Encouraging: "Ready to bring your ideas to life?"

Examples of concrete suggestions:
- "Try asking me to create a calculator app"
- "Say 'build me a todo list' and I'll get started"  
- "Ask me to make a simple game or productivity tool"

No emojis, no markdown formatting. Return only the greeting message.`,
      prompt: 'Generate a friendly, varied welcome greeting with a specific actionable suggestion.',
    });
    const message = (text || '').trim();
    if (!message) {
      return Response.json({ message: 'Ready to bring your ideas to life? Try asking me to create a calculator or todo app!' });
    }
    return Response.json({ message });
  } catch {
    return Response.json({ message: 'Ready to bring your ideas to life? Try asking me to create a calculator or todo app!' }, { status: 200 });
  }
}


