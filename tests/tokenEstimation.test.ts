import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateTokensFromText,
  estimateTokensFromJson,
  estimateToolCallUsage,
  estimateCostUSD,
  mergeUsageEstimates,
  toUsageEstimates,
  getUsageCostBreakdown,
} from '@/lib/agent/metrics/tokenEstimation';

test('estimateTokensFromText enforces minimum token count', () => {
  const { tokens } = estimateTokensFromText('hi');
  assert.equal(tokens, 1);
});

test('estimateTokensFromText respects configured ratio', () => {
  const { tokens } = estimateTokensFromText('a'.repeat(40));
  assert.equal(tokens, 10);
});

test('estimateTokensFromJson handles objects', () => {
  const sample = { foo: 'bar', count: 12 };
  const { tokens, charCount } = estimateTokensFromJson(sample);
  assert.ok(tokens >= 2, 'expected serialized object to require >= 2 tokens');
  assert.ok(charCount > 0);
});

test('estimateToolCallUsage aggregates prompt and result tokens', () => {
  const { usage } = estimateToolCallUsage({ input: 'console.log("hi")' }, { result: 'ok' });
  assert.ok((usage.promptTokens ?? 0) > 0);
  assert.ok((usage.completionTokens ?? 0) > 0);
  assert.equal(usage.totalTokens, (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
});

test('estimateCostUSD uses pricing map', () => {
  const usage = toUsageEstimates(1000, 500);
  const cost = estimateCostUSD(usage);
  assert.equal(Number(cost.toFixed(6)), Number((((1000 + 500) / 1_000_000) * 2).toFixed(6)));
});

test('getUsageCostBreakdown exposes prompt and completion costs', () => {
  const usage = toUsageEstimates(2000, 1000);
  const breakdown = getUsageCostBreakdown(usage, 'openai/gpt-5');
  const expectedPrompt = (2000 / 1_000_000) * 5;
  const expectedCompletion = (1000 / 1_000_000) * 15;

  assert.equal(breakdown.promptCostUSD, expectedPrompt);
  assert.equal(breakdown.completionCostUSD, expectedCompletion);
  assert.equal(breakdown.totalCostUSD, expectedPrompt + expectedCompletion);
});

test('mergeUsageEstimates accumulates token fields', () => {
  const base = toUsageEstimates(100, 50, { reasoningTokens: 10 });
  const next = toUsageEstimates(25, 25, { reasoningTokens: 5, charCount: 123 });
  const merged = mergeUsageEstimates(base, next);
  assert.equal(merged.promptTokens, 125);
  assert.equal(merged.completionTokens, 75);
  assert.equal(merged.totalTokens, 200);
  assert.equal(merged.reasoningTokens, 15);
  assert.equal(merged.charCount, 123);
});
