import React, { useEffect, useMemo, useState } from 'react'

function MenuBar({ appName }){
  const [time, setTime] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()), 30000); return ()=>clearInterval(t) },[])
  return (
    <div className="menubar">
      <div className="title"> {appName || 'Finder'}</div>
      <div className="right">{time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
    </div>
  )
}

function Window({ app, onClose }){
  const [Comp, setComp] = useState(null)
  useEffect(()=>{
    let mounted = true
    import(/* @vite-ignore */ app.path).then(m=>{ if(mounted) setComp(()=>m.default) })
    return ()=>{ mounted = false }
  }, [app.path])
  return (
    <div className="window" style={{left: app.left ?? 90, top: app.top ?? 90}}>
      <div className="titlebar">
        <div className="traffic">
          <div className="b red" onClick={onClose} title="Close" />
          <div className="b yellow" title="Minimize" />
          <div className="b green" title="Zoom" />
        </div>
        <div className="title">{app.name}</div>
        <div style={{marginLeft:'auto'}} className="badge">{app.id.slice(0,8)}</div>
      </div>
      <div className="content">
        {Comp ? <Comp /> : <div className="muted">Loading {app.name}…</div>}
      </div>
    </div>
  )
}

export default function Desktop(){
  const [apps, setApps] = useState([])
  const [open, setOpen] = useState([])
  const focusedName = open.length ? open[open.length-1].name : 'Finder'

  useEffect(()=>{
    fetch('/apps/registry.json?_=' + Date.now())
      .then(r=>r.json())
      .then(list=> setApps(list))
      .catch(()=> setApps([]))
  }, [])

  const dockApps = useMemo(()=> apps.slice(0,8), [apps])

  function launch(app){
    setOpen(prev => {
      const idx = prev.findIndex(w => w.id === app.id)
      if (idx >= 0) return [...prev.slice(0, idx), ...prev.slice(idx+1), prev[idx]]
      return [...prev, app]
    })
  }

  function close(appId){
    setOpen(prev => prev.filter(w => w.id !== appId))
  }

  return (
    <div className="desktop">
      <div className="wallpaper" />
      <MenuBar appName={focusedName} />

      <div className="desktop-icons">
        {apps.slice(0,6).map(a => (
          <div key={a.id} className="desktop-icon" onDoubleClick={()=>launch(a)}>
            <div className="glyph">{a.icon ?? '📦'}</div>
            <div style={{fontSize:12,marginTop:6}}>{a.name}</div>
          </div>
        ))}
      </div>

      {open.map(app => (
        <Window key={app.id} app={app} onClose={()=>close(app.id)} />
      ))}

      <div className="dock">
        {dockApps.map(a => (
          <div key={a.id} className="icon" title={a.name} onClick={()=>launch(a)}>
            <span style={{fontSize:22}}>{a.icon ?? '📦'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
