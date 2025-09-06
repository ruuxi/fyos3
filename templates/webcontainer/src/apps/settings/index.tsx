import React from 'react'
export default function Settings(){
  const [dark, setDark] = React.useState(false)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:600}}>Settings</div>
        <span className="badge">System</span>
      </div>
      <div style={{marginTop:10}}>
        <label style={{display:'flex',alignItems:'center',gap:8}}>
          <input type="checkbox" checked={dark} onChange={()=>setDark(v=>!v)} /> Dark Mode (demo)
        </label>
      </div>
    </div>
  )
}
