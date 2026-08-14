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

const header = (t, model = "deepseek-v4-flash") => ({
  type: "request/header",
  seq: 0,
  time: t,
  data: { header: { config: { provider: "deepseek-official", model } } },
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

// 1. off-peak flash: input 1.5/M, output 4.5/M (CNY)
{
  const v = run([
    header(OFF_PEAK),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.strictEqual(v.inputTokens, 1_000_000);
  assert.strictEqual(v.outputTokens, 1_000_000);
  assert.ok(Math.abs(v.cost - 6.0) < 1e-9, `cost=${v.cost}`);
  assert.strictEqual(v.currency, "CNY");
  console.log("off-peak OK:", v.cost);
}

// 2. peak flash: input 3.0/M, output 9.0/M
{
  const v = run([
    header(PEAK),
    messageUsage(PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.ok(Math.abs(v.cost - 12.0) < 1e-9, `peak cost=${v.cost}`);
  console.log("peak OK:", v.cost);
}

// 3. cache hit pricing: cacheRead uses the (cheap) cache-hit price
{
  const v = run([
    header(OFF_PEAK),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.ok(Math.abs(v.cost - 0.05) < 1e-9, `cacheHit cost=${v.cost}`);
  console.log("cache-hit OK:", v.cost);
}

// 4. dedupe: chunk then message for same (turn, step) must NOT double count
{
  const v = run([
    header(OFF_PEAK),
    chunkUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ]);
  assert.strictEqual(v.inputTokens, 1_000_000, "dedupe input");
  assert.strictEqual(v.outputTokens, 1_000_000, "dedupe output");
  assert.ok(Math.abs(v.cost - 6.0) < 1e-9, "dedupe cost");
  console.log("dedupe OK");
}

// 5. per-model breakdown: flash + pro in one session
{
  const v = run([
    header(OFF_PEAK),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
    header(OFF_PEAK, "deepseek-v4-pro"),
    messageUsage(OFF_PEAK, 2, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  const keys = Object.keys(v.perModel).sort();
  assert.deepStrictEqual(keys, ["deepseek-official/deepseek-v4-flash", "deepseek-official/deepseek-v4-pro"]);
  assert.ok(Math.abs(v.cost - 6.0) < 1e-9, `mixed cost=${v.cost}`);
  console.log("per-model OK:", keys);
}

// 6. unknown model falls back to flash price
{
  const v = run([
    header(OFF_PEAK, "deepseek-chat"),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.ok(Math.abs(v.cost - 1.5) < 1e-9, `fallback cost=${v.cost}`);
  assert.deepStrictEqual(Object.keys(v.perModel), ["deepseek-official/deepseek-chat"]);
  console.log("fallback OK");
}

// 7. turns breakdown: per-turn + per-step + peak flags + reasoning
{
  const v = run([
    header(OFF_PEAK),
    chunkUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 500_000 }),
    messageUsage(OFF_PEAK, 1, 1, { inputTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 500_000 }),
    messageUsage(PEAK, 2, 1, { inputTokens: 1_000_000, outputTokens: 0 }),
    messageUsage(PEAK, 2, 2, { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.strictEqual(v.turns.length, 2, "two turns");
  const t1 = v.turns[0];
  const t2 = v.turns[1];
  assert.strictEqual(t1.turn, 1);
  assert.strictEqual(t1.model, "deepseek-v4-flash");
  assert.strictEqual(t1.steps.length, 1, "turn 1 deduped to one step");
  assert.strictEqual(t1.steps[0].peak, false);
  assert.ok(Math.abs(t1.cost - 6.0) < 1e-9, `turn1 cost=${t1.cost}`);
  assert.strictEqual(t1.reasoningTokens, 500_000);
  assert.ok(Math.abs(t1.peakCost - 0) < 1e-9);
  assert.ok(Math.abs(t1.offPeakCost - 6.0) < 1e-9);

  assert.strictEqual(t2.turn, 2);
  assert.strictEqual(t2.steps.length, 2);
  assert.strictEqual(t2.steps[0].peak, true);
  assert.strictEqual(t2.steps[1].peak, true);
  assert.ok(Math.abs(t2.cost - 6.0) < 1e-9, `turn2 cost=${t2.cost}`);
  assert.ok(Math.abs(t2.peakCost - 6.0) < 1e-9);

  assert.strictEqual(v.reasoningTokens, 500_000);
  console.log("turns breakdown OK");
}

console.log("ALL TESTS PASSED");
