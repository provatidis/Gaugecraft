# Gaugecraft

A read-only research workspace for Aero MetaDEX03 predictive allocation, available on GitHub Pages or locally. Compare pool rewards, inspect incentive expiry, model your share after dilution, and collect evidence about whether an APR persists.

The first live run on October 22, 2026 retrieved **474 allocator pools across seven networks**. These are genuine contract observations. Historical coverage begins when your collector runs; the application does not manufacture earlier history. Counts and price coverage will change.

## Run locally

Requires **Node.js 24 or newer** (for built-in SQLite). No account, wallet, API key or paid service is required.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:4317**. `npm install` and `npm run dev` also work. The server binds to loopback only, collects immediately, and then collects at UTC half-hour boundaries while running. The first collection can take several minutes. Existing observations appear immediately.

For this Mac, `Start Gaugecraft.command` also launches the app using an installed Node or Codex's bundled Node runtime. Dependencies must already be installed. Keep the terminal running; Ctrl+C stops it. Computer sleep and closed terminals create collection gaps, which the analysis exposes.

For the production build:

```sh
pnpm build
pnpm start
```

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. Enable **Settings → Pages → Source → GitHub Actions**. Push to `main` or select **Actions → Collect and publish Gaugecraft → Run workflow** to publish. No paid service or manually supplied secret is required: the workflow uses GitHub's repository-scoped token and the configured public RPCs.

The workflow collects at **:07 and :37 UTC each hour**, freezes forecasts, backs up SQLite, and exports a static dashboard. It also runs on source changes. Collection and publishing are serialized. GitHub schedules can be delayed or disabled after 60 days without repository activity; the retrieval timestamp and stale-data warnings remain authoritative. Check Actions if updates stop. See [GitHub's schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Observation history persists as compressed SQLite assets on the **Collector history** prerelease (`collector-state`), separate from source commits. Each run restores the newest complete backup and saves a uniquely named replacement before publishing; the three newest complete backups are retained. A failed restore stops the workflow instead of silently discarding history. The first deployment starts with `config/launch-history.sqlite.gz`, containing actual public contract reads collected on launch day, with provenance in `config/launch-history.json`. No personal settings are included. The fixture namespace is seeded separately and explicitly labeled.

The hosted dashboard downloads precomputed observations. Simulator inputs and watchlists stay in browser storage and are never sent to the collector. Charts and CSV contain the last 30 days; the release database retains full history and frozen forecasts. Missing prices and failed network reads stay visible. A total RPC failure publishes the last successful observations with their original timestamps and an error status. Backups grow with history; monitor release size as the dataset grows and migrate durable storage before approaching GitHub's per-asset limits.

To build the same static export locally, after collecting data:

```sh
VITE_DATA_MODE=static pnpm build
pnpm export:pages
python3 -m http.server 4318 --directory dist --bind 127.0.0.1
```

Relative asset URLs support the repository subpath and an inherited user-site domain. `pnpm build` without `VITE_DATA_MODE` still builds the local server version. Public hosting has GitHub's ordinary access logging; Gaugecraft adds no telemetry.

## Daily workflow

1. **Markets** starts with estimated total pool rewards descending. Search token symbols, network or pool address; use **Returns** for the main revenue comparison or **All metrics** for TVL, volume and changes; sort any visible column; add pools to your local watchlist. Pool names stay pinned while you scroll. The pool total is shared by every allocator.
2. **Pool analysis** shows actual UTC source windows, block identity, six charts, incentive schedules and descriptive alerts. Chart ranges are 24h, 48h, 7d and 30d; longer ranges do not invent missing samples.
3. **Simulator** accepts allocation power and optional stake value in USD. Enter any power you already have in that pool to avoid counting it twice. Optional fixed-stake decay and activation delay affect the earnings integral. Inputs remain in this browser's local storage.
4. **Opportunities** shows baseline comparisons until a pool passes the history gate. Once eligible, it orders candidates by stressed earnings per 1,000 additional power. These assumptions are transparent and deliberately uncalibrated.
5. **Performance** evaluates frozen forecasts after 48 hours, only with sufficient observations. Revenue and return results are explicitly reconstruction proxies, not realized wallet claims. Benchmarks use selections saved at prediction time and matched complete cohorts.

Hover metric information icons for definitions. Missing values are `—`, never silently zero. Stale pools are marked and excluded from opportunity candidates. Refresh reloads the latest observations, charts and forecast evaluations while preserving table filters. It does not trigger an unbounded RPC collection. **Data health** shows freshness and the latest collection result for every configured network; one successful network cannot hide older observations on another.

## Data and configuration

Copy `.env.example` to `.env` if you want overrides. Package scripts load it with Node's built-in environment-file support. Data lives at `data/gaugecraft.sqlite`, including WAL files while running, and is ignored by Git. Back up the SQLite database with SQLite's backup API, or stop the app before copying it.

| Setting           | Default / purpose                                                              |
| ----------------- | ------------------------------------------------------------------------------ |
| `CHAINS`          | All supported networks: `8453,10,42161,1,57073,4663,5042`                      |
| `RPC_<chainId>`   | Override the corresponding public RPC; for example `RPC_8453`                  |
| `RPC_INTERVAL_MS` | `200`, minimum interval between RPC requests; retries have exponential backoff |
| `GAUGECRAFT_DB`   | `data/gaugecraft.sqlite`, relative to the repository working directory         |
| `PORT`            | `4317`, bound to `127.0.0.1`                                                   |
| `COLLECT`         | `0` disables the web server's collector; default enabled                       |
| `SAVE_FORECASTS`  | `0` disables new forecast records; default enabled                             |

Use `CHAINS=8453` for a smaller Base-only collection. Public RPCs can rate-limit, fail or change policy. You can supply your own legitimate RPC endpoint without changing source code. Provider URLs are not returned to the browser; do not commit `.env`.

### Collector and CSV

```sh
pnpm collect                   # One collection, useful for an external scheduler
pnpm collector                 # Continuous collector without the web UI
pnpm --silent export > observations.csv # Live observations only
pnpm --silent export --demo > demo.csv   # Explicit synthetic namespace
```

The dashboard also exports CSV. UTC source/retrieval times and actual fee-window boundaries are included. Fields that spreadsheet software could interpret as formulas are neutralized.

Only one collector can own a database at a time. A renewable lease prevents overlapping UI/CLI runs and recovers after interruption. Each `(source mode, chain-aware pool ID, 30-minute UTC source-time bucket)` is stored once; retries preserve the first observation and its frozen forecast. A failed network does not erase its last successful data. Read collector status in the dashboard for errors and coverage.

For an OS scheduler, run `pnpm collect` in this repository every 30 minutes, with an absolute Node/pnpm path if the scheduler has a different PATH. Do not also keep a separate watcher running unless you intentionally want the lease to skip duplicate jobs. No system service or recurring Codex automation is installed by this project.

### Explicit demo

```sh
pnpm demo
COLLECT=0 pnpm dev
```

Select **Sample fixtures** in the header. This seeds five invented pools with seven days of deterministic synthetic observations in a separate namespace. The banner remains visible throughout charts, simulations and performance. Live ingestion never uses these values. Seeding is idempotent and does not overwrite live history. The fixture date range is anchored to the first seeding time and does not pretend to keep advancing.

## Research limits

- The official launch article is dated **October 21, 2026**. Current documentation and live reads specify a **47-hour allocation cooldown**; our forecasting horizon is 48 hours. Cooldown is per stake and network, and this app cannot establish a particular stake's transaction eligibility without stake information.
- Market Stake APR is reconstructed using Aero's display formula and our prices. It is not an official API quote, LP APR, or personal capital APR. Pool reward power multiplied by AERO price is not your invested principal.
- Eligible historical fees use current staked liquidity as an approximation. Several launch observations contain only 7–11 hours of activity. They are shown with their actual windows and are not scaled into fictitious 48-hour observations. The launch baseline uses that partial fee level, so it is not a fully measured 48-hour revenue forecast.
- USD prices are local spot estimates anchored to the configured USDC address (USDG on Robinhood) at $1. There is no independent oracle or depeg protection. Unknown or conflicting prices block totals. This intentionally leaves many pools partially unpriced.
- No persistence ranking appears until roughly 48 hours of sufficiently continuous, priced history exists. Descriptive signals do not imply calibrated confidence or causal allocator behavior.
- Evaluation approximates the realized revenue window from observed snapshots. It does not reconstruct every fee/checkpoint event, simulate exact integer contract accounting, or measure claims from an actual sAERO position.

[SOURCES.md](SOURCES.md) records sources, addresses, reliability, formulas, pricing rules, model assumptions and validation evidence. [PLAN.md](PLAN.md) records the review of the original brief.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
```

Financial tests cover incentive units/expiry, own dilution, existing allocation, decay, delay, zero/missing inputs, forecast cutoff, incomplete windows and error denominators. Integration tests cover atomic ingestion, idempotence, failure recovery, lease ownership, chain/mode isolation and CSV safety. They run offline with explicit fixtures; normal tests never claim to be a live-chain validation.

| Directory             | Responsibility                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| `config/`             | Verified app-used deployment addresses, read ABI and source provenance         |
| `server/sources/`     | Public RPC reads, pinned-block collection and transparent spot prices          |
| `server/store.ts`     | SQLite observations, immutable forecasts, saved benchmark decisions and leases |
| `server/collector.ts` | Network orchestration, recovery and half-hour schedule                         |
| `src/analysis/`       | Pure reward, scenario, persistence and evaluation calculations                 |
| `src/client/`         | React interface; personal inputs stay in the browser                           |
| `tests/`              | Offline financial and ingestion checks                                         |

React/Vite provides a small local UI, viem handles EVM ABI reads, Recharts renders time series, and Node's built-in SQLite avoids a native database dependency or external service. There is no wallet library, signing path, transaction endpoint, telemetry, external font or price-tracking account.

MIT licensed. Gaugecraft is independent research software and is not affiliated with Aero.
