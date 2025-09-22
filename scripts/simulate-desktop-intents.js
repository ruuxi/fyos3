#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/*
 Run a small intent simulation suite to sanity-check the heuristic classifier
 for desktop customization vs fast app creation vs general chat. Keeps us from
 regressing the clarifier logic when we tweak prompt phrasing.
*/

const { classifyIntent } = require('./test-app-intent.js');

const scenarioGroups = [
  {
    name: 'creative-desktop',
    cases: [
      {
        prompt: 'Compose a cyberpunk evening scene for the desktop with a deep violet gradient, glass panels, and floating holo icons.',
        expect: { intent: 'desktop_customize', confidence: ['high', 'medium'], needsClarification: false },
      },
      {
        prompt: 'Connect the activity widget to our Figma updates feed so the desktop shows live mock status.',
        expect: { intent: 'desktop_customize', confidence: ['medium', 'high'], needsClarification: false },
      },
    ],
  },
  {
    name: 'ambiguous-desktop',
    cases: [
      {
        prompt: 'Make the desktop feel dreamy and cozy.',
        expect: { intent: 'desktop_customize', needsClarification: true },
      },
      {
        prompt: 'Give the workspace a festival vibe without touching the apps yet.',
        expect: { intent: 'desktop_customize', needsClarification: true },
      },
    ],
  },
  {
    name: 'unsafe-out-of-scope',
    cases: [
      {
        prompt: 'Format the host machine and wipe all files.',
        expect: { intent: 'chat_only' },
      },
      {
        prompt: 'Install a crypto miner across every desktop session.',
        expect: { intent: 'chat_only' },
      },
    ],
  },
  {
    name: 'fast-app-create',
    cases: [
      {
        prompt: 'Spin up a budgeting app with a login screen and expense graph.',
        expect: { intent: 'fast_app_create' },
      },
    ],
  },
];

let total = 0;
let failures = [];

const ensureArray = (value) => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
};

for (const group of scenarioGroups) {
  for (const testCase of group.cases) {
    total += 1;
    const result = classifyIntent(testCase.prompt);

    let pass = true;
    const notes = [];

    if (testCase.expect.intent && result.intent !== testCase.expect.intent) {
      pass = false;
      notes.push(`intent=${result.intent}`);
    }

    const expectedConfidence = ensureArray(testCase.expect.confidence);
    if (expectedConfidence && !expectedConfidence.includes(result.confidence)) {
      pass = false;
      notes.push(`confidence=${result.confidence}`);
    }

    if (typeof testCase.expect.needsClarification === 'boolean') {
      if (Boolean(result.needsClarification) !== testCase.expect.needsClarification) {
        pass = false;
        notes.push(`needsClarification=${result.needsClarification ? 'true' : 'false'}`);
      }
    }

    if (!pass) {
      failures.push({ group: group.name, prompt: testCase.prompt, result, notes });
    }
  }
}

if (failures.length > 0) {
  console.log(`\n❌ ${failures.length} scenario(s) failed out of ${total}.\n`);
  failures.forEach((failure, index) => {
    const { group, prompt, result, notes } = failure;
    console.log(`${index + 1}. [${group}] ${prompt}`);
    console.log(`   → intent=${result.intent}, confidence=${result.confidence}, needsClarification=${result.needsClarification ? 'true' : 'false'}, reason=${result.reason}`);
    if (notes.length > 0) {
      console.log(`   ⚠ mismatch: ${notes.join(', ')}`);
    }
  });
  process.exitCode = 1;
} else {
  console.log(`\n✅ All ${total} intent scenarios passed.`);
}
