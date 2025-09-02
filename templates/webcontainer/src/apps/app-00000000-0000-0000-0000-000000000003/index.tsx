import React from 'react'
export default function Notes(){
  const [notes, setNotes] = React.useState([{id:1,text:'Welcome to Notes'}])
  const [t, setT] = React.useState('')
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:600}}>Notes</div>
        <span className="badge">Local</span>
      </div>
      <div style={{display:'flex',gap:10,marginTop:10}}>
        <textarea value={t} onChange={e=>setT(e.target.value)} placeholder="Write a note…" style={{flex:1,height:90,border:'1px solid #e5e7eb',borderRadius:8,padding:8}} />
        <button onClick={()=>{ if(t.trim()){ setNotes(n=>[{id:Date.now(),text:t.trim()},...n]); setT('') } }} style={{padding:'8px 12px'}}>Add</button>
      </div>
      <ul className="list" style={{marginTop:8}}>
        {notes.map(n=> <li key={n.id}>{n.text}</li>)}
      </ul>
    </div>
  )
}
