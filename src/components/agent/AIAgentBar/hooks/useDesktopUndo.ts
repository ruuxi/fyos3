import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

type BuildSnapshot = (instance: WebContainerAPI) => Promise<{ gz: Uint8Array }>;
type RestoreSnapshot = (instance: WebContainerAPI, snapshot: Uint8Array) => Promise<void>;

type UseDesktopUndoArgs = {
  instance: WebContainerAPI | null;
  instanceRef: MutableRefObject<WebContainerAPI | null>;
  status: string;
  buildSnapshot: BuildSnapshot;
  restoreSnapshot: RestoreSnapshot;
};

type RestoreOptions = {
  onBeforeRestore?: () => void;
  onAfterRestore?: () => void;
};

export function useDesktopUndo({
  instance,
  instanceRef,
  status,
  buildSnapshot,
  restoreSnapshot,
}: UseDesktopUndoArgs) {
  const undoStackRef = useRef<Uint8Array[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const fsChangedRef = useRef(false);
  const prevStatusRef = useRef<string>('ready');
  const lastInstanceRef = useRef<WebContainerAPI | null>(null);

  useEffect(() => {
    if (!instance) {
      undoStackRef.current = [];
      setUndoDepth(0);
      lastInstanceRef.current = null;
      return;
    }
    if (lastInstanceRef.current === instance) return;

    let cancelled = false;
    lastInstanceRef.current = instance;
    undoStackRef.current = [];
    setUndoDepth(0);
    fsChangedRef.current = false;

    (async () => {
      try {
        const { gz } = await buildSnapshot(instance);
        if (cancelled) return;
        undoStackRef.current.push(gz);
        setUndoDepth(undoStackRef.current.length);
        console.log('📸 [UNDO] Initial snapshot captured');
      } catch (error) {
        if (!cancelled) {
          console.warn('[UNDO] Initial snapshot failed', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [instance, buildSnapshot]);

  const markFsChanged = useCallback(() => {
    fsChangedRef.current = true;
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const now = status;
    const finished = (prev === 'submitted' || prev === 'streaming') && now === 'ready';

    let cancelled = false;

    if (finished) {
      if (fsChangedRef.current && instanceRef.current) {
        const inst = instanceRef.current;
        if (inst) {
          (async () => {
            try {
              const { gz } = await buildSnapshot(inst);
              if (cancelled) return;
              undoStackRef.current.push(gz);
              setUndoDepth(undoStackRef.current.length);
              console.log('📸 [UNDO] Snapshot captured after agent run. Depth:', undoStackRef.current.length);
            } catch (error) {
              if (!cancelled) {
                console.warn('[UNDO] Snapshot after run failed', error);
              }
            } finally {
              fsChangedRef.current = false;
            }
          })();
        }
      } else {
        fsChangedRef.current = false;
      }
    }

    prevStatusRef.current = now;
    return () => {
      cancelled = true;
    };
  }, [status, buildSnapshot, instanceRef]);

  const restorePreviousSnapshot = useCallback(async (opts?: RestoreOptions) => {
    const inst = instanceRef.current;
    if (!inst) return false;

    const stack = undoStackRef.current;
    if (stack.length < 2) return false;

    const currentSnapshot = stack.pop();
    const previousSnapshot = stack[stack.length - 1];
    if (!previousSnapshot) {
      if (currentSnapshot) stack.push(currentSnapshot);
      return false;
    }

    opts?.onBeforeRestore?.();

    try {
      await restoreSnapshot(inst, previousSnapshot);
      fsChangedRef.current = false;
      setUndoDepth(stack.length);
      console.log('↩️ [UNDO] Restored previous snapshot. Depth:', stack.length);
      return true;
    } catch (error) {
      if (currentSnapshot) stack.push(currentSnapshot);
      throw error;
    } finally {
      opts?.onAfterRestore?.();
    }
  }, [instanceRef, restoreSnapshot]);

  return {
    undoDepth,
    canUndo: undoDepth > 1,
    markFsChanged,
    restorePreviousSnapshot,
  } as const;
}
