import { generateText } from 'ai';
import { CAPABILITY_ROUTER_PROMPT } from '@/lib/prompts/capabilityRouter';
import {
  AttachmentHint,
  CapabilityIntent,
  CapabilityHeuristicDecision,
  evaluateCapabilityHeuristics,
} from '@/lib/agent/intents/capabilityHeuristics';

type Confidence = 'low' | 'medium' | 'high';

type DecisionSource = 'heuristic' | 'model';

export interface CapabilityRouterDecision {
  intent: CapabilityIntent;
  confidence: Confidence;
  reason: string;
  source: DecisionSource;
  heuristic?: CapabilityHeuristicDecision;
  rawModelOutput?: string;
  modelId?: string;
}

export interface CapabilityRouterParams {
  text: string;
  hints?: AttachmentHint[];
  modelId?: string;
  skipModel?: boolean;
}

const DEFAULT_MODEL_ID = process.env.AGENT_CAPABILITY_ROUTER_MODEL ?? 'google/gemini-2.0-flash';

const buildRouterPromptInput = (text: string, hints: AttachmentHint[]): string => {
  const sections: string[] = [];
  sections.push('## User Message');
  sections.push(text || '[empty]');
  if (hints.length > 0) {
    sections.push('## Attachments');
    for (const hint of hints) {
      const type = hint.contentType || 'unknown';
      sections.push(`- ${type} :: ${hint.url}`);
    }
  }
  sections.push('## Task');
  sections.push('Return a JSON object with intent, confidence, and reason.');
  return sections.join('\n');
};

const parseModelDecision = (raw: string): { intent?: CapabilityIntent; confidence?: Confidence; reason?: string } => {
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as { intent?: unknown; confidence?: unknown; reason?: unknown };
    return {
      intent: typeof parsed.intent === 'string' ? (parsed.intent as CapabilityIntent) : undefined,
      confidence: typeof parsed.confidence === 'string' ? (parsed.confidence as Confidence) : undefined,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    };
  } catch {
    // tolerate models that wrap JSON in text
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = typeof parsed.intent === 'string' ? (parsed.intent as CapabilityIntent) : undefined;
      const confidence = typeof parsed.confidence === 'string' ? (parsed.confidence as Confidence) : undefined;
      const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
      return { intent, confidence, reason };
    } catch {
      return {};
    }
  }
  return {};
};

export const routeCapabilityIntent = async ({
  text,
  hints = [],
  modelId = DEFAULT_MODEL_ID,
  skipModel = false,
}: CapabilityRouterParams): Promise<CapabilityRouterDecision> => {
  const heuristicDecision = evaluateCapabilityHeuristics({ text, hints });

  if (skipModel || heuristicDecision.confidence === 'high') {
    return {
      intent: heuristicDecision.intent,
      confidence: heuristicDecision.confidence,
      reason: heuristicDecision.reason,
      source: 'heuristic',
      heuristic: heuristicDecision,
    };
  }

  if (!text && hints.length === 0) {
    return {
      intent: heuristicDecision.intent,
      confidence: heuristicDecision.confidence,
      reason: heuristicDecision.reason,
      source: 'heuristic',
      heuristic: heuristicDecision,
    };
  }

  try {
    const classification = await generateText({
      model: modelId,
      system: CAPABILITY_ROUTER_PROMPT,
      prompt: buildRouterPromptInput(text, hints),
    });

    const raw = (classification?.text || '').trim();
    const parsed = parseModelDecision(raw);
    if (parsed.intent && parsed.confidence) {
      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        reason: parsed.reason || 'model-classification',
        source: 'model',
        heuristic: heuristicDecision,
        rawModelOutput: raw,
        modelId,
      };
    }

    return {
      intent: heuristicDecision.intent,
      confidence: heuristicDecision.confidence,
      reason: heuristicDecision.reason,
      source: 'heuristic',
      heuristic: heuristicDecision,
      rawModelOutput: raw,
      modelId,
    };
  } catch (error) {
    return {
      intent: heuristicDecision.intent,
      confidence: heuristicDecision.confidence,
      reason: heuristicDecision.reason,
      source: 'heuristic',
      heuristic: heuristicDecision,
      rawModelOutput: error instanceof Error ? error.message : String(error),
      modelId,
    };
  }
};
