import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { rlGlobal, rlAI, rlIngest, rlAgent, getClientIp } from '@/lib/rateLimit';

const rules = [
  { pattern: /^\/api\/ai\//, limiter: rlAI },
  { pattern: /^\/api\/media\/ingest$/, limiter: rlIngest },
  { pattern: /^\/api\/agent(\/.*)?$/, limiter: rlAgent },
  { pattern: /^\/api\//, limiter: rlGlobal }, // fallback
] as const;

function pickLimiter(pathname: string) {
  return rules.find((r) => r.pattern.test(pathname))?.limiter ?? rlGlobal;
}

export default clerkMiddleware(async (auth, req) => {
  const pathname = new URL(req.url).pathname;
  if (!pathname.startsWith('/api')) return NextResponse.next();

  const { userId } = await auth();
  const key = userId || getClientIp(req);
  const limiter = pickLimiter(pathname);
  const result = await limiter.limit(key);

  const headers = new Headers({
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(result.reset),
  });

  if (!result.success) {
    const now = Math.floor(Date.now() / 1000);
    headers.set('Retry-After', String(Math.max(0, result.reset - now)));
    return new NextResponse(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers,
    });
  }

  const res = NextResponse.next();
  headers.forEach((v, k) => res.headers.set(k, v));
  return res;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}