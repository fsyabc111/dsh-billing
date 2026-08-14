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
      reasoningTokens: number;
      peakCost: number;
      offPeakCost: number;
      perModel: Record<
        string,
        {
          cost: number;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          reasoningTokens: number;
        }
      >;
      turns: Array<{
        turn: number;
        model: string | null;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        reasoningTokens: number;
        cost: number;
        peakCost: number;
        offPeakCost: number;
        steps: Array<{
          step: number;
          model: string;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          reasoningTokens: number;
          cost: number;
          peak: boolean;
        }>;
      }>;
    };
  }
}

export {};
