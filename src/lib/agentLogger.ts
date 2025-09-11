export interface AgentLogEntry {
  timestamp: string;
  sessionId: string;
  type: 'message' | 'tool_call' | 'token_usage' | 'error';
  data: {
    // Message data
    messageId?: string;
    role?: 'user' | 'assistant';
    content?: string;

    // Tool call data
    toolName?: string;
    toolCallId?: string;
    toolInput?: any;
    toolOutput?: any;
    toolDuration?: number;

    // Token usage data
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    model?: string;

    // Error data
    error?: string;
    stack?: string;
  };
}

class AgentLogger {
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  async logEntry(entry: Omit<AgentLogEntry, 'timestamp'>) {
    const logEntry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Log to console for development
    console.log(`[AgentLog] ${entry.type}:`, entry.data);
  }
  
  async logMessage(sessionId: string, messageId: string, role: 'user' | 'assistant', content: string) {
    await this.logEntry({
      sessionId,
      type: 'message',
      data: {
        messageId,
        role,
        content: content.slice(0, 1000) + (content.length > 1000 ? '...' : ''), // Truncate long content
      },
    });
  }
  
  async logToolCall(
    sessionId: string, 
    toolName: string, 
    toolCallId: string, 
    input: any, 
    output: any, 
    duration: number
  ) {
    await this.logEntry({
      sessionId,
      type: 'tool_call',
      data: {
        toolName,
        toolCallId,
        toolInput: input,
        toolOutput: output,
        toolDuration: duration,
      },
    });
  }
  
  async logTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    model: string = 'claude-3-5-sonnet-20241022',
    estimatedCost?: number
  ) {
    // Use provided cost or calculate as fallback
    const cost = estimatedCost !== undefined ? estimatedCost : totalTokens * this.getCostPerToken(model);
    
    await this.logEntry({
      sessionId,
      type: 'token_usage',
      data: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: cost,
        model,
      },
    });
  }
  
  async logError(sessionId: string, error: Error | string, context?: any) {
    await this.logEntry({
      sessionId,
      type: 'error',
      data: {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      },
    });
  }
  
  private getCostPerToken(model: string): number {
    // Approximate costs per token (in USD) - update these based on current pricing
    const costMap: Record<string, number> = {
      'qwen3-coder': 0.000002, // $2 per 1M tokens (as used in route.ts)
      'claude-3-5-sonnet-20241022': 0.000003, // $3 per 1M tokens (rough average of input/output)
      'claude-3-haiku-20240307': 0.00000025, // $0.25 per 1M tokens
      'gpt-4o': 0.0000025, // $2.5 per 1M tokens (rough average)
      'gpt-4o-mini': 0.00000015, // $0.15 per 1M tokens
    };
    
    return costMap[model] || 0.000002; // Default to qwen3-coder pricing
  }
  
  async getRecentLogs(limit: number = 100): Promise<AgentLogEntry[]> {
    // Return empty array since we're not storing logs to files
    console.log(`[AgentLogger] getRecentLogs called with limit ${limit} - returning empty array`);
    return [];
  }

  async getSessionSummary(sessionId: string): Promise<{
    totalMessages: number;
    totalToolCalls: number;
    totalTokens: number;
    totalCost: number;
    duration: number;
    toolCallBreakdown: Record<string, number>;
  }> {
    console.log(`[AgentLogger] getSessionSummary called for session ${sessionId} - returning empty summary`);

    // Return empty summary since we don't have persistent logs
    return {
      totalMessages: 0,
      totalToolCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      duration: 0,
      toolCallBreakdown: {},
    };
  }
}

export const agentLogger = new AgentLogger();
