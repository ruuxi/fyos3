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

export const CodeEditAstInput = z.object({
  path: z.string().describe('File path to edit (must be TypeScript/JavaScript/TSX/JSX).'),
  action: z
    .enum(['upsertImport', 'updateFunctionBody', 'replaceJsxElement', 'replaceJsxAttributes', 'insertAfterLastImport', 'insertAtTop'])
    .describe('Type of AST edit to perform.'),
  selector: z.object({
    functionName: z.string().optional().describe('Function name to target (for updateFunctionBody).'),
    exported: z.boolean().optional().describe('Whether the function is exported (for updateFunctionBody).'),
    jsxTag: z.string().optional().describe('JSX tag name to target (for replaceJsxElement/replaceJsxAttributes).'),
  }).optional().describe('Selector to find the target element in the AST.'),
  payload: z.object({
    import: z.object({
      module: z.string().describe('Module name to import from.'),
      specifiers: z.array(z.string()).describe('Named specifiers to import.'),
    }).optional().describe('Import details (for upsertImport).'),
    functionBody: z.string().optional().describe('New function body content (for updateFunctionBody).'),
    jsxReplaceWith: z.string().optional().describe('JSX string to replace element with (for replaceJsxElement).'),
    jsxAttributes: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional().describe('JSX attributes to set (for replaceJsxAttributes).'),
    insertText: z.string().optional().describe('Text to insert (for insertAfterLastImport/insertAtTop).'),
  }).optional().describe('Payload data for the edit operation.'),
  dryRun: z.boolean().default(false).describe('If true, perform analysis but do not write changes to file.'),
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
export type TCodeEditAstInput = z.infer<typeof CodeEditAstInput>;

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
  web_search: 'web_search',
  ai_fal: 'ai_fal',
  ai_eleven_music: 'ai_eleven_music',
  media_list: 'media_list',
  code_edit_ast: 'code_edit_ast',
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

// AI media generation tool inputs
export const AiFalInput = z.object({
  model: z.string().describe('FAL model name (e.g., "fal-ai/flux/schnell", "fal-ai/runway-gen3/turbo/image-to-video").'),
  input: z.record(z.string(), z.any()).describe('Model-specific input parameters as key-value pairs.'),
  scope: z.object({
    desktopId: z.string().optional(),
    appId: z.string().optional(),
    appName: z.string().optional(),
  }).optional().describe('Optional scope for organizing generated assets.'),
});

export const ElevenMusicInput = z.object({
  prompt: z.string().describe('Text description of the music to generate.'),
  musicLengthMs: z.number().int().min(1000).max(300000).default(30000).describe('Length of generated music in milliseconds (1-300 seconds).'),
  outputFormat: z.enum(['mp3', 'wav']).default('mp3').describe('Output audio format.'),
  scope: z.object({
    desktopId: z.string().optional(),
    appId: z.string().optional(),
    appName: z.string().optional(),
  }).optional().describe('Optional scope for organizing generated assets.'),
});


export const MediaListInput = z.object({
  type: z.enum(['image', 'audio', 'video', 'unknown']).optional().describe('Filter by media type.'),
  appId: z.string().optional().describe('Filter by app ID.'),
  desktopId: z.string().optional().describe('Filter by desktop ID.'),
  from: z.string().optional().describe('Filter by creation date from (ISO string).'),
  to: z.string().optional().describe('Filter by creation date to (ISO string).'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of items to return.'),
});

export type TAiFalInput = z.infer<typeof AiFalInput>;
export type TElevenMusicInput = z.infer<typeof ElevenMusicInput>;
export type TMediaListInput = z.infer<typeof MediaListInput>;


