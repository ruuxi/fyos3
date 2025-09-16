declare module 'exa-js' {
  class Exa {
    constructor(apiKey: string);
    searchAndContents(
      query: string,
      options?: ExaSearchOptions,
    ): Promise<{ results: ExaSearchResult[] }>;
  }

  export interface ExaSearchOptions {
    livecrawl?: 'always' | 'never' | 'auto';
    numResults?: number;
    [key: string]: unknown;
  }

  export interface ExaSearchResult {
    title?: string;
    url?: string;
    text?: string;
    publishedDate?: string;
    [key: string]: unknown;
  }
  export default Exa;
}
