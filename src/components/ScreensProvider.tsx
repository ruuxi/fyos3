'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface ScreensContextValue {
  activeIndex: number;
  goTo: (index: number, opts?: { durationMs?: number }) => void;
  next: () => void;
  prev: () => void;
  isTransitioning: boolean;
  animDurationMs: number;
}

const ScreensContext = createContext<ScreensContextValue | null>(null);

export function useScreens(): ScreensContextValue {
  const context = useContext(ScreensContext);
  if (!context) {
    throw new Error('useScreens must be used within a ScreensProvider');
  }
  return context;
}

interface ScreensProviderProps {
  children: React.ReactNode;
  defaultIndex?: number;
  screenCount?: number;
}

export function ScreensProvider({ 
  children, 
  defaultIndex = 1, // Desktop is center/default
  screenCount = 2 
}: ScreensProviderProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [animDurationMs, setAnimDurationMs] = useState<number>(420);
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const goTo = useCallback((index: number, opts?: { durationMs?: number }) => {
    if (index < 0 || index >= screenCount || index === activeIndex || isTransitioning) {
      return;
    }

    setIsTransitioning(true);
    const dur = Math.max(0, Math.min(800, Math.round(opts?.durationMs ?? 420)));
    setAnimDurationMs(dur);
    setActiveIndex(index);

    // Clear any existing timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Mark transition as complete after animation duration
    transitionTimeoutRef.current = setTimeout(() => {
      setIsTransitioning(false);
      transitionTimeoutRef.current = null;
    }, Math.max(0, Math.min(1200, dur + 20))); // small buffer past CSS timing
  }, [activeIndex, isTransitioning, screenCount]);

  const next = useCallback(() => {
    goTo(activeIndex + 1);
  }, [activeIndex, goTo]);

  const prev = useCallback(() => {
    goTo(activeIndex - 1);
  }, [activeIndex, goTo]);

  const value: ScreensContextValue = {
    activeIndex,
    goTo,
    next,
    prev,
    isTransitioning,
    animDurationMs,
  };

  return (
    <ScreensContext.Provider value={value}>
      {children}
    </ScreensContext.Provider>
  );
}
