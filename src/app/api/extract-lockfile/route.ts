import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lockfileContent } = body;
    
    if (!lockfileContent) {
      return NextResponse.json({
        success: false,
        error: 'No lockfile content provided'
      }, { status: 400 });
    }
    
    // Save to templates directory
    const templatesDir = path.join(process.cwd(), 'templates', 'webcontainer');
    const lockfilePath = path.join(templatesDir, 'pnpm-lock.yaml');
    
    // Ensure directory exists
    await fs.mkdir(templatesDir, { recursive: true });
    
    // Write lockfile
    await fs.writeFile(lockfilePath, lockfileContent, 'utf8');
    
    return NextResponse.json({
      success: true,
      message: 'Lockfile saved successfully to templates/webcontainer/pnpm-lock.yaml'
    });
    
  } catch (error) {
    console.error('Error saving lockfile:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}
