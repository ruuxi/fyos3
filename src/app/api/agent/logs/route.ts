import { NextResponse } from 'next/server';
import { agentLogger } from '@/lib/agentLogger';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const sessionId = url.searchParams.get('sessionId');
    const format = url.searchParams.get('format') || 'json';

    if (sessionId) {
      // Get session summary
      const summary = await agentLogger.getSessionSummary(sessionId);
      return NextResponse.json(summary);
    }

    const logs = await agentLogger.getRecentLogs(limit);
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = 'timestamp,sessionId,type,messageId,role,toolName,toolCallId,toolDuration,promptTokens,completionTokens,totalTokens,estimatedCost,model,error\n';
      const csvRows = logs.map(log => {
        const data = log.data;
        return [
          log.timestamp,
          log.sessionId,
          log.type,
          data.messageId || '',
          data.role || '',
          data.toolName || '',
          data.toolCallId || '',
          data.toolDuration || '',
          data.promptTokens || '',
          data.completionTokens || '',
          data.totalTokens || '',
          data.estimatedCost || '',
          data.model || '',
          data.error || ''
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
      }).join('\n');
      
      return new NextResponse(csvHeaders + csvRows, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="agent-logs.csv"'
        }
      });
    }

    return NextResponse.json({
      logs,
      count: logs.length,
      summary: {
        totalSessions: new Set(logs.map(l => l.sessionId)).size,
        totalMessages: logs.filter(l => l.type === 'message').length,
        totalToolCalls: logs.filter(l => l.type === 'tool_call').length,
        totalTokens: logs.filter(l => l.type === 'token_usage').reduce((sum, l) => sum + (l.data.totalTokens || 0), 0),
        totalCost: logs.filter(l => l.type === 'token_usage').reduce((sum, l) => sum + (l.data.estimatedCost || 0), 0),
        toolUsage: logs.filter(l => l.type === 'tool_call').reduce((acc, l) => {
          const tool = l.data.toolName || 'unknown';
          acc[tool] = (acc[tool] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      }
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
      // For now, we don't support deleting specific sessions
      // This could be implemented by filtering the log file
      return NextResponse.json(
        { error: 'Session deletion not implemented yet' },
        { status: 501 }
      );
    }

    // Clear all logs (this would require implementing a clear method in agentLogger)
    return NextResponse.json(
      { error: 'Log clearing not implemented yet' },
      { status: 501 }
    );
  } catch (error) {
    console.error('[Agent Logs API] Delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete logs' },
      { status: 500 }
    );
  }
}




