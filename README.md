# gta6-trophy-rarity-forecast-01 — refresh-aware quantile forecaster

Node 22, standard library only, deterministic. Reads every `<id>.in` in `MAKEFUN_INPUT_DIR`
(default `/input`) and writes `<id>.out` to `MAKEFUN_OUTPUT_DIR` (default `/output`).

## Why persistence loses

Exophase refreshes its tracked-player count on its own schedule (hours apart). On a refresh the
player pool grows fast (launch night: 638 -> 3,868 in one refresh) and the newly tracked players
are MORE CASUAL, so every earned-trophy rarity DROPS — except a trophy already at ~100% (the
platinum anchor), which stays near the top. Persistence forecasts the last rate unchanged with a
symmetric spread, so it over-predicts after a refresh and eats a large pinball loss.

## Model (fixed in advance, never tuned on data)

For each trophy with last rate `r` (percent):

    L       = logit(clamp(r))              # clamp to [0.01, 99.99]
    d       = horizon_minutes / 1440       # horizon in days
    sd      = sqrt(d)
    mu      = -DILUTION * sd               # downward logit drift from the expected refresh
    anchor  = (r >= 99) ? 0.15 : 1.0       # platinum resists dilution
    shifted = L + mu * anchor
    for each level z in Z = [-1.6449, -0.6745, 0, 0.6745, 1.6449]:
        scale = z < 0 ? DOWN : (z > 0 ? UP : 0)
        q     = invLogit(shifted + z * scale * SIGMA * sd), rounded to 4 decimals

Constants: `SIGMA=0.55`, `DILUTION=0.42`, `DOWN=1.25`, `UP=0.85`. A missing/null last rate falls
back to logit(0.5). All constants are fixed — nothing is data-dependent at runtime.

## Run

    mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

Output: `{"trophies":[{"id":1,"q":[q05,q25,q50,q75,q95]}, ...]}` — one row per trophy, each id
once, each q five finite numbers 0..100, non-decreasing, at most 65,536 bytes.

Scoring is pinball loss on the logit scale (mean over all trophy/level items, lower is better).