// AI helpers for FYOS apps (client-side, runs inside Vite iframe)
export type AIProvider = 'fal' | 'eleven';

type Scope = { appId?: string; appName?: string };

type AIRequestPayload<TInput> = {
  type: 'AI_REQUEST';
  id: string;
  provider: AIProvider;
  model: string;
  input: TInput;
  scope?: Scope;
};

type AIResponsePayload = {
  type: 'AI_RESPONSE';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type MediaIngestPayload = {
  base64?: string;
  sourceUrl?: string;
  contentType?: string;
};

type MediaIngestRequest = {
  type: 'MEDIA_INGEST';
  id: string;
  payload: MediaIngestPayload;
  scope?: Scope;
};

type MediaIngestResponse = {
  type: 'MEDIA_INGEST_RESPONSE';
  id: string;
  ok: boolean;
  result?: MediaIngestResult;
  error?: string;
};

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null;
}

function deriveScope(): Scope | undefined {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    const appId = sp.get('id') || undefined;
    const appName = sp.get('name') || undefined;
    return { appId, appName };
  } catch {
    return undefined;
  }
}

function isMatchingAIResponse(data: unknown, expectedId: string): data is AIResponsePayload {
  if (!isPlainObject(data)) return false;
  if (data.type !== 'AI_RESPONSE') return false;
  if (data.id !== expectedId) return false;
  if (typeof data.ok !== 'boolean') return false;
  if ('error' in data && data.error !== undefined && typeof data.error !== 'string') return false;
  return true;
}

function isMatchingMediaResponse(data: unknown, expectedId: string): data is MediaIngestResponse {
  if (!isPlainObject(data)) return false;
  if (data.type !== 'MEDIA_INGEST_RESPONSE') return false;
  if (data.id !== expectedId) return false;
  if (typeof data.ok !== 'boolean') return false;
  if ('error' in data && data.error !== undefined && typeof data.error !== 'string') return false;
  if ('result' in data && data.result !== undefined && !isPlainObject(data.result)) return false;
  return true;
}

function generateRequestId(): string {
  return 'ai_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
}

export async function aiRequest<TInput = unknown, TResult = unknown>(provider: AIProvider, model: string, input: TInput): Promise<TResult> {
  const id = generateRequestId();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      try {
        const data = event.data;
        if (!isMatchingAIResponse(data, id)) return;
        window.removeEventListener('message', onMessage);
        if (data.ok) {
          resolve(data.result as TResult);
        } else {
          reject(new Error(data.error || 'AI request failed'));
        }
      } catch (err) {
        window.removeEventListener('message', onMessage);
        reject(err);
      }
    };
    window.addEventListener('message', onMessage);
    try {
      // Derive app scope from iframe query params (?id=...&name=...)
      const scope = deriveScope();
      const payload: AIRequestPayload<TInput> = { type: 'AI_REQUEST', id, provider, model, input, scope };
      // Post directly to the top-level Next.js host
      window.top?.postMessage(payload, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage);
      reject(err);
      return;
    }
    // Timeout after 60s
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage); } catch {}
      reject(new Error('AI request timeout'));
    }, 60000);
  });
}

export async function callFal<TInput = unknown, TResult = unknown>(model: string, input: TInput): Promise<TResult> {
  return aiRequest<TInput, TResult>('fal', model, input);
}

export async function callFluxSchnell<TInput = unknown, TResult = unknown>(input: TInput): Promise<TResult> {
  return callFal<TInput, TResult>('fal-ai/nano-banana', input);
}

// New Nano Banana text-to-image helper (replaces FLUX Schnell)
export async function callNanaBanana<TInput = unknown, TResult = unknown>(input: TInput): Promise<TResult> {
  return callFal<TInput, TResult>('fal-ai/nano-banana', input);
}

// Text-to-image using Nano Banana
export async function textToImage(prompt: string, options: PlainObject = {}): Promise<unknown> {
  return callFal('fal-ai/nano-banana', { prompt, ...options });
}

export interface ComposeMusicParams {
  prompt?: string;
  compositionPlan?: unknown;
  musicLengthMs?: number;
  outputFormat?: string;
  model?: string;
}

export async function composeMusic(params: ComposeMusicParams): Promise<unknown> {
  const input: PlainObject = {};
  if (typeof params.prompt === 'string') input.prompt = params.prompt;
  if (params.compositionPlan !== undefined) input.composition_plan = params.compositionPlan;
  if (typeof params.musicLengthMs === 'number') input.music_length_ms = params.musicLengthMs;
  if (typeof params.outputFormat === 'string') input.output_format = params.outputFormat;
  if (typeof params.model === 'string') input.model = params.model;
  const model = typeof params.model === 'string' ? params.model : '';
  return aiRequest('eleven', model, input);
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
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isMatchingMediaResponse(data, id)) return;
      window.removeEventListener('message', onMessage);
      if (data.ok && data.result?.publicUrl) {
        resolve(data.result.publicUrl);
      } else {
        reject(new Error(data.error || 'Ingest failed'));
      }
    };
    window.addEventListener('message', onMessage);
    try {
      const request: MediaIngestRequest = {
        type: 'MEDIA_INGEST',
        id,
        payload: { base64, contentType },
        scope,
      };
      window.top?.postMessage(request, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage);
      reject(err);
    }
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage); } catch {}
      reject(new Error('Ingest timeout'));
    }, 60000);
  });
}

export async function ingestToPublicUrlFromSourceUrl(sourceUrl: string, contentType?: string): Promise<string> {
  const id = generateMediaRequestId();
  const scope = deriveScope();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isMatchingMediaResponse(data, id)) return;
      window.removeEventListener('message', onMessage);
      if (data.ok && data.result?.publicUrl) {
        resolve(data.result.publicUrl);
      } else {
        reject(new Error(data.error || 'Ingest failed'));
      }
    };
    window.addEventListener('message', onMessage);
    try {
      const request: MediaIngestRequest = {
        type: 'MEDIA_INGEST',
        id,
        payload: { sourceUrl, contentType },
        scope,
      };
      window.top?.postMessage(request, '*');
    } catch (err) {
      window.removeEventListener('message', onMessage);
      reject(err);
    }
    setTimeout(() => {
      try { window.removeEventListener('message', onMessage); } catch {}
      reject(new Error('Ingest timeout'));
    }, 60000);
  });
}

export async function uploadFileToPublicUrl(file: File): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Unexpected file reader result type'));
      }
    };
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
export async function imageToVideo(image: File | string, options: PlainObject = {}): Promise<unknown> {
  const image_url = await ensurePublicUrl(image);
  return callFal('fal-ai/bytedance/seedance/v1/lite/image-to-video', { image_url, ...options });
}

export async function referenceToVideo(referenceImage: File | string, options: PlainObject = {}): Promise<unknown> {
  const reference_image_url = await ensurePublicUrl(referenceImage);
  return callFal('fal-ai/bytedance/seedance/v1/lite/reference-to-video', { reference_image_url, ...options });
}

export async function imageToImage(image: File | string, prompt: string, options: PlainObject = {}): Promise<unknown> {
  const image_urls = [await ensurePublicUrl(image)];
  return callFal('fal-ai/nano-banana/edit', { image_urls, prompt, ...options });
}

export async function imageEdit(image: File | string, instruction: string, options: PlainObject = {}): Promise<unknown> {
  const image_urls = [await ensurePublicUrl(image)];
  return callFal('fal-ai/nano-banana/edit', { image_urls, prompt: instruction, ...options });
}

// Multiple image editing using Nano Banana
export async function multiImageEdit(images: Array<File | string>, prompt: string, options: PlainObject = {}): Promise<unknown> {
  const image_urls: string[] = [];
  for (const img of images) image_urls.push(await ensurePublicUrl(img));
  return callFal('fal-ai/nano-banana/edit', { image_urls, prompt, ...options });
}

export async function textToVideo(prompt: string, options: PlainObject = {}): Promise<unknown> {
  return callFal('fal-ai/wan/v2.2-5b/text-to-video/fast-wan', { prompt, ...options });
}

export async function videoToVideo(video: File | string, options: PlainObject = {}): Promise<unknown> {
  const video_url = await ensurePublicUrl(video);
  return callFal('fal-ai/wan/v2.2-a14b/video-to-video', { video_url, ...options });
}

export async function audioToVideoAvatar(avatar: string, audio: File | string, options: PlainObject = {}): Promise<unknown> {
  const url = await ensurePublicUrl(audio);
  return callFal('argil/avatars/audio-to-video', { avatar, audio_url: { url }, ...options });
}

export async function textToSpeechMultilingual(text: string, options: PlainObject = {}): Promise<unknown> {
  return callFal('fal-ai/chatterbox/text-to-speech/multilingual', { text, ...options });
}

export async function speechToSpeech(audio: File | string, options: PlainObject = {}): Promise<unknown> {
  const source_audio_url = await ensurePublicUrl(audio);
  return callFal('fal-ai/chatterbox/speech-to-speech', { source_audio_url, ...options });
}

export async function soundEffects(prompt: string, options: PlainObject = {}): Promise<unknown> {
  return callFal('fal-ai/elevenlabs/sound-effects/v2', { prompt, ...options });
}

export async function videoToAudio(video: File | string, options: PlainObject = {}): Promise<unknown> {
  const video_url = await ensurePublicUrl(video);
  return callFal('mirelo-ai/sfx-v1/video-to-audio', { video_url, ...options });
}

export async function videoFoley(video: File | string, options: PlainObject = {}): Promise<unknown> {
  const video_url = await ensurePublicUrl(video);
  return callFal('fal-ai/hunyuan-video-foley', { video_url, ...options });
}

export async function imageTo3D(image: File | string, options: PlainObject = {}): Promise<unknown> {
  const image_url = await ensurePublicUrl(image);
  return callFal('tripo3d/tripo/v2.5/image-to-3d', { image_url, ...options });
}

export async function multiviewTo3D(images: Array<File | string>, options: PlainObject = {}): Promise<unknown> {
  const image_urls: string[] = [];
  for (const img of images) image_urls.push(await ensurePublicUrl(img));
  return callFal('tripo3d/tripo/v2.5/multiview-to-3d', { image_urls, ...options });
}
