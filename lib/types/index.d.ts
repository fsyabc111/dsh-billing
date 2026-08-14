declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionMap {
    billing: {
      currency: string;
      displayDecimals: number;
      cost: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      perModel: Record<
        string,
        {
          cost: number;
          costUsd: number;
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
