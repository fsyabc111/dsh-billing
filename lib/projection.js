import { z } from "zod";
import { modelKey, resolvePrices, computeCost, isPeakUtc } from "./pricing.js";

/**
 * The `billing` session projection. Folds:
 *   - `request/header` (+ `request/context`) last-wins provider/model route
 *   - `assistant/chunk` (usage) and `assistant/message` (usage) token samples
 * keyed by `(turn, step)` so the final `assistant/message` sample REPLACES the
 * early `assistant/chunk` sample (no double counting), matching token-meter.
 * `event.time` drives peak/off-peak price selection. Cost is in CNY.
 * The view publishes session aggregates AND a per-turn/per-step breakdown.
 */

const stepSchema = z.object({
  step: z.number().int().nonnegative(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  peak: z.boolean(),
});

const turnSchema = z.object({
  turn: z.number().int().nonnegative(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  peakCost: z.number().nonnegative(),
  offPeakCost: z.number().nonnegative(),
  steps: z.array(stepSchema),
});

const billingViewSchema = z.object({
  currency: z.string(),
  displayDecimals: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  peakCost: z.number().nonnegative(),
  offPeakCost: z.number().nonnegative(),
  perModel: z.record(
    z.string(),
    z.object({
      cost: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheWriteTokens: z.number().int().nonnegative(),
      reasoningTokens: z.number().int().nonnegative(),
    })
  ),
  turns: z.array(turnSchema),
});

function accumulate(state, provider, model, usage, time, turn, step, config) {
  const prices = resolvePrices(config, provider, model, time);
  const cost = computeCost(prices, usage);
  const peak = isPeakUtc(time, config.peakWindowsUtc ?? []);
  const key = turn + ":" + step;
  const steps = Object.assign({}, state.steps);
  steps[key] = {
    provider,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    cost,
    peak,
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
      let cost = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let reasoningTokens = 0;
      let peakCost = 0;
      let offPeakCost = 0;
      const perModel = {};
      const byTurn = {};

      for (const key of Object.keys(state.steps)) {
        const s = state.steps[key];
        const sep = key.indexOf(":");
        const turn = Number(key.slice(0, sep));
        const step = Number(key.slice(sep + 1));
        const mk = modelKey(s.provider, s.model);

        cost += s.cost;
        inputTokens += s.inputTokens;
        outputTokens += s.outputTokens;
        cacheReadTokens += s.cacheReadTokens;
        cacheWriteTokens += s.cacheWriteTokens;
        reasoningTokens += s.reasoningTokens ?? 0;
        if (s.peak) peakCost += s.cost;
        else offPeakCost += s.cost;

        let row = perModel[mk];
        if (!row) {
          row = { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
          perModel[mk] = row;
        }
        row.cost += s.cost;
        row.inputTokens += s.inputTokens;
        row.outputTokens += s.outputTokens;
        row.cacheReadTokens += s.cacheReadTokens;
        row.cacheWriteTokens += s.cacheWriteTokens;
        row.reasoningTokens += s.reasoningTokens ?? 0;

        let g = byTurn[turn];
        if (!g) {
          g = { steps: [] };
          byTurn[turn] = g;
        }
        g.steps.push({
          step,
          model: s.model,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          cacheReadTokens: s.cacheReadTokens,
          cacheWriteTokens: s.cacheWriteTokens,
          reasoningTokens: s.reasoningTokens ?? 0,
          cost: s.cost,
          peak: s.peak,
        });
      }

      const turns = Object.keys(byTurn)
        .map(Number)
        .sort((a, b) => a - b)
        .map((turn) => {
          const steps = byTurn[turn].steps.sort((a, b) => a.step - b.step);
          let tCost = 0;
          let tPeak = 0;
          let tInput = 0;
          let tOutput = 0;
          let tCacheRead = 0;
          let tCacheWrite = 0;
          let tReasoning = 0;
          const models = new Set();
          for (const s of steps) {
            tCost += s.cost;
            tPeak += s.peak ? s.cost : 0;
            tInput += s.inputTokens;
            tOutput += s.outputTokens;
            tCacheRead += s.cacheReadTokens;
            tCacheWrite += s.cacheWriteTokens;
            tReasoning += s.reasoningTokens;
            models.add(s.model);
          }
          return {
            turn,
            model: models.size === 1 ? steps[0].model : null,
            inputTokens: tInput,
            outputTokens: tOutput,
            cacheReadTokens: tCacheRead,
            cacheWriteTokens: tCacheWrite,
            reasoningTokens: tReasoning,
            cost: tCost,
            peakCost: tPeak,
            offPeakCost: tCost - tPeak,
            steps,
          };
        });

      const viewPerModel = {};
      for (const mk of Object.keys(perModel)) {
        viewPerModel[mk] = {
          cost: perModel[mk].cost,
          inputTokens: perModel[mk].inputTokens,
          outputTokens: perModel[mk].outputTokens,
          cacheReadTokens: perModel[mk].cacheReadTokens,
          cacheWriteTokens: perModel[mk].cacheWriteTokens,
          reasoningTokens: perModel[mk].reasoningTokens,
        };
      }

      return {
        currency: config.currency,
        displayDecimals: config.displayDecimals ?? 4,
        cost,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        peakCost,
        offPeakCost,
        perModel: viewPerModel,
        turns,
      };
    },

    stateVersion: 3,
  };
}
