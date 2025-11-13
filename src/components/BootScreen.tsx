'use client';

import React, { useEffect, useMemo } from 'react';

type BootScreenProps = {
  message?: string;
  progress: number; // 0..100
  complete?: boolean; // triggers exit animation
  onExited?: () => void; // called after exit animation completes
  isSignedIn?: boolean; // auth gate
  onSignIn?: () => void; // sign-in action
  canProceed?: boolean; // true if user can proceed (signed in or continued anon)
  onContinue?: () => void; // continue without sign-in
};

export default function BootScreen({ message = 'Preparing…', progress, complete = false, onExited, isSignedIn = false, onSignIn, canProceed = false, onContinue }: BootScreenProps) {
  const clamped = Math.max(0, Math.min(100, progress));

  useEffect(() => {
    if (complete && canProceed) {
      onExited?.();
    }
  }, [complete, canProceed, onExited]);

  const widthStyle = useMemo(() => ({ width: `${clamped}%` }), [clamped]);
  const wallpaperStyle = useMemo<React.CSSProperties>(() => {
    return { backgroundImage: `url(/2.webp)`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }, []);

  const glassStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'saturate(160%) blur(24px)',
    WebkitBackdropFilter: 'saturate(160%) blur(24px)',
  };

  return (
    <div className="boot-overlay absolute inset-0 z-20 flex items-center text-white" aria-busy={!complete}>
      {/* Wallpaper + glass */}
      <div className="absolute inset-0 -z-10" style={wallpaperStyle} />
      <div className="absolute inset-0 -z-10 pointer-events-none" style={glassStyle} />

      <div className="relative text-center px-6" style={{ left: 'calc(50% + 200px)', transform: 'translateX(-50%)' }}>
        <div className="mb-7">
          <div className="boot-brand-text">fromyou</div>
        </div>

        <div className="mx-auto w-[280px] md:w-[520px]">
          <div className="h-2.5 rounded-full bg-white/10 ring-1 ring-white/10 overflow-hidden relative">
            <div
              className="h-full rounded-full bg-white/90 transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]"
              style={widthStyle}
            >
              {/* shimmer removed for minimalist aesthetic */}
            </div>
          </div>
          <div className="mt-4 text-[13px] text-white/80 leading-relaxed tracking-wide select-none">
            {message}
          </div>
          {!isSignedIn && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onSignIn}
                className="px-5 py-2 rounded-full border border-white/20 text-white bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors"
                aria-label="Sign in to continue"
              >
                Sign in
              </button>
              {onContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  className="px-5 py-2 rounded-full border border-white/20 text-white bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors"
                  aria-label="Continue as guest"
                >
                  Continue as guest
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-30%); }
          100% { transform: translateX(30%); }
        }
        .boot-brand-text {
          font-family: 'Playfair Display', serif;
          font-weight: 600;
          font-size: 56px;
          line-height: 1;
          color: #f7fafc;
          text-shadow: 0 2px 8px rgba(0,0,0,0.35);
          user-select: none;
        }
      `}</style>
    </div>
  );
}
