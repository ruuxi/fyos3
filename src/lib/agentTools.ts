import { z } from 'zod';

// Centralized, simple, and LLM-friendly tool input schemas
// Keep fields minimal, add clear descriptions, avoid strict refinements that block LLMs

export const FSFindInput = z.object({
  root: z.string().default('.').describe('Directory to list from (absolute or project-relative).'),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(10)
    .describe('Maximum folder depth to traverse (0 lists only the root).'),
  glob: z
    .string()
    .optional()
    .describe('Optional glob filter (e.g., "**/*.tsx"). Applied to full paths.'),
  prefix: z
    .string()
    .optional()
    .describe('Optional path prefix filter. Only include entries starting with this prefix.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(200)
    .describe('Maximum number of entries to return (default 200).'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Pagination offset. Use nextOffset from the previous result for the next page.'),
});

export const FSReadInput = z.object({
  path: z.string().describe('File path to read (absolute or project-relative).'),
  encoding: z
    .enum(['utf-8', 'base64'])
    .default('utf-8')
    .describe('How to decode the file contents.'),
});

export const FSWriteInput = z.object({
  path: z.string().describe('Target file path. Creates missing folders when createDirs is true.'),
  content: z.string().describe('Full file content to write.'),
  createDirs: z.boolean().default(true).describe('Create parent directories when needed.'),
});

export const FSMkdirInput = z.object({
  path: z.string().describe('Directory path to create.'),
  recursive: z.boolean().default(true).describe('Create intermediate directories as needed.'),
});

export const FSRmInput = z.object({
  path: z.string().describe('File or directory path to remove.'),
  recursive: z.boolean().default(true).describe('Remove directories recursively.'),
});

export const ExecInput = z.object({
  command: z
    .string()
    .describe('CLI to run. For package installs prefer pnpm/npm/yarn/bun. Never run dev/build/start.'),
  args: z.array(z.string()).default([]).describe('Arguments for the command.'),
  cwd: z.string().optional().describe('Working directory (optional).'),
});

export const CreateAppInput = z.object({
  id: z
    .string()
    .describe('App id in kebab-case, e.g. "notes-app" or "calculator".'),
  name: z.string().describe('Display name of the app.'),
  icon: z.string().optional().describe('Emoji or small SVG string (optional).'),
});

export const RenameAppInput = z.object({
  id: z.string().describe('Existing app id to rename.'),
  name: z.string().describe('New display name.'),
});

export const RemoveAppInput = z.object({
  id: z.string().describe('App id to remove.'),
});

export const ValidateProjectInput = z.object({
  scope: z
    .enum(['quick', 'full'])
    .default('quick')
    .describe('quick: typecheck + lint (changed files); full: also run build.'),
  files: z
    .array(z.string())
    .optional()
    .describe('Optional list of files to lint (paths relative to project root).'),
});


export type TFSFindInput = z.infer<typeof FSFindInput>;
export type TFSReadInput = z.infer<typeof FSReadInput>;
export type TFSWriteInput = z.infer<typeof FSWriteInput>;
export type TFSMkdirInput = z.infer<typeof FSMkdirInput>;
export type TFSRmInput = z.infer<typeof FSRmInput>;
export type TExecInput = z.infer<typeof ExecInput>;
export type TCreateAppInput = z.infer<typeof CreateAppInput>;
export type TRenameAppInput = z.infer<typeof RenameAppInput>;
export type TRemoveAppInput = z.infer<typeof RemoveAppInput>;
export type TValidateProjectInput = z.infer<typeof ValidateProjectInput>;

// Shared list of tool names for consistency across server and client (optional)
export const TOOL_NAMES = {
  fs_find: 'fs_find',
  fs_read: 'fs_read',
  fs_write: 'fs_write',
  fs_mkdir: 'fs_mkdir',
  fs_rm: 'fs_rm',
  exec: 'exec',
  create_app: 'create_app',
  rename_app: 'rename_app',
  remove_app: 'remove_app',
  validate_project: 'validate_project',
  search: 'search',
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];

// Web search tool input
export const WebSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(100)
    .describe('The web search query for up-to-date information.'),
});
export type TWebSearchInput = z.infer<typeof WebSearchInput>;


