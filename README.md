# Gaugecraft

[Open the dashboard](https://provatidis.com/gaugecraft/) · [Source repository](https://github.com/provatidis/gaugecraft)

A read-only research workspace for Aero MetaDEX03 predictive allocation, available on GitHub Pages or locally. Compare pool rewards, inspect incentive expiry, model your share after dilution, and collect evidence about whether an APR persists.

The first live run on October 22, 2026 retrieved **474 allocator pools across seven networks**. These are genuine contract observations. Historical coverage begins when your collector runs; the application does not manufacture earlier history. Counts and price coverage will change.

## How to use Gaugecraft effectively

Use the app to move from **your allocation size → modeled earnings → sustainable revenue → an explicit 48-hour scenario**. A useful research session ends with an explanation of the opportunity and its weak points, rather than just an APR number.

Open **How to use** in the app header for a concise research routine, direct links to all five sections and expandable explanations. The optional Markets introduction can be dismissed; the full guide remains available on desktop and mobile. Dismissal is stored only in this browser. Each research screen also has an expandable help prompt.

To learn the controls, select **Sample fixtures** in the header. Every figure in that mode is synthetic. Switch back to **Live observations** before researching actual pools.

### A repeatable research routine

1. **Check the evidence is current.** Read **Latest retrieval** and **Data health** before comparing pools. Times are UTC. Expand Data health to inspect each network; a successful read on one network does not establish freshness elsewhere. Observations older than 75 minutes are marked stale and excluded from Opportunities. A configured schedule is not proof that collection succeeded.

2. **Build a shortlist in Markets.** Enter **Intended allocation power** to compare earnings for your total power in each pool. A blank input uses **1,000 additional reference power**. Markets defaults to **Estimated earnings** descending within separate evidence groups: history-based estimates first, then full-window baselines. **Stress-case earnings** and **Pool-wide rewards** are alternative sorts; your selection is remembered. Partial fee windows, stale observations and incomplete inputs stay visible with comparable earnings withheld. Use the evidence filter to examine one group. **Returns** shows earnings, stress, evidence and revenue composition; **All metrics** adds Stake APR, TVL, volume and six-hour changes. Filter by network and star candidates for your browser-local watchlist. Identify a pool by its network and contract address, since identical token pairs can appear in multiple pools. The **Pool rewards / 48h** column is shared revenue for the entire pool; **Earnings / 48h** models your share. If no comparable earnings are available yet, use pool-wide rewards to shortlist while genuine fee history accumulates.

3. **Inspect the source of the APR in Pool analysis.** Compare eligible fee revenue, scheduled incentives and allocation power together. Read the actual fee-window duration: an eight-hour observation is not a measured 48-hour total, and different window lengths weaken direct comparisons. Check incentive expiration within your intended holding window; the estimate already stops each program at its scheduled end and assumes no renewal. An APR jump with flat revenue and falling allocation can be a denominator change rather than increased revenue. Longer chart ranges reveal only the history actually collected.

4. **Size the idea in Simulator.** Enter the **total allocation power you intend to direct to this pool**, then enter any power of yours already included in its current allocation. For example, moving from 10,000 to 15,000 power means entering **15,000 Allocation power** and **10,000 Already allocated**. Enter your own capital value in USD only if you want a personal capital APR. Optional remaining days models fixed-stake decay; leaving it blank models perpetual power. Activation delay is your timing assumption and does not establish protocol eligibility. Compare baseline earnings with the competing-allocation and revenue-decline scenarios. Intended power is shared across Markets, Opportunities and Simulator. Existing power is saved separately for each pool and source mode, and defaults to zero; older shared existing-power settings must be re-entered for the correct pool. Capital and timing fields still carry between pools, so review them when switching. Clearing intended power restores a 1,000-additional-power reference scenario and ignores saved existing allocations.

5. **Use Opportunities as a screen once history is sufficient.** Until the history gate passes, the list shows comparable full-window baselines where available and explicitly says **Insufficient history**. Partial source fee windows cannot enter that comparison. Persistence ranking requires approximately 48 hours of coverage, at least 80 priced fee observations, no gap over 75 minutes and a near-full fee window. Qualified candidates are ranked by stressed earnings for **your selected power**, including own dilution and saved existing allocation; a blank input uses **1,000 additional reference power**. The calculation is nonlinear in size and does not multiply the reference result. Use Simulator to explore timing and decay. Markets and Opportunities apply the allocation forecast when history is sufficient; Simulator scenarios start from current other allocation, so their baselines can differ.

6. **Review the reasoning, then evaluate it later.** Return to your watchlist and compare fee changes, incentive runway and incoming allocation before revising an assumption. After forecast windows mature, use **Performance** to see whether revenue was overestimated or allocation pressure underestimated. Compare benchmarks only on the displayed matched, complete cohorts. These are observed-data return proxies for a standard reference allocation, not a record of your actual positions or claims. Collection gaps can leave a mature forecast unevaluable; waiting longer does not recreate missing observations.

### Read the estimates in context

| Display                               | What it means                                                                                                                                                       | How to use it                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pool rewards / 48h**                | Pool-wide revenue estimate, using the observed eligible-fee level and incentives overlapping the next 48 hours. At launch the fee input may cover a shorter period. | Find pools worth inspecting, then check the source window and simulate your share.                                                                     |
| **Stake APR** in Markets              | Annualized revenue relative to allocation power valued at the AERO spot estimate.                                                                                   | A headline comparison using that denominator; do not treat it as your personal capital APR.                                                            |
| **Personal capital APR** in Simulator | Annualized scenario earnings divided by the stake value in USD you entered.                                                                                         | Compare with its underlying 48-hour USD earnings. It is an annualization, without compounding.                                                         |
| **Opportunities stress**              | A 50% decline in forecast fees and 50% more competing allocation, on top of the model's projected allocation. Scheduled incentives retain their modeled USD value.  | A declared stress case used for ranking, not a probability or confidence interval.                                                                     |
| **Simulator scenarios**               | Competing-power shocks start from current other allocation; the revenue-down scenario halves all modeled USD revenue, including incentives.                         | Isolate the effect of dilution or lower revenue at your size. These scenarios do not automatically apply the Opportunities allocation-growth forecast. |

Markets compares immediate, constant-power allocations using `power / (projected other power + power) × forecast revenue`. Existing power is removed from the current pool total before projecting competing growth and adding the intended total once. Its stress case reduces forecast fees by 50% and increases projected other power by 50%, retaining scheduled incentive USD value. Comparable fee windows must span 47–49 hours; shorter windows are never silently annualized or extrapolated. History-based forecasts and constant-condition baselines are distinct evidence groups, not one unconditional ranking.

The simulator's **No new competing allocation** case is a baseline assumption, not a prediction that competitors will stay away. Neither ranking nor simulation includes every price move, liquidity change, gas cost or contract-accounting detail. Metric information icons and [SOURCES.md](SOURCES.md) explain the formulas and approximations.

### Worked example: pool rewards versus your earnings

**Illustrative arithmetic only: these invented figures do not describe a live pool.** Assume a pool has 1,000,000 existing allocation power, none of it yours, and $5,000 of modeled revenue paid uniformly over the next 48 hours. You add 10,000 power, with no activation delay or decay.

```text
Your post-allocation share = 10,000 / (1,000,000 + 10,000) ≈ 0.9901%
Your baseline earnings    = that share × $5,000 ≈ $49.50 over 48 hours
```

| Assumption                                                 | Estimated earnings / 48h |
| ---------------------------------------------------------- | -----------------------: |
| No new competing allocation                                |                   $49.50 |
| 25% more competing allocation                              |                   $39.68 |
| 50% more competing allocation                              |                   $33.11 |
| 100% more competing allocation                             |                   $24.88 |
| 50% less total USD revenue, unchanged competing allocation |                   $24.75 |

This is why the largest pool reward total or highest headline APR may not produce the largest earnings for your allocation. Actual incentive timing, stake decay and activation delay require the time-dependent calculation used by the app.

### Common states and mistakes

| What you see                 | Interpretation and next step                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insufficient history**     | The persistence model has not met its data gate. Inspect baseline scenarios and collect more complete observations; do not read the absence of a ranking as a negative pool score.                                                                                                                                      |
| **—**                        | A required input, price or comparison is unavailable. Check pool warnings and methodology; do not substitute zero.                                                                                                                                                                                                      |
| **Stale observations**       | Current comparison evidence is too old. Check Data health and the [collector workflow](https://github.com/provatidis/gaugecraft/actions/workflows/pages.yml). The refresh button reloads the last published data; it does not run collection. Repository maintainers can use **Run workflow** to collect and republish. |
| **No evaluated returns yet** | The 48-hour horizon has not closed, or the required observations are incomplete. Performance cannot assess forecast accuracy from pending predictions.                                                                                                                                                                  |

Do not sum eligible-fee or volume values across CSV rows: their trailing windows overlap. Export observations to preserve timestamps and source-window boundaries for your own analysis. Hosted charts and CSV contain up to 30 days; full retained history is in the collector database. Watchlists and simulator inputs stay in this browser; the app does not track your actual stake positions or execute reallocations.

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

The workflow collects at **:17 and :47 UTC each hour**, freezes forecasts, backs up SQLite, and exports a static dashboard. It also runs on source changes. Collection and publishing are serialized. GitHub schedules can be delayed or disabled after 60 days without repository activity; the retrieval timestamp and stale-data warnings remain authoritative. Check Actions if updates stop. See [GitHub's schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

If observations become stale, inspect the workflow run **Event** column. A successful manual or push run does not establish that the schedule is working. Use **Run workflow** for an immediate refresh. If no scheduled events appear while the workflow is active, changing and committing its cron entries re-registers the scheduled trigger; see [GitHub’s trigger troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#scheduled-workflow-stopped-running). A browser refresh only reloads the last published dataset.

Observation history persists as compressed SQLite assets on the **Collector history** prerelease (`collector-state`), separate from source commits. Each run restores the newest complete backup and saves a uniquely named replacement before publishing; the three newest complete backups are retained. A failed restore stops the workflow instead of silently discarding history. The first deployment starts with `config/launch-history.sqlite.gz`, containing actual public contract reads collected on launch day, with provenance in `config/launch-history.json`. No personal settings are included. The fixture namespace is seeded separately and explicitly labeled.

The hosted dashboard downloads precomputed observations. Simulator inputs and watchlists stay in browser storage and are never sent to the collector. Charts and CSV contain the last 30 days; the release database retains full history and frozen forecasts. Missing prices and failed network reads stay visible. A total RPC failure publishes the last successful observations with their original timestamps and an error status. Backups grow with history; monitor release size as the dataset grows and migrate durable storage before approaching GitHub's per-asset limits.

To build the same static export locally, after collecting data:

```sh
VITE_DATA_MODE=static pnpm build
pnpm export:pages
python3 -m http.server 4318 --directory dist --bind 127.0.0.1
```

Relative asset URLs support the repository subpath and an inherited user-site domain. `pnpm build` without `VITE_DATA_MODE` still builds the local server version. Public hosting has GitHub's ordinary access logging; Gaugecraft adds no telemetry.

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
