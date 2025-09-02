import React from 'react'
export default function Finder(){
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:600}}>Finder</div>
        <span className="badge">Home</span>
      </div>
      <p className="muted">This is a simple Finder. It lists installed apps:</p>
      <AppsList />
    </div>
  )
}

function AppsList(){
  const [apps, setApps] = React.useState([])
  React.useEffect(()=>{ fetch('/apps/registry.json').then(r=>r.json()).then(setApps) },[])
  return (
    <ul className="list">
      {apps.map(a=> <li key={a.id}>{a.icon} {a.name} <code style={{color:'#6b7280'}}>{a.id.slice(0,8)}</code></li>)}
    </ul>
  )
}
