export const CREATE_INTENT_PROMPT = `## Creating New Apps

When creating a new app, follow this two-phase approach:

### Phase 1: Assess Planning Depth
1. Prefer the \`fast_app_create\` tool to scaffold new apps in one call—supply a kebab-case \`id\`, display \`name\`, optional \`icon\`, and batch of initial \`files\` (e.g., \`index.tsx\`, \`styles.css\`). This tool now mirrors its output into the active WebContainer VFS automatically, so no follow-up sync is required. Fall back to \`app_manage\` (action \`create|rename|remove\`) when you need incremental registry maintenance.
2. If the request is **simple or single-screen** (e.g., one feature, straightforward UI), skip \`plan.md\`. Instead, summarize your approach in chat with a brief outline (overview + three bullet implementation steps) and move directly to coding.
3. For the initial create fast-path: do NOT call \`validate_project\` or \`web_exec\`. Scaffold via \`fast_app_create\` (or \`app_manage.create\` as a fallback) so the initial files land in one step and appear immediately on the desktop. Run validation or installs only when the user later asks to modify or add features.
4. If the scope is multi-feature, ambiguous, or needs coordination, create or update \`src/apps/<id>/plan.md\` with a comprehensive implementation plan before writing code.

### Phase 2: Implementation
1. Execute the agreed plan. Update \`plan.md\` checkboxes when a full plan exists, otherwise reference the inline outline as you work.
2. On the fast path, use \`fast_app_create\` to batch only the files the user actually requested in a single call—\`metadata.json\` is created automatically, and default shells like \`index.tsx\`/\`styles.css\` are backfilled if you leave them out—so skip boilerplate unless it's explicitly needed. Do not run \`validate_project\` until there are follow-up edits.
3. After a successful \`fast_app_create\`, continue by describing the result or editing files with tools like \`web_fs_write\` or \`code_edit_ast\`; only call \`fast_app_create\` again if the previous attempt returned an explicit error.
4. Place the app in \`src/apps/<id>/index.tsx\`; the platform keeps the corresponding \`metadata.json\` in sync for you.
5. Import \`/src/tailwind.css\` and always customize the app-specific \`styles.css\` for unique theming.

### Plan.md Template
\`\`\`markdown
# [App Name] Plan

## Goal
[1–2 sentences on the outcome and audience]

## Must-Have Tasks
- [ ] Task 1 — core UX / data flow
- [ ] Task 2 — secondary interaction or state
- [ ] Task 3 — polishing or edge handling

## Key Notes
- UI/Style: palette, layout, or animation cues
- Tech: state/data approach, deps, or persistence
- Risks: anything to validate or follow up on
\`\`\`

### Initial App Structure
- Start with a clean functional component, wrap it in \`h-full overflow-auto\`, add a header, and style it for the requested purpose.`;
