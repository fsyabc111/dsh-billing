import { z } from "zod";
import { modelKey, resolvePrices, computeCostUsd, usdToDisplay } from "./pricing.js";

/**
 * The `billing` session projection. Folds:
 *   - `request/header` (+ `request/context`) last-wins provider/model route
 *   - `assistant/chunk` (usage) and `assistant/message` (usage) token samples
 * keyed by `(turn, step)` so the final `assistant/message` sample REPLACES the
 * early `assistant/chunk` sample (no double counting), matching token-meter.
 * `event.time` drives peak/off-peak price selection.
 */

const billingViewSchema = z.object({
  currency: z.string(),
  displayDecimals: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  perModel: z.record(
    z.string(),
    z.object({
      cost: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheWriteTokens: z.number().int().nonnegative(),
    })
  ),
});

function accumulate(state, provider, model, usage, time, turn, step, config) {
  const prices = resolvePrices(config, provider, model, time);
  const costUsd = computeCostUsd(prices, usage);
  const key = turn + ":" + step;
  const steps = Object.assign({}, state.steps);
  steps[key] = {
    provider,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    costUsd,
  };
  return Object.assign({}, state, { steps });
}

export function makeBillingProjectionDefinition(config) {
  return {
    key: "billing",

    schema: billingViewSchema,

    init() {
      return { provider: null, model: null, steps: {} };
    },

    apply(state, event) {
      switch (event.type) {
        case "request/header": {
          const c = event.data.header && event.data.header.config;
          if (!c) return state;
          if (c.provider === state.provider && c.model === state.model) return state;
          return Object.assign({}, state, { provider: c.provider, model: c.model });
        }
        case "request/context": {
          const provider = event.data.provider;
          const model = event.data.model;
          if (provider === state.provider && model === state.model) return state;
          return Object.assign({}, state, { provider, model });
        }
        case "assistant/chunk": {
          const chunk = event.data.chunk;
          if (!chunk || chunk.type !== "usage") return state;
          if (state.provider == null || state.model == null) return state;
          return accumulate(state, state.provider, state.model, chunk.usage, event.time, event.data.turn, event.data.step, config);
        }
        case "assistant/message": {
          if (event.data.usage === undefined) return state;
          if (state.provider == null || state.model == null) return state;
          return accumulate(state, state.provider, state.model, event.data.usage, event.time, event.data.turn, event.data.step, config);
        }
        default:
          return state;
      }
    },

    view(state) {
      let costUsd = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      const perModel = {};

      for (const key of Object.keys(state.steps)) {
        const s = state.steps[key];
        const mk = modelKey(s.provider, s.model);
        let row = perModel[mk];
        if (!row) {
          row = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
          perModel[mk] = row;
        }
        row.costUsd += s.costUsd;
        row.inputTokens += s.inputTokens;
        row.outputTokens += s.outputTokens;
        row.cacheReadTokens += s.cacheReadTokens;
        row.cacheWriteTokens += s.cacheWriteTokens;
        costUsd += s.costUsd;
        inputTokens += s.inputTokens;
        outputTokens += s.outputTokens;
        cacheReadTokens += s.cacheReadTokens;
        cacheWriteTokens += s.cacheWriteTokens;
      }

      const viewPerModel = {};
      for (const mk of Object.keys(perModel)) {
        viewPerModel[mk] = {
          cost: usdToDisplay(perModel[mk].costUsd, config),
          costUsd: perModel[mk].costUsd,
          inputTokens: perModel[mk].inputTokens,
          outputTokens: perModel[mk].outputTokens,
          cacheReadTokens: perModel[mk].cacheReadTokens,
          cacheWriteTokens: perModel[mk].cacheWriteTokens,
        };
      }

      return {
        currency: config.currency,
        displayDecimals: config.displayDecimals ?? 4,
        cost: usdToDisplay(costUsd, config),
        costUsd,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        perModel: viewPerModel,
      };
    },

    stateVersion: 1,
  };
}
