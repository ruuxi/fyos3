## App Store as its own screen (outside the WebContainer)

This research outlines how to move the App Store out of the chat bar and into its own full‑screen “host” view, with iOS‑style multi‑screen navigation (swipe left/right). The default landing remains the Desktop running inside the WebContainer iframe; tapping the App Store icon slides to a dedicated App Store screen to the left.

### Goals
- Keep default landing on the Desktop (WebContainer iframe)
- Add a new, host‑level App Store screen (outside the iframe) with an Apple‑inspired layout
- Enable horizontal screen navigation (like iOS) with smooth swipe animation
- Wire the existing App Store button to navigate screens (instead of toggling an in‑bar mode)
- Reuse existing server endpoints and install flow

### Current state (key references)
- The chat bar includes an inline App Store "mode" that lists apps and installs into the WebContainer via host APIs.

```978:999:/home/rn/projects/7/fyos/src/components/AIAgentBar.tsx
<Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg:white/10" onClick={() => setMode('appstore')}>
  <Store className="h-4 w-4" />
</Button>
...
{mode === 'appstore' && (
  <div className="px-4 py-3">
    <div className="font-medium mb-2">App Store</div>
    {appsLoading && <div className="text-sm text-gray-500">Loading…</div>}
    ...
  </div>
)}
```

- The Desktop (inside the Vite‑powered WebContainer) handles app windows and listens for `FYOS_OPEN_APP` messages to open apps.

```889:905:/home/rn/projects/7/fyos/templates/webcontainer/src/desktop/Desktop.tsx
function onMessage(e: MessageEvent){
  const d: any = (e as any).data
  if (!d || d.type !== EVT_OPEN_APP) return
  const app: App | null = (d.app && typeof d.app === 'object') ? d.app as App : null
  if (!app || !app.id) return
  const existing = appsByIdRef.current[app.id]
  const toLaunch = existing || app
  if (!toLaunch.path) return
  bounceIcon(setLaunchingIconId, toLaunch.id)
  launch(toLaunch)
  ...
}
```

### Proposed architecture
- Introduce a host‑level Screen Manager that owns multiple full‑bleed screens:
  - Screen 0 (left): App Store screen (new) – host React component
  - Screen 1 (center/default): Desktop screen – existing `WebContainer`/iframe
- Use a horizontally translating container with GPU‑accelerated transforms and springy ease to animate between screens.
- Default index is 1 (Desktop). Tapping the App Store icon sets index to 0 and animates left.
- Add touch/pointer swipe detection on the container to navigate between screens; support Esc/backspace/left/right keys as niceties.

### Navigation & input model
- Gestures: one‑finger horizontal swipe with suppression of vertical scroll if the horizontal intent threshold is exceeded (e.g., 16–24 px).
- Thresholds: commit to next/prev screen when the drag distance exceeds ~33% of the viewport width or velocity exceeds a small threshold.
- Animation timing: 300–360 ms with ease `cubic-bezier(0.22,1,0.36,1)` to match existing bar animations.
- Accessibility: provide off‑screen screens as `aria-hidden` when not active; ensure focus is moved to a sensible landmark on screen change.

### App Store screen design (Apple‑inspired)
- Top navigation: segmented control for categories (e.g., Discover, Apps, Collections), search button, and account avatar.
- Hero editorial banners: large card with gradient backdrop, feature image, overlaid title and subtitle.
- Curated sections: horizontal carousels of app cards (App of the Day, New & Noteworthy, Top Paid/Free). Each card shows icon/emoji, name, short subtitle, and an Install button.
- App detail flyover: click a card to open a side‑sheet or full‑card overlay with richer description and screenshots.
- Thematic color palette: light, spacious layout with rounded cards, subtle drop shadows, and SF‑like typography.
- Components to leverage: shadcn UI primitives (`Card`, `Tabs`, `Button`, `Select`, `Badge`) already present in the template.

### Data & install flow
- Listings: continue using `GET /api/store/apps` and `GET /api/store/apps/:id/bundle`.
- Install: reuse the existing host install path (currently implemented in `AIAgentBar` as `hostInstallApp`). Extract or share install logic so the App Store screen can call it directly.
  - Option A (recommended): move install helper to a shared hook, e.g., `src/utils/app-install.ts` is already present and used by the bar. Expose a small wrapper `useAppInstaller()` that uses `useWebContainer()` under the hood.
  - Option B: pass a prop/callback from a top‑level provider that already has access to `useWebContainer()`.

### Components to add (host‑level)
- `src/components/ScreensProvider.tsx`: stores `activeIndex`, provides `goTo(index)`, `next()`, `prev()`, and gesture context.
- `src/components/ScreenCarousel.tsx`: visually lays out screens side by side, applies transforms/animations, handles swipe gestures.
- `src/components/AppStoreScreen.tsx`: the new Apple‑inspired App Store implementation (outside iframe), reads from `/api/store/apps`, uses shared install helper.
- Minor: add accessible landmarks, focus management, and keyboard shortcuts (e.g., Esc or Cmd+Left to return to Desktop).

### AIAgentBar changes
- Replace the current `setMode('appstore')` handler to call `goTo(0)` on the Screens context instead.
- Remove the inline App Store panel from the chat bar UI to avoid duplication.
- Keep Media and Visit panels in the chat bar as they are still handy overlays.

### Desktop/WebContainer behavior
- No changes needed for in‑iframe Desktop; it remains the center screen.
- The install flow still writes files into the WebContainer; once installed, the Desktop will discover the new app via its registry refresh loop and can open it as usual.

### Animations & performance
- Use `translate3d` with will‑change to ensure smooth 60fps transitions.
- Limit reflow/repaint by keeping the App Store DOM mounted but toggled via transforms, and by virtualizing long lists (if needed) for large catalogs.
- Match durations already used in the Desktop and Agent Bar for a cohesive feel (e.g., 340 ms open/restore, 220 ms close/minimize).

### Accessibility
- When switching screens:
  - Move focus to the App Store screen’s main heading or search field.
  - Set `aria-hidden` and `inert` on offscreen screens to prevent virtual cursor confusion.
- Ensure all actionable elements are reachable and labeled; preserve keyboard navigation parity with gestures.

### Rollout plan (high‑level)
1) Create the Screen Manager and wrap current Desktop host view with it.
2) Build `AppStoreScreen` with Apple‑inspired layout and reuse existing endpoints.
3) Factor install helper into a shared hook and use it from `AppStoreScreen`.
4) Update `AIAgentBar` App Store button to call `goTo(0)` and remove the inline App Store mode.
5) QA: gestures, keyboard, focus, and performance on desktop and touch devices.

### Open questions / decisions
- Placement of the Screen Manager: likely top‑level page layout hosting both the chat bar and the Desktop iframe. Confirm whether this lives in `src/app/page.tsx` or a higher layout wrapper where the Desktop currently mounts.
- Whether to allow swiping from App Store directly into additional future screens (e.g., a Library screen) – design leaves room for Screen 2+.
- How aggressive to make gesture thresholds for large monitors vs touch devices; consider adaptive thresholds.

### Implementation notes (file‑level)
- `src/components/AIAgentBar.tsx`: Replace App Store click to use Screens context; remove `mode === 'appstore'` panel.
- `src/components/WebContainer.tsx` (or the layout that renders it): Wrap in `ScreenCarousel` as the center screen (index 1).
- `src/components/AppStoreScreen.tsx`: new screen with design described above, data from `/api/store/apps`, install via shared helper.
- `src/utils/app-install.ts`: keep as the central install abstraction.

No code has been changed yet; the above serves as the blueprint for implementation.


