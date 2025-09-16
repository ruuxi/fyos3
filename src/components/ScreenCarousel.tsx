'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useScreens } from './ScreensProvider';

interface ScreenCarouselProps {
  children: React.ReactNode[];
}

export function ScreenCarousel({ children }: ScreenCarouselProps) {
  const { activeIndex, goTo, isTransitioning, animDurationMs } = useScreens();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [hasHorizontalIntent, setHasHorizontalIntent] = useState(false);
  const [prefersReduced, setPrefersReduced] = useState(false);

  // Calculate transform based on active index and drag offset
  const baseTransform = -activeIndex * 100; // Each screen is 100vw
  // Apply rubber-band resistance at edges for an Apple-like feel
  const edge = activeIndex === 0 ? -1 : (activeIndex === children.length - 1 ? 1 : 0);
  const resisted = (() => {
    if (edge === -1 && dragOffset > 0) {
      const ratio = 1 + dragOffset / (window.innerWidth * 2);
      return dragOffset / ratio;
    }
    if (edge === 1 && dragOffset < 0) {
      const ratio = 1 + Math.abs(dragOffset) / (window.innerWidth * 2);
      return dragOffset / ratio;
    }
    return dragOffset;
  })();
  const currentTransform = baseTransform + (typeof window !== 'undefined' ? (resisted / window.innerWidth) * 100 : 0);

  // Handle pointer events for swipe gestures
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let startTime = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (isTransitioning) return;
      
      // Don't interfere with interactive elements
      const target = e.target as Element;
      if (target && (
        target.closest('button') || 
        target.closest('a') || 
        target.closest('input') || 
        target.closest('textarea') || 
        target.closest('select') ||
        target.closest('[role="button"]') ||
        target.closest('[tabindex]')
      )) {
        return;
      }
      
      startX = e.clientX;
      startY = e.clientY;
      currentX = e.clientX;
      startTime = Date.now();
      setIsDragging(true);
      setHasHorizontalIntent(false);
      setDragOffset(0);
      
      // Don't capture pointer or prevent default immediately
      // Wait until we detect horizontal intent
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging || isTransitioning) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      currentX = e.clientX;

      // Determine intent based on initial movement
      if (!hasHorizontalIntent && (Math.abs(deltaX) > 16 || Math.abs(deltaY) > 16)) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          setHasHorizontalIntent(true);
          // Now that we know it's a horizontal swipe, capture the pointer
          container.setPointerCapture(e.pointerId);
          // Prevent page scroll when we detect horizontal intent
          document.body.style.overflow = 'hidden';
        } else {
          // Vertical intent - cancel drag
          setIsDragging(false);
          return;
        }
      }

      if (hasHorizontalIntent) {
        setDragOffset(deltaX);
        e.preventDefault();
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDragging || isTransitioning) return;

      const deltaX = currentX - startX;
      const deltaTime = Date.now() - startTime;
      const velocity = Math.abs(deltaX) / deltaTime; // px/ms
      
      // Only process swipe if we had horizontal intent
      let targetIndex = activeIndex;
      
      if (hasHorizontalIntent) {
        // Determine if we should commit to next/prev screen
        const threshold = window.innerWidth * 0.28; // 28% of viewport width (slightly easier)
        const velocityThreshold = 0.45; // px/ms (slightly easier)
        
        if (Math.abs(deltaX) > threshold || velocity > velocityThreshold) {
          if (deltaX > 0 && activeIndex > 0) {
            targetIndex = activeIndex - 1; // Swipe right = go to previous (left) screen
          } else if (deltaX < 0 && activeIndex < children.length - 1) {
            targetIndex = activeIndex + 1; // Swipe left = go to next (right) screen
          }
        }
      }

      // Reset drag state
      setIsDragging(false);
      setHasHorizontalIntent(false);
      setDragOffset(0);
      document.body.style.overflow = '';

      // Navigate to target screen
      if (targetIndex !== activeIndex) {
        // Dynamic duration based on remaining distance for a cohesive feel
        const fractionRemaining = 1 - Math.min(1, Math.abs(deltaX) / window.innerWidth);
        const baseMs = prefersReduced ? 1 : 420;
        const durationMs = Math.max(220, Math.min(520, Math.round(baseMs * (0.6 + 0.4 * fractionRemaining))));
        goTo(targetIndex, { durationMs });
      }

      // Only release pointer capture if we captured it
      if (hasHorizontalIntent) {
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer wasn't captured
        }
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const hadHorizontalIntent = hasHorizontalIntent;
      setIsDragging(false);
      setHasHorizontalIntent(false);
      setDragOffset(0);
      document.body.style.overflow = '';
      
      // Only release pointer capture if we captured it
      if (hadHorizontalIntent) {
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer wasn't captured
        }
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', handlePointerCancel);
      document.body.style.overflow = '';
    };
  }, [isDragging, hasHorizontalIntent, isTransitioning, activeIndex, children.length, goTo, prefersReduced]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTransitioning) return;

      switch (e.key) {
        case 'Escape':
          if (activeIndex !== 1) goTo(1); // Return to Desktop
          break;
        case 'ArrowLeft':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (activeIndex > 0) goTo(activeIndex - 1);
          }
          break;
        case 'ArrowRight':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (activeIndex < children.length - 1) goTo(activeIndex + 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, children.length, goTo, isTransitioning]);

  // Respect reduced motion
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (event?: MediaQueryListEvent) => {
      setPrefersReduced(event?.matches ?? m.matches);
    };
    apply();
    try {
      m.addEventListener('change', apply);
      return () => m.removeEventListener('change', apply);
    } catch {
      const legacyListener = (event: MediaQueryListEvent) => apply(event);
      m.addListener(legacyListener);
      return () => m.removeListener(legacyListener);
    }
  }, []);

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{ 
        touchAction: hasHorizontalIntent ? 'none' : 'auto',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      <div
        className="flex h-full"
        style={{
          width: `${children.length * 100}vw`,
          transform: `translate3d(${currentTransform}vw, 0, 0)`,
          transition: isDragging
            ? 'none'
            : prefersReduced
              ? 'none'
              : `transform ${animDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          willChange: 'transform',
        }}
      >
        {children.map((child, index) => (
          <div
            key={index}
            className="flex-shrink-0 w-screen h-full relative"
            aria-hidden={index !== activeIndex}
            style={{
              pointerEvents: isDragging ? 'none' : 'auto',
            }}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
