import { tool } from 'ai';
import Exa from 'exa-js';
import { agentLogger } from '@/lib/agentLogger';
import { TOOL_NAMES, WebSearchInput } from '@/lib/agentTools';
import { emitToolEnd, emitToolStart } from '@/lib/metrics/store';

export function buildServerTools(sessionId: string) {
  return {
    [TOOL_NAMES.web_search]: tool({
      description: 'Search the web for current information. ONLY use when the user explicitly requests web search or real-time data—do not use proactively.',
      inputSchema: WebSearchInput,
      async execute({ query }) {
        const startTime = Date.now();
        const toolCallId = `search_${Date.now()}`;
        try {
          // Metrics: tool_start (server)
          emitToolStart({ sessionId, toolCallId, toolName: TOOL_NAMES.web_search, inputSummary: JSON.stringify({ query }), source: 'server' });
        } catch {}
        try {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            const error = { error: 'Missing EXA_API_KEY in environment.' };
            await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
            try { emitToolEnd({ sessionId, toolCallId, toolName: TOOL_NAMES.web_search, durationMs: Date.now() - startTime, success: false, error: error.error, outputSummary: JSON.stringify(error), source: 'server' }); } catch {}
            return error;
          }
          const exa = new Exa(apiKey);
          const { results } = await exa.searchAndContents(query, { livecrawl: 'always', numResults: 3 } as any);
          const output = (results || []).map((r: any) => ({ title: r.title, url: r.url, content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined, publishedDate: r.publishedDate }));
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, { results: output.length, data: output }, Date.now() - startTime);
          try { emitToolEnd({ sessionId, toolCallId, toolName: TOOL_NAMES.web_search, durationMs: Date.now() - startTime, success: true, outputSummary: JSON.stringify({ results: output.length }), source: 'server' }); } catch {}
          return output;
        } catch (err: unknown) {
          const error = { error: err instanceof Error ? err.message : String(err) };
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
          try { emitToolEnd({ sessionId, toolCallId, toolName: TOOL_NAMES.web_search, durationMs: Date.now() - startTime, success: false, error: error.error, outputSummary: JSON.stringify(error), source: 'server' }); } catch {}
          return error;
        }
      },
    }),
  };
}

