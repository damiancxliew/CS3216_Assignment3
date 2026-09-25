#!/usr/bin/env node
/**
 * Summarise apps/web/play-cost.jsonl (written with PLAY_COST_LOG=1) per attempt.
 *
 *   node scripts/play-cost-summary.mjs [log] [prices.json] [--usd-to-sgd 1.29]
 *
 * prices.json maps a model name (or prefix, so dated snapshots match) to USD per
 * 1M tokens: { "gpt-6-luna": { "input": 0.4, "cachedInput": 0.04, "output": 2.4 } }.
 * Without it the script reports tokens only — cross-check dollars against the
 * OpenAI usage dashboard for the key used during the run.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const fxIndex = args.indexOf("--usd-to-sgd");
const usdToSgd = fxIndex === -1 ? null : Number(args.splice(fxIndex, 2)[1]);
const [logPath = "apps/web/play-cost.jsonl", pricesPath] = args;

const all = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const failures = all.filter((line) => line.error);
const lines = all.filter((line) => !line.error);
const prices = pricesPath ? JSON.parse(readFileSync(pricesPath, "utf8")) : null;

function priceFor(model) {
  if (!prices || !model) return null;
  const key = Object.keys(prices).filter((name) => model.startsWith(name)).sort((a, b) => b.length - a.length)[0];
  return key ? prices[key] : null;
}

const unpriced = new Set();
function costOf(line) {
  const price = priceFor(line.model);
  if (!price) {
    unpriced.add(line.model ?? "(unknown)");
    return null;
  }
  const fresh = line.inputTokens - line.cachedInputTokens;
  return (fresh * price.input + line.cachedInputTokens * (price.cachedInput ?? price.input) + line.outputTokens * price.output) / 1_000_000;
}

const attempts = new Map();
for (const line of lines) {
  const attempt = attempts.get(line.attemptId) ?? { calls: 0, input: 0, cached: 0, output: 0, usd: 0, priced: true, byCall: new Map(), first: line.at, last: line.at };
  const cost = costOf(line);
  attempt.calls += 1;
  attempt.input += line.inputTokens;
  attempt.cached += line.cachedInputTokens;
  attempt.output += line.outputTokens;
  if (cost === null) attempt.priced = false;
  else attempt.usd += cost;
  attempt.last = line.at;
  const call = attempt.byCall.get(line.call) ?? { calls: 0, usd: 0, priced: true, models: new Set() };
  call.calls += 1;
  if (cost === null) call.priced = false;
  else call.usd += cost;
  call.models.add(line.model);
  attempt.byCall.set(line.call, call);
  attempts.set(line.attemptId, attempt);
}

const money = (usd) => (usdToSgd ? `S$${(usd * usdToSgd).toFixed(4)}` : `US$${usd.toFixed(4)}`);
const minutes = (a) => ((new Date(a.last) - new Date(a.first)) / 60000).toFixed(1);

console.log(`${lines.length} calls across ${attempts.size} attempts\n`);
for (const [id, a] of attempts) {
  console.log(`${id}  ${a.calls} calls over ${minutes(a)} min  in ${a.input} (cached ${a.cached})  out ${a.output}  ${a.priced ? money(a.usd) : "unpriced"}`);
  for (const [call, c] of a.byCall) console.log(`    ${call.padEnd(28)} ${String(c.calls).padStart(4)} calls  ${[...c.models].join(", ")}${prices ? `  ${c.priced ? money(c.usd) : "unpriced"}` : ""}`);
}

const priced = [...attempts.values()].filter((a) => a.priced).map((a) => a.usd).sort((x, y) => x - y);
if (priced.length > 0) {
  const median = priced[Math.floor((priced.length - 1) / 2)];
  const mean = priced.reduce((sum, usd) => sum + usd, 0) / priced.length;
  console.log(`\nPer attempt (n=${priced.length}): median ${money(median)}  mean ${money(mean)}  max ${money(priced.at(-1))}`);
}
for (const f of failures) console.log(`
FAILED ${f.attemptId} ${f.call} (${f.model ?? f.tier}): ${f.error}`);
if (unpriced.size > 0) console.log(`\nNo price for: ${[...unpriced].join(", ")}`);
