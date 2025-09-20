import { z } from 'zod';

// Centralized, simple, LLM-friendly tool schemas.
// Minimize required fields, add clear descriptions, avoid overly strict refinements.

export const ResponseFormat = z.enum(['concise', 'detailed']).default('concise');

// Web FS
export const WebFsFindInput = z.object({
  root: z.string().default('.').describe('Start directory (absolute or project-relative). Use "." unless a narrower folder is known.'),
  maxDepth: z.number().int().min(0).max(20).default(10).describe('Max depth (0 lists only root). Keep low (2–5) to reduce tokens.'),
  glob: z.string().optional().describe('Optional glob (e.g., "**/*.tsx"). Prefer to target relevant files.'),
  prefix: z.string().optional().describe('Optional path prefix filter.'),
  limit: z.number().int().min(1).max(5000).default(200).describe('Max entries (default 200). Use small pages.'),
  offset: z.number().int().min(0).default(0).describe('Pagination offset.'),
  responseFormat: ResponseFormat.optional().describe('concise (default) or detailed.'),
});

export const WebFsReadInput = z.object({
  path: z.string().describe('Exact file path to read. Read only what you need.'),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('Decoding for contents.'),
  responseFormat: ResponseFormat.optional().describe('concise (default) may truncate large files; detailed returns full content.'),
  range: z
    .object({
      offset: z.number().int().min(0).optional().describe('Character offset to start from.'),
      length: z.number().int().min(1).max(200_000).optional().describe('Number of characters to include from offset (cap at 200k).'),
      lineStart: z.number().int().min(1).optional().describe('1-based line number to start from.'),
      lineEnd: z.number().int().min(1).optional().describe('1-based line number to end at (inclusive).'),
    })
    .optional()
    .describe('Optional slice controls. Prefer requesting focused windows instead of entire files.'),
});

export const WebFsWriteInput = z.object({
  path: z.string().describe('Target file path. Creates missing folders when createDirs is true.'),
  content: z.string().describe('Full file content to write. Prefer minimal, targeted edits (consider code_edit_ast).'),
  createDirs: z.boolean().default(true).describe('Create parent directories when needed.'),
});

export const WebFsRmInput = z.object({
  path: z.string().describe('File or directory path to remove.'),
  recursive: z.boolean().default(true).describe('Remove directories recursively. Destructive—use with care.'),
});

// Command exec
export const WebExecInput = z.object({
  command: z.string().describe('CLI to run. Use for package management only (e.g., pnpm add). Do NOT run dev/build/start servers.'),
  args: z.array(z.string()).default([]).describe('Arguments for the command.'),
  cwd: z.string().optional().describe('Working directory (optional).'),
});

// App management
export const AppManageInput = z.object({
  action: z.enum(['create', 'rename', 'remove']).describe('App operation to perform.'),
  id: z.string().describe('App id in kebab-case (e.g., "notes-app").'),
  name: z.string().optional().describe('Display name (required for create/rename).'),
  icon: z.string().optional().describe('Emoji or small SVG (optional).'),
});

// Validation
export const ValidateProjectInput = z.object({
  scope: z.enum(['quick', 'full']).default('quick').describe('quick: typecheck + lint; full: also runs production build.'),
  files: z.array(z.string()).optional().describe('Optional explicit file list to lint.'),
});

// Code editing
export const CodeEditAstInput = z.object({
  path: z.string().describe('File path to edit (TypeScript/JavaScript/TSX/JSX).'),
  action: z
    .enum(['upsertImport', 'updateFunctionBody', 'replaceJsxElement', 'replaceJsxAttributes', 'insertAfterLastImport', 'insertAtTop'])
    .describe('Type of AST edit to perform.'),
  selector: z
    .object({
      functionName: z.string().optional().describe('Function name (for updateFunctionBody).'),
      exported: z.boolean().optional().describe('Whether the function is exported (for updateFunctionBody).'),
      jsxTag: z.string().optional().describe('JSX tag (for replaceJsx* actions).'),
    })
    .optional()
    .describe('Selector to find target element.'),
  payload: z
    .object({
      import: z
        .object({
          module: z.string().describe('Module name to import from.'),
          specifiers: z.array(z.string()).describe('Named specifiers to import.'),
        })
        .optional()
        .describe('Import details (for upsertImport).'),
      functionBody: z.string().optional().describe('New function body (for updateFunctionBody).'),
      jsxReplaceWith: z.string().optional().describe('JSX string to replace element (for replaceJsxElement).'),
      jsxAttributes: z
        .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
        .optional()
        .describe('JSX attributes to set (for replaceJsxAttributes).'),
      insertText: z.string().optional().describe('Text to insert (for insertAfterLastImport/insertAtTop).'),
    })
    .optional()
    .describe('Payload for the operation.'),
  dryRun: z.boolean().default(false).describe('If true, analyze but do not write changes.'),
});

// Web search
export const WebSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(100)
    .describe('Web search query for up-to-date information. ONLY USE when explicitly requested.'),
  responseFormat: ResponseFormat.optional().describe('concise (default) or detailed.'),
});

// AI generation (FAL + ElevenLabs unified)
export const AiGenerateInput = z.object({
  provider: z.enum(['fal', 'eleven']).describe('AI provider to use.'),
  model: z.string().optional().describe('Model identifier when applicable.'),
  task: z.enum(['image', 'video', 'music', 'audio', '3d']).optional().describe('High-level task category.'),
  input: z.record(z.string(), z.any()).default({}).describe('Model-specific input parameters as key-value pairs.'),
  scope: z
    .object({
      desktopId: z.string().optional(),
      appId: z.string().optional(),
      appName: z.string().optional(),
    })
    .optional()
    .describe('Optional scope for organizing generated assets.'),
  responseFormat: ResponseFormat.optional().describe('concise (default) or detailed.'),
});

export const MediaListInput = z.object({
  type: z.enum(['image', 'audio', 'video', 'unknown']).optional().describe('Filter by media type.'),
  appId: z.string().optional().describe('Filter by app ID.'),
  desktopId: z.string().optional().describe('Filter by desktop ID.'),
  from: z.string().optional().describe('Filter by creation date from (ISO string).'),
  to: z.string().optional().describe('Filter by creation date to (ISO string).'),
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of items to return.'),
  responseFormat: ResponseFormat.optional().describe('concise (default) or detailed.'),
});

// Submit/update app plan.md
export const SubmitPlanInput = z.object({
  appId: z.string().describe('Target app id (kebab-case).'),
  planText: z.string().describe('Full markdown content for plan.md.'),
  mode: z.enum(['create', 'update']).default('create').describe('Create or update plan.md.'),
  section: z.string().optional().describe('Optional subsection to update (future use).'),
});

// Types
export type TWebFsFindInput = z.infer<typeof WebFsFindInput>;
export type TWebFsReadInput = z.infer<typeof WebFsReadInput>;
export type TWebFsWriteInput = z.infer<typeof WebFsWriteInput>;
export type TWebFsRmInput = z.infer<typeof WebFsRmInput>;
export type TWebExecInput = z.infer<typeof WebExecInput>;
export type TAppManageInput = z.infer<typeof AppManageInput>;
export type TValidateProjectInput = z.infer<typeof ValidateProjectInput>;
export type TCodeEditAstInput = z.infer<typeof CodeEditAstInput>;
export type TWebSearchInput = z.infer<typeof WebSearchInput>;
export type TAiGenerateInput = z.infer<typeof AiGenerateInput>;
export type TMediaListInput = z.infer<typeof MediaListInput>;
export type TSubmitPlanInput = z.infer<typeof SubmitPlanInput>;

// Tool names
export const TOOL_NAMES = {
  web_fs_find: 'web_fs_find',
  web_fs_read: 'web_fs_read',
  web_fs_write: 'web_fs_write',
  web_fs_rm: 'web_fs_rm',
  web_exec: 'web_exec',
  app_manage: 'app_manage',
  validate_project: 'validate_project',
  web_search: 'web_search',
  ai_generate: 'ai_generate',
  media_list: 'media_list',
  code_edit_ast: 'code_edit_ast',
  submit_plan: 'submit_plan',
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
