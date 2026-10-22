import type { Snapshot } from "../src/shared/types.js";
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function* csvLines(rows: Iterable<Snapshot>): Generator<string> {
  const columns = [
    "mode",
    "pool_id",
    "chain",
    "token0",
    "token1",
    "observed_utc",
    "retrieved_utc",
    "block",
    "block_hash",
    "source_window_start_utc",
    "source_window_end_utc",
    "stake_apr_pct_estimate",
    "pool_rewards_48h_usd_estimate",
    "gross_fees_window_usd",
    "eligible_fees_window_usd_estimate",
    "incentives_48h_usd_estimate",
    "allocation_power",
    "tvl_usd_estimate",
    "volume_window_usd_estimate",
    "warnings",
  ];
  yield columns.map(csvCell).join(",") + "\n";
  for (const s of rows) {
    yield [
      s.mode,
      s.id,
      s.chain,
      s.token0.symbol,
      s.token1.symbol,
      new Date(s.observedAt * 1000).toISOString(),
      new Date(s.retrievedAt * 1000).toISOString(),
      s.block,
      s.blockHash,
      new Date(s.windowStart * 1000).toISOString(),
      new Date(s.windowEnd * 1000).toISOString(),
      s.stakeApr,
      s.rewards48hUsd,
      s.grossFees48hUsd,
      s.eligibleFees48hUsd,
      s.incentives48hUsd,
      s.allocation,
      s.tvlUsd,
      s.volume48hUsd,
      s.warnings.join(" | "),
    ]
      .map(csvCell)
      .join(",") + "\n";
  }
}
export function toCsv(rows: Iterable<Snapshot>) {
  return [...csvLines(rows)].join("");
}
