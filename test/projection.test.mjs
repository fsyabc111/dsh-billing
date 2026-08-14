import { strict as assert } from "node:assert";
import { DEFAULT_CONFIG } from "../lib/pricing.js";
import { makeBillingProjectionDefinition } from "../lib/projection.js";

const def = makeBillingProjectionDefinition(DEFAULT_CONFIG);

function run(events) {
  let state = def.init();
  for (const e of events) state = def.apply(state, e);
  return def.view(state);
}

// times: off-peak 12:00 UTC, peak 02:00 UTC
const OFF_PEAK = Date.UTC(2026, 7, 18, 12, 0, 0);
const PEAK = Date.UTC(2026, 7, 18, 2, 0, 0);

const header = (t) => ({
  type: "request/header",
  seq: 0,
  time: t,
  data: { header: { config: { provider: "deepseek-official", model: "deepseek-v4-flash" } } },
});

const chunkUsage = (t, turn, step, usage) => ({
  type: "assistant/chunk",
  seq: 0,
  time: t,
  data: { turn, step, chunk: { type: "usage", usage } },
});

const messageUsage = (t, turn, step, usage) => ({
  type: "assistant/message",
  seq: 0,
  time: t,
  data: { turn, step, usage },
});

// 1. off-peak cost: flash off-peak input 0.22/M, output 0.66/M, CNY rate 7.2
{
  const v = run([
    header(OFF_PEAK),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.strictEqual(v.inputTokens, 1_000_000);
  assert.strictEqual(v.outputTokens, 1_000_000);
  assert.ok(Math.abs(v.costUsd - (0.22 + 0.66)) < 1e-9, `costUsd=${v.costUsd}`);
  assert.ok(Math.abs(v.cost - (0.88 * 7.2)) < 1e-9, `cost=${v.cost}`);
  assert.strictEqual(v.currency, "CNY");
  console.log("off-peak OK:", JSON.stringify({ costUsd: v.costUsd, cost: v.cost }));
}

// 2. peak cost: flash peak input 0.44/M, output 1.32/M
{
  const v = run([
    header(PEAK),
    messageUsage(PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.ok(Math.abs(v.costUsd - (0.44 + 1.32)) < 1e-9, `peak costUsd=${v.costUsd}`);
  console.log("peak OK:", JSON.stringify({ costUsd: v.costUsd, cost: v.cost }));
}

// 3. dedupe: chunk usage then message usage for same (turn, step) must NOT double count
{
  const v = run([
    header(OFF_PEAK),
    chunkUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.strictEqual(v.inputTokens, 1_000_000, "dedupe input");
  assert.strictEqual(v.outputTokens, 1_000_000, "dedupe output");
  console.log("dedupe OK");
}

// 4. per-model breakdown: two different models in one session
{
  const v = run([
    header(OFF_PEAK),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
    { type: "request/header", seq: 0, time: OFF_PEAK, data: { header: { config: { provider: "deepseek-official", model: "deepseek-v4-pro" } } } },
    messageUsage(OFF_PEAK, 2, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  const keys = Object.keys(v.perModel);
  assert.deepStrictEqual(keys.sort(), ["deepseek-official/deepseek-v4-flash", "deepseek-official/deepseek-v4-pro"]);
  // flash input 0.22, pro input 0.66
  assert.ok(Math.abs(v.costUsd - (0.22 + 0.66)) < 1e-9, `mixed costUsd=${v.costUsd}`);
  console.log("per-model OK:", keys);
}

// 5. unknown model falls back to flash price
{
  const v = run([
    { type: "request/header", seq: 0, time: OFF_PEAK, data: { header: { config: { provider: "deepseek-official", model: "deepseek-chat" } } } },
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.ok(Math.abs(v.costUsd - 0.22) < 1e-9, `fallback costUsd=${v.costUsd}`);
  assert.deepStrictEqual(Object.keys(v.perModel), ["deepseek-official/deepseek-chat"]);
  console.log("fallback OK");
}

console.log("ALL TESTS PASSED");
