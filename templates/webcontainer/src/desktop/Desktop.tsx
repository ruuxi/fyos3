import React, { useEffect, useRef, useState } from 'react'

// Shared constants
const DEFAULT_WINDOW_POS = { left: 90, top: 90 }
const DEFAULT_WINDOW_SIZE = { width: 720, height: 720 }
const MIN_WINDOW_SIZE = { width: 280, height: 160 }

const MENUBAR_HEIGHT = 0
const TITLEBAR_HEIGHT = 32
const MIN_VISIBLE_X = 64
const MIN_VISIBLE_Y = 48

const OPEN_RESTORE_MS = 340
const CLOSE_MS = 220
const MINIMIZE_MS = 220

const LS_ICON_POS_KEY = 'desktop.iconPositions'
const LS_WINDOW_GEOM_KEY = 'desktop.windowGeometries'

const EVT_OPEN_APP = 'FYOS_OPEN_APP'
const EVT_DESKTOP_READY = 'FYOS_DESKTOP_READY'

const DESKTOP_GRID = { spacingX: 90, spacingY: 90, startX: 16, startY: 52, maxPerCol: 6 }

type Geometry = { left: number; top: number; width: number; height: number }

// Helpers
function clampToViewport(left: number, top: number, width: number, _height: number){
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minLeft = -(width - MIN_VISIBLE_X)
  const maxLeft = vw - MIN_VISIBLE_X
  const minTop = MENUBAR_HEIGHT - (TITLEBAR_HEIGHT - 16)
  const maxTop = vh - MIN_VISIBLE_Y
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

async function loadRegistry(): Promise<App[]>{
  const res = await fetch('/apps/registry.json?_=' + Date.now())
  return res.ok ? res.json() : []
}

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
}

// Top menubar removed

function Window({ app, zIndex, onClose, onMinimize, onFocus, onMove, onResize }: WindowProps){
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
  }>({ type: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0, active: false })

  useEffect(()=>{
    // Allow partial off-screen but keep window reachable using shared clamp
    function onMoveDoc(e: MouseEvent){
      const d = draggingRef.current
      if (!d.active || !d.type) return
      if (d.type === 'move'){
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        const pos = clampToViewport(d.startLeft + dx, d.startTop + dy, d.startWidth, d.startHeight)
        onMove(pos)
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
          case 'se':
            newW = Math.max(minW, d.startWidth + dx)
            newH = Math.max(minH, d.startHeight + dy)
            break
          case 'ne':
            newW = Math.max(minW, d.startWidth + dx)
            newH = Math.max(minH, d.startHeight - dy)
            newT = d.startTop + dy
            break
          case 'sw':
            newW = Math.max(minW, d.startWidth - dx)
            newH = Math.max(minH, d.startHeight + dy)
            newL = d.startLeft + dx
            break
          case 'nw':
            newW = Math.max(minW, d.startWidth - dx)
            newH = Math.max(minH, d.startHeight - dy)
            newL = d.startLeft + dx
            newT = d.startTop + dy
            break
        }
        // Relaxed: allow oversize beyond viewport; keep window reachable via clamp on position
        if (newW < minW) newW = minW
        if (newH < minH) newH = minH
        const pos = clampToViewport(newL, newT, newW, newH)
        onMove(pos)
        onResize({ width: newW, height: newH })
      }
    }
    function onUp(){ draggingRef.current.active = false; draggingRef.current.type = null }
    document.addEventListener('mousemove', onMoveDoc)
    document.addEventListener('mouseup', onUp)
    return ()=>{
      document.removeEventListener('mousemove', onMoveDoc)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onMove, onResize])

  function startMove(e: React.MouseEvent){
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
  }

  function startResize(handle: 'nw'|'ne'|'sw'|'se'){
    return (e: React.MouseEvent)=>{
      e.stopPropagation()
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
    }
  }
  const classes = ['window']
  if (app.anim === 'open' || app.anim === 'restore') classes.push('opening')
  if (app.anim === 'close') classes.push('closing')
  if (app.anim === 'minimize') classes.push('minimizing')
  if (app.minimized && !app.anim) classes.push('minimized')

  return (
    <div className={classes.join(' ')} style={{ ...resolveAppGeometry(app), zIndex }} onMouseDown={onFocus}>
      <div className="titlebar" onMouseDown={startMove}>
        <div className="traffic" onMouseDown={(e)=>e.stopPropagation()}>
          <div className="b red" onClick={onClose} title="Close" />
          <div className="b yellow" onClick={onMinimize} title="Minimize" />
          <div className="b green" title="Zoom" />
        </div>
        <div className="title">{app.name}</div>
        <div style={{marginLeft:'auto'}} className="badge">{app.id.slice(0,8)}</div>
      </div>
      <div className="content">
        <iframe
          title={app.name}
          src={`/app.html?path=${encodeURIComponent(app.path)}&id=${encodeURIComponent(app.id)}&name=${encodeURIComponent(app.name)}&base=0&ui=1&tw=1`}
          style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation allow-downloads"
          onError={(e) => {
            console.warn('Iframe error for app:', app.name, e);
          }}
        />
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
  const [open, setOpen] = useState<App[]>([])
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
            let currentPositions = loadIconPositions()
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
            
            const geoms = loadWindowGeometries()
            if (geoms && Object.keys(geoms).length > 0){
              setWindowGeometries(geoms)
            }
          } catch {}
          
          // build quick lookup
          try { appsByIdRef.current = Object.fromEntries(list.map(a=>[a.id,a])) } catch {}
          return list
        })
      })
      .catch(()=> setApps([]))
  }, [])

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
          }
        })
        .catch(()=>{})
    }, 2500)
    return ()=> clearInterval(iv)
  }, [])

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
      saveWindowGeometries(next)
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
          try{ localStorage.setItem(LS_ICON_POS_KEY, JSON.stringify(iconPositionsRef.current)) } catch{}
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

  const [launchingIconId, setLaunchingIconId] = useState<string | null>(null)

  // Listen for requests to auto-open an app
  useEffect(()=>{
    function onMessage(e: MessageEvent){
      const d: any = (e as any).data
      if (!d || d.type !== EVT_OPEN_APP) return
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
        saveIconPositions(next)
        return next
      })
    }
    window.addEventListener('message', onMessage)
    return ()=> window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="desktop">
      <div className="wallpaper" />
      {/* MenuBar removed */}

      <div className="desktop-icons">
        {apps.slice(0,20).map(a => {
          const pos = iconPositions[a.id] || { left: 16, top: 52 }
          return (
            <div
              key={a.id}
              className={`desktop-icon${launchingIconId===a.id ? ' launching' : ''}`}
              style={{ left: pos.left, top: pos.top }}
              onMouseDown={(e)=>{
                dragIconRef.current = {
                  id: a.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  startLeft: pos.left,
                  startTop: pos.top,
                  dragging: false
                }
              }}
              onClick={(e)=>{
                if (suppressClickRef.current.has(a.id)) { e.preventDefault(); return }
                bounceIcon(setLaunchingIconId, a.id)
                launch(a)
              }}
            >
              <div className="glyph">{a.icon ?? '📦'}</div>
              <div style={{fontSize:12,marginTop:6}}>{a.name}</div>
            </div>
          )
        })}
      </div>

      {open.map((app, idx) => (
        <Window
          key={app.id}
          app={app}
          zIndex={100 + idx}
          onClose={()=>close(app.id)}
          onMinimize={()=>minimize(app.id)}
          onFocus={()=>focus(app.id)}
          onMove={(pos)=>updateWindow(app.id, pos)}
          onResize={(size)=>updateWindow(app.id, size)}
        />
      ))}
    </div>
  )
}
