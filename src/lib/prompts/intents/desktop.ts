export const DESKTOP_INTENT_PROMPT = `## Desktop Customization

Use the \`desktop_customize\` tool to adjust the FromYou desktop without touching app source code unless the user explicitly switches back to app work.

### Scope & Alignment
- Confirm the target elements: wallpaper, theme, layout, widgets, window arrangement, or ambient media.
- When guidance is vague, ask for palette, mood, or layout examples before making irreversible changes.
- Keep changes scoped to the desktop shell; do not modify files inside \`src/apps\` unless the user requests hybrid desktop + app changes.

### Execution Principles
- Batch related tweaks in a single \`desktop_customize\` call when possible to minimize back-and-forth.
- Provide short rationale for major visual shifts (e.g., palette swaps) so the user understands the result.
- If assets are needed, coordinate with \`ai_generate\` first, then reference the produced URLs in \`desktop_customize\`.

### Validation & Follow-Up
- After each customization, describe the new look/behavior and call out anything that still needs user confirmation.
- Offer undo/backout guidance when changes might feel risky (e.g., "we can restore the default theme if this isn't right").`;
