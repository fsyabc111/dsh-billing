import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_CONFIG } from "./pricing.js";
import { makeBillingProjectionDefinition } from "./projection.js";
import { createDaily } from "./daily.js";

export const name = "dsh-billing";
export const inject = ["sessionProjections"];

function resolveHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim() !== "") return env;
  return path.join(os.homedir(), ".dsh");
}

function loadConfig(priceTablePath) {
  const p = priceTablePath ?? path.join(resolveHome(), "billing.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    config = DEFAULT_CONFIG;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n");
    } catch {
      /* use in-memory default */
    }
  }
  return { config, priceTablePath: p };
}

export function apply(ctx, config) {
  const loaded = loadConfig(config && config.priceTablePath);
  const daily = createDaily(loaded.priceTablePath, loaded.config);

  // 1. Per-session, per-model cost (durable, deduped, client-readable via useProjection("billing")).
  ctx.sessionProjections.register(makeBillingProjectionDefinition(loaded.config));

  // 2. Profile-wide daily rollup + optional detail logging, observed live per call.
  ctx.on("llm/stream", async function* (options, next) {
    const provider = options.provider;
    const model = options.model;
    for await (const chunk of next()) {
      if (chunk.type === "usage") {
        try {
          daily.record(provider, model, chunk.usage, Date.now());
        } catch {
          /* accounting must never break the stream */
        }
      }
      yield chunk;
    }
  });
}
