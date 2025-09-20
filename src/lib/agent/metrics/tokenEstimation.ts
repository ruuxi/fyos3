import type { AgentUsageEstimates } from './types';

type ModelEstimationConfig = {
  charsPerToken?: number;
  promptCostPerMillion?: number;
  completionCostPerMillion?: number;
};

const DEFAULT_CONFIG: Required<ModelEstimationConfig> = {
  charsPerToken: 4,
  promptCostPerMillion: 2,
  completionCostPerMillion: 2,
};

const MODEL_OVERRIDES: Record<string, ModelEstimationConfig> = {
  'alibaba/qwen3-coder': {
    promptCostPerMillion: 2,
    completionCostPerMillion: 2,
  },
  'google/gemini-2.0-flash': {
    promptCostPerMillion: 0.1,
    completionCostPerMillion: 0.4,
  },
  'openai/gpt-5': {
    promptCostPerMillion: 5,
    completionCostPerMillion: 15,
  },
};

const envCharPerToken = (() => {
  const raw = process.env.AGENT_CHARS_PER_TOKEN_DEFAULT;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
})();

function getConfigForModel(model?: string): Required<ModelEstimationConfig> {
  const override = model ? MODEL_OVERRIDES[model] : undefined;
  return {
    charsPerToken: override?.charsPerToken ?? envCharPerToken ?? DEFAULT_CONFIG.charsPerToken,
    promptCostPerMillion: override?.promptCostPerMillion ?? DEFAULT_CONFIG.promptCostPerMillion,
    completionCostPerMillion: override?.completionCostPerMillion ?? DEFAULT_CONFIG.completionCostPerMillion,
  };
}

export function estimateTokensFromText(text: string, model?: string) {
  const config = getConfigForModel(model);
  const charCount = text.length;
  const tokens = charCount === 0 ? 0 : Math.max(1, Math.ceil(charCount / config.charsPerToken));
  return { tokens, charCount };
}

export function estimateTokensFromJson(value: unknown, model?: string) {
  let serialized = '';
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value ?? null);
    } catch {
      serialized = '';
    }
  }
  return estimateTokensFromText(serialized, model);
}

export function toUsageEstimates(
  promptTokens: number,
  completionTokens: number,
  extra?: Partial<AgentUsageEstimates>
): AgentUsageEstimates {
  const total = promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: total,
    ...extra,
  };
}

export function estimateToolCallUsage(
  input: unknown,
  output: unknown,
  model?: string,
): { usage: AgentUsageEstimates; inputCharCount: number; outputCharCount: number } {
  const inputEstimate = estimateTokensFromJson(input, model);
  const outputEstimate = estimateTokensFromJson(output, model);
  return {
    usage: toUsageEstimates(inputEstimate.tokens, outputEstimate.tokens, {
      charCount: inputEstimate.charCount + outputEstimate.charCount,
    }),
    inputCharCount: inputEstimate.charCount,
    outputCharCount: outputEstimate.charCount,
  };
}

export function estimateCostUSD(usage: AgentUsageEstimates, model?: string): number {
  const config = getConfigForModel(model);
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const promptCost = (promptTokens / 1_000_000) * config.promptCostPerMillion;
  const completionCost = (completionTokens / 1_000_000) * config.completionCostPerMillion;
  return Number((promptCost + completionCost).toFixed(6));
}

export function mergeUsageEstimates(base: AgentUsageEstimates, next: AgentUsageEstimates): AgentUsageEstimates {
  return {
    promptTokens: (base.promptTokens ?? 0) + (next.promptTokens ?? 0),
    completionTokens: (base.completionTokens ?? 0) + (next.completionTokens ?? 0),
    totalTokens: (base.totalTokens ?? 0) + (next.totalTokens ?? 0),
    reasoningTokens: (base.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    cachedInputTokens: (base.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
    charCount: (base.charCount ?? 0) + (next.charCount ?? 0),
  };
}
