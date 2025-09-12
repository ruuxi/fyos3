'use client';

import React, { useEffect, useMemo, useState } from 'react';

type BootScreenProps = {
  message?: string;
  progress: number; // 0..100
  complete?: boolean; // triggers exit animation
  onExited?: () => void; // called after exit animation completes
  isSignedIn?: boolean; // auth gate
  onSignIn?: () => void; // sign-in action
};

export default function BootScreen({ message = 'Preparing…', progress, complete = false, onExited, isSignedIn = false, onSignIn }: BootScreenProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (complete && isSignedIn && !exiting) {
      setExiting(true);
      const t = window.setTimeout(() => {
        onExited?.();
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [complete, isSignedIn, exiting, onExited]);

  const widthStyle = useMemo(() => ({ width: `${clamped}%` }), [clamped]);

  return (
    <div className={`boot-overlay absolute inset-0 z-20 flex items-center justify-center bg-white text-black ${exiting ? 'boot-overlay--exit' : ''}`} aria-busy={!exiting}>
      <div className="relative text-center px-6">
        <div className="mb-7">
          <h1 className="select-none font-semibold tracking-tight text-4xl md:text-6xl">
            <span>From You</span>
          </h1>
        </div>

        <div className="mx-auto w-[280px] md:w-[520px]">
          <div className="h-2.5 rounded-full bg-black/10 ring-1 ring-black/10 overflow-hidden relative">
            <div
              className="h-full rounded-full bg-black/80 transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]"
              style={widthStyle}
            >
              {/* shimmer removed for minimalist aesthetic */}
            </div>
          </div>
          <div className="mt-4 text-[13px] text-black/70 leading-relaxed tracking-wide select-none">
            {message}
          </div>
          {!isSignedIn && (
            <div className="mt-6 flex items-center justify-center">
              <button
                type="button"
                onClick={onSignIn}
                className="px-5 py-2 rounded-full border border-black/15 text-black bg-white hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-black/30 transition-colors"
                aria-label="Sign in to continue"
              >
                Sign in
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-30%); }
          100% { transform: translateX(30%); }
        }
        .boot-overlay {
          clip-path: circle(150% at 50% 50%);
          transition: clip-path 800ms cubic-bezier(0.16, 1, 0.3, 1), opacity 600ms ease;
        }
        .boot-overlay--exit {
          clip-path: circle(0% at 50% 50%);
          opacity: 0;
        }
      `}</style>
    </div>
  );
}


