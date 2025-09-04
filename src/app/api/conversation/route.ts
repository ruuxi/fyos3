/* File Role: Entry point, traffic director, and user interface layer
  
  - Model: openai/gpt-4o-mini (conversational AI)
  - Responsibilities:
    - Receives ALL user requests from frontend
    - Performs intent detection (conversational vs coding)
    - Routes coding requests to /api/agent
    - Processes responses into natural conversation
    - Always provides the final response to users */
    
import { convertToModelMessages, streamText, UIMessage } from 'ai';
import { z } from 'zod';
import { 
  CONVERSATIONAL_SYSTEM_PROMPT, 
  CODING_RESPONSE_PROCESSOR_PROMPT, 
  FALLBACK_SYSTEM_PROMPT 
} from '@/lib/aiPrompts';

export const maxDuration = 30;

// Simple intent detection to classify user requests
function detectIntent(message: string): 'conversational' | 'coding' {
  const codingKeywords = [
    // File operations
    'create', 'build', 'write', 'edit', 'modify', 'update', 'delete', 'remove', 'file', 'folder', 'directory',
    // Development terms
    'app', 'component', 'function', 'class', 'method', 'variable', 'install', 'package', 'dependency',
    'code', 'programming', 'script', 'debug', 'error', 'bug', 'fix', 'implement', 'develop',
    // Web technologies
    'html', 'css', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node', 'npm', 'yarn', 'pnpm',
    // Commands and tools
    'run', 'execute', 'command', 'terminal', 'cli', 'git', 'commit', 'push', 'pull', 'merge',
    // Project specific
    'webcontainer', 'vite', 'next.js', 'tailwind', 'deploy'
  ];

  const lowerMessage = message.toLowerCase();
  const hasCodeKeywords = codingKeywords.some(keyword => lowerMessage.includes(keyword));
  
  // Check for question words that might indicate conversational intent
  const conversationalPatterns = [
    /^(what|how|why|when|where|who|can you|could you|would you|do you|are you|is there)/i,
    /\?(.*)?$/,  // Ends with question mark
    /(tell me|explain|help me understand)/i
  ];
  
  const hasConversationalPattern = conversationalPatterns.some(pattern => pattern.test(message));
  
  // If it has coding keywords, it's likely a coding request
  if (hasCodeKeywords) {
    return 'coding';
  }
  
  // If it has conversational patterns but no coding keywords, it's conversational
  if (hasConversationalPattern) {
    return 'conversational';
  }
  
  // Default to coding for ambiguous cases since this is a development environment
  return 'coding';
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log('🟣 [CONVERSATION] Raw request data:', { messages: messages?.length || 'undefined', type: typeof messages });
  console.log('🟣 [CONVERSATION] Incoming request with messages:', messages?.map?.(m => ({
    role: m.role,
    content: 'content' in m && typeof m.content === 'string' ? (m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content) : '[non-text content]',
  })));

  // Ensure messages is an array
  if (!Array.isArray(messages)) {
    console.error('❌ [CONVERSATION] Messages is not an array:', messages);
    return new Response('Invalid messages format', { status: 400 });
  }

  // Get the latest user message for intent detection
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const lastMessageText = lastUserMessage && 'content' in lastUserMessage && typeof lastUserMessage.content === 'string' 
    ? lastUserMessage.content 
    : '';

  const intent = detectIntent(lastMessageText);
  console.log('🔍 [CONVERSATION] Detected intent:', intent, 'for message:', lastMessageText.substring(0, 50) + '...');

  if (intent === 'coding') {
    // Forward to coding model with conversation context
    console.log('🔧 [CONVERSATION] Forwarding to coding model...');
    
    try {
      const response = await fetch(`${req.url.replace('/conversation', '/agent')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          messages: [
            ...messages,
            {
              role: 'system',
              content: 'You are receiving this request through a conversation layer. Please provide your technical response and any tool outputs, and the conversation layer will format it appropriately for the user.'
            }
          ]
        }),
      });

      if (!response.ok) {
        throw new Error(`Coding model returned ${response.status}: ${response.statusText}`);
      }

      // Stream the coding model response through conversation layer
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from coding model');
      }

      const decoder = new TextDecoder();
      let codingResponse = '';

      // Collect the full response from coding model
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        codingResponse += chunk;
      }

      // Now process the coding response with conversation model
      const conversationMessages = [
        {
          role: 'user',
          content: `Original user request: ${lastMessageText}

Coding model response: ${codingResponse}

Please present this response to the user in a natural, conversational way.`
        }
      ];

      const result = streamText({
        model: 'google/gemini-2.0-flash',
        providerOptions: {
          gateway: {
            order: ['google', 'vertex'], // Use same gateway pattern
          },
        },
        system: CODING_RESPONSE_PROCESSOR_PROMPT,
        messages: conversationMessages as any,
        onFinish: (event) => {
          console.log('💬 [CONVERSATION] Response finished:', {
            finishReason: event.finishReason,
            usage: event.usage,
            text: event.text?.length > 200 ? event.text.substring(0, 200) + '...' : event.text,
          });
        },
      });

      return result.toUIMessageStreamResponse();

    } catch (error) {
      console.error('❌ [CONVERSATION] Error calling coding model:', error);
      
      // Fallback to direct conversational response
      const result = streamText({
        model: 'google/gemini-2.0-flash',
        providerOptions: {
          gateway: {
            order: ['google', 'vertex'], // Use same gateway pattern
          },
        },
        system: FALLBACK_SYSTEM_PROMPT,
        messages: convertToModelMessages(messages),
      });

      return result.toUIMessageStreamResponse();
    }

  } else {
    // Handle conversational requests directly
    console.log('💬 [CONVERSATION] Handling conversational request directly');
    
    const result = streamText({
      model: 'google/gemini-2.0-flash',
      providerOptions: {
        gateway: {
          order: ['google', 'vertex'], // Use same gateway pattern
        },
      },
      system: CONVERSATIONAL_SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      onFinish: (event) => {
        console.log('💬 [CONVERSATION] Conversational response finished:', {
          finishReason: event.finishReason,
          usage: event.usage,
          text: event.text?.length > 200 ? event.text.substring(0, 200) + '...' : event.text,
        });
      },
    });

    console.log('📤 [CONVERSATION] Returning conversational streaming response');
    return result.toUIMessageStreamResponse();
  }
}