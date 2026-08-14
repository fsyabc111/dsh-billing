declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionMap {
    billing: {
      currency: string;
      displayDecimals: number;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      perModel: Record<
        string,
        {
          cost: number;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
        }
      >;
    };
  }
}

export {};
