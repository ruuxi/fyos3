#!/usr/bin/env node
// One-time migration: extract src/data/webcontainer-files.ts into
// templates/webcontainer/ as real files (preferring .tsx over .jsx).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SRC_FILE = path.join(repoRoot, 'src', 'data', 'webcontainer-files.ts');
const TMP_DIR = path.join(repoRoot, '.tmp');
const OUT_JS = path.join(TMP_DIR, 'webcontainer-files.cjs');
const TEMPLATES_DIR = path.join(repoRoot, 'templates', 'webcontainer');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeTsToCjs(tsCode) {
  let code = tsCode.toString();
  code = code.replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, '');
  code = code.replace(/\s+as\s+[A-Za-z0-9_<>.,\s]+/g, '');
  code = code.replace(/export\s+const\s+files\s*:?\s*[^=]*=/, 'module.exports =');
  return code;
}

function renameToTsx(name) {
  return name.endsWith('.jsx') ? name.replace(/\.jsx$/, '.tsx') : name;
}

function adjustContentForPath(p, content) {
  // Fix index.html entrypoint reference if present
  if (p === 'index.html') {
    return content.replace('/src/main.jsx', '/src/main.tsx');
  }
  // Adjust registry.json app paths to .tsx
  if (p === path.join('apps', 'registry.json')) {
    try {
      const arr = JSON.parse(content);
      for (const item of arr) {
        if (typeof item.path === 'string') {
          item.path = item.path.replace(/index\.jsx$/, 'index.tsx');
        }
      }
      return JSON.stringify(arr, null, 2);
    } catch {
      // fallback: best-effort text replace
      return content.replace(/index\.jsx/g, 'index.tsx');
    }
  }
  // Fix JSX with leading '>' token in Terminal app
  if (p.endsWith(path.join('app-00000000-0000-0000-0000-000000000004', 'index.tsx'))) {
    return content.replace(/>\s*\{l\}\<\/div\>/, '{\'>\'} {l}</div>');
  }
  return content;
}

async function writeTree(tree, baseDir, parentRel = '') {
  for (const [name, node] of Object.entries(tree)) {
    if ('file' in node) {
      const origRel = path.join(parentRel, name);
      const rel = renameToTsx(origRel);
      const dest = path.join(baseDir, rel);
      ensureDirSync(path.dirname(dest));
      const adjusted = adjustContentForPath(rel, node.file.contents);
      await fsp.writeFile(dest, adjusted, 'utf8');
    } else if ('directory' in node) {
      const dirRel = path.join(parentRel, name);
      await writeTree(node.directory, baseDir, dirRel);
    }
  }
}

async function main() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`Cannot find ${path.relative(repoRoot, SRC_FILE)}`);
    process.exit(1);
  }
  ensureDirSync(TMP_DIR);
  ensureDirSync(TEMPLATES_DIR);

  const tsCode = await fsp.readFile(SRC_FILE, 'utf8');
  const cjsCode = sanitizeTsToCjs(tsCode);
  await fsp.writeFile(OUT_JS, cjsCode, 'utf8');
  const requireCjs = createRequire(import.meta.url);
  const files = requireCjs(OUT_JS);

  // Clear templates dir before writing
  await fsp.rm(TEMPLATES_DIR, { recursive: true, force: true });
  ensureDirSync(TEMPLATES_DIR);
  await writeTree(files, TEMPLATES_DIR);
  console.log(`Migrated files to ${path.relative(repoRoot, TEMPLATES_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

