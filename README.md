# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/scarfacenx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/scarfacenx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2): 198 pre-token protocols ranked by implied value from a sealed DefiLlama snapshot — a dark signal-console dashboard with a sortable board, per-protocol detail and farm plans, and a model sandbox that re-ranks the page live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, scores every rankable pre-token protocol, and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. Run `node --test test/model.test.mjs` for the model's tests and `node test/gate-check.mjs out` for the seven gate rows the scorer checks.

---

<sub>Entered on [make.fun](https://make.fun/?ref=skww9c08&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
