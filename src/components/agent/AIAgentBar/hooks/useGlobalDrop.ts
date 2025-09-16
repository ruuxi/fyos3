import { useEffect, useRef } from 'react';

type GlobalDropOptions = {
  onFiles: (files: FileList | File[]) => Promise<void> | void;
  onUrl: (url: string) => Promise<void> | void;
  onTextAsFile?: (text: string) => Promise<void> | void;
  setIsDraggingOver?: (v: boolean) => void;
};

export function useGlobalDrop({ onFiles, onUrl, onTextAsFile, setIsDraggingOver }: GlobalDropOptions) {
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const hasDroppableData = (event: DragEvent) => {
      const dt = event.dataTransfer;
      if (!dt) return false;
      const types = Array.from(dt.types ?? []);
      return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasDroppableData(event)) return;
      event.preventDefault();
      dragCounterRef.current++;
      setIsDraggingOver?.(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasDroppableData(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasDroppableData(event)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDraggingOver?.(false);
    };
    const onDrop = async (event: DragEvent) => {
      if (!hasDroppableData(event)) return;
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver?.(false);

      const dt = event.dataTransfer;
      try {
        if (dt?.files && dt.files.length > 0) {
          await onFiles(dt.files);
          return;
        }
        const uriList = dt?.getData('text/uri-list');
        let url = (uriList || '').split('\n')[0].trim();
        if (!url) {
          const text = dt?.getData('text/plain');
          const maybe = (text || '').trim();
          if (/^https?:\/\//i.test(maybe)) {
            url = maybe;
          } else if (/^data:[^;]+;base64,/i.test(maybe)) {
            // Let caller decide how to handle data URLs via onUrl
            await onUrl(maybe);
            return;
          } else if (maybe) {
            await onTextAsFile?.(maybe);
            return;
          }
        }
        if (url) {
          await onUrl(url);
        }
      } catch {
        // ignore
      }
    };

    // Use capture-phase listeners so drops work even when other layers intercept events.
    const captureOptions: AddEventListenerOptions = { capture: true };
    const dragOverOptions: AddEventListenerOptions = { capture: true, passive: false };

    window.addEventListener('dragenter', onDragEnter, captureOptions);
    // Explicitly non-passive so preventDefault is honored for dragover
    window.addEventListener('dragover', onDragOver, dragOverOptions);
    window.addEventListener('dragleave', onDragLeave, captureOptions);
    window.addEventListener('drop', onDrop, captureOptions);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, captureOptions);
      window.removeEventListener('dragover', onDragOver, captureOptions);
      window.removeEventListener('dragleave', onDragLeave, captureOptions);
      window.removeEventListener('drop', onDrop, captureOptions);
    };
  }, [onFiles, onUrl, onTextAsFile, setIsDraggingOver]);
}
