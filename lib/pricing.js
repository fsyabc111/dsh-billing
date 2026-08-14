// dsh-billing — price lookup and cost arithmetic.
// Prices are stored in USD per 1M tokens (the only currency DeepSeek publishes
// officially); display currency is configurable (default CNY via an editable
// exchange rate). All token buckets are disjoint: inputTokens (cache miss),
// cacheReadTokens (cache hit), outputTokens; cacheWriteTokens is reserved but
// never produced by the deepseek-official adapter.

export const DEFAULT_CONFIG = {
  currency: 'CNY',
  exchangeRateUsdToCny: 7.2,
  priceModel: 'peak-off-peak',
  peakWindowsUtc: [
    { start: '01:00', end: '04:00' },
    { start: '06:00', end: '10:00' },
  ],
  effectiveDate: '2026-08-16T16:00:00Z',
  fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  displayDecimals: 4,
  logging: { enabled: false, dir: 'billing-logs' },
  models: {
    'deepseek-official/deepseek-v4-flash': {
      peak: { input: 0.44, cacheRead: 0.014, output: 1.32, cacheWrite: 0 },
      offPeak: { input: 0.22, cacheRead: 0.007, output: 0.66, cacheWrite: 0 },
      flat: { input: 0.14, cacheRead: 0.0028, output: 0.28, cacheWrite: 0 },
    },
    'deepseek-official/deepseek-v4-pro': {
      peak: { input: 1.32, cacheRead: 0.044, output: 3.96, cacheWrite: 0 },
      offPeak: { input: 0.66, cacheRead: 0.022, output: 1.98, cacheWrite: 0 },
      flat: { input: 0.435, cacheRead: 0.003625, output: 0.87, cacheWrite: 0 },
    },
  },
};

const M = 1_000_000;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** Whether a Unix-ms timestamp falls inside any UTC peak window. */
export function isPeakUtc(timeMs, windows) {
  const d = new Date(timeMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const w of windows) {
    if (mins >= toMinutes(w.start) && mins < toMinutes(w.end)) return true;
  }
  return false;
}

export function modelKey(provider, model) {
  return `${provider}/${model}`;
}

/**
 * Resolve the per-1M-token USD price bucket for a call.
 * Falls back to the configured fallback model when the model id is unknown.
 */
function priceForEntry(config, entry, timeMs) {
  if (config.priceModel === 'flat' && entry.flat) return entry.flat;
  if (entry.peak && entry.offPeak) {
    return isPeakUtc(timeMs, config.peakWindowsUtc ?? []) ? entry.peak : entry.offPeak;
  }
  return entry.flat ?? entry.peak ?? entry.offPeak;
}

export function resolvePrices(config, provider, model, timeMs) {
  const key = modelKey(provider, model);
  const entry = config.models[key];
  if (entry) return priceForEntry(config, entry, timeMs);

  const fb = config.fallback ?? {};
  const fbEntry = config.models[modelKey(fb.provider, fb.model)];
  if (fbEntry) return priceForEntry(config, fbEntry, timeMs);
  return { input: 0, cacheRead: 0, output: 0, cacheWrite: 0 };
}

/** Cost in USD for one TokenUsage sample against a per-1M-token price bucket. */
export function computeCostUsd(pricesPerM, usage) {
  const input = (usage.inputTokens ?? 0) / M * (pricesPerM.input ?? 0);
  const cacheRead = (usage.cacheReadTokens ?? 0) / M * (pricesPerM.cacheRead ?? 0);
  const cacheWrite = (usage.cacheWriteTokens ?? 0) / M * (pricesPerM.cacheWrite ?? 0);
  const output = (usage.outputTokens ?? 0) / M * (pricesPerM.output ?? 0);
  return input + cacheRead + cacheWrite + output;
}

/** Convert a USD amount to the configured display currency. */
export function usdToDisplay(usd, config) {
  if (config.currency === 'CNY') return usd * (config.exchangeRateUsdToCny ?? 1);
  return usd;
}

/** Format a display-currency amount: 4 decimals, `< ¥0.0001` floor placeholder. */
export function formatMoney(amount, config) {
  const decimals = config.displayDecimals ?? 4;
  const symbol = config.currency === 'CNY' ? '¥' : '$';
  const threshold = 10 ** -decimals;
  if (amount > 0 && amount < threshold) return `< ${symbol}${threshold.toFixed(decimals)}`;
  return `${symbol}${amount.toFixed(decimals)}`;
}
