// AI helpers for FYOS apps (client-side, runs inside Vite iframe)
export type AIProvider = 'fal' | 'eleven';

function generateRequestId(): string {
  return 'ai_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
}

export async function aiRequest(provider: AIProvider, model: string, input: any): Promise<any> {
  const id = generateRequestId();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      try {
        const d: any = (e as any).data;
        if (!d || d.type !== 'AI_RESPONSE' || d.id !== id) return;
        window.removeEventListener('message', onMessage as any);
        if (d.ok) resolve(d.result);
        else reject(new Error(d.error || 'AI request failed'));
      } catch (err) {
        window.removeEventListener('message', onMessage as any);
        reject(err);
      }
    };
    window.addEventListener('message', onMessage as any);
    try {
      // Derive app scope from iframe query params (?id=...&name=...)
      let scope: { appId?: string; appName?: string } | undefined = undefined;
      try {
        const sp = new URLSearchParams(window.location.search || '');
        const appId = sp.get('id') || undefined;
        const appName = sp.get('name') || undefined;
        scope = { appId, appName };
      } catch {}
      const payload = { type: 'AI_REQUEST', id, provider, model, input, scope } as const;
      // Post directly to the top-level Next.js host to avoid needing a desktop relay
      window.top?.postMessage(payload, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage as any);
      reject(err);
      return;
    }
    // Timeout after 60s
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage as any); } catch {}
      reject(new Error('AI request timeout'));
    }, 60000);
  });
}

export async function callFal(model: string, input: any): Promise<any> {
  return aiRequest('fal', model, input);
}

export async function callFluxSchnell(input: any): Promise<any> {
  return aiRequest('fal', 'fal-ai/flux-1/schnell', input);
}

export interface ComposeMusicParams {
  prompt?: string;
  compositionPlan?: any;
  musicLengthMs?: number;
  outputFormat?: string;
  model?: string;
}

export async function composeMusic(params: ComposeMusicParams): Promise<any> {
  const input: any = {};
  if (params && typeof params === 'object') {
    if (typeof (params as any).prompt === 'string') input.prompt = (params as any).prompt;
    if ((params as any).compositionPlan) input.composition_plan = (params as any).compositionPlan;
    if (typeof (params as any).musicLengthMs === 'number') input.music_length_ms = (params as any).musicLengthMs;
    if (typeof (params as any).outputFormat === 'string') input.output_format = (params as any).outputFormat;
    if (typeof (params as any).model === 'string') input.model = (params as any).model;
  }
  return aiRequest('eleven', input.model || '', input);
}

// Media ingest helpers for inputs that require a public URL
function generateMediaRequestId(): string {
  return 'media_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
}

export interface MediaIngestResult {
  ok: boolean;
  id?: string;
  publicUrl?: string;
  r2Key?: string;
  sha256?: string;
  size?: number;
  contentType?: string;
  error?: string;
}

export async function ingestToPublicUrlFromBase64(base64: string, contentType?: string): Promise<string> {
  const id = generateMediaRequestId();
  const scope = deriveScope();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const d: any = (e as any).data;
      if (!d || d.type !== 'MEDIA_INGEST_RESPONSE' || d.id !== id) return;
      window.removeEventListener('message', onMessage as any);
      if (d.ok && d.result?.publicUrl) resolve(d.result.publicUrl);
      else reject(new Error(d.error || 'Ingest failed'));
    };
    window.addEventListener('message', onMessage as any);
    try {
      const payload = { base64, contentType };
      window.top?.postMessage({ type: 'MEDIA_INGEST', id, payload, scope }, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage as any);
      reject(err);
    }
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage as any); } catch {}
      reject(new Error('Ingest timeout'));
    }, 60000);
  });
}

export async function ingestToPublicUrlFromSourceUrl(sourceUrl: string, contentType?: string): Promise<string> {
  const id = generateMediaRequestId();
  const scope = deriveScope();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const d: any = (e as any).data;
      if (!d || d.type !== 'MEDIA_INGEST_RESPONSE' || d.id !== id) return;
      window.removeEventListener('message', onMessage as any);
      if (d.ok && d.result?.publicUrl) resolve(d.result.publicUrl);
      else reject(new Error(d.error || 'Ingest failed'));
    };
    window.addEventListener('message', onMessage as any);
    try {
      const payload = { sourceUrl, contentType };
      window.top?.postMessage({ type: 'MEDIA_INGEST', id, payload, scope }, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage as any);
      reject(err);
    }
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage as any); } catch {}
      reject(new Error('Ingest timeout'));
    }, 60000);
  });
}

function deriveScope(): { appId?: string; appName?: string } | undefined {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    const appId = sp.get('id') || undefined;
    const appName = sp.get('name') || undefined;
    return { appId, appName };
  } catch {
    return undefined;
  }
}

export async function uploadFileToPublicUrl(file: File): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
  const ct = file.type || undefined;
  return ingestToPublicUrlFromBase64(base64, ct);
}

export async function ensurePublicUrl(input: File | string): Promise<string> {
  if (typeof input === 'string') return input;
  return uploadFileToPublicUrl(input);
}

// Convenience wrappers for common FAL models (developers can still use callFal directly)
export async function imageToVideo(image: File | string, options: any = {}): Promise<any> {
  const image_url = await ensurePublicUrl(image);
  return callFal('fal-ai/bytedance/seedance/v1/lite/image-to-video', { image_url, ...options });
}

export async function referenceToVideo(referenceImage: File | string, options: any = {}): Promise<any> {
  const reference_image_url = await ensurePublicUrl(referenceImage);
  return callFal('fal-ai/bytedance/seedance/v1/lite/reference-to-video', { reference_image_url, ...options });
}

export async function imageToImage(image: File | string, prompt: string, options: any = {}): Promise<any> {
  const image_url = await ensurePublicUrl(image);
  return callFal('fal-ai/qwen-image/image-to-image', { image_url, prompt, ...options });
}

export async function imageEdit(image: File | string, instruction: string, options: any = {}): Promise<any> {
  const image_url = await ensurePublicUrl(image);
  return callFal('fal-ai/qwen-image-edit', { image_url, instruction, ...options });
}

export async function textToVideo(prompt: string, options: any = {}): Promise<any> {
  return callFal('fal-ai/wan/v2.2-5b/text-to-video/fast-wan', { prompt, ...options });
}

export async function videoToVideo(video: File | string, options: any = {}): Promise<any> {
  const video_url = await ensurePublicUrl(video);
  return callFal('fal-ai/wan/v2.2-a14b/video-to-video', { video_url, ...options });
}

export async function audioToVideoAvatar(avatar: string, audio: File | string, options: any = {}): Promise<any> {
  const url = await ensurePublicUrl(audio);
  return callFal('argil/avatars/audio-to-video', { avatar, audio_url: { url }, ...options });
}

export async function textToSpeechMultilingual(text: string, options: any = {}): Promise<any> {
  return callFal('fal-ai/chatterbox/text-to-speech/multilingual', { text, ...options });
}

export async function speechToSpeech(audio: File | string, options: any = {}): Promise<any> {
  const source_audio_url = await ensurePublicUrl(audio);
  return callFal('fal-ai/chatterbox/speech-to-speech', { source_audio_url, ...options });
}

export async function soundEffects(prompt: string, options: any = {}): Promise<any> {
  return callFal('fal-ai/elevenlabs/sound-effects/v2', { prompt, ...options });
}

export async function videoToAudio(video: File | string, options: any = {}): Promise<any> {
  const video_url = await ensurePublicUrl(video);
  return callFal('mirelo-ai/sfx-v1/video-to-audio', { video_url, ...options });
}

export async function videoFoley(video: File | string, options: any = {}): Promise<any> {
  const video_url = await ensurePublicUrl(video);
  return callFal('fal-ai/hunyuan-video-foley', { video_url, ...options });
}

export async function imageTo3D(image: File | string, options: any = {}): Promise<any> {
  const image_url = await ensurePublicUrl(image);
  return callFal('tripo3d/tripo/v2.5/image-to-3d', { image_url, ...options });
}

export async function multiviewTo3D(images: Array<File | string>, options: any = {}): Promise<any> {
  const image_urls: string[] = [];
  for (const img of images) image_urls.push(await ensurePublicUrl(img));
  return callFal('tripo3d/tripo/v2.5/multiview-to-3d', { image_urls, ...options });
}
