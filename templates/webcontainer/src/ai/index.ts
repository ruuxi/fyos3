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
      const payload = { type: 'AI_REQUEST', id, provider, model, input } as const;
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
