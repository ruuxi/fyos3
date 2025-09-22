import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAgentIntent, normalizeClientIntent } from '@/app/api/agent/route';

test('normalizeClientIntent maps known aliases', () => {
  assert.equal(normalizeClientIntent('create-app'), 'create');
  assert.equal(normalizeClientIntent('desktop_customize'), 'desktop');
  assert.equal(normalizeClientIntent('media'), 'media');
  assert.equal(normalizeClientIntent('edit'), 'edit');
  assert.equal(normalizeClientIntent('unknown'), undefined);
});

test('deriveAgentIntent prefers client-provided non-edit intent', () => {
  const result = deriveAgentIntent({
    clientIntent: 'media',
    lastUserText: 'just chatting',
    hints: [],
  });
  assert.equal(result.intent, 'media');
  assert.equal(result.source, 'client');
});

test('deriveAgentIntent detects create requests from text when no client intent', () => {
  const result = deriveAgentIntent({
    clientIntent: undefined,
    lastUserText: 'please create a productivity app with timers',
    hints: [],
  });
  assert.equal(result.intent, 'create');
});

test('deriveAgentIntent flags media intents for attachments with media verbs', () => {
  const result = deriveAgentIntent({
    clientIntent: undefined,
    lastUserText: 'remix the attached photo with a watercolor style',
    hints: [{ contentType: 'image/png', url: 'https://example.com/photo.png' }],
  });
  assert.equal(result.intent, 'media');
  assert.equal(result.source, 'heuristic-media');
});

test('deriveAgentIntent identifies desktop customization language', () => {
  const result = deriveAgentIntent({
    clientIntent: undefined,
    lastUserText: 'change the desktop background to a neon grid and refresh the layout',
    hints: [],
  });
  assert.equal(result.intent, 'desktop');
});

test('deriveAgentIntent defaults to edit when no clues are present', () => {
  const result = deriveAgentIntent({
    clientIntent: undefined,
    lastUserText: 'can you review the code?',
    hints: [],
  });
  assert.equal(result.intent, 'edit');
});

test('deriveAgentIntent honors capability router factual bucket', () => {
  const result = deriveAgentIntent({
    clientIntent: undefined,
    lastUserText: 'what is the weather in sf right now?',
    hints: [],
    capabilityIntent: 'factual_lookup',
  });
  assert.equal(result.intent, 'edit');
  assert.equal(result.source, 'capability-router');
  assert.equal(result.reason, 'capability:factual_lookup');
});
