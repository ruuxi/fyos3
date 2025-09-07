import { useEffect, useMemo, useState } from 'react'

type AppRecord = {
  _id: string;
  appId: string;
  name: string;
  icon?: string;
  description?: string;
  tags?: string[];
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export default function AppStore() {
  const [apps, setApps] = useState<AppRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await fetchJSON<{ apps: AppRecord[] }>(`/api/store/apps`)
        if (!mounted) return
        setApps(data.apps || [])
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message || 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return apps
    const s = search.toLowerCase()
    return apps.filter(a => a.name.toLowerCase().includes(s) || (a.description||'').toLowerCase().includes(s) || (a.tags||[]).some(t => t.toLowerCase().includes(s)))
  }, [apps, search])

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-white/70 backdrop-blur border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="font-semibold">App Store</div>
          <div className="ml-auto">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps" className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-sm text-gray-500">No apps found.</div>
        )}
        {filtered.map(a => (
          <div key={a._id} className="border rounded-lg p-3 bg-white">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-lg">{a.icon || '📦'}</div>
              <div className="font-medium truncate" title={a.name}>{a.name}</div>
            </div>
            {a.description && <div className="text-xs text-gray-600 line-clamp-2 mb-2">{a.description}</div>}
            <div className="flex items-center gap-2">
              <button
                className="text-xs px-2 py-1 rounded bg-black text-white"
                onClick={() => {
                  try {
                    window.parent?.postMessage({ type: 'FYOS_INSTALL_APP', appId: a._id }, '*')
                  } catch {}
                }}
              >Install</button>
              <a href={`/api/store/apps/${a._id}/bundle`} target="_blank" className="text-xs px-2 py-1 rounded border">Download</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


