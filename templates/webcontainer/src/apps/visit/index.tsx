import { useEffect, useMemo, useState } from 'react'

type DesktopRecord = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export default function Visit() {
  const [desktops, setDesktops] = useState<DesktopRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await fetchJSON<{ desktops: DesktopRecord[] }>(`/api/visit/desktops`)
        if (!mounted) return
        setDesktops(data.desktops || [])
      } catch (e: unknown) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return desktops
    const s = search.toLowerCase()
    return desktops.filter(a => a.title.toLowerCase().includes(s) || (a.description||'').toLowerCase().includes(s))
  }, [desktops, search])

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-white/70 backdrop-blur border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Visit Desktops</div>
          <div className="ml-auto">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search desktops" className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-sm text-gray-500">No desktops found.</div>
        )}
        {filtered.map(d => (
          <div key={d._id} className="border rounded-lg p-3 bg-white">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-lg">{d.icon || '🖥️'}</div>
              <div className="font-medium truncate" title={d.title}>{d.title}</div>
            </div>
            {d.description && <div className="text-xs text-gray-600 line-clamp-2 mb-2">{d.description}</div>}
            <div className="flex items-center gap-2">
              <a href={`/d/${d._id}`} className="text-xs px-2 py-1 rounded bg-black text-white">Open</a>
              <a href={`/api/visit/desktops/${d._id}/snapshot`} target="_blank" className="text-xs px-2 py-1 rounded border">Download</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

