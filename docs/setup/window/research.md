## Window Tiling (up to 8) — Research, UX Spec, and Implementation Plan

### Goals
- Smooth, lag‑free window tiling with intuitive snap/lock placement.
- Support up to 8 canonical tiles: left/right/top/bottom halves + the four corners.
- Always maintain a small gap between windows and from desktop edges.
- Easy to position and resize; clear visual indicators (previews/zone highlights).
- Minimal main‑thread work during drag/resize; commit state once on drop.

### Summary of Proposed Model
- **Tiling zones (8):**
  - Halves: `left-half`, `right-half`, `top-half`, `bottom-half`
  - Corners: `top-left`, `top-right`, `bottom-left`, `bottom-right`
- **Activation style:** Pointer proximity bands near edges/corners (magnetic “snap bands”) trigger preview overlays. On release, the window snaps into the zone rectangle.
- **Gap rule:** Apply a global gap G (e.g. 8px) between windows and from the viewport edges so windows never “touch.”
- **Performance:** During drag/resize, mutate element styles directly with requestAnimationFrame; update React state only on mouseup. Keep overlays lightweight.

### UX Requirements
- **Discoverability:** When a window is dragged toward an edge or corner, show a translucent preview of the destination tile and a subtle highlight for the active zone.
- **Intuitive snap lock:** A generous activation band (~32–40px) around edges/corners; snap only after mouseup to avoid surprise jumps. Keep a soft “magnet” when pointer remains in band.
- **Cancel / override:**
  - Press `Esc` to cancel snapping and drop the window where it is.
  - Hold `Alt` (or `Option`) to disable snap detection for that drag.
- **Resize while snapped:** When a snapped window is resized, either (a) remain locked to the zone and resize within it (respecting min size), or (b) break free when the resize exceeds a small threshold away from zone bounds. The recommended default is to remain within tile until user drags significantly away.
- **Tiny gaps:** Always leave a gap between adjacent tiles and between tiles and the desktop edges. Use the same constant gap G for consistency.
- **Visual indicators:**
  - Global overlay canvas with a dashed preview rectangle in the target zone.
  - When pointer moves out of bands, preview fades out.

### Geometry: Zones and Gaps
- Let G be the gap (default 8px).
- Let `vw`, `vh` be viewport width/height and `g2 = 2 * G`.
- Define the 8 target rectangles with G inset from edges and between halves/quadrants. Example:

```ts
type Geometry = { left: number; top: number; width: number; height: number };
type SnapZoneId =
  | 'left-half' | 'right-half' | 'top-half' | 'bottom-half'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function computeSnapRects(vw: number, vh: number, gap: number): Record<SnapZoneId, Geometry> {
  const G = gap;
  const g2 = G * 2;
  const halfW = Math.floor(vw / 2);
  const halfH = Math.floor(vh / 2);
  return {
    'left-half':     { left: G, top: G, width: Math.max(0, halfW - G - G/2), height: vh - g2 },
    'right-half':    { left: halfW + G/2, top: G, width: Math.max(0, halfW - G - G/2), height: vh - g2 },
    'top-half':      { left: G, top: G, width: vw - g2, height: Math.max(0, halfH - G - G/2) },
    'bottom-half':   { left: G, top: halfH + G/2, width: vw - g2, height: Math.max(0, halfH - G - G/2) },
    'top-left':      { left: G, top: G, width: Math.max(0, halfW - G - G/2), height: Math.max(0, halfH - G - G/2) },
    'top-right':     { left: halfW + G/2, top: G, width: Math.max(0, halfW - G - G/2), height: Math.max(0, halfH - G - G/2) },
    'bottom-left':   { left: G, top: halfH + G/2, width: Math.max(0, halfW - G - G/2), height: Math.max(0, halfH - G - G/2) },
    'bottom-right':  { left: halfW + G/2, top: halfH + G/2, width: Math.max(0, halfW - G - G/2), height: Math.max(0, halfH - G - G/2) },
  };
}
```

Notes:
- All rects are inset by G from the outer edges and split lines.
- Using `Math.floor(vw/2)` avoids fractional pixels; we separately subtract split gaps.

### Snap Detection Algorithm
- Core idea: compute “activation bands” along edges and corners where snap should occur. Two robust options:
  1) Region‑based: Check if pointer is within a corner region (square band of size T) or edge band (strip of width T). Corners win over edges when both match.
  2) Distance‑based: Compute distance to each canonical zone center or boundary; pick the nearest within a max threshold.

Recommended simple approach (region‑based, with T ≈ 36px):
```ts
function detectZone(pointerX: number, pointerY: number, vw: number, vh: number, T = 36): SnapZoneId | null {
  const nearLeft = pointerX <= T;
  const nearRight = pointerX >= vw - T;
  const nearTop = pointerY <= T;
  const nearBottom = pointerY >= vh - T;

  if (nearLeft && nearTop) return 'top-left';
  if (nearRight && nearTop) return 'top-right';
  if (nearLeft && nearBottom) return 'bottom-left';
  if (nearRight && nearBottom) return 'bottom-right';
  if (nearLeft) return 'left-half';
  if (nearRight) return 'right-half';
  if (nearTop) return 'top-half';
  if (nearBottom) return 'bottom-half';
  return null;
}
```

Enhancements:
- Introduce hysteresis so the preview doesn’t flicker when hovering near boundaries.
- Allow a keyboard modifier (e.g., hold Shift) to cycle alternative zones while staying near one edge.

### Visual Indicators
- A single absolutely positioned overlay element with `pointer-events:none` covering the desktop.
- A dashed rectangle (`.snap-preview`) shows the target rect; transitions for opacity/scale for smoothness.
- Corner/edge highlight classes can be toggled for extra feedback.

Example CSS (lightweight):
```css
.snap-overlay { position: absolute; inset: 0; pointer-events: none; }
.snap-preview { position: absolute; border: 2px dashed rgba(56,189,248,.85); background: rgba(56,189,248,.08);
  border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,.25); opacity: .001; transform: scale(.98);
  transition: opacity .14s ease, transform .14s ease; }
.snap-preview.active { opacity: 1; transform: scale(1); }
```

### Performance Strategy
- During drag/resize, mutate the window’s style (`left`, `top`, `width`, `height`) inside `requestAnimationFrame` and keep React out of the hot path; commit once on mouseup.
- Ensure windows are layer‑promoted: `transform: translateZ(0)`, `backface-visibility:hidden`, `contain: layout paint`, and targeted `will-change`.
- Disable selection globally during gestures; clear selections in both the host and the child iframe to prevent accidental highlights.
- Avoid per‑chunk logging and micro‑progress updates in dev install/serve streams (already implemented upstream) to reduce main‑thread jank.

### Resize and Tiling Interop
- If a snapped window is resized within its zone, keep the resulting geometry clamped to the zone rect minus GAP.
- When the user drags the edges far enough away from tile bounds (e.g., > 24px beyond), detach from the zone and become a free‑form window.
- On subsequent drag near edges, re‑offer tile previews.

### Accessibility and Keyboard
- Announce snap zones to screen readers as landmarks only when previews are visible.
- Keyboard: while dragging, allow `Shift` to cycle compatible zones for the current edge. `Esc` cancels.

### Implementation Plan (Phased)
1) Data and constants
   - Re‑introduce `SnapZoneId` (8 enums) and a `GAP` constant in `Desktop.tsx`.
   - Add helpers: `computeSnapRects(vw, vh, GAP)`, `detectZone(x, y, vw, vh, T)`.
2) Overlay layer
   - Add `.snap-overlay` and `.snap-preview` container in `Desktop` just under wallpaper.
   - Toggle visibility on drag start; update preview rect on drag move; hide on drop/cancel.
3) Drag lifecycle integration
   - On drag start, compute active zone (if any) and show preview.
   - On drag move, recompute active zone and preview rect; keep UI reactive but do DOM writes in rAF.
   - On mouseup: if a zone is active, commit `updateWindow(id, rectForZone(zone))`; else, commit free‑form geometry.
4) Gap enforcement
   - Ensure all tile rects are inset by GAP; when committing free‑form resizes near viewport edges, “magnetize” to leave GAP rather than touching the edge.
5) Persistence
   - Persist snapped geometry in localStorage along with free‑form geometries so next boot restores layout.
6) Performance polish
   - Verify main‑thread time: style updates only in rAF; a single overlay element; no extra reflows.
   - Confirm `user-select:none` during drag; remove it on drop.
7) QA
   - Verify all 8 zones; test various viewport sizes; ensure min sizes respected.
   - Check no visual seams: windows have constant GAP between each other and from edges.

### Open Questions / Options
- Support more complex snap layouts (e.g., thirds or 2×3 for six windows) in a second iteration.
- Per‑window “locked” state UI badge when snapped to a zone? Optional.
- Keyboard‑only tiling (e.g., Win+Arrow style) as an enhancement.

### Acceptance Criteria
- Dragging a window near an edge/corner shows a clear preview; on release, the window snaps into the precise tile with GAP.
- Up to eight tiles are supported, with windows never touching each other or the desktop edges.
- Drag/resize interactions remain smooth at 60fps on typical hardware.

