import React from 'react'
import Image from 'next/image'
import { useAuth } from '@clerk/nextjs'

type MediaItem = {
  _id: string
  contentType: string
  publicUrl?: string
  r2Key: string
  createdAt: number
  size?: number
  appId?: string
}

function formatBytes(n?: number) {
  if (!n || n <= 0) return ''
  const units = ['B','KB','MB','GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function App(){
  const { isSignedIn, isLoaded } = useAuth()
  const [items, setItems] = React.useState<MediaItem[]>([])
  const [type, setType] = React.useState<string>('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Only attempt to load media if user is authenticated
      if (!isSignedIn) {
        setItems([])
        return
      }
      
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      params.set('limit', '10')
      const res = await fetch(`/api/media/list?${params.toString()}`)
      const json = await res.json()
      setItems(json.items || [])
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [isSignedIn, type])

  React.useEffect(()=>{ 
    if (isLoaded) {
      void load() 
    }
  }, [isLoaded, load])

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-white/70 backdrop-blur border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Media</div>
          <select value={type} onChange={e=>setType(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="image">Images</option>
            <option value="audio">Audio</option>
            <option value="video">Video</option>
          </select>
          <button onClick={()=>load()} className="ml-auto text-xs border rounded px-2 py-1">Refresh</button>
        </div>
      </div>
      <div className="p-3 space-y-3">
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && !isSignedIn && isLoaded && (
          <div className="text-sm text-gray-600 text-center py-8">
            <div className="mb-2">🔒</div>
            <div>Please sign in to view your media files.</div>
          </div>
        )}
        {!loading && !error && isSignedIn && items.length === 0 && (
          <div className="text-sm text-gray-600">No media found.</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((m) => (
            <div key={m._id} className="border rounded-md p-2">
              <div className="text-xs text-gray-500">{new Date(m.createdAt).toLocaleString()} • {formatBytes(m.size)}</div>
              <div className="mt-2">
                {m.contentType.startsWith('image/') && (
                  <div className="relative w-full overflow-hidden rounded" style={{ aspectRatio: '4 / 3' }}>
                    <Image
                      src={m.publicUrl || ''}
                      alt={m.r2Key}
                      fill
                      className="object-cover"
                      sizes="(min-width: 768px) 33vw, 100vw"
                    />
                  </div>
                )}
                {m.contentType.startsWith('audio/') && (
                  <audio controls src={m.publicUrl || ''} className="w-full" />
                )}
                {m.contentType.startsWith('video/') && (
                  <video controls src={m.publicUrl || ''} className="w-full rounded" />
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <a href={m.publicUrl || '#'} target="_blank" className="text-xs px-2 py-1 rounded border">Open</a>
                <div className="text-xs text-gray-600 truncate" title={m.r2Key}>{m.r2Key}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
