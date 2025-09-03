#!/usr/bin/env node
// Extract pnpm-lock.yaml from running Next.js dev server's WebContainer
// This script calls the /api/extract-lockfile endpoint

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const TEMPLATES_DIR = path.join(repoRoot, 'templates', 'webcontainer');
const LOCKFILE_PATH = path.join(TEMPLATES_DIR, 'pnpm-lock.yaml');

async function extractLockfile() {
  console.log('📡 Instructions for extracting lockfile from WebContainer:');
  console.log('');
  console.log('1. Make sure your Next.js dev server is running (`pnpm dev`)');
  console.log('2. Open http://localhost:3000 in your browser');
  console.log('3. Wait for the WebContainer to fully load and install dependencies');
  console.log('4. Look for the "Extract Lockfile" button on the page and click it');
  console.log('5. The pnpm-lock.yaml will be automatically saved to templates/webcontainer/');
  console.log('');
  console.log('Alternatively, you can manually trigger the extraction by visiting:');
  console.log('http://localhost:3000 and using the browser developer console to run:');
  console.log('');
  console.log('```javascript');
  console.log('// In browser console after WebContainer is loaded:');
  console.log('const instance = window.webcontainerInstance; // assuming you expose it');
  console.log('const lockfile = await instance.fs.readFile("pnpm-lock.yaml");');
  console.log('const content = new TextDecoder().decode(lockfile);');
  console.log('await fetch("/api/extract-lockfile", {');
  console.log('  method: "POST",');
  console.log('  headers: { "Content-Type": "application/json" },');
  console.log('  body: JSON.stringify({ lockfileContent: content })');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('The ExtractLockfileButton component has been added to help with this process.');
}

extractLockfile().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
