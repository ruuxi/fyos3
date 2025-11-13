import React, { useEffect, useRef, useState } from 'react'

// Shared constants
// Host reserves 400px on the left for the agent sidebar
const SIDEBAR_WIDTH = 400
const ICON_LAYOUT_VERSION = 'right-aligned-v1'
const ICON_LAYOUT_VERSION_KEY = 'desktop.iconLayoutVersion'
const ICON_RIGHT_MARGIN = 32
const ICON_WIDTH = 64

const DEFAULT_WINDOW_POS = { left: SIDEBAR_WIDTH + 90, top: 90 }
const DEFAULT_WINDOW_SIZE = { width: 720, height: 720 }
const MIN_WINDOW_SIZE = { width: 280, height: 160 }

const OPEN_RESTORE_MS = 340
const CLOSE_MS = 220
const MINIMIZE_MS = 220

const LS_ICON_POS_KEY = 'desktop.iconPositions'
const LS_WINDOW_GEOM_KEY = 'desktop.windowGeometries'
const LS_WINDOW_TABS_KEY = 'desktop.windowTabs'
const LS_APP_ORDER_KEY = 'desktop.appOrder'

const EVT_OPEN_APP = 'FYOS_OPEN_APP'
const EVT_DESKTOP_READY = 'FYOS_DESKTOP_READY'
const EVT_USER_MODE = 'FYOS_USER_MODE'

const DESKTOP_GRID = { spacingX: 90, spacingY: 90, startX: SIDEBAR_WIDTH + 16, startY: 52, maxPerCol: 6 }

type DialOption = 'expand' | 'close' | 'move' | 'chat'

const DIAL_THRESHOLD = 36

type DialMeta = { label: string; angle: number; icon: string }

const DIAL_OPTION_META: Record<DialOption, DialMeta> = {
  expand: { label: 'Expand', angle: -45, icon: '⤢' },
  move: { label: 'Move', angle: 45, icon: '🪟' },
  close: { label: 'Close', angle: 135, icon: '✕' },
  chat: { label: 'Open Chat', angle: -135, icon: '💬' },
}

const DIAL_OPTIONS: DialOption[] = ['expand', 'move', 'close', 'chat']
const DIAL_VIEWBOX = 224
const DIAL_CENTER = DIAL_VIEWBOX / 2
const DIAL_OUTER_RADIUS = 100
const DIAL_INNER_RADIUS = 58
const DIAL_LABEL_RADIUS = 82
const DIAL_SWEEP = 90

function degToRad(deg: number){
  return (deg * Math.PI) / 180
}

function polarToCartesian(angleDeg: number, radius: number){
  const rad = degToRad(angleDeg)
  return {
    x: DIAL_CENTER + radius * Math.cos(rad),
    y: DIAL_CENTER + radius * Math.sin(rad),
  }
}

function buildDialPath(angleDeg: number){
  const start = angleDeg - DIAL_SWEEP / 2
  const end = angleDeg + DIAL_SWEEP / 2
  const outerStart = polarToCartesian(start, DIAL_OUTER_RADIUS)
  const outerEnd = polarToCartesian(end, DIAL_OUTER_RADIUS)
  const innerEnd = polarToCartesian(end, DIAL_INNER_RADIUS)
  const innerStart = polarToCartesian(start, DIAL_INNER_RADIUS)
  const largeArc = DIAL_SWEEP > 180 ? 1 : 0
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${DIAL_OUTER_RADIUS} ${DIAL_OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${DIAL_INNER_RADIUS} ${DIAL_INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

function computeLabelPosition(angleDeg: number){
  return polarToCartesian(angleDeg, DIAL_LABEL_RADIUS)
}

type Geometry = { left: number; top: number; width: number; height: number }

// Helpers
function clampToViewport(left: number, top: number, width: number, height: number){
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Enforce a consistent visual gap from all edges (instead of partial visibility)
  const minLeft = 16 + SIDEBAR_WIDTH
  const maxLeft = Math.max(16 + SIDEBAR_WIDTH, vw - width - 16)
  const minTop = 16
  const maxTop = Math.max(16, vh - height - 16)
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

function setBodyUserSelect(value: string){
  if (typeof document === 'undefined') return
  const { body } = document
  if (!body) return
  try {
    body.style.userSelect = value
    if (value){
      body.style.setProperty('-webkit-user-select', value)
    } else {
      body.style.removeProperty('-webkit-user-select')
    }
  } catch {
    // ignore style failures
  }
}

function determineDialOption(dx: number, dy: number, distance: number, hasWindow: boolean): DialOption | null {
  if (distance < DIAL_THRESHOLD) return null
  const angle = Math.atan2(dy, dx)
  const normalizedDeg = (angle * 180 / Math.PI + 360) % 360
  const deg = (normalizedDeg - 45 + 360) % 360
  if (deg >= 315 || deg < 45) return hasWindow ? 'move' : null
  if (deg >= 45 && deg < 135) return hasWindow ? 'close' : null
  if (deg >= 135 && deg < 225) return 'chat'
  if (deg >= 225 && deg < 315) return hasWindow ? 'expand' : null
  return null
}

type ContextPointerMessage = {
  type: 'FYOS_DESKTOP_CONTEXT_POINTER'
  phase: 'down' | 'move' | 'up' | 'cancel'
  pointerId: number
  clientX: number
  clientY: number
  button?: number
  buttons?: number
  pointerType?: string
  appId?: string | null
}

function isContextPointerMessage(value: unknown): value is ContextPointerMessage {
  if (!value || typeof value !== 'object') return false
  const msg = value as Partial<ContextPointerMessage>
  const phaseValid = msg.phase === 'down' || msg.phase === 'move' || msg.phase === 'up' || msg.phase === 'cancel'
  return msg.type === 'FYOS_DESKTOP_CONTEXT_POINTER'
    && phaseValid
    && typeof msg.pointerId === 'number'
    && typeof msg.clientX === 'number'
    && typeof msg.clientY === 'number'
}

function bounceIcon(setLaunching: React.Dispatch<React.SetStateAction<string | null>>, id: string, ms = 600){
  setLaunching(id)
  setTimeout(()=> setLaunching(prev => prev === id ? null : prev), ms)
}

function loadIconPositions(): Record<string, { left: number; top: number }>{
  try{
    const version = localStorage.getItem(ICON_LAYOUT_VERSION_KEY)
    if (version !== ICON_LAYOUT_VERSION) {
      return {}
    }
    const raw = localStorage.getItem(LS_ICON_POS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveIconPositions(pos: Record<string, { left: number; top: number }>): void{
  try{
    localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(pos))
    localStorage.setItem(ICON_LAYOUT_VERSION_KEY, ICON_LAYOUT_VERSION)
  } catch{}
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
  isBeingMoved: boolean
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

function Window({ app, zIndex, onClose, onMinimize, onFocus, onMove, onResize, tabs, activeTabId, onTabActivate, onTabClose, onNewTab, onOpenAppInTab, availableApps, isBeingMoved }: WindowProps){
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
      }
    }
    function onUp(){
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
        } else {
          const width = d.curWidth ?? d.startWidth
          const height = d.curHeight ?? d.startHeight
          const left = d.curLeft ?? d.startLeft
          const top = d.curTop ?? d.startTop
          onMove({ left, top })
          onResize({ width, height })
        }
        clearSelectionEverywhere()
        try{ rootRef.current?.classList.remove('resizing') } catch {}
        try{ document.body.classList.remove('desktop-resizing') } catch {}
        setBodyUserSelect('')
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
    if (e.button !== 0) return
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
    setBodyUserSelect('none')
    try{ document.body.style.cursor = 'grabbing' } catch {}
    // Avoid costly selection updates during drag; clear once at start
    clearSelectionEverywhere()
  }

  function startResize(handle: 'nw'|'ne'|'sw'|'se'){
    return (e: React.MouseEvent)=>{
      if (e.button !== 0) return
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
      setBodyUserSelect('none')
      try{
        const map: Record<string,string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
        document.body.style.cursor = map[handle] || 'nwse-resize'
      } catch {}
      // Avoid costly selection updates during drag; clear once at start
      clearSelectionEverywhere()
    }
  }
  const classes = ['window']
  if (app.anim === 'open' || app.anim === 'restore') classes.push('opening')
  if (app.anim === 'close') classes.push('closing')
  if (app.anim === 'minimize') classes.push('minimizing')
  if (app.minimized && !app.anim) classes.push('minimized')
  if (isBeingMoved) classes.push('moving')

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const isBlank = !activeTab || !activeTab.appId;
  const iframeSrc = !isBlank ? `/app.html?path=${encodeURIComponent(activeTab.path||'')}&id=${encodeURIComponent(activeTab.appId||'')}&name=${encodeURIComponent(activeTab.title)}&ui=1` : '';

  return (
    <div ref={rootRef} className={classes.join(' ')} data-app-id={app.id} style={{ ...resolveAppGeometry(app), zIndex, background: 'rgba(12,18,36,0.10)' }} onMouseDown={onFocus}>
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
            data-app-id={app.id}
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
  const appOrderRef = useRef(appOrder)
  const [userMode, setUserMode] = useState<'auth'|'anon'>('auth')
  const userModeRef = useRef(userMode)
  // Seed localStorage desktop state from persisted file if present
  useEffect(() => {
    (async () => {
      try {
        if (userMode === 'anon') return;
        const res = await fetch('/_fyos/desktop-state.json?_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (json && typeof json === 'object') {
          try { if (json.iconPositions) localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(json.iconPositions)); } catch {}
          try { if (json.windowGeometries) localStorage.setItem(LS_WINDOW_GEOM_KEY, JSON.stringify(json.windowGeometries)); } catch {}
          try { if (json.windowTabs) localStorage.setItem(LS_WINDOW_TABS_KEY, JSON.stringify(json.windowTabs)); } catch {}
          try { if (json.appOrder) localStorage.setItem(LS_APP_ORDER_KEY, JSON.stringify(json.appOrder)); } catch {}
        }
      } catch {}
    })();
  }, [userMode])
  useEffect(() => { appOrderRef.current = appOrder }, [appOrder])
  useEffect(() => { userModeRef.current = userMode }, [userMode])
  // Announce readiness to host so it can flush any pending open-app messages
  useEffect(()=>{
    try { window.parent?.postMessage({ type: EVT_DESKTOP_READY }, '*') } catch {}
  }, [])
  // Load saved settings on mount
  useEffect(() => {
    try {
      // Load wallpaper theme
      const savedWallpaper = localStorage.getItem('fyos-wallpaper')
      if (savedWallpaper && ['default', '1', '2', '3', '4', '5'].includes(savedWallpaper)) {
        document.documentElement.style.setProperty('--desktop-gradient', `var(--desktop-gradient-${savedWallpaper})`)
        if (savedWallpaper === 'default') {
          document.documentElement.style.setProperty('--desktop-background-size', 'cover')
          document.documentElement.style.setProperty('--desktop-background-position', 'center')
          document.documentElement.style.setProperty('--desktop-background-repeat', 'no-repeat')
        } else {
          document.documentElement.style.setProperty('--desktop-background-size', 'auto')
          document.documentElement.style.setProperty('--desktop-background-position', 'initial')
          document.documentElement.style.setProperty('--desktop-background-repeat', 'initial')
        }
      }
      // Load animations setting
      const savedAnimations = localStorage.getItem('fyos-animations')
      if (savedAnimations === 'false') {
        document.documentElement.style.setProperty('--window-open-duration', '0ms')
        document.documentElement.style.setProperty('--window-close-duration', '0ms')
        document.documentElement.style.setProperty('--window-minimize-duration', '0ms')
      }
      // Load icon size
      const savedIconSize = localStorage.getItem('fyos-icon-size')
      if (savedIconSize) {
        const size = parseInt(savedIconSize, 10)
        if (size >= 48 && size <= 80) {
          document.documentElement.style.setProperty('--icon-size', `${size}px`)
        }
      }
    } catch {}
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
  const openWindowsRef = useRef<App[]>([])
  useEffect(() => { openWindowsRef.current = open }, [open])
  const [windowTabs, setWindowTabs] = useState<Record<string, WindowTabsState>>({})
  const windowTabsRef = useRef(windowTabs)
  useEffect(() => { windowTabsRef.current = windowTabs }, [windowTabs])

  const [dialState, setDialState] = useState<{
    x: number;
    y: number;
    active: DialOption | null;
    distance: number;
    available: Record<DialOption, boolean>;
  } | null>(null)
  const dialSessionRef = useRef<{
    pointerId: number
    originX: number
    originY: number
    targetAppId: string | null
    source: 'native' | 'iframe'
  } | null>(null)
  const dialListenersRef = useRef<{
    move?: (evt: PointerEvent) => void
    up?: (evt: PointerEvent) => void
    cancel?: (evt: PointerEvent) => void
    key?: (evt: KeyboardEvent) => void
  } | null>(null)

  const moveSessionRef = useRef<{
    appId: string
    offsetX: number
    offsetY: number
    width: number
    height: number
    pointerId: number | null
    pendingX: number | null
    pendingY: number | null
  } | null>(null)
  const moveSessionFrameRef = useRef<number | null>(null)
  const [movingWindowId, setMovingWindowId] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const skipGeometryPersistenceRef = useRef(false)
  const endMoveSessionRef = useRef<(persist?: boolean) => void>(() => {})
  const startDialSessionRef = useRef<(params: { pointerId: number; clientX: number; clientY: number; source: 'native' | 'iframe'; targetAppId?: string | null }) => void>(() => {})
  const updateDialVisualsRef = useRef<((clientX: number, clientY: number) => { option: DialOption | null; distance: number; hasWindow: boolean } | null) | null>(null)
  const executeDialSelectionRef = useRef<((option: DialOption, appId: string | null, pointerX: number, pointerY: number) => void) | null>(null)
  const launchRef = useRef<(app: App) => void>(() => {})

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

  const [iconPositions, setIconPositions] = useState<Record<string,{left:number;top:number}>>({})
  const [windowGeometries, setWindowGeometries] = useState<Record<string,{left:number;top:number;width:number;height:number}>>({})
  const windowGeometriesRef = useRef(windowGeometries)
  useEffect(() => { windowGeometriesRef.current = windowGeometries }, [windowGeometries])
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
    const { spacingX, spacingY, startY, maxPerCol } = DESKTOP_GRID
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440
    const workspaceRight = viewportWidth - ICON_RIGHT_MARGIN
    const firstColumnLeft = Math.max(SIDEBAR_WIDTH + ICON_RIGHT_MARGIN, workspaceRight - ICON_WIDTH)
    
    // Get all occupied positions
    const occupiedPositions = new Set<string>()
    Object.values(currentPositions).forEach(pos => {
      occupiedPositions.add(`${pos.left},${pos.top}`)
    })
    
    // Find first available grid position
    for (let i = 0; i < 50; i++) { // limit search to prevent infinite loop
      const col = Math.floor(i / maxPerCol)
      const row = i % maxPerCol
      const left = Math.max(SIDEBAR_WIDTH + ICON_RIGHT_MARGIN, firstColumnLeft - col * spacingX)
      const top = startY + row * spacingY
      const posKey = `${left},${top}`
      
      if (!occupiedPositions.has(posKey)) {
        return { left, top }
      }
    }
    
    // Fallback: place at end of first column
    return { left: firstColumnLeft, top: startY + maxPerCol * spacingY }
  }

  const getRightAlignedFallback = () => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440
    const workspaceRight = viewportWidth - ICON_RIGHT_MARGIN
    const left = Math.max(SIDEBAR_WIDTH + ICON_RIGHT_MARGIN, workspaceRight - ICON_WIDTH)
    return { left, top: DESKTOP_GRID.startY }
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
            if (userMode === 'auth') {
              try { saveIconPositions(newPositions) } catch {}
            }
            
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
  launchRef.current = launch

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
      if (userMode === 'auth' && !skipGeometryPersistenceRef.current) saveWindowGeometries(next)
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

  const resolveDialTargetAppId = (preferredId: string | null | undefined): string | null => {
    if (preferredId) {
      const exists = openWindowsRef.current.find(w => w.id === preferredId)
      if (exists) return exists.id
    }
    const top = openWindowsRef.current.length ? openWindowsRef.current[openWindowsRef.current.length - 1] : null
    return top ? top.id : null
  }

  const getDialAvailability = (hasWindow: boolean): Record<DialOption, boolean> => {
    return {
      expand: hasWindow,
      move: hasWindow,
      close: hasWindow,
      chat: true,
    }
  }

  const startDialSession = (params: { pointerId: number; clientX: number; clientY: number; source: 'native' | 'iframe'; targetAppId?: string | null }) => {
    const targetId = resolveDialTargetAppId(params.targetAppId ?? null)
    const availability = getDialAvailability(Boolean(targetId))
    const existing = dialSessionRef.current
    if (existing) endDial()
    dialSessionRef.current = {
      pointerId: params.pointerId,
      originX: params.clientX,
      originY: params.clientY,
      targetAppId: targetId,
      source: params.source,
    }
    setDialState({
      x: params.clientX,
      y: params.clientY,
      active: null,
      distance: 0,
      available: availability,
    })

    const keyListener = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        endDial()
      }
    }
    const listeners: {
      move?: (evt: PointerEvent) => void
      up?: (evt: PointerEvent) => void
      cancel?: (evt: PointerEvent) => void
      key?: (evt: KeyboardEvent) => void
    } = { key: keyListener }

    if (params.source === 'native') {
      const moveListener = (evt: PointerEvent) => {
        const session = dialSessionRef.current
        if (!session || session.source !== 'native' || session.pointerId !== evt.pointerId) return
        evt.preventDefault()
        updateDialVisuals(evt.clientX, evt.clientY)
      }
      const upListener = (evt: PointerEvent) => {
        const session = dialSessionRef.current
        if (!session || session.source !== 'native' || session.pointerId !== evt.pointerId) return
        evt.preventDefault()
        const result = updateDialVisuals(evt.clientX, evt.clientY)
        endDial()
        if (result?.option) {
          executeDialSelection(result.option, session.targetAppId, evt.clientX, evt.clientY)
        }
      }
      const cancelListener = (evt: PointerEvent) => {
        const session = dialSessionRef.current
        if (!session || session.source !== 'native' || session.pointerId !== evt.pointerId) return
        evt.preventDefault()
        endDial()
      }
      listeners.move = moveListener
      listeners.up = upListener
      listeners.cancel = cancelListener
      window.addEventListener('pointermove', moveListener, { passive: false })
      window.addEventListener('pointerup', upListener, { passive: false })
      window.addEventListener('pointercancel', cancelListener, { passive: false })
    }

    window.addEventListener('keydown', keyListener)
    dialListenersRef.current = listeners
  }
  startDialSessionRef.current = startDialSession

  const endDial = () => {
    const listeners = dialListenersRef.current
    if (listeners) {
      if (listeners.move) window.removeEventListener('pointermove', listeners.move)
      if (listeners.up) window.removeEventListener('pointerup', listeners.up)
      if (listeners.cancel) window.removeEventListener('pointercancel', listeners.cancel)
      if (listeners.key) window.removeEventListener('keydown', listeners.key)
    }
    dialListenersRef.current = null
    dialSessionRef.current = null
    setDialState(null)
  }

  const updateDialVisuals = (clientX: number, clientY: number) => {
    const session = dialSessionRef.current
    if (!session) return null
    const hasWindow = Boolean(session.targetAppId && openWindowsRef.current.some(w => w.id === session.targetAppId))
    const dx = clientX - session.originX
    const dy = clientY - session.originY
    const distance = Math.sqrt(dx * dx + dy * dy)
    const option = determineDialOption(dx, dy, distance, hasWindow)
    const availability = getDialAvailability(hasWindow)
    setDialState(prev => prev ? { ...prev, active: option, distance, available: availability } : prev)
    return { option, distance, hasWindow }
  }
  updateDialVisualsRef.current = updateDialVisuals

  function executeDialSelection(option: DialOption, appId: string | null, pointerX: number, pointerY: number) {
    if (option === 'chat') {
      try { window.parent?.postMessage({ type: 'FYOS_OPEN_CHAT' }, '*') } catch {}
      return
    }
    if (!appId) return
    const target = openWindowsRef.current.find(w => w.id === appId)
    if (!target) return
    focus(appId)
    if (option === 'close') {
      close(appId)
      return
    }
    if (option === 'expand') {
      try {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const M = 12
        const left = SIDEBAR_WIDTH + M
        const top = M
        const width = Math.max(0, vw - SIDEBAR_WIDTH - (M * 2))
        const height = Math.max(0, vh - (M * 2))
        updateWindow(appId, { left, top, width, height })
      } catch {}
      return
    }
    if (option === 'move') {
      startMoveSession(appId, pointerX, pointerY)
    }
  }
  executeDialSelectionRef.current = executeDialSelection

  const applyMoveSessionPosition = (session: NonNullable<typeof moveSessionRef.current>, clientX: number, clientY: number) => {
    const rawLeft = clientX - session.offsetX
    const rawTop = clientY - session.offsetY
    const clamped = clampToViewport(rawLeft, rawTop, session.width, session.height)
    updateWindow(session.appId, { left: clamped.left, top: clamped.top })
  }

  const scheduleMoveSessionApply = () => {
    if (moveSessionFrameRef.current != null) return
    moveSessionFrameRef.current = requestAnimationFrame(() => {
      moveSessionFrameRef.current = null
      const session = moveSessionRef.current
      if (!session || session.pendingX == null || session.pendingY == null) return
      applyMoveSessionPosition(session, session.pendingX, session.pendingY)
    })
  }

  const endMoveSession = (persist = true) => {
    const session = moveSessionRef.current
    const listenersActive = Boolean(session)
    moveSessionRef.current = null
    if (moveSessionFrameRef.current != null) {
      cancelAnimationFrame(moveSessionFrameRef.current)
      moveSessionFrameRef.current = null
    }
    if (listenersActive) {
      window.removeEventListener('pointermove', onMoveSessionPointerMove)
      window.removeEventListener('pointerdown', onMoveSessionPointerDown, true)
      window.removeEventListener('pointerup', onMoveSessionPointerUp, true)
      window.removeEventListener('pointercancel', onMoveSessionPointerCancel, true)
      window.removeEventListener('keydown', onMoveSessionKeyDown)
      try { document.body.classList.remove('desktop-window-moving') } catch {}
    }
    skipGeometryPersistenceRef.current = false
    if (persist && session && isMountedRef.current) {
      const latest = openWindowsRef.current.find(w => w.id === session.appId)
      if (latest) {
        const geom = resolveAppGeometry(latest)
        saveGeometries(prev => ({ ...prev, [session.appId]: geom }))
      }
    }
    if (isMountedRef.current) setMovingWindowId(null)
  }
  endMoveSessionRef.current = endMoveSession

  const onMoveSessionPointerMove = (evt: PointerEvent) => {
    const session = moveSessionRef.current
    if (!session) return
    evt.preventDefault()
    session.pendingX = evt.clientX
    session.pendingY = evt.clientY
    scheduleMoveSessionApply()
  }

  const onMoveSessionPointerUp = (evt: PointerEvent) => {
    const session = moveSessionRef.current
    if (!session) return
    if (session.pointerId !== null && session.pointerId !== evt.pointerId) return
    evt.preventDefault()
    evt.stopPropagation()
    endMoveSession()
  }

  const onMoveSessionPointerCancel = (evt: PointerEvent) => {
    const session = moveSessionRef.current
    if (!session) return
    if (session.pointerId !== null && session.pointerId !== evt.pointerId) return
    evt.preventDefault()
    endMoveSession()
  }

  const onMoveSessionPointerDown = (evt: PointerEvent) => {
    const session = moveSessionRef.current
    if (!session) return
    if (evt.button !== 0) {
      evt.preventDefault()
      return
    }
    evt.preventDefault()
    evt.stopPropagation()
    session.pointerId = evt.pointerId
    window.addEventListener('pointerup', onMoveSessionPointerUp, true)
    window.addEventListener('pointercancel', onMoveSessionPointerCancel, true)
  }

  const onMoveSessionKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') {
      endMoveSession()
    }
  }

  const startMoveSession = (appId: string, pointerX: number, pointerY: number) => {
    const target = openWindowsRef.current.find(w => w.id === appId)
    if (!target) return
    endMoveSession()
    skipGeometryPersistenceRef.current = true
    const geom = resolveAppGeometry(target)
    moveSessionRef.current = {
      appId,
      offsetX: pointerX - geom.left,
      offsetY: pointerY - geom.top,
      width: geom.width,
      height: geom.height,
      pointerId: null,
      pendingX: null,
      pendingY: null,
    }
    try { document.body.classList.add('desktop-window-moving') } catch {}
    window.addEventListener('pointermove', onMoveSessionPointerMove, { passive: false })
    window.addEventListener('pointerdown', onMoveSessionPointerDown, true)
    window.addEventListener('keydown', onMoveSessionKeyDown)
    if (isMountedRef.current) setMovingWindowId(appId)
    applyMoveSessionPosition(moveSessionRef.current, pointerX, pointerY)
  }

  const handleDesktopPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return
    e.preventDefault()
    e.stopPropagation()
    const appIdFromTarget = (e.target as HTMLElement | null)?.closest('[data-app-id]')?.getAttribute('data-app-id') || null
    if (moveSessionRef.current) {
      endMoveSession()
    }
    startDialSession({
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      source: 'native',
      targetAppId: appIdFromTarget,
    })
  }


  useEffect(() => {
    return () => {
      isMountedRef.current = false
      endMoveSessionRef.current?.(false)
      const listeners = dialListenersRef.current
      if (listeners) {
        if (listeners.move) window.removeEventListener('pointermove', listeners.move)
        if (listeners.up) window.removeEventListener('pointerup', listeners.up)
        if (listeners.cancel) window.removeEventListener('pointercancel', listeners.cancel)
        if (listeners.key) window.removeEventListener('keydown', listeners.key)
      }
      dialListenersRef.current = null
      dialSessionRef.current = null
      try { document.body.classList.remove('desktop-window-moving') } catch {}
    }
  }, [])


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
          try{ if (userModeRef.current === 'auth') localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(iconPositionsRef.current)) } catch{}
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
    function onMessage(e: MessageEvent){
      const payload = e.data
      
      // Relay AI and media responses from host to app iframes
      if (payload && typeof payload === 'object') {
        const msgType = (payload as {type?: unknown}).type
        if (msgType === 'AI_RESPONSE' || msgType === 'MEDIA_INGEST_RESPONSE') {
          // Forward to all app iframes
          try {
            const iframes = document.querySelectorAll('iframe[data-app-id]')
            iframes.forEach(iframe => {
              try {
                (iframe as HTMLIFrameElement).contentWindow?.postMessage(payload, '*')
              } catch {}
            })
          } catch {}
          return
        }
        if (msgType === 'AI_REQUEST' || msgType === 'MEDIA_INGEST') {
          try {
            window.parent?.postMessage(payload, '*')
          } catch {}
          return
        }
      }
      
      if (isContextPointerMessage(payload)) {
        if (payload.phase === 'down') {
          const candidateAppId = typeof payload.appId === 'string' ? payload.appId : null
          if (moveSessionRef.current) {
            endMoveSessionRef.current?.()
          }
          startDialSessionRef.current?.({
            pointerId: payload.pointerId,
            clientX: payload.clientX,
            clientY: payload.clientY,
            source: 'iframe',
            targetAppId: candidateAppId,
          })
        } else {
          const session = dialSessionRef.current
          if (!session || session.source !== 'iframe' || session.pointerId !== payload.pointerId) return
          if (payload.phase === 'move') {
            updateDialVisualsRef.current?.(payload.clientX, payload.clientY)
          } else if (payload.phase === 'up') {
            const result = updateDialVisualsRef.current?.(payload.clientX, payload.clientY)
            endDial()
            if (result?.option && executeDialSelectionRef.current) {
              executeDialSelectionRef.current(result.option, session.targetAppId, payload.clientX, payload.clientY)
            }
          } else if (payload.phase === 'cancel') {
            endDial()
          }
        }
        return
      }
      if (!payload || typeof payload !== 'object') return
      const record = payload as { [key: string]: unknown }
      const typeValue = typeof record.type === 'string' ? record.type : ''
      // FYOS_AGENT_RUN_* forwarding removed; HMR no longer paused during runs
      if (typeValue === EVT_USER_MODE) {
        const raw = (record.payload as { mode?: unknown } | undefined)?.mode
        if (raw === 'auth' || raw === 'anon') setUserMode(raw)
        return
      }
      if (typeValue === 'FYOS_REQUEST_DESKTOP_STATE') {
        try {
          const payload = (userModeRef.current === 'auth')
            ? { iconPositions: loadIconPositions(), windowGeometries: loadWindowGeometries(), windowTabs: loadWindowTabs(), appOrder: loadAppOrder() }
            : { iconPositions: iconPositionsRef.current, windowGeometries: windowGeometriesRef.current, windowTabs: windowTabsRef.current, appOrder: appOrderRef.current }
          window.parent?.postMessage({ type: 'FYOS_DESKTOP_STATE', payload }, '*')
        } catch {}
        return
      }
      // Settings: Wallpaper theme
      if (typeValue === 'FYOS_SET_WALLPAPER') {
        try {
          const theme = record.theme
          if (typeof theme === 'string' && ['default', '1', '2', '3', '4', '5'].includes(theme)) {
            document.documentElement.style.setProperty('--desktop-gradient', `var(--desktop-gradient-${theme})`)
            if (theme === 'default') {
              document.documentElement.style.setProperty('--desktop-background-size', 'cover')
              document.documentElement.style.setProperty('--desktop-background-position', 'center')
              document.documentElement.style.setProperty('--desktop-background-repeat', 'no-repeat')
            } else {
              document.documentElement.style.setProperty('--desktop-background-size', 'auto')
              document.documentElement.style.setProperty('--desktop-background-position', 'initial')
              document.documentElement.style.setProperty('--desktop-background-repeat', 'initial')
            }
          }
        } catch {}
        return
      }
      // Settings: Animations
      if (typeValue === 'FYOS_SET_ANIMATIONS') {
        try {
          const enabled = record.enabled
          if (typeof enabled === 'boolean') {
            const duration = enabled ? '' : '0ms'
            document.documentElement.style.setProperty('--window-open-duration', duration || '340ms')
            document.documentElement.style.setProperty('--window-close-duration', duration || '220ms')
            document.documentElement.style.setProperty('--window-minimize-duration', duration || '220ms')
          }
        } catch {}
        return
      }
      // Settings: Reset windows
      if (typeValue === 'FYOS_RESET_WINDOWS') {
        try {
          localStorage.removeItem(LS_WINDOW_GEOM_KEY)
          localStorage.removeItem(LS_WINDOW_TABS_KEY)
          setWindowGeometries({})
          setWindowTabs({})
          setOpen([])
        } catch {}
        return
      }
      // Settings: Icon size
      if (typeValue === 'FYOS_SET_ICON_SIZE') {
        try {
          const size = record.size
          if (typeof size === 'number' && size >= 48 && size <= 80) {
            document.documentElement.style.setProperty('--icon-size', `${size}px`)
          }
        } catch {}
        return
      }
      // Settings: Reset icon positions
      if (typeValue === 'FYOS_RESET_ICONS') {
        try {
          localStorage.removeItem(LS_ICON_POS_KEY)
          setIconPositions({})
        } catch {}
        return
      }
      if (typeValue !== EVT_OPEN_APP) return
      const rawApp = record.app
      const app: App | null = (rawApp && typeof rawApp === 'object') ? rawApp as App : null
      if (!app || !app.id) return
      // If app exists in registry, prefer that canonical entry
      const existing = appsByIdRef.current[app.id]
      const toLaunch = existing || app
      // Ensure it has a reasonable path shape
      if (!toLaunch.path) return
      // visually bounce icon if present
      bounceIcon(setLaunchingIconId, toLaunch.id)
      launchRef.current?.(toLaunch)
      // If icon position missing, assign one and persist
      setIconPositions(prev => {
        if (prev[toLaunch.id]) return prev
        const nextPos = findNextIconPosition(prev, appsRef.current || [])
        const next = { ...prev, [toLaunch.id]: nextPos }
        if (userModeRef.current === 'auth') saveIconPositions(next)
        return next
      })
    }
    window.addEventListener('message', onMessage)
    return ()=> { window.removeEventListener('message', onMessage) }
  }, [])

  const brandStyle: React.CSSProperties = {
    left: `calc(50% + ${SIDEBAR_WIDTH / 2}px)`,
    top: '50%',
  }

  return (
    <div
      className="desktop"
      style={{ background: 'transparent', color: 'inherit' }}
      onPointerDown={handleDesktopPointerDown}
      onContextMenu={(e)=>{ e.preventDefault() }}
    >
      <div className="sidebar-background" />
      <div className="wallpaper" />
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


      {/* Center brand adjusted for host sidebar width */}
      <div className="center-brand" style={brandStyle} aria-hidden={open.length > 0}>
        <div className="brand-text">fromyou</div>
      </div>

      {/* Main desktop area (windows); icons grid removed */}
      <div className="desktop-main" />

      {/* Desktop icons grid (draggable) */}
      <div className="desktop-icons" aria-label="Desktop icons">
        {(appOrder.length ? appOrder : apps.map(a=>a.id)).map(id => {
          const a = appsByIdRef.current[id]
          if (!a) return null
          const p = iconPositions[id] || getRightAlignedFallback()
          return (
            <div
              key={id}
              className={`desktop-icon`}
              style={{ left: p.left, top: p.top }}
              onMouseDown={(e)=>{
                if (e.button !== 0) return
                e.preventDefault()
                const cur = iconPositions[id] || getRightAlignedFallback()
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

      {dialState && (
        <div className="context-dial-overlay" style={{ left: dialState.x, top: dialState.y }}>
          <div className="context-dial">
            <svg className="dial-svg" viewBox={`0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}`} aria-hidden>
              <circle className="dial-ring" cx={DIAL_CENTER} cy={DIAL_CENTER} r={DIAL_OUTER_RADIUS + 6} />
              {DIAL_OPTIONS.map(option => {
                const meta = DIAL_OPTION_META[option]
                const active = dialState.active === option
                const disabled = !dialState.available[option]
                const classes = ['dial-slice']
                if (active) classes.push('active')
                if (disabled) classes.push('disabled')
                return (
                  <path
                    key={option}
                    className={classes.join(' ')}
                    d={buildDialPath(meta.angle)}
                  />
                )
              })}
              <circle className="dial-inner" cx={DIAL_CENTER} cy={DIAL_CENTER} r={DIAL_INNER_RADIUS - 8} />
            </svg>
            {DIAL_OPTIONS.map(option => {
              const meta = DIAL_OPTION_META[option]
              const active = dialState.active === option
              const disabled = !dialState.available[option]
              const pos = computeLabelPosition(meta.angle)
              const classes = ['dial-label-node']
              if (active) classes.push('active')
              if (disabled) classes.push('disabled')
              return (
                <div key={option} className={classes.join(' ')} style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
                  <span className="dial-ico" aria-hidden>{meta.icon}</span>
                </div>
              )
            })}
            <div className={`dial-center${dialState.distance < DIAL_THRESHOLD ? ' active' : ''}`}>
              <span className="dial-center-label">Cancel</span>
            </div>
          </div>
        </div>
      )}

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
            isBeingMoved={movingWindowId === app.id}
          />
        );
      })}
    </div>
  )
}
