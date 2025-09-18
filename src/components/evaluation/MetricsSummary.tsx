import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricsSummaryProps {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalTokens: number;
  totalCost: number;
  toolUsage: Record<string, number>;
}

export default function MetricsSummary({
  totalSessions,
  totalMessages,
  totalToolCalls,
  totalTokens,
  totalCost,
  toolUsage
}: MetricsSummaryProps) {
  const formatCost = (cost: number) => {
    return `$${cost.toFixed(6)}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="font-medium">Sessions</div>
              <div className="text-2xl font-bold">{totalSessions}</div>
            </div>
            <div>
              <div className="font-medium">Messages</div>
              <div className="text-2xl font-bold">{totalMessages}</div>
            </div>
            <div>
              <div className="font-medium">Tool Calls</div>
              <div className="text-2xl font-bold">{totalToolCalls}</div>
            </div>
            <div>
              <div className="font-medium">Total Tokens</div>
              <div className="text-2xl font-bold">{totalTokens.toLocaleString()}</div>
            </div>
            <div>
              <div className="font-medium">Est. Cost</div>
              <div className="text-2xl font-bold">{formatCost(totalCost)}</div>
            </div>
          </div>
          
          {Object.keys(toolUsage).length > 0 && (
            <div className="mt-6">
              <h4 className="font-medium mb-3">Tool Usage</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {Object.entries(toolUsage)
                  .sort(([,a], [,b]) => b - a)
                  .map(([tool, count]) => (
                    <div key={tool} className="flex justify-between p-2 bg-gray-50 rounded">
                      <span className="truncate">{tool}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}