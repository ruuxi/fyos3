import React, { useEffect, useRef, useState } from 'react'

// Shared constants
const DEFAULT_WINDOW_POS = { left: 90, top: 90 }
const DEFAULT_WINDOW_SIZE = { width: 720, height: 720 }
const MIN_WINDOW_SIZE = { width: 280, height: 160 }

// kept for reference; removed unused constants to satisfy linter

const OPEN_RESTORE_MS = 340
const CLOSE_MS = 220
const MINIMIZE_MS = 220

const LS_ICON_POS_KEY = 'desktop.iconPositions'
const LS_WINDOW_GEOM_KEY = 'desktop.windowGeometries'
const LS_WINDOW_TABS_KEY = 'desktop.windowTabs'
const LS_APP_ORDER_KEY = 'desktop.appOrder'

const EVT_OPEN_APP = 'FYOS_OPEN_APP'
const EVT_DESKTOP_READY = 'FYOS_DESKTOP_READY'
const THEME_KEY = 'fyos.desktop.theme'
const EVT_SET_THEME = 'FYOS_SET_THEME'
const EVT_USER_MODE = 'FYOS_USER_MODE'

const DESKTOP_GRID = { spacingX: 90, spacingY: 90, startX: 16, startY: 52, maxPerCol: 6 }

// Reserved sidebar width for the new left app list (disabled)
const SIDEBAR_WIDTH = 0

type Geometry = { left: number; top: number; width: number; height: number }
type SnapZoneId =
  | 'left-half' | 'right-half' | 'top-half' | 'bottom-half'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// Visual gap to keep from edges and between tiles
const GAP = 16

// Helpers
function clampToViewport(left: number, top: number, width: number, height: number){
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Enforce a consistent visual gap from all edges (instead of partial visibility)
  const minLeft = GAP + SIDEBAR_WIDTH
  const maxLeft = Math.max(GAP + SIDEBAR_WIDTH, vw - width - GAP)
  const minTop = GAP
  const maxTop = Math.max(GAP, vh - height - GAP)
  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop)
  }
}

function resolveAppGeometry(app: App): Geometry{
  return {
    left: app.left ?? DEFAULT_WINDOW_POS.left,
    top: app.top ?? DEFAULT_WINDOW_POS.top,
    width: app.width ?? DEFAULT_WINDOW_SIZE.width,
    height: app.height ?? DEFAULT_WINDOW_SIZE.height,
  }
}

// (removed unused resolveInitialGeometry)

function bounceIcon(setLaunching: React.Dispatch<React.SetStateAction<string | null>>, id: string, ms = 600){
  setLaunching(id)
  setTimeout(()=> setLaunching(prev => prev === id ? null : prev), ms)
}

function loadIconPositions(): Record<string, { left: number; top: number }>{
  try{
    const raw = localStorage.getItem(LS_ICON_POS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveIconPositions(pos: Record<string, { left: number; top: number }>): void{
  try{ localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(pos)) } catch{}
}

function loadWindowGeometries(): Record<string, { left: number; top: number; width: number; height: number }>{
  try{
    const raw = localStorage.getItem(LS_WINDOW_GEOM_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveWindowGeometries(geoms: Record<string, { left: number; top: number; width: number; height: number }>): void{
  try{ localStorage.setItem(LS_WINDOW_GEOM_KEY, JSON.stringify(geoms)) } catch{}
}

function loadWindowTabs(): Record<string, WindowTabsState> {
  try { return JSON.parse(localStorage.getItem(LS_WINDOW_TABS_KEY) || '{}') || {}; } catch { return {}; }
}

function saveWindowTabs(map: Record<string, WindowTabsState>) {
  try { localStorage.setItem(LS_WINDOW_TABS_KEY, JSON.stringify(map)); } catch {}
}

function loadAppOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_APP_ORDER_KEY) || '[]') || []; } catch { return []; }
}

function saveAppOrder(order: string[]) {
  try { localStorage.setItem(LS_APP_ORDER_KEY, JSON.stringify(order)); } catch {}
}

async function loadRegistry(): Promise<App[]>{
  const res = await fetch('/apps/registry.json?_=' + Date.now())
  return res.ok ? res.json() : []
}

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

interface App {
  id: string
  name: string
  icon?: string
  path: string
  left?: number
  top?: number
  width?: number
  height?: number
  minimized?: boolean
  anim?: 'open' | 'close' | 'minimize' | 'restore'
}

interface WindowProps {
  app: App
  zIndex: number
  onClose: () => void
  onMinimize: () => void
  onFocus: () => void
  onMove: (pos: { left: number; top: number }) => void
  onResize: (size: { width: number; height: number }) => void
  tabs: WindowTab[]
  activeTabId: string
  onTabActivate: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onOpenAppInTab: (tabId: string, app: App) => void
  availableApps: App[]
}

// Top menubar removed

function LauncherGrid({ apps, onPick }: { apps: App[]; onPick: (a: App) => void }) {
  return (
    <div className="launcher-grid">
      {apps.map(a => (
        <button key={a.id} className="launcher-item" onClick={() => onPick(a)}>
          <div className="glyph">{a.icon || '📦'}</div>
          <div className="label">{a.name}</div>
        </button>
      ))}
    </div>
  );
}

function Window({ app, zIndex, onClose, onMinimize, onFocus, onMove, onResize, tabs, activeTabId, onTabActivate, onTabClose, onNewTab, onOpenAppInTab, availableApps }: WindowProps){
  const rootRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const draggingRef = useRef<{
    type: 'move' | 'resize' | null
    startX: number
    startY: number
    startLeft: number
    startTop: number
    startWidth: number
    startHeight: number
    handle?: 'nw'|'ne'|'sw'|'se'
    active: boolean
    curDx?: number
    curDy?: number
    curLeft?: number
    curTop?: number
    curWidth?: number
    curHeight?: number
  }>({ type: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0, active: false })

  function clearSelectionEverywhere(){
    try{ window.getSelection()?.removeAllRanges() } catch {}
    try{
      const iframe = rootRef.current?.querySelector('iframe') as HTMLIFrameElement | null
      const sel = iframe?.contentWindow?.getSelection()
      if (sel && sel.rangeCount > 0) sel.removeAllRanges()
    } catch {}
  }

  function scheduleApply(){
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(()=>{
      rafIdRef.current = null
      const d = draggingRef.current
      const el = rootRef.current
      if (!el || !d.active) return
      if (d.type === 'move'){
        const dx = d.curDx ?? 0
        const dy = d.curDy ?? 0
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      } else if (d.type === 'resize'){
        if (typeof d.curLeft === 'number') el.style.left = `${d.curLeft}px`
        if (typeof d.curTop === 'number') el.style.top = `${d.curTop}px`
        if (typeof d.curWidth === 'number') el.style.width = `${d.curWidth}px`
        if (typeof d.curHeight === 'number') el.style.height = `${d.curHeight}px`
      }
    })
  }

  useEffect(()=>{
    // Drag loop: use rAF and transform to avoid React state churn
    function onMoveDoc(e: MouseEvent){
      const d = draggingRef.current
      if (!d.active || !d.type) return
      e.preventDefault()
      const el = rootRef.current
      if (!el) return
      if (d.type === 'move'){
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        // Store deltas; apply via rAF transform
        d.curDx = dx
        d.curDy = dy
        scheduleApply()
        // Broadcast for snap overlay
        try {
          const geom = resolveAppGeometry(app)
          const pos = clampToViewport(geom.left + dx, geom.top + dy, geom.width, geom.height)
          window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'move', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: { left: pos.left, top: pos.top, width: geom.width, height: geom.height }, altKey: e.altKey } }))
        } catch {}
      } else if (d.type === 'resize'){
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        let newW = d.startWidth
        let newH = d.startHeight
        let newL = d.startLeft
        let newT = d.startTop
        const minW = MIN_WINDOW_SIZE.width
        const minH = MIN_WINDOW_SIZE.height
        switch(d.handle){
          case 'se': newW = Math.max(minW, d.startWidth + dx); newH = Math.max(minH, d.startHeight + dy); break
          case 'ne': newW = Math.max(minW, d.startWidth + dx); newH = Math.max(minH, d.startHeight - dy); newT = d.startTop + dy; break
          case 'sw': newW = Math.max(minW, d.startWidth - dx); newH = Math.max(minH, d.startHeight + dy); newL = d.startLeft + dx; break
          case 'nw': newW = Math.max(minW, d.startWidth - dx); newH = Math.max(minH, d.startHeight - dy); newL = d.startLeft + dx; newT = d.startTop + dy; break
        }
        if (newW < minW) newW = minW
        if (newH < minH) newH = minH
        const pos = clampToViewport(newL, newT, newW, newH)
        d.curLeft = pos.left
        d.curTop = pos.top
        d.curWidth = newW
        d.curHeight = newH
        scheduleApply()
        try {
          window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'move', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: { left: pos.left, top: pos.top, width: newW, height: newH }, altKey: e.altKey } }))
        } catch {}
      }
    }
    function onUp(e: MouseEvent){
      const d = draggingRef.current
      if (d.active && d.type){
        const isMove = d.type === 'move'
        if (isMove){
          const dx = (d.curDx ?? 0)
          const dy = (d.curDy ?? 0)
          const geom = resolveAppGeometry(app)
          const pos = clampToViewport(geom.left + dx, geom.top + dy, geom.width, geom.height)
          // Commit to React once
          onMove({ left: pos.left, top: pos.top })
          try { const el = rootRef.current; if (el){ el.style.transform = ''; } } catch {}
          try { window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'end', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: { left: pos.left, top: pos.top, width: geom.width, height: geom.height } } })) } catch {}
        } else {
          const width = d.curWidth ?? d.startWidth
          const height = d.curHeight ?? d.startHeight
          const left = d.curLeft ?? d.startLeft
          const top = d.curTop ?? d.startTop
          onMove({ left, top })
          onResize({ width, height })
          try { window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'end', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: { left, top, width, height } } })) } catch {}
        }
        clearSelectionEverywhere()
        try{ rootRef.current?.classList.remove('resizing') } catch {}
        try{ document.body.classList.remove('desktop-resizing') } catch {}
        try{ document.body.style.userSelect = '' } catch {}
        try{ (document.body.style as any).webkitUserSelect = '' } catch {}
        try{ document.body.style.cursor = '' } catch {}
      }
      draggingRef.current.active = false; draggingRef.current.type = null
    }
    document.addEventListener('mousemove', onMoveDoc)
    document.addEventListener('mouseup', onUp)
    return ()=>{
      document.removeEventListener('mousemove', onMoveDoc)
      document.removeEventListener('mouseup', onUp)
    }
  }, [app, onMove, onResize])

  function startMove(e: React.MouseEvent){
    e.preventDefault()
    onFocus()
    const g = resolveAppGeometry(app)
    draggingRef.current = {
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startLeft: g.left,
      startTop: g.top,
      startWidth: g.width,
      startHeight: g.height,
      active: true
    }
    try{ rootRef.current?.classList.add('resizing') } catch {}
    try{ document.body.classList.add('desktop-resizing') } catch {}
    try{ document.body.style.userSelect = 'none' } catch {}
    try{ (document.body.style as any).webkitUserSelect = 'none' } catch {}
    try{ document.body.style.cursor = 'grabbing' } catch {}
    // Avoid costly selection updates during drag; clear once at start
    clearSelectionEverywhere()
    try { window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'start', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: g } })) } catch {}
  }

  function startResize(handle: 'nw'|'ne'|'sw'|'se'){
    return (e: React.MouseEvent)=>{
      e.stopPropagation()
      e.preventDefault()
      onFocus()
      const g = resolveAppGeometry(app)
      draggingRef.current = {
        type: 'resize',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: g.left,
        startTop: g.top,
        startWidth: g.width,
        startHeight: g.height,
        active: true
      }
      try{ rootRef.current?.classList.add('resizing') } catch {}
      try{ document.body.classList.add('desktop-resizing') } catch {}
      try{ document.body.style.userSelect = 'none' } catch {}
      try{ (document.body.style as any).webkitUserSelect = 'none' } catch {}
      try{
        const map: Record<string,string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
        document.body.style.cursor = map[handle] || 'nwse-resize'
      } catch {}
      // Avoid costly selection updates during drag; clear once at start
      clearSelectionEverywhere()
      try { window.dispatchEvent(new CustomEvent('FYOS_TILING', { detail: { phase: 'start', id: app.id, pointer: { x: e.clientX, y: e.clientY }, geom: g } })) } catch {}
    }
  }
  const classes = ['window']
  if (app.anim === 'open' || app.anim === 'restore') classes.push('opening')
  if (app.anim === 'close') classes.push('closing')
  if (app.anim === 'minimize') classes.push('minimizing')
  if (app.minimized && !app.anim) classes.push('minimized')

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const isBlank = !activeTab || !activeTab.appId;
  const iframeSrc = !isBlank ? `/app.html?path=${encodeURIComponent(activeTab.path||'')}&id=${encodeURIComponent(activeTab.appId||'')}&name=${encodeURIComponent(activeTab.title)}&base=0&ui=1&tw=1` : '';

  return (
    <div ref={rootRef} className={classes.join(' ')} style={{ ...resolveAppGeometry(app), zIndex, background: 'rgba(12,18,36,0.10)' }} onMouseDown={onFocus}>
      <nav className="tabstrip" role="tablist" aria-label="Tabs" onMouseDown={startMove}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id===activeTabId}
            className={`tab${t.id===activeTabId?' active':''}`}
            onClick={()=>onTabActivate(t.id)}
            onMouseDown={(e)=>e.stopPropagation()}>
            <span className="tab-ico">{t.icon||'📦'}</span>
            <span className="tab-title">{t.title}</span>
            <span className="tab-close" onClick={(e)=>{ e.stopPropagation(); onTabClose(t.id); }}>×</span>
          </button>
        ))}
        <button className="tab-add" aria-label="New tab" onClick={onNewTab} onMouseDown={(e)=>e.stopPropagation()}>+</button>
        <div className="win-controls" onMouseDown={(e)=>e.stopPropagation()}>
          <button className="ctl ctl-close" aria-label="Close" onClick={onClose} />
          <button className="ctl ctl-min" aria-label="Minimize" onClick={onMinimize} />
          <button className="ctl ctl-expand" aria-label="Expand" onClick={()=>{
            try {
              const vw = window.innerWidth; const vh = window.innerHeight; const M = 12;
              const left = SIDEBAR_WIDTH + M; const top = M; const width = Math.max(0, vw - SIDEBAR_WIDTH - (M*2)); const height = Math.max(0, vh - (M*2));
              onMove({ left, top }); onResize({ width, height });
            } catch {}
          }} />
        </div>
        <div className="tab-gradient-left" />
        <div className="tab-gradient-right" />
        <div className="tab-insert-marker" aria-hidden />
      </nav>
      <div className="content" style={{ top: '32px', background: 'transparent' }}>
        {isBlank ? (
          <LauncherGrid apps={availableApps} onPick={(a) => onOpenAppInTab(activeTab?.id || tabs[0]?.id || '', a)} />
        ) : (
          <iframe
            title={activeTab.title}
            src={iframeSrc}
            style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation allow-downloads"
            onError={(e) => {
              console.warn('Iframe error for app:', activeTab.title, e);
            }}
          />
        )}
      </div>
      <div className="resize-handle nw" onMouseDown={startResize('nw')} />
      <div className="resize-handle ne" onMouseDown={startResize('ne')} />
      <div className="resize-handle sw" onMouseDown={startResize('sw')} />
      <div className="resize-handle se" onMouseDown={startResize('se')} />
    </div>
  )
}

export default function Desktop(){
  const [apps, setApps] = useState<App[]>([])
  const appsByIdRef = useRef<Record<string, App>>({})
  const [appOrder, setAppOrder] = useState<string[]>([])
  const [userMode, setUserMode] = useState<'auth'|'anon'>('auth')
  const [theme, setTheme] = useState<{ mode: 'image'|'gradient'; value: string } | null>(null)
  // const [bootscreen, setBootscreen] = useState<boolean>(false)
  // const [gradientKey, setGradientKey] = useState<string>('1')
  // const gradientVar = `var(--desktop-gradient-${gradientKey})`
  // Seed localStorage desktop state from persisted file if present
  useEffect(() => {
    (async () => {
      try {
        if (userMode === 'anon') return;
        const res = await fetch('/_fyos/desktop-state.json?_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (json && typeof json === 'object') {
          try { if (json.theme && (json.theme.mode === 'image' || json.theme.mode === 'gradient') && typeof json.theme.value === 'string') { localStorage.setItem(THEME_KEY, JSON.stringify(json.theme)); setTheme(json.theme); } } catch {}
          try { if (json.iconPositions) localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(json.iconPositions)); } catch {}
          try { if (json.windowGeometries) localStorage.setItem(LS_WINDOW_GEOM_KEY, JSON.stringify(json.windowGeometries)); } catch {}
          try { if (json.windowTabs) localStorage.setItem(LS_WINDOW_TABS_KEY, JSON.stringify(json.windowTabs)); } catch {}
          try { if (json.appOrder) localStorage.setItem(LS_APP_ORDER_KEY, JSON.stringify(json.appOrder)); } catch {}
        }
      } catch {}
    })();
  }, [userMode])
  // Announce readiness to host so it can flush any pending open-app messages
  useEffect(()=>{
    try { window.parent?.postMessage({ type: EVT_DESKTOP_READY }, '*') } catch {}
  }, [])
  // Ensure root container stretches full viewport
  useEffect(()=>{
    try{
      const root = document.getElementById('root')
      if (root){
        root.style.height = '100%'
        root.style.width = '100%'
      }
      document.documentElement.style.height = '100%'
      document.documentElement.style.width = '100%'
      document.body.style.height = '100%'
      document.body.style.width = '100%'
      document.body.style.margin = '0'
    } catch {}
  }, [])
  // React to theme changes from other windows (BootScreen)
  useEffect(()=>{
    function onStorage(e: StorageEvent){
      try{
        if (e.key === THEME_KEY && e.newValue){
          const t = JSON.parse(e.newValue)
          if (t && (t.mode === 'image' || t.mode === 'gradient') && typeof t.value === 'string') setTheme(t)
        }
      } catch {}
    }
    window.addEventListener('storage', onStorage)
    return ()=> window.removeEventListener('storage', onStorage)
  }, [])
  // Load theme (from BootScreen selection). If none, default to /2.webp
  useEffect(()=>{
    try {
      const raw = localStorage.getItem(THEME_KEY)
      if (raw){
        const t = JSON.parse(raw)
        if (t && (t.mode === 'image' || t.mode === 'gradient') && typeof t.value === 'string'){
          setTheme(t)
          return
        }
      }
    } catch {}
    // default theme (image 2.webp)
    setTheme({ mode: 'image', value: '/2.webp' })
  }, [])
  // Load persisted gradient - disabled for now
  // useEffect(()=>{
  //   try {
  //     const saved = localStorage.getItem('fyos.desktop.gradient')
  //     if (saved) {
  //       setGradientKey(saved)
  //     }
  //   } catch {}
  //   // Show bootscreen the very first time only
  //   try {
  //     const seen = localStorage.getItem('fyos.desktop.seenBoot')
  //     if (!seen) setBootscreen(true)
  //   } catch {}
  // }, [])
  // function chooseGradient(key: string){
  //   try { localStorage.setItem('fyos.desktop.gradient', key) } catch {}
  //   try { localStorage.setItem('fyos.desktop.seenBoot', '1') } catch {}
  //   setGradientKey(key)
  //   setBootscreen(false)
  // }
  const [open, setOpen] = useState<App[]>([])
  const [windowTabs, setWindowTabs] = useState<Record<string, WindowTabsState>>({})

  useEffect(() => { if (userMode === 'auth') setWindowTabs(loadWindowTabs()); }, [userMode]);

  function mergeOrderWithRegistry(order: string[], list: App[]): string[] {
    const ids = new Set(list.map(a => a.id))
    const filtered = order.filter(id => ids.has(id))
    const missing = list.map(a => a.id).filter(id => !filtered.includes(id))
    return [...filtered, ...missing]
  }

  const persistWindowTabs = (updater: (prev: Record<string, WindowTabsState>) => Record<string, WindowTabsState>) => {
    setWindowTabs(prev => { const next = updater(prev); if (userMode === 'auth') saveWindowTabs(next); return next; });
  };

  function ensureWindowTabsFor(app: App) {
    persistWindowTabs(prev => {
      if (prev[app.id]) return prev;
      const first: WindowTab = { id: crypto.randomUUID(), appId: app.id, title: app.name, icon: app.icon, path: app.path };
      return { ...prev, [app.id]: { activeTabId: first.id, tabs: [first] } };
    });
  }

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


  function openAppIntoTab(windowId: string, tabId: string, appLike: App) {
    persistWindowTabs(prev => {
      const curr = prev[windowId]; if (!curr) return prev;
      const list = curr.tabs.map(t => t.id === tabId ? ({ ...t, appId: appLike.id, title: appLike.name, icon: appLike.icon, path: appLike.path }) : t);
      return { ...prev, [windowId]: { ...curr, tabs: list, activeTabId: tabId } };
    });
  }

  const snapAltBypassRef = useRef(false)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const snapAppIdRef = useRef<string | null>(null)
  const currentZoneRef = useRef<SnapZoneId | null>(null)
  const lastZoneSwitchTsRef = useRef<number>(0)
  // Require a dwell period in a snap zone before arming snap
  const SNAP_DWELL_MS = 1000
  const zoneEnterTsRef = useRef<number>(0)
  const zoneArmedRef = useRef<boolean>(false)
  const [iconPositions, setIconPositions] = useState<Record<string,{left:number;top:number}>>({})
  const [windowGeometries, setWindowGeometries] = useState<Record<string,{left:number;top:number;width:number;height:number}>>({})
  const dragIconRef = useRef<{
    id: string | null
    startX: number
    startY: number
    startLeft: number
    startTop: number
    dragging: boolean
  }>({ id: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, dragging: false })
  const suppressClickRef = useRef<Set<string>>(new Set())
  // focusedName removed with menubar

  // Helper function to find next available icon position
  const findNextIconPosition = (currentPositions: Record<string,{left:number;top:number}>, _existingApps: App[]) => {
    const { spacingX, spacingY, startX, startY, maxPerCol } = DESKTOP_GRID
    
    // Get all occupied positions
    const occupiedPositions = new Set<string>()
    Object.values(currentPositions).forEach(pos => {
      occupiedPositions.add(`${pos.left},${pos.top}`)
    })
    
    // Find first available grid position
    for (let i = 0; i < 50; i++) { // limit search to prevent infinite loop
      const col = Math.floor(i / maxPerCol)
      const row = i % maxPerCol
      const left = startX + col * spacingX
      const top = startY + row * spacingY
      const posKey = `${left},${top}`
      
      if (!occupiedPositions.has(posKey)) {
        return { left, top }
      }
    }
    
    // Fallback: place at end of first column
    return { left: startX, top: startY + maxPerCol * spacingY }
  }

  useEffect(()=>{
    loadRegistry()
      .then((list: App[])=> {
        setApps(() => {
          // load icon positions from localStorage if present
          try{
            let currentPositions = userMode === 'auth' ? loadIconPositions() : {}
            if (!currentPositions || Object.keys(currentPositions).length === 0){
              const seed: Record<string,{left:number;top:number}> = {}
              list.forEach(app => {
                seed[app.id] = findNextIconPosition(seed, list)
              })
              currentPositions = seed
            }
            
            // Check for new apps that don't have positions yet
            const newPositions = { ...currentPositions }
            list.forEach(app => {
              if (!newPositions[app.id]) {
                newPositions[app.id] = findNextIconPosition(newPositions, list)
              }
            })
            
            setIconPositions(newPositions)
            
            const geoms = userMode === 'auth' ? loadWindowGeometries() : {}
            if (geoms && Object.keys(geoms).length > 0){
              setWindowGeometries(geoms)
            }
            // Initialize app order
            try {
              const loaded = userMode === 'auth' ? loadAppOrder() : []
              const merged = mergeOrderWithRegistry(loaded, list)
              setAppOrder(merged)
              if (userMode === 'auth') saveAppOrder(merged)
            } catch {}
          } catch {}
          
          // build quick lookup
          try { appsByIdRef.current = Object.fromEntries(list.map(a=>[a.id,a])) } catch {}
          return list
        })
      })
      .catch(()=> setApps([]))
  }, [userMode])

  // Dock removed for now.

  // Periodically refresh registry so newly created apps appear without iframe reload
  const appsRef = useRef<App[]>(apps)
  useEffect(()=>{ appsRef.current = apps }, [apps])
  useEffect(()=>{
    const iv = setInterval(()=>{
      loadRegistry()
        .then((list: App[])=>{
          const curr = JSON.stringify(appsRef.current?.map(a=>({id:a.id,name:a.name,icon:a.icon,path:a.path})) ?? [])
          const next = JSON.stringify(list?.map(a=>({id:a.id,name:a.name,icon:a.icon,path:a.path})) ?? [])
          if (curr !== next) {
            setApps(list)
            try { appsByIdRef.current = Object.fromEntries(list.map(a=>[a.id,a])) } catch {}
            // merge app order with potential new/removed apps
            setAppOrder(prev => {
              const base = prev.length ? prev : (userMode === 'auth' ? loadAppOrder() : [])
              const merged = mergeOrderWithRegistry(base, list)
              if (userMode === 'auth') saveAppOrder(merged)
              return merged
            })
          }
        })
        .catch(()=>{})
    }, 2500)
    return ()=> clearInterval(iv)
  }, [userMode])

  // Helper function to find next available window position
  const findNextWindowPosition = (openWindows: App[]) => {
    const baseLeft = 90
    const baseTop = 90
    const offsetStep = 30
    const maxOffset = 200
    
    // Try positions with increasing offset
    for (let offset = 0; offset <= maxOffset; offset += offsetStep) {
      const left = baseLeft + offset
      const top = baseTop + offset
      
      // Check if this position conflicts with existing windows
      const hasConflict = openWindows.some(w => {
        const wLeft = w.left ?? baseLeft
        const wTop = w.top ?? baseTop
        return Math.abs(wLeft - left) < 50 && Math.abs(wTop - top) < 50
      })
      
      if (!hasConflict) {
        return { left, top }
      }
    }
    
    // Fallback: use base position with random small offset
    return {
      left: baseLeft + Math.floor(Math.random() * 100),
      top: baseTop + Math.floor(Math.random() * 100)
    }
  }

  function launch(app: App){
    setOpen(prev => {
      const idx = prev.findIndex(w => w.id === app.id)
      if (idx >= 0) {
        const exists = prev[idx]
        // If minimized, restore with animation
        if (exists.minimized){
          const DURATION = OPEN_RESTORE_MS
          const g = resolveAppGeometry(exists)
          const { left, top } = clampToViewport(g.left, g.top, g.width, g.height)
          const updated = { ...exists, left, top, minimized: false, anim: 'restore' as const }
          const next = [...prev]
          next.splice(idx, 1) // bring to front
          next.push(updated)
          setTimeout(()=>{
            setOpen(p=> p.map(w=> w.id===app.id ? { ...w, anim: undefined } : w))
          }, DURATION)
          return next
        }
        // otherwise just bring to front
        return [...prev.slice(0, idx), ...prev.slice(idx+1), prev[idx]]
      }
      
      const geom = windowGeometries[app.id]
      const basePos = geom ? { left: geom.left, top: geom.top } : findNextWindowPosition(prev)
      const baseSize = geom ? { width: geom.width, height: geom.height } : { width: resolveAppGeometry(app).width, height: resolveAppGeometry(app).height }
      const clamped = clampToViewport(basePos.left, basePos.top, baseSize.width, baseSize.height)
      const created: App = { ...app, left: clamped.left, top: clamped.top, width: baseSize.width, height: baseSize.height, minimized: false, anim: 'open' }
      const DURATION = OPEN_RESTORE_MS
      setTimeout(()=>{
        setOpen(p=> p.map(w=> w.id===app.id ? { ...w, anim: undefined } : w))
      }, DURATION)
      // Seed tabs for new window
      ensureWindowTabsFor(created)
      return [...prev, created]
    })
  }

  function close(appId: string){
    // Animate close before removing
    const DURATION = CLOSE_MS
    setOpen(prev => prev.map(w => w.id === appId ? { ...w, anim: 'close' } : w))
    setTimeout(()=>{
      setOpen(prev => prev.filter(w => w.id !== appId))
    }, DURATION)
  }

  function minimize(appId: string){
    const DURATION = MINIMIZE_MS
    setOpen(prev => prev.map(w => w.id === appId ? { ...w, anim: 'minimize' } : w))
    setTimeout(()=>{
      setOpen(prev => prev.map(w => w.id === appId ? { ...w, minimized: true, anim: undefined } : w))
    }, DURATION)
  }

  function focus(appId: string){
    setOpen(prev => {
      const idx = prev.findIndex(w => w.id === appId)
      if (idx < 0) return prev
      return [...prev.slice(0, idx), ...prev.slice(idx+1), prev[idx]]
    })
  }

  const saveGeometries = (updater: (g: Record<string,{left:number;top:number;width:number;height:number}>)=>Record<string,{left:number;top:number;width:number;height:number}>) => {
    setWindowGeometries(prev => {
      const next = updater(prev)
      if (userMode === 'auth') saveWindowGeometries(next)
      return next
    })
  }

  function updateWindow(appId: string, partial: Partial<App>){
    setOpen(prev => prev.map(w => w.id === appId ? { ...w, ...partial } : w))
    if ('left' in partial || 'top' in partial || 'width' in partial || 'height' in partial){
      saveGeometries(prev => {
        const cur = prev[appId] || { left: 90, top: 90, width: 720, height: 720 }
        return { ...prev, [appId]: { left: partial.left ?? cur.left, top: partial.top ?? cur.top, width: partial.width ?? cur.width, height: partial.height ?? cur.height } }
      })
    }
  }

  // SNAP GEOMETRY AND DETECTION
  const GAP = 12
  function rectForZone(zone: SnapZoneId, gap = GAP): Geometry{
    const vw = window.innerWidth
    const vh = window.innerHeight
    const g2 = gap * 2
    const workLeft = SIDEBAR_WIDTH
    const workW = vw - workLeft
    const halfW = Math.floor(workW / 2)
    const halfH = Math.floor(vh / 2)
    switch(zone){
      case 'left-half': return { left: workLeft + gap, top: gap, width: Math.max(0, halfW - gap - gap/2), height: vh - g2 }
      case 'right-half': return { left: workLeft + halfW + gap/2, top: gap, width: Math.max(0, halfW - gap - gap/2), height: vh - g2 }
      case 'top-half': return { left: workLeft + gap, top: gap, width: workW - g2, height: Math.max(0, halfH - gap - gap/2) }
      case 'bottom-half': return { left: workLeft + gap, top: halfH + gap/2, width: workW - g2, height: Math.max(0, halfH - gap - gap/2) }
      case 'top-left': return { left: workLeft + gap, top: gap, width: Math.max(0, halfW - gap - gap/2), height: Math.max(0, halfH - gap - gap/2) }
      case 'top-right': return { left: workLeft + halfW + gap/2, top: gap, width: Math.max(0, halfW - gap - gap/2), height: Math.max(0, halfH - gap - gap/2) }
      case 'bottom-left': return { left: workLeft + gap, top: halfH + gap/2, width: Math.max(0, halfW - gap - gap/2), height: Math.max(0, halfH - gap - gap/2) }
      case 'bottom-right': return { left: workLeft + halfW + gap/2, top: halfH + gap/2, width: Math.max(0, halfW - gap - gap/2), height: Math.max(0, halfH - gap - gap/2) }
    }
  }

  function detectSnap(x: number, y: number, T = 120): SnapZoneId | null{
    const vw = window.innerWidth
    const vh = window.innerHeight
    const workLeft = SIDEBAR_WIDTH
    const nearLeft = x <= workLeft + T
    const nearRight = x >= vw - T
    const nearTop = y <= T
    const nearBottom = y >= vh - T
    if (!(nearLeft || nearRight || nearTop || nearBottom)) return null

    const cornerRatio = 0.3 // widen corner segments for easier corner snaps
    const cornerW = (vw - workLeft) * cornerRatio
    const cornerH = vh * cornerRatio

    // Top edge
    if (nearTop) {
      if (x <= workLeft + cornerW) return 'top-left'
      if (x >= vw - cornerW) return 'top-right'
      return 'top-half'
    }

    // Bottom edge
    if (nearBottom) {
      if (x <= cornerW) return 'bottom-left'
      if (x >= vw - cornerW) return 'bottom-right'
      return 'bottom-half'
    }

    // Left edge
    if (nearLeft) {
      if (y <= cornerH) return 'top-left'
      if (y >= vh - cornerH) return 'bottom-left'
      return 'left-half'
    }

    // Right edge
    if (nearRight) {
      if (y <= cornerH) return 'top-right'
      if (y >= vh - cornerH) return 'bottom-right'
      return 'right-half'
    }

    return null
  }

  useEffect(()=>{
    function onMoveDoc(e: MouseEvent){
      const d = dragIconRef.current
      if (!d.id) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const threshold = 4
      if (!d.dragging && Math.hypot(dx, dy) > threshold){
        d.dragging = true
        suppressClickRef.current.add(d.id)
      }
      if (d.dragging){
        setIconPositions(prev => ({
          ...prev,
          [d.id!]: { left: Math.max(4, d.startLeft + dx), top: Math.max(40, d.startTop + dy) }
        }))
      }
    }
    function onUp(){
      const d = dragIconRef.current
      if (d.id){
        // persist positions
        setTimeout(()=>{
          try{ if (userMode === 'auth') localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(iconPositionsRef.current)) } catch{}
        }, 0)
      }
      dragIconRef.current = { id: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, dragging: false }
      // allow clicks again after a tick
      setTimeout(()=> suppressClickRef.current.clear(), 0)
    }
    document.addEventListener('mousemove', onMoveDoc)
    document.addEventListener('mouseup', onUp)
    function onResize(){
      // Re-clamp all windows into viewport on viewport resize (relaxed)
      setOpen(prev => prev.map(w => {
        const g = resolveAppGeometry(w)
        const { left, top } = clampToViewport(g.left, g.top, g.width, g.height)
        return { ...w, left, top }
      }))
    }
    window.addEventListener('resize', onResize)
    return ()=>{
      document.removeEventListener('mousemove', onMoveDoc)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const iconPositionsRef = useRef(iconPositions)
  useEffect(()=>{ iconPositionsRef.current = iconPositions }, [iconPositions])

  // keep setter for bounceIcon compatibility (state value unused)
  const [, setLaunchingIconId] = useState<string | null>(null)

  // Listen for requests to auto-open an app
  useEffect(()=>{
    // Tiling event bus for snap overlay (imperative updates for performance)
    function applyPreviewRect(rect: Geometry | null, active: boolean){
      const overlay = overlayRef.current
      const preview = previewRef.current
      if (!overlay || !preview) return
      if (!rect){
        preview.classList.remove('active')
        return
      }
      preview.style.left = `${rect.left}px`
      preview.style.top = `${rect.top}px`
      preview.style.width = `${rect.width}px`
      preview.style.height = `${rect.height}px`
      if (active) preview.classList.add('active'); else preview.classList.remove('active')
    }
    function showOverlay(){ const o = overlayRef.current; if (o) o.style.display = 'block' }
    function hideOverlay(){ const o = overlayRef.current; if (o) o.style.display = 'none' }

    function onTiling(e: any){
      const d = e?.detail || {}
      if (!d || !d.phase) return
      if (d.altKey) { snapAltBypassRef.current = true } else { snapAltBypassRef.current = false }
      const now = Date.now()
      if (d.phase === 'start'){
        snapAppIdRef.current = d.id || null
        currentZoneRef.current = null
        lastZoneSwitchTsRef.current = now
        zoneArmedRef.current = false
        zoneEnterTsRef.current = now
        showOverlay()
        const z = snapAltBypassRef.current ? null : detectSnap(d.pointer?.x, d.pointer?.y)
        currentZoneRef.current = z
        // Show preview but keep inactive until dwell time has elapsed
        applyPreviewRect(z ? rectForZone(z) : null, false)
      } else if (d.phase === 'move'){
        if (!snapAppIdRef.current) return
        const candidate = snapAltBypassRef.current ? null : detectSnap(d.pointer?.x, d.pointer?.y)
        const prev = currentZoneRef.current
        if (candidate !== prev){
          // hysteresis: require 60ms stability before switching
          if (now - lastZoneSwitchTsRef.current >= 60){
            currentZoneRef.current = candidate
            lastZoneSwitchTsRef.current = now
            // reset dwell when entering a new zone
            zoneEnterTsRef.current = now
            zoneArmedRef.current = false
            applyPreviewRect(candidate ? rectForZone(candidate) : null, false)
          }
        }
        // arm snap only after dwelling in the same zone for SNAP_DWELL_MS
        const z = currentZoneRef.current
        if (z && !zoneArmedRef.current && (now - zoneEnterTsRef.current) >= SNAP_DWELL_MS){
          zoneArmedRef.current = true
          applyPreviewRect(rectForZone(z), true)
        }
      } else if (d.phase === 'end'){
        const id = snapAppIdRef.current
        const z = snapAltBypassRef.current ? null : (currentZoneRef.current || detectSnap(d.pointer?.x, d.pointer?.y))
        // Only snap if the zone was armed (held long enough)
        if (z && id && zoneArmedRef.current){
          const r = rectForZone(z)
          updateWindow(id, { left: r.left, top: r.top, width: r.width, height: r.height })
        }
        hideOverlay()
        applyPreviewRect(null, false)
        snapAppIdRef.current = null
        currentZoneRef.current = null
        snapAltBypassRef.current = false
        zoneArmedRef.current = false
      }
    }
    window.addEventListener('FYOS_TILING' as any, onTiling)
    function onMessage(e: MessageEvent){
      const d: any = (e as any).data
      if (!d) return
      if (d.type === EVT_USER_MODE) {
        try { const mode = d?.payload?.mode; if (mode === 'auth' || mode === 'anon') setUserMode(mode) } catch {}
        return
      }
      if (d.type === EVT_SET_THEME) {
        try { const t = d?.payload; if (t && (t.mode === 'image' || t.mode === 'gradient') && typeof t.value === 'string') setTheme(t) } catch {}
        return
      }
      if (d.type === 'FYOS_REQUEST_DESKTOP_STATE') {
        try {
          const payload = (userMode === 'auth')
            ? { iconPositions: loadIconPositions(), windowGeometries: loadWindowGeometries(), windowTabs: loadWindowTabs(), appOrder: loadAppOrder() }
            : { iconPositions, windowGeometries, windowTabs, appOrder }
          window.parent?.postMessage({ type: 'FYOS_DESKTOP_STATE', payload }, '*')
        } catch {}
        return
      }
      if (d.type !== EVT_OPEN_APP) return
      const app: App | null = (d.app && typeof d.app === 'object') ? d.app as App : null
      if (!app || !app.id) return
      // If app exists in registry, prefer that canonical entry
      const existing = appsByIdRef.current[app.id]
      const toLaunch = existing || app
      // Ensure it has a reasonable path shape
      if (!toLaunch.path) return
      // visually bounce icon if present
      bounceIcon(setLaunchingIconId, toLaunch.id)
      launch(toLaunch)
      // If icon position missing, assign one and persist
      setIconPositions(prev => {
        if (prev[toLaunch.id]) return prev
        const nextPos = findNextIconPosition(prev, appsRef.current || [])
        const next = { ...prev, [toLaunch.id]: nextPos }
        if (userMode === 'auth') saveIconPositions(next)
        return next
      })
    }
    window.addEventListener('message', onMessage)
    return ()=> { window.removeEventListener('message', onMessage); window.removeEventListener('FYOS_TILING' as any, onTiling) }
  }, [])

  const wallpaperStyle: React.CSSProperties = theme?.mode === 'gradient'
    ? { background: theme.value }
    : { backgroundImage: `url(${theme?.value || '/2.webp'})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }

  return (
    <div className="desktop" style={{ background: 'transparent', color: 'inherit' }}>
      <div className="wallpaper" style={wallpaperStyle} />
      <div className="wallpaper-glass" />
      {/* MenuBar removed */}

      {userMode === 'anon' && (
        <div style={{ position: 'fixed', top: 8, left: 110, right: 12, zIndex: 9999, pointerEvents: 'none' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.8)', backdropFilter: 'saturate(140%) blur(6px)', color: '#111', border: '1px solid rgba(0,0,0,0.08)', pointerEvents: 'auto' }}>
            <span style={{ fontSize: 12 }}>You’re not signed in. Work won’t be saved.</span>
          </div>
        </div>
      )}

      {/* Sidebar removed */}

      <div ref={overlayRef} className="snap-overlay" aria-hidden style={{display:'none'}}>
        <div ref={previewRef} className="snap-preview" />
      </div>

      {/* Center brand (offset upward to account for bottom agent bar) */}
      <div className="center-brand" aria-hidden={open.length > 0}>
        <div className="brand-text">fromyou</div>
      </div>

      {/* Main desktop area (windows); icons grid removed */}
      <div className="desktop-main" />

      {/* Desktop icons grid (draggable) */}
      <div className="desktop-icons" aria-label="Desktop icons">
        {(appOrder.length ? appOrder : apps.map(a=>a.id)).map(id => {
          const a = appsByIdRef.current[id]
          if (!a) return null
          const p = iconPositions[id] || { left: 16, top: 52 }
          return (
            <div
              key={id}
              className={`desktop-icon`}
              style={{ left: p.left, top: p.top }}
              onMouseDown={(e)=>{
                e.preventDefault()
                const cur = iconPositions[id] || { left: 16, top: 52 }
                dragIconRef.current = { id, startX: e.clientX, startY: e.clientY, startLeft: cur.left, startTop: cur.top, dragging: false }
              }}
              onClick={()=>{
                if (suppressClickRef.current.has(id)) return
                launch(a)
              }}
            >
              <div className="glyph">{a.icon ?? '📦'}</div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#e5e7eb', textAlign: 'center', maxWidth: 64, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
            </div>
          )
        })}
      </div>

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
            onNewTab={()=>addTab(app.id)}
            onOpenAppInTab={(tabId, a)=>openAppIntoTab(app.id, tabId, a)}
            availableApps={apps}
          />
        );
      })}
    </div>
  )
}
