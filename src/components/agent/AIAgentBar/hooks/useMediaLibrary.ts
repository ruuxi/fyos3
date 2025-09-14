import { useCallback, useEffect, useRef, useState } from 'react';
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
  getDurableAttachments: () => Array<{ name: string; publicUrl: string; contentType: string }>;
  projectAttachmentsToDurable: (list: Array<{ name: string; publicUrl: string; contentType: string }>) => Array<{ name: string; publicUrl: string; contentType: string }>;
};

export function useMediaLibrary(): UseMediaLibraryState {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaType, setMediaType] = useState<string>('');
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; publicUrl: string; contentType: string }>>([]);

  // Short-lived map from blob: URL -> durable URL returned by ingest
  const blobToDurableRef = useRef<Map<string, { publicUrl: string; contentType?: string }>>(new Map());

  const projectAttachmentsToDurable = useCallback((list: Array<{ name: string; publicUrl: string; contentType: string }>) => {
    try {
      const map = blobToDurableRef.current;
      return list.map(a => {
        if (/^https?:\/\//i.test(a.publicUrl)) return a;
        if (/^blob:/i.test(a.publicUrl)) {
          const m = map.get(a.publicUrl);
          if (m && m.publicUrl && /^https?:\/\//i.test(m.publicUrl)) {
            return { ...a, publicUrl: m.publicUrl, contentType: a.contentType || (m.contentType || 'application/octet-stream') };
          }
        }
        return a;
      });
    } catch {
      return list;
    }
  }, []);

  const getDurableAttachments = useCallback(() => {
    const projected = projectAttachmentsToDurable(attachments);
    return projected.filter(a => /^https?:\/\//i.test(a.publicUrl));
  }, [attachments, projectAttachmentsToDurable]);

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
    console.log('🔄 [MEDIA] Starting upload for', Array.from(files).map(f => f.name));
    try {
      const list: File[] = Array.isArray(files) ? files : Array.from(files);
      for (const file of list) {
        console.log('📁 [MEDIA] Processing file:', file.name, 'type:', file.type, 'size:', file.size);
        let objectUrl: string | null = null;
        try {
          objectUrl = URL.createObjectURL(file);
          console.log('🔗 [MEDIA] Created blob URL:', objectUrl);
          const previewIndex = (() => {
            let idx = -1;
            setAttachments(prev => {
              const next = prev.slice();
              const contentType = file.type || guessContentTypeFromFilename(file.name);
              console.log('📝 [MEDIA] Adding to attachments:', { name: file.name, publicUrl: objectUrl!, contentType });
              next.push({ name: file.name, publicUrl: objectUrl!, contentType });
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
          console.log('✅ [MEDIA] Ingest response:', result);
          
          // Use a promise to ensure state update completes
          await new Promise<void>(resolve => {
            setAttachments(prev => {
              const next = prev.slice();
              if (previewIndex >= 0 && previewIndex < next.length) {
                const updated = {
                  name: file.name,
                  publicUrl: result.publicUrl || objectUrl || '',
                  contentType: file.type || result.contentType || guessContentTypeFromFilename(file.name),
                };
                console.log('🔄 [MEDIA] Updating attachment:', updated);
                next[previewIndex] = updated;
              }
              // Record mapping from blob -> durable for use during send
              try {
                if (objectUrl && result.publicUrl) {
                  blobToDurableRef.current.set(objectUrl, { publicUrl: result.publicUrl, contentType: result.contentType });
                }
              } catch {}
              // Resolve after state update
              setTimeout(resolve, 0);
              return next;
            });
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
        setAttachments(prev => [...prev, { name, publicUrl: result.publicUrl || trimmed, contentType: result.contentType || inferred }]);
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
    getDurableAttachments,
    projectAttachmentsToDurable,
  };
}


