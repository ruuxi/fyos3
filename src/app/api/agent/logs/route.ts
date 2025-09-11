import { NextResponse } from 'next/server';
import { agentLogger } from '@/lib/agentLogger';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    if (sessionId) {
      // Get session summary - will return empty data since we don't persist logs
      const summary = await agentLogger.getSessionSummary(sessionId);
      return NextResponse.json(summary);
    }

    // Return empty logs since we don't persist them to files
    const logs: any[] = [];

    return NextResponse.json({
      logs,
      count: 0,
      summary: {
        totalSessions: 0,
        totalMessages: 0,
        totalToolCalls: 0,
        totalTokens: 0,
        totalCost: 0,
        toolUsage: {}
      },
      message: 'Logging is now console-only. No persistent logs are stored.'
    });
  } catch (error) {
    console.error('[Agent Logs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    if (sessionId) {
      // No persistent logs to delete
      return NextResponse.json({
        message: 'No persistent logs to delete - logging is console-only',
        sessionId
      });
    }

    // No persistent logs to clear
    return NextResponse.json({
      message: 'No persistent logs to clear - logging is console-only'
    });
  } catch (error) {
    console.error('[Agent Logs API] Delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete logs' },
      { status: 500 }
    );
  }
}




