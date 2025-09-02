import React from 'react'
export default function Terminal(){
  const [lines, setLines] = React.useState(['Welcome to Terminal'])
  const [cmd, setCmd] = React.useState('help')
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:600}}>Terminal</div>
        <span className="badge">Demo</span>
      </div>
      <div style={{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',background:'#111827',color:'#d1d5db',borderRadius:8,padding:10,marginTop:8}}>
        {lines.map((l,i)=>(<div key={i}>{'>'} {l}</div>))}
      </div>
      <div style={{display:'flex',gap:8,marginTop:8}}>
        <input value={cmd} onChange={e=>setCmd(e.target.value)} style={{flex:1,border:'1px solid #e5e7eb',borderRadius:6,padding:8}} />
        <button onClick={()=>{ setLines(l=>[...l, 'executed: '+cmd]); setCmd('') }}>Run</button>
      </div>
    </div>
  )
}
