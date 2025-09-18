"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface MetricData {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalTokens: number;
  totalCost: number;
  toolUsage: Record<string, number>;
}

export default function EvaluationPage() {
  const [metrics, setMetrics] = useState<MetricData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/agent/logs?limit=1000');
      if (!response.ok) throw new Error('Failed to fetch metrics');
      
      const data = await response.json();
      setMetrics(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading evaluation metrics...</div>
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
        <h1 className="text-3xl font-bold">Agent Evaluation Metrics</h1>
        <Button onClick={fetchMetrics} variant="outline">Refresh</Button>
      </div>

      {metrics && (
        <Card>
          <CardHeader>
            <CardTitle>Performance Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="font-medium">Sessions</div>
                <div className="text-2xl font-bold">{metrics.totalSessions}</div>
              </div>
              <div>
                <div className="font-medium">Messages</div>
                <div className="text-2xl font-bold">{metrics.totalMessages}</div>
              </div>
              <div>
                <div className="font-medium">Tool Calls</div>
                <div className="text-2xl font-bold">{metrics.totalToolCalls}</div>
              </div>
              <div>
                <div className="font-medium">Total Tokens</div>
                <div className="text-2xl font-bold">{metrics.totalTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="font-medium">Est. Cost</div>
                <div className="text-2xl font-bold">${metrics.totalCost.toFixed(6)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
