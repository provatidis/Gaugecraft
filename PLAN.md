# Gaugecraft implementation plan

1. Verify MetaDEX03 reward accounting, deployment identities and public view interfaces; record evidence in SOURCES.md.
2. Build a read-only collector → SQLite → React dashboard vertical slice. Verify Base first, then collect all seven networks by default. Pin all reads in each chain run to one block, retain raw units and actual source windows.
3. Add a browser-only allocation simulator with own-allocation dilution, explicit stake-value denominator, time-bounded incentives, optional stake decay and activation delay.
4. Store 30-minute observations and immutable 48-hour forecasts. Describe persistence using coverage, fee stability, allocation trend and incentive expiry; abstain when evidence is thin.
5. Evaluate only mature forecasts with adequate observations. Keep observed allocation errors separate from return proxies; do not call a reconstruction a wallet's realized return. Compare benchmark selections made at forecast time.
6. Verify calculations and ingestion, lint, type-check, build, and inspect the local UI. Document limits and scheduling.

## Review of the supplied prompt

- Official launch article and docs say October 21, 2026, not October 22.
- Current guide specifies 47-hour cooldown per stake per network; 48 hours remains the research horizon. Query configured cooldown rather than hardcoding transaction eligibility.
- Allocation power is not stake principal. Market APR uses power × AERO price; personal capital APR needs the user's stake USD value. Store neither personal input server-side.
- Eligible allocator fees differ from all trading fees. Aero's display uses historical total fees × current staked-liquidity fraction: useful, but an approximation of historical eligibility.
- Rewards are time-weighted. Fixed-duration stakes decay; cross-chain activation is not necessarily instantaneous. Avoid the naive end-of-window allocation denominator.
- Incentives are fixed-rate programs with actual start/end times. Launch tokens or missing prices must not become zero-dollar rewards.
- Launch history cannot support learned allocator behavior or calibrated confidence. Use explainable signals and stress tests, not an arbitrary composite score.
- Overlapping trailing 48-hour fee values cannot be summed to evaluate revenue. Distinguish cumulative reward accounting from rolling-window estimates.
- No wallet, transaction paths, paid services, telemetry, or dependency on other personal repositories.
