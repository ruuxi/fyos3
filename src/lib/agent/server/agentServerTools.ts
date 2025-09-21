import { tool } from 'ai';
import { promises as fs } from 'fs';
import path from 'path';
import Exa, { type ExaSearchOptions, type ExaSearchResult } from 'exa-js';
import { agentLogger } from '@/lib/agentLogger';
import { TOOL_NAMES, WebSearchInput, FastAppCreateInput } from '@/lib/agentTools';

export function buildServerTools(sessionId: string) {
  return {
    [TOOL_NAMES.web_search]: tool({
      description: 'Search the web for current information. ONLY use when the user explicitly requests web search or real-time data—do not use proactively.',
      inputSchema: WebSearchInput,
      async execute({ query }) {
        const startTime = Date.now();
        const toolCallId = `search_${Date.now()}`;
        try {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            const error = { error: 'Missing EXA_API_KEY in environment.' };
            await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
            return error;
          }
          const exa = new Exa(apiKey);
          const options: ExaSearchOptions = { livecrawl: 'always', numResults: 3 };
          const { results } = await exa.searchAndContents(query, options);
          const entries: ExaSearchResult[] = Array.isArray(results) ? results : [];
          const output = entries.map((r) => ({
            title: typeof r.title === 'string' ? r.title : undefined,
            url: typeof r.url === 'string' ? r.url : undefined,
            content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined,
            publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : undefined,
          }));
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, { results: output.length, data: output }, Date.now() - startTime);
          return output;
        } catch (err: unknown) {
          const error = { error: err instanceof Error ? err.message : String(err) };
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
          return error;
        }
      },
    }),
    [TOOL_NAMES.fast_app_create]: tool({
      description: 'Create a new app by batching metadata/registry updates and optional file writes server-side. Keeps initial scaffolds fast.',
      inputSchema: FastAppCreateInput,
      async execute(input) {
        const startTime = Date.now();
        const toolCallId = `fast_create_${Date.now()}`;

        const log = async (payload: unknown) => {
          try {
            await agentLogger.logToolCall(sessionId, TOOL_NAMES.fast_app_create, toolCallId, input, payload, Date.now() - startTime);
          } catch {}
        };

        try {
          const cwd = process.cwd();
          const appsRoot = path.join(cwd, 'src', 'apps');
          const registryPath = path.join(cwd, 'public', 'apps', 'registry.json');

          const safeName = input.name.trim();
          const safeId = input.id.trim();
          const safeIcon = input.icon?.trim() || '📦';

          let registry: Array<{ id: string; name: string; icon?: string; path: string }> = [];
          try {
            const raw = await fs.readFile(registryPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              registry = parsed.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string');
            }
          } catch {}

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

          const appBase = path.join(appsRoot, finalId);
          const normalizedBase = path.normalize(appBase);
          if (!normalizedBase.startsWith(path.normalize(appsRoot))) {
            throw new Error('Resolved app path escapes workspace.');
          }

          await fs.mkdir(appBase, { recursive: true });

          const createdAt = Date.now();
          const metadata = { id: finalId, name: finalName, icon: safeIcon, createdAt } as const;
          const metadataPath = path.join(appBase, 'metadata.json');
          await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');

          const normalizeRelativePath = (value: string): string => {
            const trimmed = value.trim();
            if (!trimmed) {
              throw new Error('File path cannot be empty.');
            }
            const withoutLeading = trimmed.replace(/^\.\/+/, '').replace(/^\/+/, '');
            const normalized = path.normalize(withoutLeading);
            if (normalized.includes('..')) {
              throw new Error(`Invalid file path: ${value}`);
            }
            if (!normalized || normalized === '.' || normalized === '') {
              throw new Error(`Invalid file path: ${value}`);
            }
            return normalized;
          };

          const defaultIndex = `import React from 'react'\nimport '/src/tailwind.css'\nimport './styles.css'\n\nexport default function App() {\n  return (\n    <div className=\"h-full overflow-auto bg-gradient-to-b from-white to-slate-50\">\n      <div className=\"sticky top-0 bg-white/80 backdrop-blur border-b px-3 py-2\">\n        <div className=\"font-semibold tracking-tight\">${finalName}</div>\n      </div>\n      <div className=\"p-3 space-y-3\">\n        <div className=\"rounded-lg border bg-white shadow-sm p-3\">\n          <p className=\"text-slate-600 text-sm\">This is a new app. Build your UI here. The container fills the window and scrolls as needed.</p>\n        </div>\n      </div>\n    </div>\n  )\n}\n`;

          const defaultStyles = `/* App-specific theme variables */\n:root {\n  --app-accent: #22c55e;\n  --app-secondary: #64748b;\n  --app-background: #ffffff;\n  --app-surface: #f8fafc;\n  --app-border: #e2e8f0;\n  --app-text: #1e293b;\n  --app-text-muted: #64748b;\n  --app-hover: #16a34a;\n}\n\n/* Base app styling */\nbody {\n  font-family: Inter, ui-sans-serif, system-ui, Arial, sans-serif;\n}\n\n/* App-specific utility classes */\n.app-button {\n  background: var(--app-accent);\n  color: white;\n  transition: all 0.2s ease;\n}\n\n.app-button:hover {\n  background: var(--app-hover);\n  transform: translateY(-1px);\n}\n\n.app-surface {\n  background: var(--app-surface);\n  border: 1px solid var(--app-border);\n}\n\n/* Links */\na {\n  color: var(--app-accent);\n  text-decoration: none;\n}\n\n.a:hover {\n  color: var(--app-hover);\n  text-decoration: underline;\n}\n`;

          const requestedFiles = Array.isArray(input.files) ? [...input.files] : [];
          const normalizedFiles = requestedFiles.map((file) => ({
            path: normalizeRelativePath(file.path),
            content: file.content,
          }));

          const hasIndex = normalizedFiles.some((file) => file.path === 'index.tsx');
          const hasStyles = normalizedFiles.some((file) => file.path === 'styles.css');

          if (!hasIndex) {
            normalizedFiles.unshift({ path: 'index.tsx', content: defaultIndex });
          }
          if (!hasStyles) {
            normalizedFiles.unshift({ path: 'styles.css', content: defaultStyles });
          }

          const createdFiles: string[] = ['metadata.json'];

          for (const file of normalizedFiles) {
            if (file.path === 'metadata.json') continue;
            const absolutePath = path.join(appBase, file.path);
            const normalizedAbsolute = path.normalize(absolutePath);
            if (!normalizedAbsolute.startsWith(normalizedBase)) {
              throw new Error(`File path escapes app directory: ${file.path}`);
            }
            const dir = path.dirname(absolutePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(absolutePath, file.content, 'utf-8');
            createdFiles.push(file.path);
          }

          const registryEntry = { id: finalId, name: finalName, icon: safeIcon, path: `/src/apps/${finalId}/index.tsx` };
          registry.push(registryEntry);
          await fs.mkdir(path.dirname(registryPath), { recursive: true });
          await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');

          let registryContent: string | undefined;
          try {
            registryContent = await fs.readFile(registryPath, 'utf-8');
          } catch {}

          const mirrorFiles = await Promise.all(
            createdFiles.map(async (relativePath) => {
              try {
                const content = await fs.readFile(path.join(appBase, relativePath), 'utf-8');
                return { path: relativePath, content } as const;
              } catch {
                return null;
              }
            }),
          );

          const mirror = {
            registry: registryContent,
            files: mirrorFiles.filter((entry): entry is { path: string; content: string } => entry !== null),
          } as const;

          const result = {
            ok: true,
            id: finalId,
            name: finalName,
            base: `src/apps/${finalId}`,
            createdFiles,
            icon: safeIcon,
            createdAt,
            mirror,
          } as const;

          await log(result);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = { ok: false, error: message } as const;
          await log(failure);
          return failure;
        }
      },
    }),
  };
}
