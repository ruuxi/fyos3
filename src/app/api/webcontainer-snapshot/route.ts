import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function GET(request: NextRequest) {
  try {
    const snapshotPath = path.join(process.cwd(), 'src', 'data', 'webcontainer-snapshot.bin');
    const snapshot = readFileSync(snapshotPath);
    
    return new Response(snapshot, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('Error serving WebContainer snapshot:', error);
    return NextResponse.json(
      { error: 'Snapshot not found. Run `pnpm generate:snapshot` first.' },
      { status: 404 }
    );
  }
}
