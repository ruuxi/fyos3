#!/usr/bin/env node
// Materialize src/data/webcontainer-files.ts to a temp folder and run ESLint
// so you can catch syntax errors in the embedded code strings.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SRC_FILE = path.join(repoRoot, 'src', 'data', 'webcontainer-files.ts');
const TMP_DIR = path.join(repoRoot, '.tmp');
const OUT_JS = path.join(TMP_DIR, 'webcontainer-files.cjs');
const OUT_FS = path.join(TMP_DIR, 'webcontainer-check');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeTsToCjs(tsCode) {
  let code = tsCode.toString();
  // Drop type-only imports and exports
  code = code.replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, '');
  // Remove inline type assertions like `as FileSystemTree`
  code = code.replace(/\s+as\s+[A-Za-z0-9_<>.,\s]+/g, '');
  // Transform `export const files: FileSystemTree =` to `module.exports =`
  code = code.replace(/export\s+const\s+files\s*:?\s*[^=]*=/, 'module.exports =');
  return code;
}

async function writeTreeToDisk(tree, baseDir) {
  for (const [name, node] of Object.entries(tree)) {
    if ('file' in node) {
      const p = path.join(baseDir, name);
      ensureDirSync(path.dirname(p));
      await fsp.writeFile(p, node.file.contents, 'utf8');
    } else if ('directory' in node) {
      const dirPath = path.join(baseDir, name);
      ensureDirSync(dirPath);
      await writeTreeToDisk(node.directory, dirPath);
    }
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`Cannot find ${path.relative(repoRoot, SRC_FILE)}`);
    process.exit(1);
  }

  ensureDirSync(TMP_DIR);
  ensureDirSync(OUT_FS);

  const tsCode = await fsp.readFile(SRC_FILE, 'utf8');
  const cjsCode = sanitizeTsToCjs(tsCode);
  await fsp.writeFile(OUT_JS, cjsCode, 'utf8');

  const requireCjs = createRequire(import.meta.url);
  const files = requireCjs(OUT_JS); // cjs export
  // Clear output fs
  await fsp.rm(OUT_FS, { recursive: true, force: true });
  ensureDirSync(OUT_FS);

  await writeTreeToDisk(files, OUT_FS);

  console.log(`Wrote WebContainer tree to ${path.relative(repoRoot, OUT_FS)}`);

  // Run ESLint against the materialized files
  try {
    await run('pnpm', ['exec', 'eslint', OUT_FS, '--ext', '.js,.jsx,.ts,.tsx']);
    console.log('ESLint completed with no errors.');
  } catch (error) {
    console.error('ESLint reported issues. Review the output above.', error);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
