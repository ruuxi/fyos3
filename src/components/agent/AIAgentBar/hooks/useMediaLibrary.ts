import { useCallback, useEffect, useState } from 'react';
import type { MediaItem } from '@/lib/agent/agentTypes';
import { guessContentTypeFromFilename } from '@/lib/agent/agentUtils';

type BusyFlags = { loading: boolean; uploadBusy: boolean };

type UseMediaLibraryState = {
  mediaItems: MediaItem[];
  mediaType: string;
  setMediaType: (t: string) => void;
  mediaError: string | null;
  uploadError: string | null;
  attachments: Array<{ name: string; publicUrl: string; contentType: string }>;
  setAttachments: React.Dispatch<React.SetStateAction<Array<{ name: string; publicUrl: string; contentType: string }>>>;
  loadMedia: () => Promise<void>;
  uploadFiles: (files: FileList | File[] | null) => Promise<void>;
  ingestFromUrl: (url: string) => Promise<void>;
  busyFlags: BusyFlags;
};

export function useMediaLibrary(): UseMediaLibraryState {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaType, setMediaType] = useState<string>('');
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; publicUrl: string; contentType: string }>>([]);

  const loadMedia = useCallback(async () => {
    setMediaLoading(true); setMediaError(null);
    try {
      const params = new URLSearchParams();
      if (mediaType) params.set('type', mediaType);
      params.set('limit', '100');
      const res = await fetch(`/api/media/list?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setMediaItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      setMediaError(e?.message || 'Failed to load');
    } finally {
      setMediaLoading(false);
    }
  }, [mediaType]);

  useEffect(() => { void loadMedia(); }, [mediaType, loadMedia]);

  const uploadFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    setUploadBusy(true); setUploadError(null);
    try {
      const list: File[] = Array.isArray(files) ? files : Array.from(files);
      for (const file of list) {
        let objectUrl: string | null = null;
        try {
          objectUrl = URL.createObjectURL(file);
          const previewIndex = (() => {
            let idx = -1;
            setAttachments(prev => {
              const next = prev.slice();
              next.push({ name: file.name, publicUrl: objectUrl!, contentType: file.type || guessContentTypeFromFilename(file.name) });
              idx = next.length - 1;
              return next;
            });
            return idx;
          })();

          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Read failed'));
            reader.readAsDataURL(file);
          });
          const body: any = { base64, contentType: file.type || undefined, metadata: { filename: file.name } };
          const res = await fetch('/api/media/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `Upload failed (${res.status})`);
          }
          const result = await res.json();
          setAttachments(prev => {
            const next = prev.slice();
            if (previewIndex >= 0 && previewIndex < next.length) {
              next[previewIndex] = {
                name: file.name,
                publicUrl: (result && result.id) ? `/api/media/${result.id}` : (result.publicUrl || objectUrl || ''),
                contentType: file.type || result.contentType || guessContentTypeFromFilename(file.name),
              };
            }
            return next;
          });
        } finally {
          if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch {} }
        }
      }
      await loadMedia();
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  }, [loadMedia]);

  const ingestFromUrl = useCallback(async (url: string) => {
    const trimmed = (url || '').trim();
    if (!trimmed) return;
    setUploadBusy(true); setUploadError(null);
    try {
      const res = await fetch('/api/media/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl: trimmed }) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Ingest failed (${res.status})`);
      }
      try {
        const result = await res.json();
        const name = trimmed.split('/').pop() || 'link';
        const inferred = guessContentTypeFromFilename(name);
        setAttachments(prev => [...prev, {
          name,
          publicUrl: (result && result.id) ? `/api/media/${result.id}` : (result.publicUrl || trimmed),
          contentType: result.contentType || inferred,
        }]);
      } catch {
        const name = trimmed.split('/').pop() || 'link';
        setAttachments(prev => [...prev, { name, publicUrl: trimmed, contentType: guessContentTypeFromFilename(name) }]);
      }
      await loadMedia();
    } catch (e: any) {
      setUploadError(e?.message || 'Ingest failed');
    } finally {
      setUploadBusy(false);
    }
  }, [loadMedia]);

  return {
    mediaItems,
    mediaType,
    setMediaType,
    mediaError,
    uploadError,
    attachments,
    setAttachments,
    loadMedia,
    uploadFiles,
    ingestFromUrl,
    busyFlags: { loading: mediaLoading, uploadBusy },
  };
}


