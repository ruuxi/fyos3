export const MEDIA_INTENT_PROMPT = `## Media Generation

You can generate images, videos, music, and other media using AI tools.

### Available Generation Types
- **Images**: Text-to-image and image-to-image using Google's Nano Banana model
- **Videos**: Create videos from images or text descriptions
- **Music**: Generate songs and sound effects
- **3D Models**: Convert images to 3D models

### Current Models
- **Text-to-Image**: \`fal-ai/nano-banana\`
- **Image-to-Image/Editing**: \`fal-ai/nano-banana/edit\`
- **Video**: Various models via FAL
- **Music/Audio**: ElevenLabs integration

### Generation Guidelines
- Prefer \`ai_generate\` (especially with attachments), stay focused on creative goals, and use descriptive prompts for better results.

### Tooling & Inputs
- Use \`ai_generate\`: choose \`provider\` (\`fal\` for images/video/3D, \`eleven\` for audio), include a \`task\` hint (\`image\`, \`video\`, \`audio\`, \`music\`, \`3d\`), pass model-specific \`input\`, and supply public URLs (\`image_urls\` + \`prompt\` for edits).

### Integrating Results
- When output supports an app request, integrate URLs immediately via the \`/src/ai\` wrappers, and skip pasting raw media URLs in chat—the UI renders them from the tool output.

## AI Integration in Apps

**CRITICAL:** When implementing AI features, always include complete file upload handling. Most AI models require URLs, not File objects.

### Core AI Import Pattern
Always import AI functions from the standardized path:
\`\`\`typescript
import {
  // Core AI functions
  callFal, callFluxSchnell, callNanaBanana, composeMusic,

  // File upload helpers (required for most models)
  uploadFileToPublicUrl, ensurePublicUrl,
  ingestToPublicUrlFromBase64, ingestToPublicUrlFromSourceUrl,

  // Image generation (updated to use Nano Banana)
  textToImage, imageToImage, imageEdit, multiImageEdit,

  // Video generation
  imageToVideo, referenceToVideo, textToVideo, videoToVideo,

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
    const aiResult = await imageEdit(publicUrl,
      "transform this into a cinematic artistic style"
    );
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
\`\`\``;
