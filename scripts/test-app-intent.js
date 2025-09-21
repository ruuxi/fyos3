#!/usr/bin/env node
/*
 Quick classifier test for the app-build heuristic.
 Mirrors the client/server logic so you can validate decisions quickly.
*/

// Negative intents we never want to classify as app-builds
const NON_APP_CONTENT_REGEX = /(poem|poetry|story|essay|email|message|note|lyrics|song|music|melody|image|picture|photo|art|video|animation|tweet|post|bio|joke|summary|summar(?:y|ise|ize)|article|blog|outline|script|recipe|caption|code snippet)/i;
// Require an app-like noun close (within ~6 words) to the verb
const CREATE_APP_REGEX = /\b(build|create|scaffold|make|generate|spin\s*up|draft)\b(?:\s+\w+){0,6}?\s+\b(app|apps|application|applications|project|site|website|web\s*app|ui)\b/i;
// Also allow explicit short forms like "new app"
const NEW_APP_REGEX = /\bnew\s+(app|apps|application|applications)\b/i;

function classify(text) {
  const input = String(text || '').trim();
  if (!input) return { build: false, reason: 'empty' };
  if (NON_APP_CONTENT_REGEX.test(input)) return { build: false, reason: 'non-app-content' };
  if (CREATE_APP_REGEX.test(input)) return { build: true, reason: 'create-app-proximity' };
  if (NEW_APP_REGEX.test(input)) return { build: true, reason: 'explicit-new-app' };
  return { build: false, reason: 'no-app-signal' };
}

function formatResult(text, result) {
  const verdict = result.build ? 'BUILD APP' : "DON'T BUILD";
  return `- ${verdict} | ${result.reason} | ${text}`;
}

const DEFAULT_PROMPTS = [
  // Should NOT build
  'Create a poem for me about the ocean',
  'Make a song in the style of lo-fi',
  'Generate an image of a sunset over mountains',
  'Write an email to my team about the release',
  'Draft a short story about time travel',
  'Summarize this article about web performance',
  'Create a video concept for a launch',

  // Should build
  'Create a new app for tracking tasks',
  'Build a simple website that shows my portfolio',
  'Scaffold a web app with a login page',
  'Generate a project to visualize CSV data',
  'Spin up an application that fetches weather data',
  'Make a UI for editing markdown files',
  'New app to explore photos by tag',
  'Draft a site with a landing page and blog',
];

function runWithDefaults() {
  console.log('Testing default sample prompts:');
  DEFAULT_PROMPTS.forEach((p) => {
    const r = classify(p);
    console.log(formatResult(p, r));
  });
}

function runWithArgs(args) {
  args.forEach((p) => {
    const r = classify(p);
    console.log(formatResult(p, r));
  });
}

function runWithStdin() {
  const lines = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    lines.push(chunk);
  });
  process.stdin.on('end', () => {
    const text = lines.join('');
    const prompts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    prompts.forEach((p) => {
      const r = classify(p);
      console.log(formatResult(p, r));
    });
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 && process.stdin.isTTY) {
    runWithDefaults();
  } else if (args.length > 0) {
    runWithArgs(args);
  } else {
    runWithStdin();
  }
}

if (require.main === module) {
  main();
}

module.exports = { classify };

