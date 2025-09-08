## Tabbed Windows — Research, UX, and Implementation Plan

### Goals
- Multiple apps can live as tabs inside a single window.
- New Tab (+) opens a blank tab showing the app launcher (clicking an app loads into that tab).
- Drag-and-drop tabs across windows to merge/split.
- Smooth performance: DOM writes in rAF during drag, minimal re-renders.
- Persist state: tabs per window, active tab, per-tab app metadata.

### UX Spec
- Window chrome:
  - Titlebar on top, below it a horizontal tab strip with: [<tab>[x], <tab>[x], …, (+)].
  - Active tab is visually highlighted; close icon per tab; [+] at the end.
  - Tab strip horizontally scrollable if overflow; subtle left/right gradients.
- New tab flow:
  - Click [+] → creates a blank tab with an “Apps” panel (the existing app store/launcher UI) inside the window content.
  - Clicking an app replaces this blank state with the app iframe.
- Dragging tabs:
  - MouseDown on tab → drag ghost; supported drop targets: any other window tab strip, or new window (drop outside creates a new window with that tab).
  - Reorder within a window by dragging along its strip.
  - Visual indicator on candidate drop target (insertion marker).
- Keyboard:
  - ArrowLeft/ArrowRight to switch tabs, Home/End to jump first/last.
  - Ctrl/Cmd+T to add tab, Ctrl/Cmd+W to close tab, Ctrl/Cmd+Shift+T to reopen last closed (optional).

### Data Model
- Add `WindowTab`:
  - `id: string` — unique within window.
  - `appId: string | null` — if null → blank tab (launcher).
  - `title: string` — app name or “New Tab”.
  - `icon?: string` — emoji/glyph.
  - `path?: string` — app path when loaded.
- Per-window tabs state:
```ts
type WindowTabsState = {
  activeTabId: string;
  tabs: WindowTab[];
}
```
- Storage keys:
  - `desktop.windowTabs`: Record<windowId, WindowTabsState>
  - Reuse existing geometry persistence to restore window bounds.

### Operations
- Create tab: append `WindowTab` with `appId: null`, set active.
- Close tab: remove; if active, activate previous or first available.
- Activate tab: set `activeTabId`.
- Reorder tabs (within window): splice list.
- Move tab across windows: remove from source, insert into destination; if destination is undefined, create a new window with that single tab.
- Open app into tab: populate `appId`, `title`, `icon`, `path` and render iframe.

### Drag-and-Drop Strategy
- Keep existing high-perf DnD pattern: perform DOM transforms in rAF.
- Tab drag:
  - On mousedown over tab: set drag state; create lightweight drag ghost.
  - While moving: hit-test tab strips (getBoundingClientRect cache per frame), compute insertion index; draw insertion marker.
  - On mouseup: commit to state; if dropped outside any strip: create new window at drop point with this tab.
- Hit areas:
  - Tab strips across all windows; tolerate a vertical tolerance around strip.
- Performance:
  - Avoid React state writes during move; only on drop.
  - Use single overlay for ghost + insertion marker; update styles imperatively.

### Rendering
- Window:
  - Titlebar remains draggable window handle.
  - Below: `nav.tabstrip` with tabs and (+); each tab is a button with role=tab, aria-selected.
  - Content area renders:
    - If active tab has `appId`: iframe mount (as today).
    - Else: launcher panel (grid of apps).

### Persistence
- On every tabs change (add/close/reorder/activate or cross-window move) write `desktop.windowTabs`.
- On launch/restore: pair windows with their tabs (fallback to one tab per window if missing).

### Accessibility
- Tabstrip with ARIA roles; keyboard navigation described above.
- Close buttons have aria-label with tab title.

### Edge Cases
- Last tab closed in a window → close window (optional) or keep with a blank tab (recommended).
- Moving last tab out → window becomes blank tab or closes (choose blank for continuity).
- App errors: iframe errors stay scoped to the tab; switching tabs cleansly pauses offscreen app (optional).

### Implementation Plan
1) Types and storage
   - Add `WindowTab`, `WindowTabsState`, storage helpers (load/save) under the same localStorage scheme.
2) State wiring
   - In `Desktop.tsx`, maintain `windowTabs: Record<string, WindowTabsState>` keyed by window/app id.
   - On window creation, seed with a single tab for the launched app.
3) Window component
   - Add tabstrip UI; wire handlers: onTabActivate/Close/Reorder/NewTab.
   - Content switcher: iframe vs launcher view.
4) DnD across windows
   - Global overlay and hit-test registry of tabstrips.
   - Implement drag ghost and insertion marker; commit on drop.
5) Persistence + restore
   - Load `windowTabs` on boot; reconcile with existing windows list.
6) Perf polish & QA
   - rAF for DOM writes, minimal React updates.
   - Keyboard and ARIA verification.

### References (patterns)
- Chrome/VS Code tabstrip behaviors (reorder, detach into new window).
- Interact.js modifiers for snapping and end-only commits for smoothness.


