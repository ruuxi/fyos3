'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import agentVerbs from '@/data/agent-verbs';

const DEFAULT_INTERVAL = 5000;

export type AgentVerbCarouselProps = {
  intervalMs?: number;
};

export default function AgentVerbCarousel({ intervalMs = DEFAULT_INTERVAL }: AgentVerbCarouselProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * agentVerbs.length));

  const words = useMemo(() => agentVerbs, []);
  const gradient = useMemo(() => {
    const palettes = [
      'linear-gradient(120deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.55) 18%, rgba(255,255,255,0.95) 52%, rgba(255,255,255,0.4) 84%, rgba(255,255,255,0.22) 100%)',
      'linear-gradient(120deg, rgba(56,189,248,0.35) 0%, rgba(99,102,241,0.65) 45%, rgba(236,72,153,0.75) 100%)',
      'linear-gradient(120deg, rgba(249,115,22,0.45) 0%, rgba(251,191,36,0.75) 50%, rgba(16,185,129,0.55) 100%)',
      'linear-gradient(120deg, rgba(168,85,247,0.65) 0%, rgba(56,189,248,0.85) 55%, rgba(16,185,129,0.65) 100%)',
      'linear-gradient(120deg, rgba(248,113,113,0.65) 0%, rgba(245,158,11,0.75) 50%, rgba(129,140,248,0.65) 100%)',
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }, []);
  const shimmerStyle = useMemo(() => ({
    '--agent-verb-gradient': gradient,
  }), [gradient]);

  useEffect(() => {
    const tick = () => {
      setIndex((prev) => {
        const next = (prev + 1) % words.length;
        return next;
      });
    };
    const timer = window.setInterval(tick, Math.max(400, intervalMs));
    return () => window.clearInterval(timer);
  }, [intervalMs, words.length]);

  const currentWord = words[index];

  return (
    <span
      className="agent-verb-shimmer inline-block font-semibold tracking-wide text-white"
      style={shimmerStyle as CSSProperties}
    >
      {currentWord}
      <style jsx>{`
        @keyframes agentVerbShimmer {
          0% { background-position: -150%; }
          60% { background-position: 150%; }
          75% { background-position: 150%; }
          100% { background-position: -150%; }
        }
        .agent-verb-shimmer {
          background: var(--agent-verb-gradient, linear-gradient(120deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.35) 100%));
          background-size: 230% 100%;
          -webkit-background-clip: text;
          color: transparent;
          text-shadow: 0 0 16px rgba(255,255,255,0.25);
          filter: drop-shadow(0 0 10px rgba(255,255,255,0.12));
          animation: agentVerbShimmer 4.8s ease-in-out infinite;
          text-transform: lowercase;
          letter-spacing: 0.06em;
        }
      `}</style>
    </span>
  );
}
