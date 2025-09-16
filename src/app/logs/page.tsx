'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AgentLogEntry } from '@/lib/agentLogger';

interface LogSummary {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalTokens: number;
  totalCost: number;
  toolUsage: Record<string, number>;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/agent/logs?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch logs');
      
      const data = (await response.json()) as { logs?: AgentLogEntry[]; summary?: LogSummary };
      setLogs(data.logs ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(6)}`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'message': return 'bg-blue-100 text-blue-800';
      case 'tool_call': return 'bg-green-100 text-green-800';
      case 'token_usage': return 'bg-purple-100 text-purple-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const downloadCSV = () => {
    window.open(`/api/agent/logs?format=csv&limit=${limit}`, '_blank');
  };

  const uniqueSessions = Array.from(new Set(logs.map(l => l.sessionId)));

  const filteredLogs = selectedSession 
    ? logs.filter(l => l.sessionId === selectedSession)
    : logs;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading logs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Agent Activity Logs</h1>
        <div className="flex gap-2">
          <Button onClick={fetchLogs} variant="outline">Refresh</Button>
          <Button onClick={downloadCSV} variant="outline">Download CSV</Button>
        </div>
      </div>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="font-medium">Sessions</div>
                <div className="text-2xl font-bold">{summary.totalSessions}</div>
              </div>
              <div>
                <div className="font-medium">Messages</div>
                <div className="text-2xl font-bold">{summary.totalMessages}</div>
              </div>
              <div>
                <div className="font-medium">Tool Calls</div>
                <div className="text-2xl font-bold">{summary.totalToolCalls}</div>
              </div>
              <div>
                <div className="font-medium">Total Tokens</div>
                <div className="text-2xl font-bold">{summary.totalTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="font-medium">Est. Cost</div>
                <div className="text-2xl font-bold">{formatCost(summary.totalCost)}</div>
              </div>
            </div>
            
            {Object.keys(summary.toolUsage).length > 0 && (
              <div className="mt-4">
                <div className="font-medium mb-2">Tool Usage</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(summary.toolUsage).map(([tool, count]) => (
                    <Badge key={tool} variant="outline">
                      {tool}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4 items-center">
        <div>
          <label className="text-sm font-medium">Limit: </label>
          <select 
            value={limit} 
            onChange={(e) => setLimit(Number(e.target.value))}
            className="border rounded px-2 py-1"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
        
        <div>
          <label className="text-sm font-medium">Session: </label>
          <select 
            value={selectedSession || ''} 
            onChange={(e) => setSelectedSession(e.target.value || null)}
            className="border rounded px-2 py-1"
          >
            <option value="">All Sessions</option>
            {uniqueSessions.map(sessionId => (
              <option key={sessionId} value={sessionId}>
                {sessionId.slice(0, 20)}...
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {filteredLogs.map((log, index) => (
          <Card key={index} className="p-4">
            <div className="flex justify-between items-start mb-2">
              <div className="flex gap-2 items-center">
                <Badge className={getTypeColor(log.type)}>
                  {log.type}
                </Badge>
                <span className="text-sm text-gray-500">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className="text-xs text-gray-400">
                  {log.sessionId.slice(0, 12)}...
                </span>
              </div>
            </div>
            
            <div className="text-sm space-y-1">
              {log.type === 'message' && (
                <>
                  <div><strong>Role:</strong> {log.data.role}</div>
                  <div><strong>Content:</strong> {log.data.content}</div>
                </>
              )}
              
              {log.type === 'tool_call' && (
                <>
                  <div><strong>Tool:</strong> {log.data.toolName}</div>
                  <div><strong>Duration:</strong> {log.data.toolDuration}ms</div>
                  <div><strong>Input:</strong> <code className="bg-gray-100 px-1 rounded text-xs">{JSON.stringify(log.data.toolInput)}</code></div>
                  <div><strong>Output:</strong> <code className="bg-gray-100 px-1 rounded text-xs">{JSON.stringify(log.data.toolOutput)}</code></div>
                </>
              )}
              
              {log.type === 'token_usage' && (
                <>
                  <div><strong>Model:</strong> {log.data.model}</div>
                  <div><strong>Tokens:</strong> {log.data.promptTokens}p + {log.data.completionTokens}c = {log.data.totalTokens} total</div>
                  <div><strong>Cost:</strong> {formatCost(log.data.estimatedCost || 0)}</div>
                </>
              )}
              
              {log.type === 'error' && (
                <>
                  <div className="text-red-600"><strong>Error:</strong> {log.data.error}</div>
                  {log.data.stack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">Stack trace</summary>
                      <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-x-auto">{log.data.stack}</pre>
                    </details>
                  )}
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      {filteredLogs.length === 0 && (
        <div className="text-center text-gray-500">No logs found.</div>
      )}
    </div>
  );
}
