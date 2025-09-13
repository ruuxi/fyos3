import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useScrollSizing(mode: 'compact' | 'chat' | 'visit' | 'media') {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const scrollAnimRef = useRef<number | null>(null);
  const forceFollowRef = useRef(false);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const MIN_CONTAINER_HEIGHT = 72;
  const MAX_CONTAINER_HEIGHT = 520;

  function isUserNearBottom(el: HTMLElement, threshold = 48): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  function cancelScrollAnimation() {
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  }

  function smoothScrollToBottom(el: HTMLElement, durationMs = 550) {
    const prefersReduced =
      typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (durationMs <= 0 || prefersReduced) {
      const snapTarget = el.scrollHeight - el.clientHeight;
      el.scrollTop = snapTarget;
      return;
    }
    if (scrollAnimRef.current !== null) {
      return;
    }
    const startTop = el.scrollTop;
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const dynamicTarget = el.scrollHeight - el.clientHeight;
      el.scrollTop = startTop + (dynamicTarget - startTop) * eased;
      if (t < 1) {
        scrollAnimRef.current = requestAnimationFrame(step);
      } else {
        scrollAnimRef.current = null;
      }
    };
    scrollAnimRef.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = isUserNearBottom(el, 56);
    };
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    isNearBottomRef.current = isUserNearBottom(el, 56);
    return () => el.removeEventListener('scroll', onScroll as any);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesInnerRef.current;
    if (!container || !content) return;
    const updateHeight = () => {
      const contentHeight = content.scrollHeight;
      const viewportCap = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : MAX_CONTAINER_HEIGHT;
      const next = Math.min(viewportCap, Math.max(MIN_CONTAINER_HEIGHT, contentHeight));
      setContainerHeight(next);
    };
    updateHeight();
    const ro = new ResizeObserver(() => { updateHeight(); });
    ro.observe(content);
    const onResize = () => updateHeight();
    window.addEventListener('resize', onResize);
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize); };
  });

  useEffect(() => () => cancelScrollAnimation(), []);

  useLayoutEffect(() => {
    if (mode !== 'chat') return;
    const el = messagesContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = isUserNearBottom(el, 56);
    const prevScrollHeight = prevScrollHeightRef.current || 0;
    const newScrollHeight = el.scrollHeight;
    if (prevScrollHeight === 0) {
      smoothScrollToBottom(el, 700);
      prevScrollHeightRef.current = newScrollHeight;
      return;
    }
    const shouldFollow = forceFollowRef.current || isNearBottomRef.current;
    if (shouldFollow) {
      requestAnimationFrame(() => smoothScrollToBottom(el, 600));
    } else {
      const delta = newScrollHeight - prevScrollHeight;
      if (delta > 0) {
        el.scrollTop += delta;
      }
    }
    prevScrollHeightRef.current = el.scrollHeight;
    forceFollowRef.current = false;
  });

  return {
    messagesContainerRef,
    messagesInnerRef,
    containerHeight,
    setContainerHeight,
    forceFollow: () => { forceFollowRef.current = true; },
  } as const;
}


