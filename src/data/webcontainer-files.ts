// Generated at runtime to support scripts/verify-webcontainer.mjs
// Creates a file tree representation of templates/webcontainer with text files only.

const nodeRequire = (globalThis as any).require ?? eval('require');

const fs = nodeRequire('node:fs') as typeof import('node:fs');
const path = nodeRequire('node:path') as typeof import('node:path');

type TreeNode =
  | { file: { contents: string } }
  | { directory: Record<string, TreeNode> };

type FileTree = Record<string, TreeNode>;

const TEMPLATE_ROOT = path.join(process.cwd(), 'templates', 'webcontainer');
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.txt',
  '.md',
  '.yaml',
  '.yml',
  '.cjs',
  '.mjs',
  '.svg',
]);

export const files: FileTree = buildTree(TEMPLATE_ROOT);

function buildTree(root: string): FileTree {
  const tree: FileTree = {};
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return tree;
  }

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const directory = buildTree(fullPath);
      tree[entry.name] = { directory };
    } else if (entry.isFile() && isTextFile(entry.name)) {
      tree[entry.name] = { file: { contents: readTextFile(fullPath) } };
    }
  }

  return tree;
}

function shouldIgnore(name: string): boolean {
  if (name === 'node_modules' || name === '.pnpm-store' || name === '.turbo') return true;
  if (name === 'dist' || name === '.next' || name === '.git') return true;
  return false;
}

function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.bin' || ext === '.webp' || ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    return false;
  }
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Include lockfiles and git metadata without extensions
  if (filename === '.gitignore' || filename === '.npmrc' || filename === 'pnpm-lock.yaml') return true;
  return false;
}

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

