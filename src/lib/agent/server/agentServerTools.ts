import { tool } from 'ai';
import Exa, { type ExaSearchOptions, type ExaSearchResult } from 'exa-js';
import { agentLogger } from '@/lib/agentLogger';
import { TOOL_NAMES, WebSearchInput } from '@/lib/agentTools';

export function buildServerTools(sessionId: string) {
  return {
    [TOOL_NAMES.web_search]: tool({
      description: 'Search the web for current information. ONLY use when the user explicitly requests web search or real-time data—do not use proactively.',
      inputSchema: WebSearchInput,
      async execute({ query }) {
        const startTime = Date.now();
        const toolCallId = `search_${Date.now()}`;
        try {
          const apiKey = process.env.EXA_API_KEY;
          if (!apiKey) {
            const error = { error: 'Missing EXA_API_KEY in environment.' };
            await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
            return error;
          }
          const exa = new Exa(apiKey);
          const options: ExaSearchOptions = { livecrawl: 'always', numResults: 3 };
          const { results } = await exa.searchAndContents(query, options);
          const entries: ExaSearchResult[] = Array.isArray(results) ? results : [];
          const output = entries.map((r) => ({
            title: typeof r.title === 'string' ? r.title : undefined,
            url: typeof r.url === 'string' ? r.url : undefined,
            content: typeof r.text === 'string' ? r.text.slice(0, 1000) : undefined,
            publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : undefined,
          }));
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, { results: output.length, data: output }, Date.now() - startTime);
          return output;
        } catch (err: unknown) {
          const error = { error: err instanceof Error ? err.message : String(err) };
          await agentLogger.logToolCall(sessionId, TOOL_NAMES.web_search, toolCallId, { query }, error, Date.now() - startTime);
          return error;
        }
      },
    }),
  };
}
