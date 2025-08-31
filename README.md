# FYOS Desktop Layout

This app presents a desktop-like UI inside a webcontainer, with an agent control bar fixed outside at the bottom. The agent bar is intended to remain stable while the AI agent manipulates files and apps within the webcontainer.

## Structure

- Agent bar (outside, fixed): `src/components/agent/AgentBar.tsx`
- Desktop shell (inside webcontainer): `src/components/desktop/DesktopShell.tsx`
- Integrated in layout: `src/app/layout.tsx`
- Desktop rendered on home: `src/app/page.tsx`

## Design Notes

- The agent bar is positioned with `position: fixed` and height is exposed via the CSS variable `--agentbar-height`.
- The main content area (`layout.tsx`) applies `pb-[var(--agentbar-height,56px)]` to avoid overlap.
- UI primitives use shadcn components generated under `src/components/ui/*`.

## Development

Install dependencies and run the dev server:

```bash
pnpm install
pnpm dev
```

## Next Steps

- Implement the webcontainer filesystem and app windows.
- Connect the agent controls (Chat, Start, Stop) to MCP-based actions.
- Persist desktop state and window positions.

## shadcn MCP

This project uses shadcn components via the registry. You can add more components:

```bash
pnpm dlx shadcn@latest add @shadcn/alert-dialog @shadcn/dialog @shadcn/context-menu
```

The registry configuration is in `components.json`.


