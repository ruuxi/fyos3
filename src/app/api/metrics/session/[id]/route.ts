import { metricsEnabled } from '@/lib/metrics/config';
import { getSessionDetail } from '@/lib/metrics/store';
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
