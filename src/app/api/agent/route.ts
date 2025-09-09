import { convertToModelMessages, streamText, UIMessage, stepCountIs, tool, generateText } from 'ai';
import { z } from 'zod';
import {
  TOOL_NAMES,
  FSFindInput,
  FSReadInput,
  FSWriteInput,
  FSMkdirInput,
  FSRmInput,
  ExecInput,
  CreateAppInput,
  RenameAppInput,
  RemoveAppInput,
  ValidateProjectInput,
  SubmitPlanInput,
  WebSearchInput,
} from '@/lib/agentTools';
import Exa from 'exa-js';

// Some tool actions (like package installs) may take longer than 30s
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  console.log('🔵 [AGENT] Incoming request with messages:', messages.map(m => ({
    role: m.role,
    content: 'content' in m && typeof m.content === 'string' ? (m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content) : '[non-text content]',
    toolCalls: 'toolCalls' in m && Array.isArray(m.toolCalls) ? m.toolCalls.length : 0
  })));

  // Classifier mode: return one-word label ("create" | "chat") for the latest user message
  const classifyMode = new URL(req.url).searchParams.get('classify') === '1' || new URL(req.url).searchParams.get('mode') === 'classify';
  if (classifyMode) {
    // Use only the latest user message for classification
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = (lastUser && typeof (lastUser as any).content === 'string') ? (lastUser as any).content : '';
    try {
      const result = await generateText({
        model: 'google/gemini-2.0-flash',
        temperature: 0.1,
        system: [
          'You are a strict classifier. Output exactly one lowercase word: create or chat.',
          'Output create only if the user is asking to create, make, or edit an app.',
          'Otherwise output chat. No punctuation, no extra words. Chat refers to anything else.'
        ].join(' '),
        prompt: userText || ' ',
      });
      
      // Log usage after generateText completes
      console.log('🏷️ [CLASSIFY] Classification finished:', {
        finishReason: result.finishReason,
        textLength: result.text?.length || 0,
        inputLength: userText?.length || 0,
      });
      
      if (result.usage) {
        console.log('📊 [USAGE-CLASSIFY] Token consumption:', {
          inputTokens: result.usage.inputTokens || 0,
          outputTokens: result.usage.outputTokens || 0,
          totalTokens: result.usage.totalTokens || 0,
          reasoningTokens: result.usage.reasoningTokens || 0,
          cachedInputTokens: result.usage.cachedInputTokens || 0,
        });
        
        // Calculate cost for gemini-2.0-flash: $0.10 per million input, $0.40 per million output
        const inputCostPerMillion = 0.10;
        const outputCostPerMillion = 0.40;
        const estimatedCost = 
          ((result.usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
          ((result.usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
        
        console.log('💰 [USAGE-COST] gemini-2.0-flash estimated cost: $' + estimatedCost.toFixed(6));
      }
      const raw = (result.text || '').trim().toLowerCase();
      const label = raw.startsWith('create') ? 'create' : 'chat';
      return new Response(JSON.stringify({ label }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err: unknown) {
      return new Response(JSON.stringify({ label: 'chat', error: err instanceof Error ? err.message : String(err) }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    }
  }

  // Persona-only mode: returns a parallel, personality-driven stream that does not use tools
  const url = new URL(req.url);
  const personaMode = url.searchParams.get('persona') === '1' || url.searchParams.get('mode') === 'persona';
  if (personaMode) {
    const personaSystem = [
      'You are "Sim", an edgy teen persona who chats with the user.',
      'Respond to the user accordingly with your personality, feel free to chat normally.',
      'If the user requests something: narrate what you\'re doing as if you\'re handling their request, with sarcastic, confident teen energy.',
      'NEVER output code, commands, or file paths. Never use backticks or code blocks. No tool calls. No XML or JSON.',
      'Keep it short, vivid, and conversational. It\'s okay to be playful or a little sassy.',
      'Focus on progress and outcomes (e.g., "fine, I\'m wiring up your app"), not the technical details.',
      'Avoid technical jargon like components, functions, build, TypeScript, or APIs. Say things like "hooking things up", "tuning it", "giving it a glow-up" instead.',
      'If the user asks for code or implementation details, just say thats not your job and someone else is handling that.',
    ].join(' ');

    // Only provide user messages as context; ignore assistant/tool messages entirely
    const personaMessages = messages.filter(m => m.role === 'user');

    const result = streamText({
      model: 'google/gemini-2.0-flash',
      messages: convertToModelMessages(personaMessages),
      system: personaSystem,
      onFinish: ({ usage, finishReason, text }: any) => {
        console.log('🎭 [PERSONA] Response finished:', {
          finishReason,
          textLength: text?.length || 0,
          messagesCount: personaMessages.length,
        });
        
        if (usage) {
          console.log('📊 [USAGE-PERSONA] Token consumption:', {
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            totalTokens: usage.totalTokens || 0,
            reasoningTokens: usage.reasoningTokens || 0,
            cachedInputTokens: usage.cachedInputTokens || 0,
          });
          
          // Calculate cost for gemini-2.0-flash: $0.10 per million input, $0.40 per million output
          const inputCostPerMillion = 0.10;
          const outputCostPerMillion = 0.40;
          const estimatedCost = 
            ((usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
            ((usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
          
          console.log('💰 [USAGE-COST] gemini-2.0-flash estimated cost: $' + estimatedCost.toFixed(6));
        }
      },
    });

    console.log('📤 [PERSONA] Returning streaming response');
    return result.toUIMessageStreamResponse();
  }

  const result = streamText({
    model: 'alibaba/qwen3-coder',
    providerOptions: {
      gateway: {
        order: ['cerebras', 'alibaba'], // Try Amazon Bedrock first, then Anthropic
      },
    },
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(15),
    onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }: any) => {
      console.log('📊 [USAGE-STEP] Step finished:', {
        finishReason,
        textLength: text?.length || 0,
        toolCallsCount: toolCalls?.length || 0,
        toolResultsCount: toolResults?.length || 0,
        usage: usage ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cachedInputTokens,
        } : null,
      });
      
      // Log individual tool calls in this step
      if (toolCalls?.length) {
        console.log('🔧 [USAGE-STEP] Tool calls:', toolCalls.map((tc: any) => ({
          name: tc.toolName,
          id: tc.toolCallId?.substring(0, 8),
        })));
      }
    },
    onFinish: (event) => {
      // Enhanced usage logging
      console.log('🎯 [AI] Response finished:', {
        finishReason: event.finishReason,
        textLength: event.text?.length || 0,
        toolCalls: event.toolCalls?.length || 0,
        toolResults: event.toolResults?.length || 0,
        stepCount: event.steps?.length || 0,
      });

      // Detailed token usage logging
      if (event.usage) {
        console.log('📊 [USAGE-TOTAL] Token consumption:', {
          inputTokens: event.usage.inputTokens || 0,
          outputTokens: event.usage.outputTokens || 0,
          totalTokens: event.usage.totalTokens || 0,
          reasoningTokens: event.usage.reasoningTokens || 0,
          cachedInputTokens: event.usage.cachedInputTokens || 0,
        });

        // Calculate cost estimates based on model pricing
        // qwen3-coder: $2.00 per million tokens (input and output)
        const inputCostPerMillion = 2.00; // $2.00 per 1M input tokens
        const outputCostPerMillion = 2.00; // $2.00 per 1M output tokens
        const estimatedCost = 
          ((event.usage.inputTokens || 0) / 1000000) * inputCostPerMillion +
          ((event.usage.outputTokens || 0) / 1000000) * outputCostPerMillion;
        
        console.log('💰 [USAGE-COST] qwen3-coder estimated cost: $' + estimatedCost.toFixed(6));
      }

      // Log step-by-step breakdown if multiple steps
      if (event.steps && event.steps.length > 1) {
        console.log('📈 [USAGE-STEPS] Step breakdown:');
        event.steps.forEach((step: any, index: number) => {
          console.log(`  Step ${index}: ${step.text?.length || 0} chars, ${step.toolCalls?.length || 0} tools`);
        });
      }

      if (event.toolCalls?.length) {
        console.log('🔧 [AI] Tool calls made:', event.toolCalls.map((tc: any) => ({
          name: tc.toolName,
          input: tc.input ?? tc.args,
          id: tc.toolCallId?.substring(0, 8)
        })));
        
        // Log file operation details
        event.toolCalls.forEach((tc: any) => {
          if (tc.toolName.startsWith('web_fs_') || ['create_app', 'remove_app', 'rename_app'].includes(tc.toolName)) {
            const args = tc.input || tc.args || {};
            switch (tc.toolName) {
              case 'web_fs_write':
                console.log(`📝 [AI-Tool] WRITE: ${args.path} (${args.content?.length || 0} chars)`);
                break;
              case 'web_fs_read':
                console.log(`👁️ [AI-Tool] READ: ${args.path}`);
                break;
              case 'web_fs_mkdir':
                console.log(`📁 [AI-Tool] MKDIR: ${args.path}`);
                break;
              case 'web_fs_rm':
                console.log(`🗑️ [AI-Tool] REMOVE: ${args.path}`);
                break;
              case 'create_app':
                console.log(`🆕 [AI-Tool] CREATE_APP: "${args.name}" (${args.icon || '📦'})`);
                break;
              case 'remove_app':
                console.log(`❌ [AI-Tool] REMOVE_APP: ${args.id}`);
                break;
              case 'rename_app':
                console.log(`✏️ [AI-Tool] RENAME_APP: ${args.id} -> "${args.name}"`);
                break;
            }
          }
        });
      }

      if (event.toolResults?.length) {
        console.log('📋 [AI] Tool results received:', event.toolResults.map((tr: any) => ({
          name: tr.toolName,
          success: !tr.result?.error,
          id: tr.toolCallId?.substring(0, 8)
        })));
        
        // Log file operation results
        event.toolResults.forEach((tr: any) => {
          if (tr.toolName.startsWith('web_fs_') || ['create_app', 'remove_app', 'rename_app'].includes(tr.toolName)) {
            const result = tr.result || {};
            if (result.error) {
              console.error(`❌ [AI-Result] ${tr.toolName.toUpperCase()} FAILED:`, result.error);
            } else {
              switch (tr.toolName) {
                case 'web_fs_write':
                  console.log(`✅ [AI-Result] WRITE SUCCESS: ${result.path} (${result.size || 'unknown size'})`);
                  break;
                case 'web_fs_read':
                  console.log(`✅ [AI-Result] READ SUCCESS: ${result.path} (${result.size || 'unknown size'})`);
                  break;
                case 'create_app':
                  console.log(`✅ [AI-Result] APP CREATED: "${result.name}" at ${result.path}`);
                  break;
                case 'remove_app':
                  console.log(`✅ [AI-Result] APP REMOVED: "${result.name}" (${result.id})`);
                  break;
                case 'rename_app':
                  console.log(`✅ [AI-Result] APP RENAMED: "${result.oldName}" -> "${result.newName}"`);
                  break;
              }
            }
          }
        });
      }
    },
    system: `# WebContainer Engineering Agent

## Role & Capabilities
You are a proactive engineering agent operating inside a **WebContainer-powered workspace**. You can:
- Read and modify files
- Create apps and manage project structure
- Run package installs and commands
- **Never run dev, build, or start server commands**
- Keep commentary to a minimum, it's not necessary.

## Project Structure
- **Vite React App**: Source in \`src/\`, public assets in \`public/\`
- **App Creation**: Provide kebab-case id (e.g., "notes-app", "calculator") and place code in \`src/apps/<id>/index.tsx\`
- **Duplicate Handling**: System automatically adds "(1)", "(2)" etc. for duplicate names

## Styling & Layout Guidelines

### Window Context
- Apps run inside **resizable desktop windows** in an iframe (~600x380 default, may resize smaller)
- Iframe passes Tailwind + desktop UI CSS; base CSS is disabled
- **Always wrap content** in full-height container: \`<div class="h-full overflow-auto">\`
- Avoid fixed viewport units for height; use flex or h-full with internal scrolling
- Keep sticky headers within the app, not the top window
- Do not rely on window.top styling

### Design Philosophy: Context-Aware Styling
**CRITICAL:** Don't create plain, unstyled apps. Always apply thoughtful styling that matches the user's intent:

**App Purpose Analysis:**
- **Productivity apps** (notes, todo, calculator): Clean, focused layouts with subtle shadows, proper spacing, muted colors
- **Creative apps** (drawing, music, photo): Bold colors, larger interactive areas, visual feedback
- **Data apps** (dashboards, analytics): Structured grids, clear hierarchy, data visualization colors
- **Entertainment apps** (games, media): Vibrant colors, engaging animations, playful elements
- **Utility apps** (settings, file manager): Organized sections, clear icons, functional aesthetics

**Styling Requirements:**
1. **Color Palette**: Choose colors that match the app's purpose (e.g., green/blue for finance, warm colors for creative tools)
2. **Typography**: Use appropriate font weights and sizes for hierarchy
3. **Spacing**: Generous padding/margins for readability, tighter spacing for data-dense apps
4. **Interactive Elements**: Clear hover states, loading indicators, visual feedback
5. **Visual Polish**: Subtle shadows, rounded corners, proper contrast ratios

### Component Library
**Available shadcn/ui components:**
- Button, Badge, Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- DropdownMenu, Input, Select, Tabs, Textarea

**Import syntax:** \`import { Button } from "@/components/ui/button"\`

**If not listed above, add new components:** Use \`web_exec\` with \`pnpm dlx shadcn@latest add [component-name]\`

**Tailwind Styling Examples:**
- **Headers**: \`bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 rounded-t-lg\`
- **Cards**: \`bg-white shadow-lg rounded-xl border border-gray-200 p-6\`
- **Buttons**: \`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors\`
- **Input focus**: \`focus:ring-2 focus:ring-blue-500 focus:border-blue-500\`

**Avoid:** Injecting global CSS, using default browser styling

## AI Integration in Apps

**CRITICAL:** When implementing AI features, always include complete file upload handling. Most AI models require URLs, not File objects.

### Core AI Import Pattern
Always import AI functions from the standardized path:
\`\`\`typescript
import { 
  // Core AI functions
  callFal, callFluxSchnell, composeMusic,
  
  // File upload helpers (required for most models)
  uploadFileToPublicUrl, ensurePublicUrl,
  ingestToPublicUrlFromBase64, ingestToPublicUrlFromSourceUrl,
  
  // Video generation
  imageToVideo, referenceToVideo, textToVideo, videoToVideo,
  
  // Image processing
  imageToImage, imageEdit,
  
  // Audio generation
  audioToVideoAvatar, textToSpeechMultilingual, speechToSpeech, 
  soundEffects, videoToAudio, videoFoley,
  
  // 3D generation
  imageTo3D, multiviewTo3D
} from "/src/ai";
\`\`\`

### File Upload Integration (Required for Most Models)
**Every AI app should include file upload UI and handling:**

\`\`\`typescript
// Complete file upload component with AI integration
const [file, setFile] = useState<File | null>(null);
const [isProcessing, setIsProcessing] = useState(false);
const [result, setResult] = useState<any>(null);

// File input handler
const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const selectedFile = e.target.files?.[0];
  if (selectedFile) setFile(selectedFile);
};

// AI processing with upload
const processWithAI = async () => {
  if (!file) return;
  setIsProcessing(true);
  try {
    // Upload file to get public URL, then call AI model
    const publicUrl = await uploadFileToPublicUrl(file);
    const aiResult = await imageToVideo(publicUrl, { 
      prompt: "transform this into a cinematic scene" 
    });
    setResult(aiResult);
  } catch (error) {
    console.error('AI processing failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

// UI with drag-drop and processing states
return (
  <div className="space-y-4">
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
      <input
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={handleFileChange}
        className="hidden"
        id="file-upload"
      />
      <label htmlFor="file-upload" className="cursor-pointer">
        <div className="text-gray-500">
          {file ? file.name : "Click or drag file here"}
        </div>
      </label>
    </div>
    
    <Button 
      onClick={processWithAI} 
      disabled={!file || isProcessing}
      className="w-full"
    >
      {isProcessing ? "Processing..." : "Generate with AI"}
    </Button>
    
    {result && (
      <div className="mt-4">
        {result.video_url && (
          <video src={result.video_url} controls className="w-full rounded" />
        )}
        {result.image_url && (
          <img src={result.image_url} alt="Generated" className="w-full rounded" />
        )}
        {result.audio_url && (
          <audio src={result.audio_url} controls className="w-full" />
        )}
      </div>
    )}
  </div>
);
\`\`\`

### Text-Only AI Models (No Upload Required)

\`\`\`typescript
// Simple text-to-media generation
const [prompt, setPrompt] = useState("");
const [isGenerating, setIsGenerating] = useState(false);
const [result, setResult] = useState<any>(null);

const generateImage = async () => {
  setIsGenerating(true);
  try {
    const result = await callFluxSchnell({ prompt });
    setResult(result);
  } catch (error) {
    console.error('Generation failed:', error);
  } finally {
    setIsGenerating(false);
  }
};

const generateMusic = async () => {
  setIsGenerating(true);
  try {
    const result = await composeMusic({
      prompt,
      musicLengthMs: 30000,
      outputFormat: "mp3"
    });
    setResult(result);
  } catch (error) {
    console.error('Music generation failed:', error);
  } finally {
    setIsGenerating(false);
  }
};
\`\`\`

### Complete AI Model Examples (Copy-Paste Ready)

#### Image-to-Video Generation
\`\`\`typescript
const handleImageToVideo = async (imageFile: File) => {
  setIsProcessing(true);
  try {
    // Upload image and generate video
    const imageUrl = await uploadFileToPublicUrl(imageFile);
    const result = await imageToVideo(imageUrl, {
      prompt: "cinematic camera movement, dramatic lighting",
      duration: 5,
      fps: 24
    });
    
    // Result contains video_url for playback
    setVideoResult(result.video_url);
  } catch (error) {
    console.error('Image-to-video failed:', error);
  } finally {
    setIsProcessing(false);
  }
};
\`\`\`

#### Reference-to-Video (Character Consistency)
\`\`\`typescript
const handleReferenceToVideo = async (referenceImage: File) => {
  setIsProcessing(true);
  try {
    const imageUrl = await uploadFileToPublicUrl(referenceImage);
    const result = await referenceToVideo(imageUrl, {
      prompt: "walking through a magical forest, maintaining character appearance",
      duration: 3
    });
    setVideoResult(result.video_url);
  } catch (error) {
    console.error('Reference-to-video failed:', error);
  } finally {
    setIsProcessing(false);
  }
};
\`\`\`

#### Image Editing and Enhancement
\`\`\`typescript
const handleImageEdit = async (imageFile: File, instruction: string) => {
  setIsProcessing(true);
  try {
    const imageUrl = await uploadFileToPublicUrl(imageFile);
    const result = await imageEdit(imageUrl, instruction);
    setEditedImage(result.image_url);
  } catch (error) {
    console.error('Image edit failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

// Usage examples:
// await handleImageEdit(file, "remove the background");
// await handleImageEdit(file, "change the lighting to golden hour");
// await handleImageEdit(file, "add snow falling in the scene");
\`\`\`

#### Video-to-Video Style Transfer
\`\`\`typescript
const handleVideoStyleTransfer = async (videoFile: File, stylePrompt: string) => {
  setIsProcessing(true);
  try {
    const videoUrl = await uploadFileToPublicUrl(videoFile);
    const result = await videoToVideo(videoUrl, {
      prompt: stylePrompt,
      strength: 0.8
    });
    setStyledVideo(result.video_url);
  } catch (error) {
    console.error('Video style transfer failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

// Usage: await handleVideoStyleTransfer(file, "anime style with vibrant colors");
\`\`\`

#### 3D Model Generation
\`\`\`typescript
const handleImageTo3D = async (imageFile: File) => {
  setIsProcessing(true);
  try {
    const imageUrl = await uploadFileToPublicUrl(imageFile);
    const result = await imageTo3D(imageUrl, {
      texture_resolution: 1024
    });
    
    // Result contains model_url (GLB format) and preview_url
    set3DModel({ 
      modelUrl: result.model_url,
      previewUrl: result.preview_url 
    });
  } catch (error) {
    console.error('3D generation failed:', error);
  } finally {
    setIsProcessing(false);
  }
};
\`\`\`

#### Audio and Voice Generation
\`\`\`typescript
const handleTextToSpeech = async (text: string, language: string = "en") => {
  setIsProcessing(true);
  try {
    const result = await textToSpeechMultilingual(text, {
      language,
      voice: "female",
      speed: 1.0
    });
    setAudioResult(result.audio_url);
  } catch (error) {
    console.error('Text-to-speech failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

const handleSoundEffects = async (description: string) => {
  setIsProcessing(true);
  try {
    const result = await soundEffects(description, {
      duration: 5
    });
    setAudioResult(result.audio_url);
  } catch (error) {
    console.error('Sound effects generation failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

const handleSpeechToSpeech = async (audioFile: File) => {
  setIsProcessing(true);
  try {
    const audioUrl = await uploadFileToPublicUrl(audioFile);
    const result = await speechToSpeech(audioUrl, {
      target_voice: "professional_male"
    });
    setAudioResult(result.audio_url);
  } catch (error) {
    console.error('Speech-to-speech failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

const handleVideoToAudio = async (videoFile: File) => {
  setIsProcessing(true);
  try {
    const videoUrl = await uploadFileToPublicUrl(videoFile);
    const result = await videoToAudio(videoUrl);
    setAudioResult(result.audio_url);
  } catch (error) {
    console.error('Video-to-audio failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

const handleVideoFoley = async (videoFile: File) => {
  setIsProcessing(true);
  try {
    const videoUrl = await uploadFileToPublicUrl(videoFile);
    const result = await videoFoley(videoUrl, {
      prompt: "realistic environmental sounds"
    });
    setAudioResult(result.audio_url);
  } catch (error) {
    console.error('Video foley failed:', error);
  } finally {
    setIsProcessing(false);
  }
};

const handleAudioToVideoAvatar = async (audioFile: File, avatar: string) => {
  setIsProcessing(true);
  try {
    const audioUrl = await uploadFileToPublicUrl(audioFile);
    const result = await audioToVideoAvatar(avatar, audioUrl);
    setVideoResult(result.video_url);
  } catch (error) {
    console.error('Audio-to-video avatar failed:', error);
  } finally {
    setIsProcessing(false);
  }
};
\`\`\`

#### Alternative Upload Methods
For advanced use cases, you can use additional upload helpers:

\`\`\`typescript
// Upload from base64 data (useful for canvas/generated content)
const handleBase64Upload = async (base64Data: string, contentType: string) => {
  try {
    const publicUrl = await ingestToPublicUrlFromBase64(base64Data, contentType);
    const result = await imageToVideo(publicUrl);
    setResult(result);
  } catch (error) {
    console.error('Base64 upload failed:', error);
  }
};

// Upload from external URL (useful for web scraping/API results)
const handleUrlUpload = async (sourceUrl: string, contentType?: string) => {
  try {
    const publicUrl = await ingestToPublicUrlFromSourceUrl(sourceUrl, contentType);
    const result = await imageToImage(publicUrl, "enhance quality");
    setResult(result);
  } catch (error) {
    console.error('URL upload failed:', error);
  }
};

// Multi-file upload for models that need multiple inputs
const handleMultiFileUpload = async (files: File[]) => {
  try {
    const uploadPromises = files.map(file => uploadFileToPublicUrl(file));
    const urls = await Promise.all(uploadPromises);
    const result = await multiviewTo3D(urls);
    setResult(result);
  } catch (error) {
    console.error('Multi-file upload failed:', error);
  }
};
\`\`\`

### Error Handling Pattern
Always wrap AI calls in proper error handling:

\`\`\`typescript
const handleAIGeneration = async () => {
  setIsProcessing(true);
  setError(null);
  
  try {
    const result = await yourAIFunction();
    setResult(result);
  } catch (error) {
    console.error('AI generation failed:', error);
    setError(error instanceof Error ? error.message : 'Generation failed');
  } finally {
    setIsProcessing(false);
  }
};
\`\`\`

**Key Points:**
- All AI functions route through secure server proxies (/api/ai/fal, /api/ai/eleven)
- File uploads are handled via R2 storage with public URLs
- Generated media URLs are automatically ingested and converted to durable FYOS URLs
- Always include loading states and error handling in AI-powered UIs

## Best Practices

### App Management
- **Prefer enhancing** existing apps if they match the requested name (e.g., Notes) rather than creating duplicates
- Ask for confirmation before duplicating apps

### Package Management
- Use \`web_exec\` tool for package manager commands (e.g., \`pnpm add <pkg>\`, \`pnpm install\`)
- **Wait for web_exec result** (includes exitCode) before proceeding
- If install fails (non-zero exitCode), report error and suggest fixes or alternatives


### Styling Implementation Strategy
**Before coding any app, analyze the user's request to determine:**
1. **App category** (productivity, creative, data, entertainment, utility)
2. **Target aesthetic** (professional, playful, minimal, rich, technical)
3. **Key interactions** (forms, visualization, media, navigation)

**Then apply contextual styling:**
- **Color scheme**: Match the app's domain (blue for productivity, green for finance, purple for creative)
- **Layout density**: Spacious for reading apps, compact for data apps
- **Visual hierarchy**: Clear headings, proper contrast, logical flow
- **Micro-interactions**: Hover effects, loading states, transitions

**Example Decision Process:**
- User asks for "expense tracker" → Finance app → Use green/blue palette, clean tables, clear CTAs
- User asks for "drawing app" → Creative tool → Vibrant colors, large canvas area, tool palettes
- User asks for "dashboard" → Data app → Structured grid, charts, neutral colors with accent highlights`,
    tools: {
      // Step 1 – file discovery
      [TOOL_NAMES.web_fs_find]: {
        description: 'List files and folders recursively starting at a directory.',
        inputSchema: FSFindInput,
      },
      // File reads
      [TOOL_NAMES.web_fs_read]: {
        description: 'Read a file from the filesystem.',
        inputSchema: FSReadInput,
      },
      // Writes and mkdirs
      [TOOL_NAMES.web_fs_write]: {
        description: 'Write file contents. Creates parent directories when needed.',
        inputSchema: FSWriteInput,
      },
      [TOOL_NAMES.web_fs_mkdir]: {
        description: 'Create a directory (optionally recursive).',
        inputSchema: FSMkdirInput,
      },
      [TOOL_NAMES.web_fs_rm]: {
        description: 'Remove a file or directory (recursive by default).',
        inputSchema: FSRmInput,
      },
      // Process execution
      [TOOL_NAMES.web_exec]: {
        description: 'Run shell commands. Prefer pnpm for installs. Never run dev/build/start.',
        inputSchema: ExecInput,
      },
      // High-level: create app folder structure with custom id
      [TOOL_NAMES.create_app]: {
        description: 'Create a new app under src/apps/<id> + update public/apps/registry.json.',
        inputSchema: CreateAppInput,
      },
      // Update registry: rename an app by id
      [TOOL_NAMES.rename_app]: {
        description: 'Rename an app in public/apps/registry.json by id.',
        inputSchema: RenameAppInput,
      },
      // Remove an app from disk and registry
      [TOOL_NAMES.remove_app]: {
        description: 'Remove an app folder and its registry entry by id.',
        inputSchema: RemoveAppInput,
      },
      // Validate project health (typecheck/lint/build quick checks)
      [TOOL_NAMES.validate_project]: {
        description:
          'Run validation checks (TypeScript noEmit; optionally ESLint on files; full also runs build).',
        inputSchema: ValidateProjectInput,
      },
      // Planning helper – capture a plan before execution
      [TOOL_NAMES.submit_plan]: tool({
        description: 'Submit a structured execution plan before making changes.',
        inputSchema: SubmitPlanInput,
        async execute({ steps }) {
          console.log('🛠️ [TOOL] submit_plan executed with steps:', steps);
          const result = { accepted: true, steps };
          console.log('✅ [TOOL] submit_plan result:', result);
          return result;
        },
      }),

      // Web search with Exa (server-side tool)
      [TOOL_NAMES.web_search]: tool({
        description: 'Search the web for up-to-date information.',
        inputSchema: WebSearchInput,
        async execute({ query }) {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            return { error: 'Missing EXA_API_KEY in environment.' };
          }
          try {
            const exa = new Exa(apiKey);
            const { results } = await exa.searchAndContents(query, {
              livecrawl: 'always',
              numResults: 3,
            } as any);
            return (results || []).map((r: any) => ({
              title: r.title,
              url: r.url,
              content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined,
              publishedDate: r.publishedDate,
            }));
          } catch (err: unknown) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
      }),
    },
  });

  console.log('📤 [AGENT] Returning streaming response');
  return result.toUIMessageStreamResponse();
}
