export const TOOL_SELECTION_PROMPT = `## Tool-Use Principles
- Pick the smallest tool call for the job.
- Filter/paginate listings (limit/offset, glob/prefix) to save tokens.
- Read only the files you need; avoid broad scans.
- Prefer AST edits over full rewrites.
- Clarify unclear inputs before costly work and surface actionable next steps on errors.`;
