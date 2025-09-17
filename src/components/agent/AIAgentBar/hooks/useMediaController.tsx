import { useCallback, useMemo, useState } from 'react';
import { useMediaLibrary } from './useMediaLibrary';
import { useGlobalDrop } from './useGlobalDrop';

export type MediaControllerArgs = {
  setMode: (mode: 'compact' | 'chat' | 'visit' | 'media' | 'friends') => void;
};

export function useMediaController({ setMode }: MediaControllerArgs) {
  const {
    mediaItems,
    mediaType,
    setMediaType,
    mediaError,
    uploadError,
    attachments,
    setAttachments,
    loadMedia,
    uploadFiles,
    ingestFromUrl: ingestFromUrlFn,
    busyFlags,
    projectAttachmentsToDurable,
  } = useMediaLibrary();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');

  const handleUploadFiles = useCallback(async (files: FileList | File[] | null) => {
    await uploadFiles(files);
  }, [uploadFiles]);

  const handleIngestFromUrl = useCallback(async () => {
    const url = ingestUrl.trim();
    if (!url) return;
    await ingestFromUrlFn(url);
    setIngestUrl('');
  }, [ingestUrl, ingestFromUrlFn]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, [setAttachments]);

  useGlobalDrop({
    onFiles: async (files) => {
      await uploadFiles(files);
      setMode('chat');
    },
    onUrl: async (url) => {
      await ingestFromUrlFn(url);
      setMode('chat');
    },
    onTextAsFile: async (text) => {
      const file = new File([text], 'dropped.txt', { type: 'text/plain' });
      await uploadFiles([file]);
      setMode('chat');
    },
    setIsDraggingOver,
  });

  const dragOverlay = useMemo(() => {
    if (!isDraggingOver) return null;
    return (
      <div
        className="fixed inset-0 z-[60] pointer-events-auto"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
        }}
        onDragLeave={() => {
          setIsDraggingOver(false);
        }}
        aria-label="Drop files to attach"
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="rounded border-2 border-dashed border-sky-300/70 bg-black/40 text-white px-4 py-3 text-sm">
            Drop to attach
          </div>
        </div>
      </div>
    );
  }, [isDraggingOver]);

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
    ingestFromUrl: ingestFromUrlFn,
    busyFlags,
    projectAttachmentsToDurable,
    dragOverlay,
    ingestUrl,
    setIngestUrl,
    handleUploadFiles,
    handleIngestFromUrl,
    removeAttachment,
    isDraggingOver,
  } as const;
}
