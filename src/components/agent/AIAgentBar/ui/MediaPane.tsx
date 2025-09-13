import { Button } from '@/components/ui/button';

export type MediaPaneProps = {
  mediaType: string;
  setMediaType: (t: string) => void;
  loadMedia: () => Promise<void>;
  loading: boolean;
  error: string | null;
  uploadError: string | null;
  onFiles: (files: FileList | null) => Promise<void> | void;
  ingestUrl: string;
  setIngestUrl: (v: string) => void;
  onIngest: () => Promise<void> | void;
  items: Array<{ _id: string; contentType: string; r2Key: string; createdAt: number; size?: number }>;
  disabled: boolean;
  formatBytes: (n?: number) => string;
};

export default function MediaPane(props: MediaPaneProps) {
  const { mediaType, setMediaType, loadMedia, loading, error, uploadError, onFiles, ingestUrl, setIngestUrl, onIngest, items, disabled, formatBytes } = props;
  return (
    <div className="px-4 py-6">
      <div className="font-medium mb-2">Media Library</div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={mediaType}
          onChange={(e)=> setMediaType(e.target.value)}
          className="text-black rounded-none px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="image">Images</option>
          <option value="audio">Audio</option>
          <option value="video">Video</option>
        </select>
        <Button size="sm" className="rounded-none" onClick={()=>void loadMedia()} disabled={loading}>Refresh</Button>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="file"
            multiple
            onChange={(e)=> void onFiles(e.target.files)}
            disabled={disabled}
            className="text-xs"
          />
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={ingestUrl}
              onChange={(e)=> setIngestUrl(e.target.value)}
              placeholder="Ingest from URL"
              className="rounded-none text-black px-2 py-1 text-xs w-[220px]"
              disabled={disabled}
            />
            <Button size="sm" className="rounded-none" onClick={()=> void onIngest()} disabled={disabled || !ingestUrl.trim()}>Add</Button>
          </div>
        </div>
      </div>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {uploadError && <div className="text-sm text-red-600">{uploadError}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-sm text-gray-300">No media found.</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((m) => (
          <div key={m._id} className="border border-white/10 bg-white/5 p-2">
            <div className="text-xs text-white/70">
              {new Date(m.createdAt).toLocaleString()} • {formatBytes(m.size)}
            </div>
            <div className="mt-2">
              {m.contentType.startsWith('image/') && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m._id}`} alt={m.r2Key} className="w-full h-auto" />
              )}
              {m.contentType.startsWith('audio/') && (
                <audio controls src={`/api/media/${m._id}`} className="w-full" />
              )}
              {m.contentType.startsWith('video/') && (
                <video controls src={`/api/media/${m._id}`} className="w-full" />
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <a href={`/api/media/${m._id}`} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border rounded-none">Open</a>
              <div className="text-xs text-white/70 truncate" title={m.r2Key}>{m.r2Key}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


