'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConvexHttpClient } from 'convex/browser';
import { useAuth } from '@clerk/nextjs';

export function useConvexClient() {
  const { getToken, isLoaded } = useAuth();
  const [client, setClient] = useState<ConvexHttpClient | null>(null);
  const [ready, setReady] = useState(false);

  const convexUrl = useMemo(() => process.env.NEXT_PUBLIC_CONVEX_URL || '', []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!convexUrl) { setClient(null); setReady(true); return; }
      const c = new ConvexHttpClient(convexUrl);
      try {
        if (isLoaded) {
          const token = await getToken({ template: 'convex' }).catch(() => null);
          if (token) c.setAuth(token);
        }
      } catch {}
      if (!cancelled) {
        setClient(c);
        setReady(true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [convexUrl, getToken, isLoaded]);

  return { client, ready } as const;
}

