'use client';

import React, { useEffect, useMemo, useState } from 'react';

type BootScreenProps = {
  message?: string;
  progress: number; // 0..100
  complete?: boolean; // triggers exit animation
  onExited?: () => void; // called after exit animation completes
};

export default function BootScreen({ message = 'Preparing…', progress, complete = false, onExited }: BootScreenProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (complete && !exiting) {
      setExiting(true);
      const t = window.setTimeout(() => {
        onExited?.();
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [complete, exiting, onExited]);

  const widthStyle = useMemo(() => ({ width: `${clamped}%` }), [clamped]);

  return (
    <div className={`boot-overlay absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(120%_120%_at_50%_0%,#0a0d12_0%,#070a0f_55%,#05070b_100%)] ${exiting ? 'boot-overlay--exit' : ''}`}>
      <div className="relative text-center px-6">
        <div className="mb-7">
          <h1 className="select-none font-semibold tracking-tight text-4xl md:text-6xl">
            <span className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">From You</span>
          </h1>
        </div>

        <div className="mx-auto w-[280px] md:w-[520px]">
          <div className="h-2.5 rounded-full bg-white/10 ring-1 ring-white/10 overflow-hidden relative">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7dd3fc] via-[#60a5fa] to-[#a78bfa] shadow-[0_0_24px_rgba(96,165,250,0.35)] transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] [will-change:width]"
              style={widthStyle}
            >
              <div className="absolute inset-0 opacity-70">
                <div className="h-full w-full bg-[linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] [mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)] animate-[shimmer_1.8s_ease_infinite]" />
              </div>
            </div>
          </div>
          <div className="mt-4 text-[13px] text-white/70 leading-relaxed tracking-wide select-none">
            {message}
          </div>
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


