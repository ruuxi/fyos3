import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Support both Upstash and Vercel KV variable names
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
  : new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

export const rlGlobal = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, '1 m'),
  analytics: true,
  prefix: 'rl:global',
});

export const rlAI = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(40, '1 m'),
  analytics: true,
  prefix: 'rl:ai',
});

export const rlIngest = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(40, '1 m'),
  analytics: true,
  prefix: 'rl:ingest',
});

export const rlAgent = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(40, '1 m'),
  analytics: true,
  prefix: 'rl:agent',
});

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

