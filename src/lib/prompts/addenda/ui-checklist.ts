export const UI_CHECKLIST_PROMPT = `## Interaction Guarantee (Required)
All UI must be functional and keyboard-accessible. Before returning code, ensure:
- Real handlers: every visible control has working onClick/onChange/onInput/onSubmit; no stubs or TODOs.
- Keyboard parity: Tab focus works; Enter/Space activate buttons/CTAs; Escape cancels; Arrow/WASD when applicable (games).
- Forms: preventDefault, validate inputs, call onSubmit, and update state/UI.
- Canvas/games: track pressed keys via keydown/keyup; process input in requestAnimationFrame; handle pointer down/move/up; respond to keyboard and mouse/touch.
- Feedback: show loading/disabled/active states and surface errors; visible state change after actions.
- Accessibility: custom controls use role="button", tabIndex=0, and onKeyDown to mirror click behavior.

Return only working code with no dead UI elements.`;
