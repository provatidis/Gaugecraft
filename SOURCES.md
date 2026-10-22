# Aero research sources

Investigated 2026-10-22 UTC. This is MetaDEX03 research, not legacy weekly Aerodrome voting. Findings and implementation status are updated below as reads are verified.

| Source                                                                                                 | Use                          | Reliability and limitations                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://aero.xyz/articles/aero-launches-today/                                                         | Launch                       | Official article dated October 21, 2026.                                                                                                                 |
| https://app.aero.xyz/docs/                                                                             | Architecture                 | Official docs: Base root, local pool/gauge/reward deployments on each chain.                                                                             |
| https://app.aero.xyz/docs/features/predictive-allocation/                                              | Pro-rata allocation          | Current docs specify 47-hour cooldown. Marketing page still says 48 hours.                                                                               |
| https://app.aero.xyz/docs/guides/staking-and-allocating/                                               | Stake power and cooldown     | Cooldown per stake per network; perpetual power is constant, fixed power decays.                                                                         |
| https://app.aero.xyz/docs/products/markets/                                                            | Display metric formulas      | Stake APR and estimated rewards are calculated estimates, not stored contract values. Eligible portion of trading fees plus future incentives.           |
| https://app.aero.xyz/docs/features/incentive-programs/                                                 | Program schedule             | Immutable token, budget, start and end. Continuous rate; zero-allocation intervals recoverable by creator.                                               |
| https://github.com/dromos-labs/metadex-public/tree/8b506b450aaa9d4a9f1a77e264f2d9dd508e9ddf            | Contracts/deployments        | Pinned first-party source. Deployments alone do not prove runtime identity.                                                                              |
| https://github.com/dromos-labs/metadex-slipstream-public/tree/f99f2095918cab69eafeffa2c3d0a8762de737b7 | CL pool implementation       | Pinned first-party source, fee and activity tapes.                                                                                                       |
| https://app.aero.xyz/assets/execution.worker-D_OV4Mdl.js                                               | Sugar addresses and read ABI | Public app v0.0.1+8e0f27. App-used, undocumented interface, can change. Extracted data/ABI only; third-party JavaScript is never executed by Gaugecraft. |
| https://app.aero.xyz/assets/figures-C6zk037s.js                                                        | App formula cross-check      | VotingRewardsManager.totalSupply is the reward denominator; gauge raw allocations are not interchangeable.                                               |
| https://app.aero.xyz/assets/pool-BtdNeCDX.js                                                           | USD activity conventions     | Volume divides each token-side amount by two to avoid double counting; missing prices must remain unavailable in Gaugecraft.                             |

## Validated contract semantics

`V3/src/rewards/VotingCheckpoints.sol`: totalSupply() computes current decayed reward power; supplyAt(timestamp) and globalRewardPointHistory(index) expose checkpoints.

`FeeDistribution.sol` and `VotingRewardsManager.sol`: token0/token1 fee accumulators distribute eligible gauge fees at checkpoints, with buffering, integer rounding and pending fees. earnedFees(tokenId,maxCheckpoints) is position-specific and intentionally not called because no wallet or stake ID is needed.

`IncentiveStreaming.sol`: incentiveCount(), incentive(id), incentives(ids); rate is token base units/second scaled by 1e18. `IIncentiveStreaming` describes prefix integrals of inverse supply. IDs begin at 1. Claims/remaining balances are not remaining undistributed future budget.

`ILeafVoter`: allocationCooldown() is configurable; gaugeStates(gauge) has separate emissions state. Gauge caps constrain LP emissions, not a guarantee of higher staking income.

## Formulas

- Stream USD over [t,t+48h] = rate/1e18/10^decimals × max(0,min(end,t+48h)-max(start,t)) × token USD price.
- App-style eligible fees = historical total trading fees × current gaugeLiquidity/liquidity. This eligibility approximation is labelled separately from observed gross fees.
- Display-style rewards = eligible fee approximation + scheduled incentives; no renewal assumed.
- Market power APR (%) = rewards48h/(current reward power × AERO price) × 182.5 × 100. Null for unknown price or zero denominator.
- Personal expected earnings = integral myPower(t)/(otherPower(t)+myPower(t)) × distributableRevenueRate(t) dt. Model adds own power once, subtracting any current allocation already included. Scenarios stress other power only.
- Personal capital APR (%) = earnings48h/stakeValueUSD × 182.5 × 100; USD stake value is an explicit optional local input.

## Public interfaces and implementation

No documented general-purpose Aero history REST API or versioned research SDK was verified in this investigation. The public app exposes a read-only Sugar contract ABI and deployment configuration. Gaugecraft reads these contracts through ordinary public JSON-RPC; it does not depend on app authentication, copy embedded provider credentials, or execute the downloaded app bundle. `config/provenance.json` records the bundle URL, version and SHA-256. This app-used interface is less stable than a documented API, so decoding failures stop the affected collection rather than inventing data.

| Required information              | Read interface                                             | Interpretation / limitation                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool universe and identities      | Sugar `count()` and paginated `all(limit,offset,172800,0)` | Pool address and chain ID are the identity. Only pools with nonzero gauge and reward-manager addresses enter allocator research. Registry size includes other pools. |
| Tokens and decimals               | Sugar `tokens(limit,offset,0,addresses)`                   | Symbols are labels, never identities or proof of a dollar peg. Unsupported decimals/metadata leave the affected pool unavailable.                                    |
| Current allocation power          | Pool reward manager `totalSupply()`                        | Current decayed voting reward supply, divided by 1e18. Not the gauge's raw allocation counter.                                                                       |
| Fees and volume                   | Sugar `windowFee0/1`, `windowVolume0/1`, `windowStart/End` | Actual token quantities over the returned interval. At launch this interval is often much shorter than the requested 48 hours.                                       |
| Liquidity and current eligibility | Sugar reserves, `liquidity`, `gaugeLiquidity`              | Current TVL and staked share. Current share approximates eligibility for historical fees; it cannot reconstruct past liquidity ownership.                            |
| Incentives and expiry             | Reward manager `incentiveCount()`, `incentives(ids)`       | All programs, including ended and future programs, are retained; IDs start at 1. Unknown schedule or active token price blocks the reward total.                     |
| Reward accounting check           | `feeRewardPerVotingPower()`                                | Token0/1 fee accumulators retained as raw integer strings. Contract scale is 1e24. Deltas can provide an additional per-power fee check, with limitations below.     |
| Cooldown                          | LeafVoter `allocationCooldown()`                           | Live configuration in seconds. All seven verified networks returned 47 hours. Does not determine a particular stake's eligibility.                                   |
| Historical changes                | Genuine SQLite observations, every 30 minutes              | Changes include decay and new allocation. They are not a count of incoming allocator transactions. No synthetic backfill.                                            |
| Stake APR / rewards               | Local calculation from the above inputs                    | Aero-style reconstruction with Gaugecraft prices; not an official API quote or onchain scalar.                                                                       |

### Networks verified on 2026-10-22

The full addresses, token anchors and public RPC URLs are in `config/chains.json`. Each run checks chain ID, code at the app's Sugar address, a block within 15 minutes of UTC time, and consistent block hash before/after collection. Every state read in a chain run uses the same block number. These checks establish live interface functionality; they are **not** a bytecode-equivalence audit of every deployment.

| Network         | Chain ID | Sugar address                                | Allocator pools in first complete run |
| --------------- | -------- | -------------------------------------------- | ------------------------------------: |
| Base            | 8453     | `0xb2a7bdb79fbe254ddaeb151c9ff7649bddad48e5` |                                   270 |
| OP Mainnet      | 10       | `0x25ec650f0b213300d9576923f1cd2c06428d322e` |                                    30 |
| Arbitrum One    | 42161    | `0xee717411f6e44f9fee011835c8e6faac5deff166` |                                    30 |
| Ethereum        | 1        | `0xa916a76b052acd3b0ff6cc76b55602fba456a85c` |                                    56 |
| Ink             | 57073    | `0xd87ae3ec91d0eb8a98a5fff27c28209dc9233260` |                                    13 |
| Robinhood Chain | 4663     | `0x471c34138d06001aee399af9ebebbdf680b966b3` |                                    68 |
| Arc             | 5042     | `0xc1994f463859f1884e93145608f82f323fe60fae` |                                     7 |

The verified app configuration uses LeafVoter `0x382409fad8503fbcdbb27a4211551fa03e884078` on these networks. Multicall3 at `0xca11bde05977b3631167028862be2a173976ca11` batches ordinary read calls. Source pools preserve their gauge and reward-manager addresses in every snapshot, so they are not guessed from legacy deployments.

The first complete dataset contained 474 allocator pools (473 active). 275 active pools had complete USD reward estimates and 221 had complete USD TVL estimates under the conservative pricing rules. This is a dated validation result, not a promise about ongoing coverage. The genuine database is local and Git-ignored; clones start empty.

## Pricing and metric provenance

USD is not an onchain measurement. The configured stable address is assumed to equal $1: USDC on Base, OP, Arbitrum, Ethereum, Ink and Arc; **USDG on Robinhood**. Token metadata was checked against those exact addresses. The program does not infer a dollar peg from a ticker. There is no depeg detection or external oracle.

Other tokens use up to two hops of price discovery through observed pools. CL price ratio is `(sqrtPriceX96 / 2^96)^2 × 10^(decimals0-decimals1)`; volatile Basic pools use reserve1/reserve0 after decimal conversion. Stable-invariant pools are excluded from price discovery. At least $1,000 of the known-price side's reserve is required. Select the deepest candidate; withhold a price if another candidate with at least 10% of that depth disagrees by more than 33%. These are explicit guardrails, not empirical confidence bounds. Reserve depth does not prove active CL liquidity or manipulation resistance.

Different chains are priced independently; bridged AERO or assets are not automatically assigned another network's price. This causes missing APRs outside Base when a reliable local AERO path is unavailable. Prices can differ from Aero's frontend. Raw token amounts, source windows, price paths and raw pool fields are retained so calculations can be revisited.

- **Observed:** contract addresses, activity token quantities, reward supply, reserve balances, program rate/start/end, source block/hash/time.
- **Derived estimates:** USD volume/TVL, historical eligible fees, next-window incentives, market Stake APR and display-style pool reward total.
- **Forecast assumptions:** future fee level, future competing supply, stress scenarios and personal return estimates.

Volume USD uses `(volume0 × price0 + volume1 × price1) / 2` following the app's convention. Gross fees use the sum of the two token fee amounts. `0` is allowed for an observed zero token amount without requiring a token price; nonzero unpriced quantities remain unavailable. An incomplete priced total is never the sum of only the known components. Aggregate dashboard cards state how many active pools are priced.

The field names `*48h*` refer to the requested window. Actual `windowStart/End` are authoritative. Short launch fee windows are **not scaled up**. Their fee totals can contribute to the explicitly labelled baseline, but a complete 48-hour fee history is not claimed. This can materially understate the fee component of the launch baseline. Market APR still annualizes the display-style total over a nominal 48 hours; it is particularly approximate during this phase.

## Time-weighted allocation model

The share model is grounded in [VotingCheckpoints.sol](https://github.com/dromos-labs/metadex-public/blob/8b506b450aaa9d4a9f1a77e264f2d9dd508e9ddf/V3/src/rewards/VotingCheckpoints.sol), [FeeDistribution.sol](https://github.com/dromos-labs/metadex-public/blob/8b506b450aaa9d4a9f1a77e264f2d9dd508e9ddf/V3/src/rewards/FeeDistribution.sol) and [IncentiveStreaming.sol](https://github.com/dromos-labs/metadex-public/blob/8b506b450aaa9d4a9f1a77e264f2d9dd508e9ddf/V3/src/rewards/IncentiveStreaming.sol). The contract integrates rewards against time-varying voting power. Therefore `myPower / currentPower × revenue` is insufficient unless the denominator includes the new allocation and power remains constant.

Simulator competing power = `(observed total supply − my existing pool power) × (1 + competition shock)`. New intended power is then added once. Reducing an existing allocation is supported. With a fixed stake, own power decays linearly over remaining duration; other power is held constant after the shock. An optional activation delay gives no earnings before activation. Fifteen-minute midpoint integration is split at activation, expiry and every incentive boundary; numerical output is a display estimate, not a claimable integer balance.

The baseline assumes fees arrive uniformly. The revenue-decline scenario halves **all USD revenue**, including incentive-token value; it does not claim the onchain token stream itself changes. Competition scenarios are +0%, +25%, +50% and +100%. Own power is never multiplied by the competing-allocation shock. Unknown principal leaves personal capital APR blank. No compounding, transaction costs, price path, future liquidity change or automatic allocation is modelled.

The 47-hour cooldown and cross-chain propagation constrain actual decisions. Enter an appropriate activation delay if known; the app neither reads a wallet nor determines whether your intended transaction is eligible. A new allocation cannot earn rewards for periods before it becomes effective.

## Persistence heuristic, version `transparent-v1`

Forecasts freeze their inputs, creation/maturity times, model version and coverage. Creation time is no earlier than retrieval completion. The model excludes later observations, other pools and the other source namespace. Saved forecasts are never recomputed using future inputs.

The history gate requires at least 47.5 hours of span in the preceding 48 hours, at least 80 fee observations, no adjacent observation gap over 75 minutes, and a current source fee window of at least 47 hours. These are operational completeness rules for a half-hour collector, **not** enough evidence of predictive skill. Stale observations older than 75 minutes are excluded from opportunity lists.

| Signal                         | Rule and effect                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fee consistency                | Show coefficient of variation of overlapping trailing fee observations. Forecast fee level is `min(current, median of latest 6h)` once the gate passes. This prevents an upward fee spike receiving immediate growth credit. |
| Allocation pressure            | Positive change over the latest 6h is extended linearly for 48h and capped at +100%; no return boost for outflows. Apply the increase immediately as a conservative timing assumption.                                       |
| Incentive runway               | Integrate fixed programs only across their actual start/end times. No renewal, top-up or invented expiry. Direct effect on revenue.                                                                                          |
| Recurring fee share            | Show fees / total forecast revenue. Descriptive only; no arbitrary score penalty.                                                                                                                                            |
| APR variability                | Coefficient of variation, labelled descriptive. Overlapping observations are correlated. No confidence percentage.                                                                                                           |
| Volume anomaly                 | Compare trailing windows separated by about 48h; both windows and price observations must be available. Descriptive only.                                                                                                    |
| Allocator reaction to high APR | Explicitly “Not calibrated.” A launch dataset cannot establish a reliable elasticity.                                                                                                                                        |

There are no hidden signal weights. Rank eligible candidates by expected USD earnings for 1,000 added power under a declared **50% fee decline plus 50% additional competition** stress, on top of the conservative inflow forecast. Scheduled incentives retain their known timing. This is an illustrative stress, not a percentile, probability or worst-case guarantee. Before the history gate passes, show baseline comparisons and “Insufficient history.”

## Forecast evaluation and benchmarks

After 48 hours, select the first observation at/after maturity within 45 minutes. Allocation error can be reported independently. A return proxy also requires at least 80 observations across the window, a genuine pre-origin anchor within 45 minutes, no supply gaps over 75 minutes, complete schedules/prices, and source window boundaries within 45 minutes of the forecast interval.

Use the endpoint's trailing eligible fee approximation **once**; never add overlapping 48-hour fee totals. Assume uniform fee timing, integrate actual incentive schedules using endpoint prices, and use midpoint supply from adjacent snapshots for the hypothetical 1,000-power share. Newly created programs can appear in the realized proxy even though they were unknowable at prediction time. Their absence from the frozen prediction is part of the error. This is intentionally labelled “observed-data proxy,” not actual realized rewards.

Absolute error is `abs(prediction − observed proxy)`; percentage error divides that by the absolute observed value and is unavailable when that value is zero. Allocation, revenue and return errors are separate. Token fee accumulator deltas are also saved/evaluated where supported: `1,000 × 1e18 / 1e24 × Σ(deltaAccumulatorToken / 10^tokenDecimals × originPriceToken)`. This supplementary non-diluted per-power check can include checkpoint buffering and endpoint timing error; it is not used to claim exact personal realization.

Benchmark selections are frozen after each successful collection cohort: persistence stress ranking, highest current Stake APR, highest estimated pool rewards, and highest eligible fee estimate. Only fresh available candidates enter the selection. Performance compares identical cohorts where all four selections have complete proxies. It uses equal reference power and independent 48-hour holds, not a compounded account strategy. Cohorts overlap and are correlated; no statistical significance or future performance claim is made. The UI reports the bounded evaluation sample it is displaying.

## Freshness, reliability and remaining work

JSON-RPC reads are sequential/rate-limited with three attempts, exponential backoff and jitter. Pool pages contain 15 entries and read batches contain up to 60 calls. Per-chain failures preserve earlier data and appear in the run log. Successful individual reads with missing reward supply or schedules produce partial observations. Both source block time and retrieval completion time are stored in UTC. Each source/chain/pool half-hour bucket is immutable after its first successful insert.

Block hashes are checked within collection, but later reorgs are not continuously revalidated. The SQLite lease prevents simultaneous collectors on one local database; this is not a distributed deployment design. Program enumeration can become expensive as contract history grows. No externally hosted service, archive-node requirement or event indexer is introduced.

An exact realized-return research engine would need checkpoint/event reconstruction, token price observations through time, validation of counterfactual supply changes, and settlement/rounding treatment. The published contracts expose checkpoint histories and reward accounting that make further investigation possible; the MVP records snapshots and accumulators instead of claiming that work is complete. More history is also required before testing allocator response or selecting empirically justified stress parameters.

Validation includes live reads across all seven configured networks, 22 offline financial/ingestion tests, TypeScript checking, lint, production build, and browser inspection of live and isolated fixture flows. See README.md for reproducible commands. No synthetic observation was inserted into the live namespace.

## GitHub Pages publication

The hosted build reads static JSON exports from this collector, not a new Aero API. GitHub Actions is scheduled twice per hour, with actual source-block and retrieval timestamps retained. [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) provide the deployment mechanism. [Scheduled workflow limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) allow delays and inactivity-based disablement; the UI never equates scheduled time with a successful observation.

SQLite history and frozen forecasts persist in the repository's `collector-state` prerelease. Uploads use unique names, size/digest checks and three retained complete copies; a failed restore stops publication. The one-time launch seed contains only genuine public observations from this collector, with a SHA-256 and coverage summary in `config/launch-history.json`. Static charts and CSV are limited to 30 days; full history remains in the database. Synthetic fixtures are stored and published under their separate `demo` namespace. Personal simulator inputs never leave browser storage.
