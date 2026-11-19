// gta6-trophy-rarity-forecast-01 — refresh-aware quantile forecaster (Node 22, standard library only).
//
// Why persistence loses: Exophase refreshes its tracked-player count on its own schedule (hours apart).
// On a refresh the player pool grows fast (launch night: 638 -> 3,868 in one refresh) and the newly
// tracked players are MORE CASUAL, so every earned-trophy rarity DROPS — except a trophy already at ~100%
// (the platinum anchor), which stays near the top. Persistence forecasts the last rate unchanged with a
// symmetric spread, so after a refresh it over-predicts and eats a large pinball loss.
//
// Model (fixed in advance, never tuned on data): for each trophy with last rate r (percent),
//   L       = logit(clamp(r))              // clamp to [0.01, 99.99]
//   d       = horizon_minutes / 1440       // horizon in days
//   sd      = sqrt(d)
//   mu      = -DILUTION * sd               // downward logit drift from the expected refresh
//   anchor  = (r >= 99) ? 0.15 : 1.0       // platinum resists dilution
//   shifted = L + mu * anchor
//   for each level z in Z = [-1.6449, -0.6745, 0, 0.6745, 1.6449]:
//     scale = z < 0 ? DOWN : (z > 0 ? UP : 0)
//     q     = invLogit(shifted + z * scale * SIGMA * sd), rounded to 4 decimals
// A missing/null last rate falls back to logit(0.5). Everything is a fixed constant.
//
// I/O contract (matches the starter): read every <id>.in in MAKEFUN_INPUT_DIR (default /input), write
// <id>.out to MAKEFUN_OUTPUT_DIR (default /output): {"trophies":[{"id":1,"q":[q05,q25,q50,q75,q95]}, ...]}
// — one row per trophy, each id once, each q five finite numbers 0..100, non-decreasing; <= 65,536 bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.6449, -0.6745, 0, 0.6745, 1.6449];
/** Spread of a rate's move, in logit units per square-root day. */
const SIGMA = 0.55;
/** Downward logit drift from the expected refresh, per square-root day. */
const DILUTION = 0.42;
/** Extra downward scale applied to the lower quantiles (casual influx drags the left tail). */
const DOWN = 1.25;
/** Upward scale applied to the upper quantiles (asymmetric — dilution is mostly downward). */
const UP = 0.85;
/** A trophy at or above this rate is the platinum anchor and resists dilution. */
const ANCHOR_RATE = 99;

interface Case {
  levels: number[];
  horizon_minutes: number;
  trophies: Array<{ id: number }>;
  history: Array<{ rates: Array<number | null> }>;
}

const clamp = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => Math.log(clamp(pct) / (100 - clamp(pct)));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const invLogit = (x: number): number => 100 / (1 + Math.exp(-x));

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  const last = c.history[c.history.length - 1];
  if (last === undefined) throw new Error(`${file} has no history`);
  const d = c.horizon_minutes / 1440;
  const sd = Math.sqrt(d);
  const mu = -DILUTION * sd;
  const trophies = c.trophies.map((t, i) => {
    const raw = last.rates[i];
    const r = raw === null || raw === undefined ? 50 : raw;
    const anchor = r >= ANCHOR_RATE ? 0.15 : 1.0;
    const shifted = logit(r) + mu * anchor;
    const q = Z.map((z) => {
      const scale = z < 0 ? DOWN : z > 0 ? UP : 0;
      return round4(invLogit(shifted + z * scale * SIGMA * sd));
    });
    return { id: t.id, q };
  });
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}