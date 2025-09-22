import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemPrompt, resolveSystemPromptSegments, SYSTEM_PROMPT } from '@/lib/prompts';

test('buildSystemPrompt includes create intent guidance and omits media content', () => {
  const prompt = buildSystemPrompt({ intent: 'create' });
  assert.match(prompt, /## Creating New Apps/);
  assert.doesNotMatch(prompt, /## Media Generation/);
});

test('edit intent excludes attachment guidance unless attachments provided', () => {
  const prompt = buildSystemPrompt({ intent: 'edit' });
  assert.doesNotMatch(prompt, /## Attachments & AI Generation Strategy/);

  const withAttachments = buildSystemPrompt({ intent: 'edit', hasAttachments: true });
  assert.match(withAttachments, /## Attachments & AI Generation Strategy/);
});

test('media intent always includes attachment guidance', () => {
  const prompt = buildSystemPrompt({ intent: 'media' });
  assert.match(prompt, /## Attachments & AI Generation Strategy/);
  assert.match(prompt, /## Media Generation/);
  assert.doesNotMatch(prompt, /## Creating New Apps/);
});

test('installed apps list is capped at ten entries with overflow marker', () => {
  const installed = Array.from({ length: 12 }, (_, index) => `App ${index + 1}`);
  const segments = resolveSystemPromptSegments({ intent: 'edit', installedApps: installed });
  const contextSegment = segments.find((segment) => segment.id === 'context:installed-apps');
  assert.ok(contextSegment, 'expected installed apps segment to be present');
  const lines = contextSegment!.content.split('\n').slice(1); // drop heading
  assert.equal(lines.length, 11);
  assert.ok(lines.includes('- App 10'), 'expected the tenth app to be present');
  assert.ok(!lines.some((line) => line.includes('App 11')), 'expected apps past the limit to be omitted');
  assert.equal(lines[lines.length - 1], '- …');
});

test('SYSTEM_PROMPT matches edit intent legacy shim', () => {
  const legacy = buildSystemPrompt({ intent: 'edit', hasAttachments: true });
  assert.equal(SYSTEM_PROMPT, legacy);
});
