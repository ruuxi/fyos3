import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

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
  private logDir: string;
  private logFile: string;
  
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, 'agent-activity.jsonl');
  }
  
  private async ensureLogDir() {
    if (!existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  
  async logEntry(entry: Omit<AgentLogEntry, 'timestamp'>) {
    try {
      await this.ensureLogDir();
      
      const logEntry: AgentLogEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      
      const logLine = JSON.stringify(logEntry) + '\n';
      await writeFile(this.logFile, logLine, { flag: 'a' });
      
      // Also log to console for development
      console.log(`[AgentLog] ${entry.type}:`, entry.data);
    } catch (error) {
      console.error('[AgentLogger] Failed to write log:', error);
    }
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
    try {
      if (!existsSync(this.logFile)) {
        return [];
      }
      
      const content = await readFile(this.logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      return lines
        .slice(-limit)
        .map(line => JSON.parse(line))
        .reverse(); // Most recent first
    } catch (error) {
      console.error('[AgentLogger] Failed to read logs:', error);
      return [];
    }
  }
  
  async getSessionSummary(sessionId: string): Promise<{
    totalMessages: number;
    totalToolCalls: number;
    totalTokens: number;
    totalCost: number;
    duration: number;
    toolCallBreakdown: Record<string, number>;
  }> {
    try {
      const logs = await this.getRecentLogs(10000); // Get more logs for analysis
      const sessionLogs = logs.filter(log => log.sessionId === sessionId);
      
      if (sessionLogs.length === 0) {
        return {
          totalMessages: 0,
          totalToolCalls: 0,
          totalTokens: 0,
          totalCost: 0,
          duration: 0,
          toolCallBreakdown: {},
        };
      }
      
      const messages = sessionLogs.filter(log => log.type === 'message');
      const toolCalls = sessionLogs.filter(log => log.type === 'tool_call');
      const tokenUsage = sessionLogs.filter(log => log.type === 'token_usage');
      
      const totalTokens = tokenUsage.reduce((sum, log) => sum + (log.data.totalTokens || 0), 0);
      const totalCost = tokenUsage.reduce((sum, log) => sum + (log.data.estimatedCost || 0), 0);
      
      const toolCallBreakdown: Record<string, number> = {};
      toolCalls.forEach(log => {
        const toolName = log.data.toolName || 'unknown';
        toolCallBreakdown[toolName] = (toolCallBreakdown[toolName] || 0) + 1;
      });
      
      const firstLog = sessionLogs[sessionLogs.length - 1];
      const lastLog = sessionLogs[0];
      const duration = new Date(lastLog.timestamp).getTime() - new Date(firstLog.timestamp).getTime();
      
      return {
        totalMessages: messages.length,
        totalToolCalls: toolCalls.length,
        totalTokens,
        totalCost,
        duration,
        toolCallBreakdown,
      };
    } catch (error) {
      console.error('[AgentLogger] Failed to generate session summary:', error);
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
}

export const agentLogger = new AgentLogger();
