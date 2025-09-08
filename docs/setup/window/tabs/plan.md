## Tabbed Windows — Implementation Plan (files, steps, snippets)

This plan implements tabs inside windows, with a New Tab (+) flow, app launcher in blank tabs, and cross-window tab drag-and-drop, while maintaining smooth performance.

### Overview of Changes
- `templates/webcontainer/src/desktop/Desktop.tsx`
  - Add tab types and persistence helpers.
  - Maintain `windowTabs` state keyed by window id.
  - Seed tabs on window creation; restore from localStorage.
  - Wire tab operations to the `Window` component.
  - Implement cross-window tab DnD via a single overlay and imperative DOM updates.

- `templates/webcontainer/src/desktop/styles.css`
  - Add tabstrip styles, overflow gradients, active/hover styles, close button, and + button.
  - Add insertion marker style for DnD.

- `templates/webcontainer/src/desktop/Desktop.tsx` (Window component)
  - Render tabstrip under titlebar.
  - Render either app iframe or launcher grid for blank tabs.
  - Handle in-window tab reorder via drag; delegate cross-window via Desktop overlay.

### Data Model & Storage

Add types and storage helpers in `Desktop.tsx` (near other persistence helpers):

```ts
type WindowTab = {
  id: string;         // unique per tab within a window
  appId: string | null;
  title: string;
  icon?: string;
  path?: string;
};

type WindowTabsState = {
  activeTabId: string;
  tabs: WindowTab[];
};

const LS_WINDOW_TABS_KEY = 'desktop.windowTabs';

function loadWindowTabs(): Record<string, WindowTabsState> {
  try { return JSON.parse(localStorage.getItem(LS_WINDOW_TABS_KEY) || '{}') || {}; } catch { return {}; }
}

function saveWindowTabs(map: Record<string, WindowTabsState>) {
  try { localStorage.setItem(LS_WINDOW_TABS_KEY, JSON.stringify(map)); } catch {}
}
```

### Desktop State & Seeding Tabs

In `Desktop()` component state:

```ts
const [windowTabs, setWindowTabs] = useState<Record<string, WindowTabsState>>({});

useEffect(() => { setWindowTabs(loadWindowTabs()); }, []);

const persistWindowTabs = (updater: (prev: Record<string, WindowTabsState>) => Record<string, WindowTabsState>) => {
  setWindowTabs(prev => { const next = updater(prev); saveWindowTabs(next); return next; });
};
```

When launching a window (inside `launch(app)`), seed tabs for new windows:

```ts
function ensureWindowTabsFor(app: App) {
  persistWindowTabs(prev => {
    if (prev[app.id]) return prev;
    const first: WindowTab = { id: crypto.randomUUID(), appId: app.id, title: app.name, icon: app.icon, path: app.path };
    return { ...prev, [app.id]: { activeTabId: first.id, tabs: [first] } };
  });
}

// after creating `created` window in launch(...)
ensureWindowTabsFor(created);
```

### Tab Operations in Desktop

Add operations that Desktop passes to `Window`:

```ts
function addTab(windowId: string) {
  persistWindowTabs(prev => {
    const curr = prev[windowId] || { activeTabId: '', tabs: [] };
    const tab: WindowTab = { id: crypto.randomUUID(), appId: null, title: 'New Tab' };
    return { ...prev, [windowId]: { activeTabId: tab.id, tabs: [...curr.tabs, tab] } };
  });
}

function closeTab(windowId: string, tabId: string) {
  persistWindowTabs(prev => {
    const curr = prev[windowId]; if (!curr) return prev;
    const idx = curr.tabs.findIndex(t => t.id === tabId); if (idx < 0) return prev;
    const nextTabs = curr.tabs.filter(t => t.id !== tabId);
    const nextActive = curr.activeTabId === tabId ? (nextTabs[idx - 1]?.id || nextTabs[0]?.id || '') : curr.activeTabId;
    return { ...prev, [windowId]: { tabs: nextTabs, activeTabId: nextActive } };
  });
}

function activateTab(windowId: string, tabId: string) {
  persistWindowTabs(prev => ({ ...prev, [windowId]: { ...prev[windowId], activeTabId: tabId } }));
}

function reorderTabs(windowId: string, fromIndex: number, toIndex: number) {
  persistWindowTabs(prev => {
    const curr = prev[windowId]; if (!curr) return prev;
    const list = curr.tabs.slice(); const [moved] = list.splice(fromIndex, 1); list.splice(toIndex, 0, moved);
    return { ...prev, [windowId]: { ...curr, tabs: list } };
  });
}

function openAppIntoTab(windowId: string, tabId: string, appLike: App) {
  persistWindowTabs(prev => {
    const curr = prev[windowId]; if (!curr) return prev;
    const list = curr.tabs.map(t => t.id === tabId ? ({ ...t, appId: appLike.id, title: appLike.name, icon: appLike.icon, path: appLike.path }) : t);
    return { ...prev, [windowId]: { ...curr, tabs: list, activeTabId: tabId } };
  });
}
```

Pass tabs and handlers into each `Window` render:

```tsx
{open.map((app, idx) => {
  const tabsState = windowTabs[app.id] || { activeTabId: '', tabs: [] };
  return (
    <Window
      key={app.id}
      app={app}
      zIndex={100 + idx}
      onClose={()=>close(app.id)}
      onMinimize={()=>minimize(app.id)}
      onFocus={()=>focus(app.id)}
      onMove={(pos)=>updateWindow(app.id, pos)}
      onResize={(size)=>updateWindow(app.id, size)}
      tabs={tabsState.tabs}
      activeTabId={tabsState.activeTabId}
      onTabActivate={(id)=>activateTab(app.id, id)}
      onTabClose={(id)=>closeTab(app.id, id)}
      onTabReorder={(from,to)=>reorderTabs(app.id, from, to)}
      onNewTab={()=>addTab(app.id)}
      onOpenAppInTab={(tabId, a)=>openAppIntoTab(app.id, tabId, a)}
    />
  );
})}
```

### Window Component: Tabstrip & Content Switcher

Extend `WindowProps` and render the tabstrip (under the titlebar). In `Window`:

```ts
interface WindowProps {
  app: App; zIndex: number;
  onClose: ()=>void; onMinimize: ()=>void; onFocus: ()=>void;
  onMove: (pos:{left:number;top:number})=>void; onResize:(s:{width:number;height:number})=>void;
  tabs: WindowTab[]; activeTabId: string;
  onTabActivate: (tabId: string)=>void;
  onTabClose: (tabId: string)=>void;
  onTabReorder: (fromIdx:number, toIdx:number)=>void;
  onNewTab: ()=>void;
  onOpenAppInTab: (tabId:string, app:App)=>void;
}
```

In render, compute `activeTab` and switch content:

```tsx
const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
const isBlank = !activeTab || !activeTab.appId;
const iframeSrc = !isBlank ? `/app.html?path=${encodeURIComponent(activeTab.path||'')}&id=${encodeURIComponent(activeTab.appId||'')}&name=${encodeURIComponent(activeTab.title)}&base=0&ui=1&tw=1` : '';

<div className="titlebar"> ... </div>
<nav className="tabstrip" role="tablist" aria-label="Tabs" onMouseDown={e=>e.stopPropagation()}>
  {tabs.map((t, i) => (
    <button key={t.id} role="tab" aria-selected={t.id===activeTabId}
      className={`tab${t.id===activeTabId?' active':''}`}
      onClick={()=>onTabActivate(t.id)}
      onMouseDown={(e)=>startTabDrag(e, i)}>
      <span className="tab-ico">{t.icon||'📦'}</span>
      <span className="tab-title">{t.title}</span>
      <span className="tab-close" onClick={(e)=>{ e.stopPropagation(); onTabClose(t.id); }}>×</span>
    </button>
  ))}
  <button className="tab-add" aria-label="New tab" onClick={onNewTab}>+</button>
  <div className="tab-gradient-left" />
  <div className="tab-gradient-right" />
  <div className="tab-insert-marker" aria-hidden />
  {/* insert-marker is positioned by Desktop during DnD */}
  {/* local in-window reorder can be supported here too */}
  </nav>

<div className="content">
  {isBlank ? (
    <LauncherGrid apps={/* use registry */} onPick={(a)=> onOpenAppInTab(activeTab?.id||tabs[0].id, a)} />
  ) : (
    <iframe title={activeTab.title} src={iframeSrc} ... />
  )}
</div>
```

Launcher grid can be a tiny inline component that lists apps from the registry (you already fetch `apps` in `Desktop`). Pass that array down or query from parent.

### Cross-Window Tab DnD (Desktop Overlay)

Add a single overlay (sibling to wallpaper/icons) and use imperative updates for performance:

```tsx
<div ref={overlayRef} className="tab-dnd-overlay" style={{display:'none'}} aria-hidden>
  <div ref={ghostRef} className="tab-dnd-ghost" />
  <div ref={insertRef} className="tab-insert-indicator" />
</div>
```

DnD flow in `Desktop`:
- On tab mousedown in `Window.startTabDrag`, emit a custom event (or call a prop) with windowId and tab index.
- Desktop sets `dragState` (sourceWindowId, tabId, startX, startY), shows overlay, builds a list of tabstrip rects for all windows.
- On `mousemove`:
  - Update ghost position (transform) via rAF.
  - Hit-test tabstrips to find target window and insertion index; position `insertRef` line.
- On `mouseup`:
  - If over a tabstrip → remove tab from source, insert into target at index (update both windows in `windowTabs`).
  - Else → create a new `App` window seeded with this tab (geometry based on drop point); remove from source.
  - Hide overlay and clear `dragState`.

Key implementation points:
- Avoid React state churn while dragging — only commit on drop.
- Cache `getBoundingClientRect()` per animation frame for all tabstrips.
- Use `pointer-events:none` on overlay; accept events on document.

### CSS (styles.css)

Add tabstrip and overlay styles:

```css
.tabstrip{position:relative; display:flex; align-items:center; gap:6px; height:32px; padding:0 8px; border-bottom:1px solid rgba(0,0,0,.06); background:linear-gradient(to bottom, rgba(255,255,255,.85), rgba(255,255,255,.7)); overflow:hidden}
.tab{display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px; border:1px solid transparent; border-radius:6px; background:transparent; color:#111; cursor:default; user-select:none}
.tab.active{background:#f3f4f6; border-color:#e5e7eb}
.tab:hover{background:#f8fafc}
.tab-ico{font-size:12px}
.tab-close{margin-left:6px; opacity:.6; cursor:pointer}
.tab-close:hover{opacity:1}
.tab-add{margin-left:auto; height:22px; width:22px; border-radius:999px; background:#f3f4f6; border:1px solid #e5e7eb; line-height:20px; text-align:center}
.tab-gradient-left,.tab-gradient-right{position:absolute; top:0; bottom:0; width:24px; pointer-events:none}
.tab-gradient-left{left:0; background:linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0))}
.tab-gradient-right{right:0; background:linear-gradient(to left, rgba(255,255,255,1), rgba(255,255,255,0))}
.tab-insert-marker{position:absolute; bottom:3px; width:2px; height:18px; background:#38bdf8; border-radius:1px; display:none}

.tab-dnd-overlay{position:absolute; inset:0; pointer-events:none; z-index:99999}
.tab-dnd-ghost{position:absolute; padding:4px 8px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,.18)}
.tab-insert-indicator{position:absolute; width:2px; height:18px; background:#38bdf8; border-radius:1px}
```

### Launcher Grid (blank tab)

Simple inline component under `Window` (or shared):

```tsx
function LauncherGrid({ apps, onPick }:{ apps: App[]; onPick:(a:App)=>void }){
  return (
    <div className="launcher-grid">
      {apps.map(a => (
        <button key={a.id} className="launcher-item" onClick={()=>onPick(a)}>
          <div className="glyph">{a.icon||'📦'}</div>
          <div className="label">{a.name}</div>
        </button>
      ))}
    </div>
  );
}
```

CSS helpers:

```css
.launcher-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:12px; padding:12px}
.launcher-item{display:flex; flex-direction:column; align-items:center; gap:8px; padding:12px; border:1px solid #e5e7eb; border-radius:10px; background:#fff}
.launcher-item .glyph{font-size:24px}
```

### Cross-Window Move API Surface

You may opt to use a simple in-app event bus (e.g., `window.dispatchEvent(new CustomEvent('FYOS_TAB_DND', { detail }))`) from `Window.startTabDrag`, and capture in `Desktop` to drive overlay + commit. This decouples window markup from global overlay logic and mirrors the pattern used for window tiling.

Event shapes:
- `phase: 'start' | 'move' | 'end'`, `windowId`, `tabId`, `pointer: {x,y}`.

### Persistence & Restore
- On boot: load `windowTabs`, ensure each open window has a tabs entry (seed with a single tab for its `app`).
- On change: write `LS_WINDOW_TABS_KEY`.

### Performance Checklist
- All drag visuals updated via rAF; no React state mutations during pointer move.
- Only one overlay for tab DnD; `pointer-events:none`.
- Avoid `console.log` in hot paths.

### Rollout Steps
1) Add types + storage + Desktop state.
2) Implement tabstrip UI and content switcher in `Window` (no DnD yet).
3) Hook launcher for blank tabs; clicking app binds iframe in tab.
4) Add in-window reorder (optional), then cross-window DnD overlay.
5) Persistence glue and QA.

### Testing
- Open multiple windows; create/close/reorder tabs; verify persistence on reload.
- Drag tab across windows; ensure geometry and active indices are correct.
- New tab shows launcher and loading app binds to that tab only.


