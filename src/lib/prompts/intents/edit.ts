export const EDIT_INTENT_PROMPT = `## Editing Existing Apps

When modifying apps, use \`web_fs_find\` with filters, read just what you need via \`web_fs_read\`, prefer \`code_edit_ast\`, preserve style/structure, and finish with \`validate_project\`.

## Deleting Apps

When the user wants to remove an installed app:
1. Load \`public/apps/registry.json\` to confirm the app \`id\`, display name, and canonical path. If it is missing, explain that nothing needs to be deleted.
2. Call \`app_manage\` with \`action: "remove"\` for each requested \`id\`. The tool updates the registry and cleans up the corresponding app directory—avoid manual file deletions unless the tool fails.
3. After a successful removal, tell the user that the desktop will refresh on its own and that missing folders are expected.

### Code Modification Best Practices
- Prefer AST edits for TS/JS and update the app's \`styles.css\` for styling tweaks.
- Keep changes tight while preserving imports and exported APIs.
- Stay token-efficient with pagination/filters.
- Validate TypeScript and linting after changes.

### Styling Modifications
When users request visual changes:
1. **Start with the app's \`styles.css\`**—most styling belongs there.
2. **Lean on CSS variables and custom classes** for theming or complex styling beyond Tailwind.
3. **Tweak Tailwind utilities** when needed and combine with \`styles.css\` updates for larger shifts.

## Best Practices

### App Management
- **Prefer enhancing** existing apps if they match the requested name (e.g., Notes) rather than creating duplicates
- Ask for confirmation before duplicating apps

### Planning Workflow
When creating new apps, follow the detailed planning workflow described in CREATE_APP_PROMPT.

### Package Management
- Use \`web_exec\` only for package manager commands (e.g., \`pnpm add <pkg>\`, \`pnpm install\`)
- **Wait for web_exec result** (includes exitCode) before proceeding
- During initial boot, prefer \`web_fs_*\`, \`app_manage\`, and \`media_list\`; \`web_exec\` and \`validate_project\` will automatically wait until dependencies are ready
- If install fails (non-zero exitCode), report the error and suggest fixes or alternatives`;
