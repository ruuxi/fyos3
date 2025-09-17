'use client';

import { useEffect, useMemo, useState } from 'react';
import agentVerbs from '@/data/agent-verbs';

const DEFAULT_INTERVAL = 2000;

export type AgentVerbCarouselProps = {
  intervalMs?: number;
};

export default function AgentVerbCarousel({ intervalMs = DEFAULT_INTERVAL }: AgentVerbCarouselProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * agentVerbs.length));

  const words = useMemo(() => agentVerbs, []);

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
    <span className="agent-verb-shimmer inline-block font-medium tracking-wide text-white/90">
      {currentWord}
      <style jsx>{`
        @keyframes agentVerbShimmer {
          0% { background-position: -120%; }
          50% { background-position: 120%; }
          100% { background-position: 120%; }
        }
        .agent-verb-shimmer {
          background: linear-gradient(120deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.75) 45%, rgba(255, 255, 255, 0.2) 75%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          color: transparent;
          animation: agentVerbShimmer 2.2s ease-in-out infinite;
          text-transform: lowercase;
          letter-spacing: 0.04em;
        }
      `}</style>
    </span>
  );
}
