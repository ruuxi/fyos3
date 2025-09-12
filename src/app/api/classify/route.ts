import { generateText, convertToModelMessages } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { CLASSIFIER_PROMPT } from '@/lib/agentPrompts';

export async function POST(req: NextRequest) {
  try {
    const { message, messages } = await req.json();
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    console.log('🏷️ [CLASSIFY] Input message:', message);
    console.log('🏷️ [CLASSIFY] Messages history length:', messages?.length || 0);

    // Prepare conversation context (last 10 messages)
    let conversationContext = '';
    if (messages && Array.isArray(messages) && messages.length > 0) {
      const last10Messages = messages.slice(-10);
      conversationContext = '\n\nConversation history (last 10 messages):\n' + 
        last10Messages.map((msg, i) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          const content = msg.parts?.map((p: any) => p.type === 'text' ? p.text : '').join('') || msg.content || '';
          return `${role}: ${content}`;
        }).join('\n');
    }

    // Use AI to classify the user's intent with conversation context
    const { text } = await generateText({
      model: 'meta/llama-4-scout',
      providerOptions: {
        gateway: {
          order: ['cerebras', 'alibaba'],
        },
      },
      system: CLASSIFIER_PROMPT,
      prompt: message + conversationContext,
      temperature: 0.2, // Lower temperature for more consistent classification
    });

    console.log('🏷️ [CLASSIFY] Raw AI response:');
    console.log('--- START RAW RESPONSE ---');
    console.log(text);
    console.log('--- END RAW RESPONSE ---');

    // Parse the markdown response
    const parseClassification = (text: string) => {
      const lines = text.split('\n');
      let taskType = '';
      let toolsRequired: string[] = [];
      let promptSections: string[] = [];
      let currentSection = '';

      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('## Task Type')) {
          currentSection = 'task';
        } else if (trimmed.startsWith('## Tools Required')) {
          currentSection = 'tools';
        } else if (trimmed.startsWith('## Prompt Sections')) {
          currentSection = 'prompts';
        } else if (trimmed.startsWith('- ') && currentSection) {
          const item = trimmed.substring(2).trim();
          if (currentSection === 'tools') {
            toolsRequired.push(item);
          } else if (currentSection === 'prompts') {
            promptSections.push(item);
          }
        } else if (currentSection === 'task' && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('`')) {
          taskType = trimmed.toLowerCase().replace(/[^a-z_]/g, '');
        }
      }

      return {
        taskType: taskType || 'chat',
        toolsRequired,
        promptSections,
      };
    };

    const classification = parseClassification(text);

    // Map tool categories to actual tool names
    const toolMapping: Record<string, string[]> = {
      file_ops: ['web_fs_find', 'web_fs_read', 'web_fs_write', 'web_fs_rm'],
      app_management: ['app_manage', 'submit_plan'],
      code_editing: ['code_edit_ast'],
      package_management: ['web_exec'],
      validation: ['validate_project'],
      ai_generation: ['ai_generate'],
      media_browsing: ['media_list'],
      web_search: ['web_search'],
    };

    // Convert tool categories to actual tool names
    const availableTools = new Set<string>();
    for (const category of classification.toolsRequired) {
      const tools = toolMapping[category];
      if (tools) {
        tools.forEach(tool => availableTools.add(tool));
      }
    }

    return NextResponse.json({
      taskType: classification.taskType,
      availableTools: Array.from(availableTools),
      promptSections: classification.promptSections,
      rawClassification: text, // For debugging
    });

  } catch (error) {
    console.error('Classification error:', error);
    return NextResponse.json(
      { error: 'Failed to classify message' },
      { status: 500 }
    );
  }
}
