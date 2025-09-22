import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCapabilityHeuristics } from '@/lib/agent/intents/capabilityHeuristics';

test('heuristics route factual lookup for direct weather question', () => {
  const decision = evaluateCapabilityHeuristics({
    text: "what's the weather in tokyo right now?",
    hints: [],
  });
  assert.equal(decision.intent, 'factual_lookup');
});

test('heuristics prefer build_edit for weather app request', () => {
  const decision = evaluateCapabilityHeuristics({
    text: 'please make a simple weather app with hourly forecast',
    hints: [],
  });
  assert.equal(decision.intent, 'build_edit');
});

test('media attachments tilt decision toward media intent', () => {
  const decision = evaluateCapabilityHeuristics({
    text: 'give this photo a watercolor style',
    hints: [{ contentType: 'image/png', url: 'https://example.com/photo.png' }],
  });
  assert.equal(decision.intent, 'media');
});
