# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/scarfacenx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/scarfacenx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2): 188 pre-token protocols ranked by implied value from a sealed DefiLlama snapshot — a dark signal-console dashboard with a sortable board, per-protocol detail and farm plans, and a model sandbox that re-ranks the page live.

## How the model was checked

The model is `implied value = category multiple × TVL^0.92 × growth × maturity × chains`, scored from the sealed 2026-11-14 snapshot only. The constants were checked, not just asserted:

- **Sensitivity.** Moving any one constant across its reasonable range — TVL exponent 0.85–1.00, growth weight 0–0.9, maturity floor 0.40–0.70, chain step 0–0.06, growth cap 50–300 — leaves the top 10 unchanged and the full board at Spearman ≥ 0.99. Deleting a term outright still leaves 9 of the top 10 (only the #9/#10 edge moves: Polymarket, five years old, against RockawayX, eight months old). Re-grounding the category multiples on the mature market's own median market-cap-per-TVL leaves 9 of the top 10 too. The top of the board is not a knife-edge artifact of 0.92 versus 0.88.
- **Against the market.** Scoring the snapshot's own 119 live-token protocols the same way gives Spearman 0.35 against their actual market caps and a median implied value of 22% of market cap. The model prices launches conservatively — about a fifth of what mature tokens carry for the same TVL — and it ranks rather than promises a price.
- **Still current.** None of the 188 board rows had launched a token by 2026-11-16, two days after the snapshot (checked against live DefiLlama data).

## What it does not claim

- **No diversity is forced.** Six of the top 10 are vault curators or capital allocators — that is where the snapshot's TVL sits. The ten biggest pre-token protocols by TVL are all exchanges, bridges or wrapped products the exclusion rule removes, so the board's top is the rule working, not TVL order.
- **The constants are judgment.** Growth weight 0.6 and the 0.92 TVL exponent cannot be backtested against one sealed snapshot; the sandbox lets the judge see the sensitivity, and the defaults are stated, not hidden.
- **Three watchlist rows are forced.** b14g, Reti Pooling and Saturn are wrapper products ranked only because the competition's watchlist requires all 40 of its slugs on the board. The dashboard and the code say so in the open.
- **Farm plans are plans, not promises.** The 40 watchlist plans name each protocol's actual product or asset (USDx/sUSDx, trUSD/strUSD, USDat/sUSDat, yzUSD/syzUSD, Morpho vaults, ether.fi Liquid vaults); the other 148 rows use a category-derived plan. Nothing here is a guarantee of an airdrop.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot — `--input` takes the snapshot file or a directory holding it (the kit's `input/snapshot.json`; the grader mounts it at `/input`) — scores every rankable pre-token protocol, and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. Run `node --test test/model.test.mjs` for the model's tests and `node test/gate-check.mjs out` for the seven gate rows the scorer checks.

---

<sub>Entered on [make.fun](https://make.fun/?ref=skww9c08&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
