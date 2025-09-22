import { generateText } from 'ai';
import { PERSONA_PROMPT } from '@/lib/prompts';
import type { CapabilityIntent } from '@/lib/agent/intents/capabilityHeuristics';
import type { AgentEventEmitter } from '@/lib/agent/server/agentEventEmitter';
import type { PersonaPostProcessReason } from '@/lib/agent/metrics/types';

export interface PersonaPostProcessOutcome {
  applied: boolean;
  text: string;
  reason: PersonaPostProcessReason;
  modelId?: string;
  durationMs?: number;
  rawModelOutput?: string;
}

export interface PersonaPostProcessOptions {
  capabilityIntent?: CapabilityIntent;
  personaMode: boolean;
  enabled: boolean;
  eventEmitter?: AgentEventEmitter;
}

const PERSONA_MODEL_ID = process.env.AGENT_PERSONA_MODEL_ID ?? 'google/gemini-2.0-flash';
type TextStreamChunk = { type?: string; delta?: string; id?: string; [key: string]: unknown };

const buildPersonaRewritePrompt = (text: string): string => {
  return [
    'You will receive an assistant response that already solved the user\'s request.',
    'Rephrase it in Sim\'s voice: confident, edgy teen energy, a bit sarcastic but helpful.',
    'Do not remove instructions, facts, links, or caveats. Keep steps and outcomes intact.',
    'Never introduce code blocks, JSON, or file paths. Avoid quoting the original message verbatim.',
    'Keep it short and lively. You may split into short paragraphs if it improves clarity.',
    '',
    '---',
    'Assistant Response:',
    text,
    '---',
    'Persona Rewrite:'
  ].join('\n');
};

const looksStructured = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // ignore parse errors, treat as natural language
    }
  }
  if (/```/.test(trimmed)) return true;
  if (/\n\s*[{}\[\]]/.test(trimmed)) return true;
  return false;
};

const applyPersonaOnce = async (text: string): Promise<PersonaPostProcessOutcome> => {
  const prompt = buildPersonaRewritePrompt(text);
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: PERSONA_MODEL_ID,
      system: PERSONA_PROMPT,
      prompt,
    });
    const finishedAt = Date.now();
    const personaText = (result?.text || '').trim();
    if (!personaText) {
      return {
        applied: false,
        text,
        reason: 'skipped-error',
        modelId: PERSONA_MODEL_ID,
        durationMs: finishedAt - startedAt,
        rawModelOutput: result?.text,
      };
    }
    return {
      applied: true,
      text: personaText,
      reason: 'applied',
      modelId: PERSONA_MODEL_ID,
      durationMs: finishedAt - startedAt,
      rawModelOutput: result?.text,
    };
  } catch (error) {
    return {
      applied: false,
      text,
      reason: 'skipped-error',
      modelId: PERSONA_MODEL_ID,
      rawModelOutput: error instanceof Error ? error.message : String(error),
    };
  }
};

export class PersonaPostProcessorController {
  private readonly enabled: boolean;
  private readonly personaMode: boolean;
  private readonly capabilityIntent?: CapabilityIntent;
  private readonly eventEmitter?: AgentEventEmitter;
  private processedPromise: Promise<PersonaPostProcessOutcome> | null = null;
  private originalText: string | null = null;

  constructor(options: PersonaPostProcessOptions) {
    this.enabled = options.enabled;
    this.personaMode = options.personaMode;
    this.capabilityIntent = options.capabilityIntent;
    this.eventEmitter = options.eventEmitter;
  }

  private async emitOutcome(outcome: PersonaPostProcessOutcome, originalText: string): Promise<void> {
    if (!this.eventEmitter) return;
    await this.eventEmitter.emit('persona_post_processed', {
      applied: outcome.applied,
      reason: outcome.reason,
      originalCharCount: originalText.length,
      finalCharCount: outcome.text.length,
      modelId: outcome.modelId,
      durationMs: outcome.durationMs,
      capabilityIntent: this.capabilityIntent,
    }, { timestamp: Date.now() });
  }

  private cacheOutcome(text: string, outcome: PersonaPostProcessOutcome): PersonaPostProcessOutcome {
    this.originalText = text;
    this.processedPromise = Promise.resolve(outcome);
    void this.emitOutcome(outcome, text);
    return outcome;
  }

  async process(text: string): Promise<PersonaPostProcessOutcome> {
    if (!this.enabled) {
      return this.cacheOutcome(text, { applied: false, text, reason: 'skipped-disabled' });
    }
    if (this.personaMode) {
      return this.cacheOutcome(text, { applied: false, text, reason: 'skipped-persona-mode' });
    }
    if (this.capabilityIntent === 'banter') {
      return this.cacheOutcome(text, { applied: false, text, reason: 'skipped-banter' });
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return this.cacheOutcome(text, { applied: false, text, reason: 'skipped-empty' });
    }
    if (looksStructured(trimmed)) {
      return this.cacheOutcome(text, { applied: false, text, reason: 'skipped-structured' });
    }

    if (!this.processedPromise || this.originalText !== text) {
      this.originalText = text;
      this.processedPromise = applyPersonaOnce(text).then(async (outcome) => {
        await this.emitOutcome(outcome, text);
        return outcome;
      });
    }

    return this.processedPromise;
  }

  wrapStream(stream: ReadableStream<unknown>): ReadableStream<unknown> {
    if (!this.enabled || this.personaMode || this.capabilityIntent === 'banter') {
      return stream;
    }

    let textBuffer = '';
    let textChunkId: string | undefined;
    let pendingTextEnd: TextStreamChunk | null = null;
    let finishHandled = false;

    return stream.pipeThrough(new TransformStream<unknown, unknown>({
      start() {
        // noop
      },
      transform: async (chunk, outputController) => {
        if (!chunk || typeof chunk !== 'object') {
          outputController.enqueue(chunk);
          return;
        }
        const messageChunk = chunk as TextStreamChunk;

        if (messageChunk.type === 'text-start') {
          textChunkId = typeof messageChunk.id === 'string' ? messageChunk.id : textChunkId;
          outputController.enqueue(chunk);
          return;
        }

        if (messageChunk.type === 'text-delta') {
          textChunkId = typeof messageChunk.id === 'string' ? messageChunk.id : textChunkId;
          textBuffer += typeof messageChunk.delta === 'string' ? messageChunk.delta : '';
          return;
        }

        if (messageChunk.type === 'text-end') {
          pendingTextEnd = chunk;
          return;
        }

        if (messageChunk.type === 'finish') {
          finishHandled = true;
          if (textBuffer) {
            const outcome = await this.process(textBuffer);
            const personaDelta = outcome.text;
            if (personaDelta) {
              const personaChunk: TextStreamChunk = { type: 'text-delta', delta: personaDelta, id: textChunkId };
              outputController.enqueue(personaChunk);
            }
          }
          if (pendingTextEnd) {
            outputController.enqueue(pendingTextEnd);
            pendingTextEnd = null;
          }
          outputController.enqueue(chunk);
          return;
        }

        outputController.enqueue(chunk);
      },
      flush: async (outputController) => {
        if (textBuffer && !finishHandled) {
          const outcome = await this.process(textBuffer);
          const personaDelta = outcome.text;
          if (personaDelta) {
            const personaChunk: TextStreamChunk = { type: 'text-delta', delta: personaDelta, id: textChunkId };
            outputController.enqueue(personaChunk);
          }
          if (pendingTextEnd) {
            outputController.enqueue(pendingTextEnd);
            pendingTextEnd = null;
          }
        }
      },
    }));
  }
}

export const createPersonaPostProcessor = (options: PersonaPostProcessOptions): PersonaPostProcessorController => {
  return new PersonaPostProcessorController(options);
};
