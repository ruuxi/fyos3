import { metricsEnabled } from '@/lib/metrics/config';
import { getSessionDetail, setSessionName } from '@/lib/metrics/store';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!metricsEnabled) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  const detail = getSessionDetail(id);
  if (!detail) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  return NextResponse.json(detail, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!metricsEnabled) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  let body: any = null;
  try { body = await req.json(); } catch {}
  const name = typeof body?.name === 'string' ? body.name : '';
  // Basic validation: max length to prevent abuse
  const trimmed = name.trim().slice(0, 120);
  setSessionName(id, trimmed);
  const detail = getSessionDetail(id);
  if (!detail) return NextResponse.json({ ok: true, name: trimmed || undefined }, { status: 200 });
  return NextResponse.json({ ok: true, name: trimmed || undefined }, { status: 200 });
}
