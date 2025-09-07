# Bottom AI Agent Bar — Research & Design Brief

## Goals
- **Persistent bottom bar** with a modern glass aesthetic (frosted, subtle shadows).
- **Center search/chat**: compact state behaves like a search bar; expands to a macOS chat-like sheet with smooth, Apple‑like transitions.
- **Side actions**: left/right clusters for **App Store**, **Visit (Desktops)**, and **Media** with consistent expand/collapse behavior.
- **Shadcn-first** implementation for primitives and overlays.
- **Performance**: unobtrusive, smooth animations, low layout shift.

## Core Layout
- **Container**: fixed to bottom, full width, safe-area aware, max width centered.
  - Tailwind hints: `fixed bottom-0 inset-x-0`, `backdrop-blur-xl`, `bg-white/60 dark:bg-neutral-900/40`, `border-t`, `shadow-[...]`, `supports-[backdrop-filter]:backdrop-blur-xl`.
- **Structure**: `Menubar` or custom flex bar with three regions:
  - Left cluster: App Store, Visit, Media icons/buttons with tooltips.
  - Center: Search/Chat input (Command-like) with placeholder.
  - Right cluster: Status, Stop/Working indicator, optional profile/avatar.

## Components (shadcn)
- **Command**: for the search/chat compact state, with `CommandInput`, groups, shortcuts.
- **Dialog** or **Sheet**: for expanded chat surface; prefer `Dialog` with rounded glass card, or `Sheet` (top-aligned from bottom) for macOS Messages vibe.
- **Popover**: lightweight quick actions (recent prompts, slash commands) from the input.
- **Tooltip**: labels for icon buttons (App Store, Visit, Media).
- **Hover Card**: quick previews (e.g., desktop info) before opening.
- **Separator**: subtle dividers inside expanded surfaces.
- **Avatar**: optional user/agent identity at right.
- **Scroll Area**: smooth scrolling in chat/app lists.

Suggested install:

```bash
pnpm dlx shadcn@latest add @shadcn/command @shadcn/popover @shadcn/dialog @shadcn/sheet @shadcn/hover-card @shadcn/tooltip @shadcn/separator @shadcn/avatar @shadcn/scroll-area
```

## Interaction & States
- **Idle (compact)**: 56–64px bar height, center input shows placeholder “Ask the AI…”.
- **Focus/Expand**: on input focus or ⌘K, animate to 70vh dialog/sheet:
  - Expand uses subtle scale+y translate with spring; background glass intensifies, border becomes soft.
  - Messages list appears with sticky header, gentle content fade-in.
- **App Store/Visit/Media**:
  - Each opens a panel with the same glass shell and shared header, either as `Dialog` tabs or `Sheet` from bottom.
  - Keep transition parity with chat expand for coherence.
- **Close**: Esc, click outside, or collapse button returns to compact bar with reverse animation.
- **Progress**: Right side shows Working…/Stop, using existing `status` from `useChat`.

## Animation Guidelines
- **Durations**: 220–320ms for bar transitions; 120–180ms for small UI.
- **Easing**: cubic-bezier(0.22, 1, 0.36, 1) (Apple-like). For spring: medium bounciness, low overshoot.
- **Tech**: Tailwind transitions with custom utilities; `framer-motion` optional but try CSS-first.
- **Scroll linking**: on expand, auto-scroll to bottom with eased follow (reuse existing smooth scroll util).

## Visual System
- **Glass**: `bg-white/60 dark:bg-neutral-900/40`, `backdrop-blur-xl`, `ring-1 ring-black/5 dark:ring-white/10`.
- **Surfaces**: cards in expanded views use subtle inner border (`border-white/40 dark:border-white/10`).
- **Icons**: `lucide-react`; maintain 18–20px in bar, 20–24px in panel headers.
- **Typography**: system UI; weight 500 for headers, 400 body.

## Accessibility
- **Keyboard**: ⌘K focus search; Esc closes; Tab/Shift+Tab nav; Arrow keys in `Command` list; Enter to submit.
- **ARIA**: label input as “Ask AI”; role for menu/dialog; focus trap inside expanded panel.
- **Reduced motion**: respect `prefers-reduced-motion`; fall back to instant state changes.

## Responsiveness
- **Mobile**: bar remains 56px; expanded state uses full-height `Sheet` from bottom; large touch targets (44px min).
- **Tablet/Desktop**: centered max-width (e.g., 980–1140px). Panels 680–860px width content.

## Architecture Changes
- Replace top card container in `AIAgentBar.tsx` with a bottom-fixed shell.
- Extract a `BottomBar` component: owns compact layout, keyboard shortcuts, and triggers.
- Extract `ExpandedChat`, `AppStorePanel`, `VisitPanel`, `MediaPanel` using shared shell.
- Reuse `useChat` state; lift only minimal state to parent.
- Keep existing client tools; wire status to Right cluster.

## State & Events
- `mode`: 'compact' | 'chat' | 'appstore' | 'visit' | 'media'.
- `setMode` transitions; single source of truth to avoid overlapping overlays.
- Persist last mode optionally; reset on route change.

## Implementation Notes
- Prefer `Dialog` for desktop parity and focus handling; `Sheet` for mobile.
- Use `ScrollArea` for message and listings.
- Use `Tooltip` on icon buttons; `HoverCard` for rich previews.
- Reuse smooth scroll helpers already present.

## Open Questions
- Should media support quick capture/upload or only library? (panel design follow-up)
- Theme tokens centralization for glass parameters and animation durations.

## Next Steps
1. Add shadcn components listed above.
2. Create `BottomBar` scaffold and replace current layout in `AIAgentBar.tsx`.
3. Implement chat expand flow; mirror to App Store/Visit/Media panels.
4. Polish animations and accessibility.
