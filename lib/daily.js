import fs from "node:fs";
import path from "node:path";
import { modelKey, resolvePrices, computeCost } from "./pricing.js";

/**
 * Profile-wide daily rollup + optional JSONL detail logging.
 * Lives under $DSH_HOME next to billing.json:
 *   - billing-daily.json            (per-local-day token/cost totals)
 *   - billing-logs/YYYY-MM-DD.jsonl (optional per-call detail, opt-in)
 */
export function createDaily(priceTablePath, config) {
  const baseDir = path.dirname(priceTablePath);
  const dailyPath = path.join(baseDir, "billing-daily.json");
  const logsDir = path.join(baseDir, config.logging && config.logging.dir ? config.logging.dir : "billing-logs");
  const loggingEnabled = !!(config.logging && config.logging.enabled);

  function localDateKey(timeMs) {
    const d = new Date(timeMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function readDaily() {
    try {
      return JSON.parse(fs.readFileSync(dailyPath, "utf8"));
    } catch {
      return {};
    }
  }

  function writeDaily(daily) {
    try {
      fs.mkdirSync(path.dirname(dailyPath), { recursive: true });
      fs.writeFileSync(dailyPath, JSON.stringify(daily, null, 2) + "\n");
    } catch {
      /* best-effort; never throw from accounting */
    }
  }

  function appendLog(dateKey, record) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(path.join(logsDir, dateKey + ".jsonl"), JSON.stringify(record) + "\n");
    } catch {
      /* best-effort */
    }
  }

  function record(provider, model, usage, timeMs) {
    const prices = resolvePrices(config, provider, model, timeMs);
    const cost = computeCost(prices, usage);
    const dateKey = localDateKey(timeMs);

    const daily = readDaily();
    const entry = daily[dateKey] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      currency: config.currency,
      perModel: {},
    };

    entry.inputTokens += usage.inputTokens ?? 0;
    entry.outputTokens += usage.outputTokens ?? 0;
    entry.cacheReadTokens += usage.cacheReadTokens ?? 0;
    entry.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    entry.cost += cost;

    const mk = modelKey(provider, model);
    let row = entry.perModel[mk];
    if (!row) {
      row = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };
      entry.perModel[mk] = row;
    }
    row.inputTokens += usage.inputTokens ?? 0;
    row.outputTokens += usage.outputTokens ?? 0;
    row.cacheReadTokens += usage.cacheReadTokens ?? 0;
    row.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    row.cost += cost;

    daily[dateKey] = entry;
    writeDaily(daily);

    if (loggingEnabled) {
      appendLog(dateKey, {
        time: timeMs,
        provider,
        model,
        usage,
        cost,
        currency: config.currency,
      });
    }
  }

  return { record, dailyPath, logsDir };
}
