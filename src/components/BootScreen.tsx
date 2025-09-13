'use client';

import React, { useEffect, useMemo, useState } from 'react';

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
  const [exiting, setExiting] = useState(false);
  const THEME_KEY = 'fyos.desktop.theme';

  type Theme = { mode: 'image'|'gradient'; value: string };
  type ThemeOption = { key: string; mode: 'image'|'gradient'; value: string };
  const options: ThemeOption[] = [
    { key: 'img-2', mode: 'image', value: '/2.webp' },
    { key: 'img-3', mode: 'image', value: '/3.webp' },
    { key: 'grad-1', mode: 'gradient', value: 'linear-gradient(180deg,#6EC1FF 0%,#60E6F7 50%,#77F2C9 100%)' },
    { key: 'grad-2', mode: 'gradient', value: 'linear-gradient(180deg,#FF6BA6 0%,#FF9D6C 50%,#FFD36E 100%)' },
    { key: 'grad-3', mode: 'gradient', value: 'linear-gradient(180deg,#A78BFA 0%,#60A5FA 50%,#22D3EE 100%)' },
  ];
  // Initialize synchronously to prevent flicker: read localStorage on first render
  const initialKey = (() => {
    if (typeof window === 'undefined') return options[0].key;
    try {
      const raw = window.localStorage.getItem(THEME_KEY);
      if (!raw) return options[0].key;
      const t: Theme = JSON.parse(raw);
      const match = options.find(o => o.mode === t.mode && o.value === t.value);
      return match ? match.key : options[0].key;
    } catch { return options[0].key; }
  })();
  const [selectedKey, setSelectedKey] = useState<string>(initialKey);
  const selected = useMemo(() => options.find(o => o.key === selectedKey) || options[0], [selectedKey]);

  useEffect(() => {
    if (complete && canProceed && !exiting) {
      setExiting(true);
      const t = window.setTimeout(() => {
        onExited?.();
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [complete, canProceed, exiting, onExited]);

  // Persist on selection
  useEffect(() => {
    const o = options.find(x => x.key === selectedKey) || options[0];
    const next: Theme = { mode: o.mode, value: o.value };
    try { window.localStorage.setItem(THEME_KEY, JSON.stringify(next)); } catch {}
    try { window.postMessage({ type: 'FYOS_SET_THEME', payload: next }, '*'); } catch {}
  }, [selectedKey]);

  const widthStyle = useMemo(() => ({ width: `${clamped}%` }), [clamped]);
  const wallpaperStyle = useMemo<React.CSSProperties>(() => {
    const o = options.find(x => x.key === selectedKey) || options[0];
    return o.mode === 'gradient'
      ? { background: o.value }
      : { backgroundImage: `url(${o.value})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }, [selectedKey]);

  return (
    <div className={`boot-overlay absolute inset-0 z-20 flex items-center justify-center text-white ${exiting ? 'boot-overlay--exit' : ''}`} aria-busy={!exiting}>
      {/* Wallpaper + glass */}
      <div className="absolute inset-0 -z-10" style={wallpaperStyle} />
      <div className="absolute inset-0 -z-10 pointer-events-none" style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'saturate(160%) blur(24px)' as any, WebkitBackdropFilter: 'saturate(160%) blur(24px)' as any }} />

      <div className="relative text-center px-6">
        <div className="mb-7">
          <h1 className="select-none font-semibold tracking-tight text-4xl md:text-6xl">
            <span>From You</span>
          </h1>
        </div>

        <div className="mx-auto w-[280px] md:w-[520px]">
          <div className="mb-4 flex items-center justify-center gap-3">
            {options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSelectedKey(opt.key)}
                aria-label="Select theme"
                className={`h-10 w-10 rounded-md ring-1 ${selectedKey===opt.key ? 'ring-sky-300' : 'ring-white/20'} overflow-hidden relative focus:outline-none focus:ring-2 focus:ring-sky-300/70`}
                title="Theme"
              >
                <div className="absolute inset-0" style={opt.mode==='image' ? { backgroundImage: `url(${opt.value})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: opt.value }} />
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.10), rgba(255,255,255,0.02))' }} />
              </button>
            ))}
          </div>

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
              <button
                type="button"
                onClick={onContinue}
                className="px-5 py-2 rounded-full border border-white/20 text-white bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors"
                aria-label="Continue without signing in"
              >
                Continue
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


