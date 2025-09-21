import { TFastAppCreateInput } from '@/lib/agentTools';

export type FastAppCreateRequest = TFastAppCreateInput;

export type FastAppCreateFileEntry = {
  path: string;
  content: string;
};

export type FastAppCreateMirror = {
  base: string;
  registry?: string;
  files: FastAppCreateFileEntry[];
};

export type FastAppCreateSuccess = {
  ok: true;
  id: string;
  name: string;
  icon: string;
  base: string;
  createdAt: number;
  createdFiles: string[];
  mirror: FastAppCreateMirror;
};

export type FastAppCreateFailure = {
  ok: false;
  error: string;
};

export type FastAppCreateResult = FastAppCreateSuccess | FastAppCreateFailure;

export type FastAppCreateFs = {
  mkdirp: (path: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
};

export type FastAppCreateOptions = {
  input: FastAppCreateRequest;
  fs: FastAppCreateFs;
  appsRoot?: string;
  registryPath?: string;
  now?: () => number;
};

const DEFAULT_APPS_ROOT = 'src/apps';
const DEFAULT_REGISTRY_PATH = 'public/apps/registry.json';

const DEFAULT_STYLES = `/* App-specific theme variables */
:root {
  --app-accent: #22c55e;
  --app-secondary: #64748b;
  --app-background: #ffffff;
  --app-surface: #f8fafc;
  --app-border: #e2e8f0;
  --app-text: #1e293b;
  --app-text-muted: #64748b;
  --app-hover: #16a34a;
}

/* Base app styling */
body {
  font-family: Inter, ui-sans-serif, system-ui, Arial, sans-serif;
}

/* App-specific utility classes */
.app-button {
  background: var(--app-accent);
  color: white;
  transition: all 0.2s ease;
}

.app-button:hover {
  background: var(--app-hover);
  transform: translateY(-1px);
}

.app-surface {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}

/* Links */
a {
  color: var(--app-accent);
  text-decoration: none;
}

a:hover {
  color: var(--app-hover);
  text-decoration: underline;
}
`;

const buildDefaultIndex = (appName: string) => `import React from 'react'
import '/src/tailwind.css'
import './styles.css'

export default function App() {
  return (
    <div className="h-full overflow-auto bg-gradient-to-b from-white to-slate-50">
      <div className="sticky top-0 bg-white/80 backdrop-blur border-b px-3 py-2">
        <div className="font-semibold tracking-tight">${appName}</div>
      </div>
      <div className="p-3 space-y-3">
        <div className="rounded-lg border bg-white shadow-sm p-3">
          <p className="text-slate-600 text-sm">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>
        </div>
      </div>
    </div>
  )
}
`;

const joinPaths = (...segments: string[]): string => {
  const cleaned = segments
    .filter((segment) => typeof segment === 'string')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => {
      const stripped = segment.replace(/^\/+/, '').replace(/\/+$/, '');
      if (index === 0 && segment.startsWith('/')) {
        return `/${stripped}`;
      }
      return stripped;
    })
    .filter(Boolean);

  if (cleaned.length === 0) return '';

  const [first, ...rest] = cleaned;
  const prefix = first.startsWith('/') ? first : first.replace(/^\/+/, '');
  const restJoined = rest.map((part) => part.replace(/^\/+/, '')).join('/');
  return restJoined ? `${prefix}/${restJoined}` : prefix;
};

const getDirname = (value: string): string => {
  const normalized = value.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '';
  return normalized.slice(0, index);
};

const normalizeRelativePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('File path cannot be empty.');
  }
  const cleaned = trimmed.replace(/^\.\/+/, '').replace(/^\/+/, '');
  const segments = cleaned.split('/');
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error(`Invalid file path segment: ${value}`);
    }
    stack.push(segment);
  }

  if (stack.length === 0) {
    throw new Error(`Invalid file path: ${value}`);
  }

  return stack.join('/');
};

const parseRegistry = (raw: string | undefined | null) => {
  if (!raw) return [] as Array<{ id: string; name: string; icon?: string; path: string }>;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.path === 'string');
    }
  } catch {}
  return [] as Array<{ id: string; name: string; icon?: string; path: string }>;
};

export async function performFastAppCreate(options: FastAppCreateOptions): Promise<FastAppCreateResult> {
  const { input, fs, appsRoot = DEFAULT_APPS_ROOT, registryPath = DEFAULT_REGISTRY_PATH, now = () => Date.now() } = options;

  try {
    const safeName = input.name.trim();
    const safeId = input.id.trim();
    const safeIcon = input.icon?.trim() || '📦';

    const registryRaw = await fs.readFile(registryPath).catch(() => '');
    const registry = parseRegistry(registryRaw);

    const existingNames = new Set(registry.map((entry) => entry.name));
    const existingIds = new Set(registry.map((entry) => entry.id));

    let finalName = safeName;
    let nameCounter = 1;
    while (existingNames.has(finalName)) {
      finalName = `${safeName} (${nameCounter})`;
      nameCounter += 1;
    }

    let finalId = safeId;
    let idCounter = 1;
    while (existingIds.has(finalId)) {
      finalId = `${safeId}-${idCounter}`;
      idCounter += 1;
    }

    const appBase = normalizeRelativePath(joinPaths(appsRoot, finalId));
    await fs.mkdirp(appBase);

    const createdAt = now();
    const metadata = { id: finalId, name: finalName, icon: safeIcon, createdAt } as const;
    const metadataContent = `${JSON.stringify(metadata, null, 2)}\n`;

    const requestedFiles = Array.isArray(input.files) ? [...input.files] : [];
    const normalizedFiles = requestedFiles.map((file) => ({
      path: normalizeRelativePath(file.path),
      content: file.content,
    }));

    const hasIndex = normalizedFiles.some((file) => file.path === 'index.tsx');
    const hasStyles = normalizedFiles.some((file) => file.path === 'styles.css');

    if (!hasStyles) {
      normalizedFiles.unshift({ path: 'styles.css', content: DEFAULT_STYLES });
    }
    if (!hasIndex) {
      normalizedFiles.unshift({ path: 'index.tsx', content: buildDefaultIndex(finalName) });
    }

    const createdFiles: string[] = [];
    const mirrorFiles: FastAppCreateFileEntry[] = [];

    const writeAppFile = async (relativePath: string, content: string) => {
      const normalized = normalizeRelativePath(relativePath);
      if (normalized === 'metadata.json') {
        throw new Error('metadata.json is reserved for internal use.');
      }
      const fullPath = normalizeRelativePath(joinPaths(appBase, normalized));
      const dir = getDirname(fullPath);
      if (dir) {
        await fs.mkdirp(dir);
      }
      await fs.writeFile(fullPath, content);
      createdFiles.push(normalized);
      mirrorFiles.push({ path: normalized, content });
    };

    const metadataPath = normalizeRelativePath(joinPaths(appBase, 'metadata.json'));
    await fs.mkdirp(appBase);
    await fs.writeFile(metadataPath, metadataContent);
    createdFiles.unshift('metadata.json');
    mirrorFiles.unshift({ path: 'metadata.json', content: metadataContent });

    for (const file of normalizedFiles) {
      await writeAppFile(file.path, file.content);
    }

    const registryEntry = {
      id: finalId,
      name: finalName,
      icon: safeIcon,
      path: `/${normalizeRelativePath(joinPaths(appBase, 'index.tsx'))}`,
    };

    const nextRegistry = [...registry, registryEntry];
    const registryJson = `${JSON.stringify(nextRegistry, null, 2)}\n`;
    const registryDir = getDirname(registryPath);
    if (registryDir) {
      await fs.mkdirp(registryDir);
    }
    await fs.writeFile(registryPath, registryJson);

    const mirror: FastAppCreateMirror = {
      base: appBase,
      registry: registryJson,
      files: mirrorFiles,
    };

    return {
      ok: true,
      id: finalId,
      name: finalName,
      icon: safeIcon,
      base: appBase,
      createdAt,
      createdFiles,
      mirror,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
