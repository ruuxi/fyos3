declare module 'exa-js' {
  class Exa {
    constructor(apiKey: string);
    searchAndContents(
      query: string,
      options?: any,
    ): Promise<{ results: Array<any> }>;
  }
  export default Exa;
}

