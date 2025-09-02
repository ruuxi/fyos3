import React from 'react'
export default function Safari(){
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:600}}>Safari</div>
        <span className="badge">Preview</span>
      </div>
      <p className="muted">Minimal browser placeholder. Open external sites is disabled in this preview.</p>
      <div style={{background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:8,padding:10}}>
        <div style={{fontSize:13,color:'#6b7280'}}>Address Bar</div>
        <input style={{width:'100%',padding:8,borderRadius:6,border:'1px solid #d1d5db'}} placeholder="https://example.com" disabled />
      </div>
    </div>
  )
}
