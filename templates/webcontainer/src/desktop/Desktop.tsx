import React, { useEffect, useRef, useState } from 'react'

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

interface MenuBarProps {
  appName?: string
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

function MenuBar({ appName }: MenuBarProps){
  const [time, setTime] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()), 30000); return ()=>clearInterval(t) },[])
  return (
    <div className="menubar">
      <div className="title"> {appName || 'Finder'}</div>
      <div className="right">{time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
    </div>
  )
}

function Window({ app, zIndex, onClose, onMinimize, onFocus, onMove, onResize }: WindowProps){
  const [Comp, setComp] = useState<React.ComponentType | null>(null)
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
    let mounted = true
    import(/* @vite-ignore */ app.path).then(m=>{ if(mounted) setComp(()=>m.default) })
    return ()=>{ mounted = false }
  }, [app.path])

  useEffect(()=>{
    function onMoveDoc(e: MouseEvent){
      const d = draggingRef.current
      if (!d.active || !d.type) return
      if (d.type === 'move'){
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        onMove({ left: Math.max(0, d.startLeft + dx), top: Math.max(28, d.startTop + dy) })
      } else if (d.type === 'resize'){
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        let newW = d.startWidth
        let newH = d.startHeight
        let newL = d.startLeft
        let newT = d.startTop
        const minW = 280
        const minH = 160
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
        onMove({ left: newL, top: newT })
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
    draggingRef.current = {
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startLeft: app.left ?? 90,
      startTop: app.top ?? 90,
      startWidth: app.width ?? 560,
      startHeight: app.height ?? 360,
      active: true
    }
  }

  function startResize(handle: 'nw'|'ne'|'sw'|'se'){
    return (e: React.MouseEvent)=>{
      e.stopPropagation()
      onFocus()
      draggingRef.current = {
        type: 'resize',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: app.left ?? 90,
        startTop: app.top ?? 90,
        startWidth: app.width ?? 560,
        startHeight: app.height ?? 360,
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
    <div className={classes.join(' ')} style={{left: app.left ?? 90, top: app.top ?? 90, width: app.width ?? 560, height: app.height ?? 360, zIndex}} onMouseDown={onFocus}>
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
        {Comp ? <Comp /> : <div className="muted">Loading {app.name}…</div>}
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
  const focusedName = open.length ? open[open.length-1].name : 'Finder'

  useEffect(()=>{
    fetch('/apps/registry.json?_=' + Date.now())
      .then(r=>r.json())
      .then((list: App[])=> {
        setApps(list)
        // load icon positions from localStorage if present
        try{
          const saved = localStorage.getItem('desktop.iconPositions')
          if (saved){
            const parsed = JSON.parse(saved) as Record<string,{left:number;top:number}>
            setIconPositions(parsed)
          } else {
            // initialize default positions in a simple grid
            const spacingX = 90
            const spacingY = 90
            const startX = 16
            const startY = 52
            const maxPerCol = 6
            const pos: Record<string,{left:number;top:number}> = {}
            list.slice(0, 20).forEach((a, i)=>{
              const col = Math.floor(i / maxPerCol)
              const row = i % maxPerCol
              pos[a.id] = { left: startX + col*spacingX, top: startY + row*spacingY }
            })
            setIconPositions(pos)
          }
          const savedGeom = localStorage.getItem('desktop.windowGeometries')
          if (savedGeom){
            const parsed = JSON.parse(savedGeom) as Record<string,{left:number;top:number;width:number;height:number}>
            setWindowGeometries(parsed)
          }
        } catch {}
      })
      .catch(()=> setApps([]))
  }, [])

  // Dock removed for now.

  function launch(app: App){
    setOpen(prev => {
      const idx = prev.findIndex(w => w.id === app.id)
      if (idx >= 0) {
        const exists = prev[idx]
        // If minimized, restore with animation
        if (exists.minimized){
          const DURATION = 340
          const updated = { ...exists, minimized: false, anim: 'restore' as const }
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
      const left = geom?.left ?? app.left ?? 90
      const top = geom?.top ?? app.top ?? 90
      const width = geom?.width ?? app.width ?? 600
      const height = geom?.height ?? app.height ?? 380
      const created: App = { ...app, left, top, width, height, minimized: false, anim: 'open' }
      const DURATION = 340
      setTimeout(()=>{
        setOpen(p=> p.map(w=> w.id===app.id ? { ...w, anim: undefined } : w))
      }, DURATION)
      return [...prev, created]
    })
  }

  function close(appId: string){
    // Animate close before removing
    const DURATION = 220
    setOpen(prev => prev.map(w => w.id === appId ? { ...w, anim: 'close' } : w))
    setTimeout(()=>{
      setOpen(prev => prev.filter(w => w.id !== appId))
    }, DURATION)
  }

  function minimize(appId: string){
    const DURATION = 220
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
      try{ localStorage.setItem('desktop.windowGeometries', JSON.stringify(next)) } catch{}
      return next
    })
  }

  function updateWindow(appId: string, partial: Partial<App>){
    setOpen(prev => prev.map(w => w.id === appId ? { ...w, ...partial } : w))
    if ('left' in partial || 'top' in partial || 'width' in partial || 'height' in partial){
      saveGeometries(prev => {
        const cur = prev[appId] || { left: 90, top: 90, width: 600, height: 380 }
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
          try{ localStorage.setItem('desktop.iconPositions', JSON.stringify(iconPositionsRef.current)) } catch{}
        }, 0)
      }
      dragIconRef.current = { id: null, startX: 0, startY: 0, startLeft: 0, startTop: 0, dragging: false }
      // allow clicks again after a tick
      setTimeout(()=> suppressClickRef.current.clear(), 0)
    }
    document.addEventListener('mousemove', onMoveDoc)
    document.addEventListener('mouseup', onUp)
    return ()=>{
      document.removeEventListener('mousemove', onMoveDoc)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const iconPositionsRef = useRef(iconPositions)
  useEffect(()=>{ iconPositionsRef.current = iconPositions }, [iconPositions])

  const [launchingIconId, setLaunchingIconId] = useState<string | null>(null)

  return (
    <div className="desktop">
      <div className="wallpaper" />
      <MenuBar appName={focusedName} />

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
                setLaunchingIconId(a.id)
                setTimeout(()=> setLaunchingIconId(prev => prev===a.id ? null : prev), 600)
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
