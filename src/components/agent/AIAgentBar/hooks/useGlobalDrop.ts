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
    const hasDroppableData = (e: any) => {
      const dt = e?.dataTransfer;
      if (!dt) return false;
      const types = Array.from(dt.types || []);
      return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
    };

    const onDragEnter = (e: any) => {
      if (!hasDroppableData(e)) return;
      e.preventDefault();
      dragCounterRef.current++;
      setIsDraggingOver?.(true);
    };
    const onDragOver = (e: any) => {
      if (!hasDroppableData(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: any) => {
      if (!hasDroppableData(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDraggingOver?.(false);
    };
    const onDrop = async (e: any) => {
      if (!hasDroppableData(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver?.(false);

      const dt: DataTransfer = e.dataTransfer;
      try {
        if (dt.files && dt.files.length > 0) {
          await onFiles(dt.files);
          return;
        }
        const uriList = dt.getData('text/uri-list');
        let url = (uriList || '').split('\n')[0].trim();
        if (!url) {
          const text = dt.getData('text/plain');
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

    window.addEventListener('dragenter', onDragEnter as EventListener);
    window.addEventListener('dragover', onDragOver as EventListener);
    window.addEventListener('dragleave', onDragLeave as EventListener);
    window.addEventListener('drop', onDrop as EventListener);
    return () => {
      window.removeEventListener('dragenter', onDragEnter as EventListener);
      window.removeEventListener('dragover', onDragOver as EventListener);
      window.removeEventListener('dragleave', onDragLeave as EventListener);
      window.removeEventListener('drop', onDrop as EventListener);
    };
  }, [onFiles, onUrl, onTextAsFile, setIsDraggingOver]);
}


