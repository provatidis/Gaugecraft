import type {
  Evaluation,
  Forecast,
  Maybe,
  Signal,
  Snapshot,
} from "../shared/types.js";
import {
  cv,
  HORIZON,
  HOUR,
  incentives,
  median,
  percentChange,
  sumKnown,
} from "./math.js";
export const MODEL = "transparent-v1";
export function historyCoverage(rows: Snapshot[], end: number) {
  const samples = rows
    .filter((s) => s.observedAt <= end && s.observedAt >= end - HORIZON)
    .sort((a, b) => a.observedAt - b.observedAt);
  const span = samples.length ? (end - samples[0].observedAt) / HOUR : 0;
  const maxGap = samples
    .slice(1)
    .reduce((m, s, i) => Math.max(m, s.observedAt - samples[i].observedAt), 0);
  return {
    samples,
    span,
    maxGap,
    ready: span >= 47.5 && samples.length >= 80 && maxGap <= 75 * 60,
  };
}
export function forecast(snapshot: Snapshot, history: Snapshot[]): Forecast {
  const madeAt = Math.max(snapshot.observedAt, snapshot.retrievedAt);
  // Explicit prediction cutoff. Future or other-pool observations never enter the model.
  const { samples, span, ready } = historyCoverage(
    history.filter(
      (s) =>
        s.id === snapshot.id &&
        s.mode === snapshot.mode &&
        s.retrievedAt <= madeAt,
    ),
    snapshot.observedAt,
  );
  const fees = samples.flatMap((s) =>
    s.eligibleFees48hUsd === null ? [] : [s.eligibleFees48hUsd],
  );
  const aprs = samples.flatMap((s) =>
    s.stakeApr === null ? [] : [s.stakeApr],
  );
  const recent = samples.filter(
    (s) => s.observedAt >= snapshot.observedAt - 6 * HOUR,
  );
  const before = samples
    .filter((s) => s.observedAt <= snapshot.observedAt - 6 * HOUR)
    .at(-1);
  const growth = percentChange(snapshot.allocation, before?.allocation ?? null);
  const feeCv = cv(fees),
    aprCv = cv(aprs);
  const enough =
    ready &&
    fees.length >= 80 &&
    snapshot.windowEnd - snapshot.windowStart >= 47 * HOUR;
  // Rolling fees overlap: use them for level stability, not independent statistical samples.
  const level = enough
    ? median(
        recent.flatMap((s) =>
          s.eligibleFees48hUsd === null ? [] : [s.eligibleFees48hUsd],
        ),
      )
    : snapshot.eligibleFees48hUsd;
  const projectedFees =
    level === null
      ? null
      : Math.min(level, snapshot.eligibleFees48hUsd ?? level);
  const scheduled = incentives(snapshot.programs, madeAt, madeAt + HORIZON);
  const revenue = sumKnown([projectedFees, scheduled]);
  // Extrapolate positive 6h inflow linearly for 48h, cap at +100%; never assume outflows benefit us.
  const extra =
    enough && growth !== null
      ? Math.max(0, Math.min(1, (growth / 100) * 8))
      : 0;
  const allocation =
    snapshot.allocation === null ? null : snapshot.allocation * (1 + extra);
  const stressed = sumKnown([
    projectedFees === null ? null : projectedFees * 0.5,
    scheduled,
  ]);
  const per = (r: Maybe, a: Maybe) =>
    r === null || a === null ? null : (1000 / (a + 1000)) * r;
  const expiring = (snapshot.programs ?? []).filter(
    (p) => p.end > snapshot.observedAt && p.end < snapshot.observedAt + HORIZON,
  );
  const share =
    revenue && projectedFees !== null ? projectedFees / revenue : null;
  const priorVolume = samples[0];
  const volumeReady =
    enough &&
    snapshot.volume48hUsd !== null &&
    priorVolume?.volume48hUsd != null &&
    priorVolume.volume48hUsd > 0 &&
    priorVolume.windowEnd - priorVolume.windowStart >= 47 * HOUR;
  const signals: Signal[] = [
    {
      name: "Observation coverage",
      value: enough
        ? `${span.toFixed(0)}h · ${samples.length} snapshots`
        : "Insufficient history",
      detail:
        "Requires 48h of coverage, at least 80 observations, no gap over 75 minutes and a near-full source fee window. This is a data gate, not statistical confidence.",
      severity: enough ? "good" : "warn",
    },
    {
      name: "Fee consistency",
      value:
        feeCv === null || !enough
          ? "Insufficient history"
          : `${(feeCv * 100).toFixed(1)}% variation`,
      detail:
        "Coefficient of variation of overlapping trailing fee estimates. Descriptive only; observations are correlated. Forecast uses the lower of current fees and the latest 6h median, with no growth bonus.",
      severity: enough && feeCv !== null && feeCv > 0.5 ? "warn" : "neutral",
    },
    {
      name: "Allocation pressure",
      value:
        growth === null
          ? "Insufficient history"
          : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% / 6h`,
      detail: enough
        ? "Positive 6h growth extrapolated linearly to 48h, capped at +100%. Decreases receive no forecast credit. All competing inflow is applied immediately, a conservative timing assumption."
        : "Six-hour change is descriptive. Until the history gate passes, baseline holds allocation constant and stress tests show dilution.",
      severity: growth !== null && growth > 10 ? "warn" : "neutral",
    },
    {
      name: "Incentive runway",
      value:
        snapshot.programs === null
          ? "Unavailable"
          : `${expiring.length} expiring within 48h`,
      detail:
        "Each onchain program is integrated only between its start and end. No replacement program or renewal is assumed.",
      severity: expiring.length ? "warn" : "neutral",
    },
    {
      name: "Recurring fee share",
      value:
        share === null
          ? "Unavailable"
          : `${(share * 100).toFixed(0)}% of estimate`,
      detail:
        "Estimated eligible fees divided by total forecast revenue. High incentive dependence is exposed rather than assigned an arbitrary penalty.",
      severity: share !== null && share < 0.3 ? "warn" : "neutral",
    },
    {
      name: "APR variability",
      value:
        aprCv === null || !enough
          ? "Insufficient history"
          : `${(aprCv * 100).toFixed(1)}% variation`,
      detail:
        "Describes observed annualized estimate variation; not an independent estimate of future return uncertainty.",
      severity: enough && aprCv !== null && aprCv > 0.5 ? "warn" : "neutral",
    },
    {
      name: "Volume anomaly",
      value: volumeReady
        ? `${(snapshot.volume48hUsd! / priorVolume.volume48hUsd!).toFixed(2)}× prior 48h`
        : "Insufficient history",
      detail:
        "Compares trailing volumes separated by 48h. Launch windows and missing observations block this signal.",
      severity: "neutral",
    },
    {
      name: "Allocator response to high APR",
      value: "Not calibrated",
      detail:
        "Requires multiple completed 48h cohorts. No learned inflow elasticity or confidence percentage is claimed at launch.",
      severity: "neutral",
    },
  ];
  return {
    id: `${snapshot.mode}:${snapshot.id}:${madeAt}:${MODEL}`,
    poolId: snapshot.id,
    mode: snapshot.mode,
    madeAt,
    dueAt: madeAt + HORIZON,
    model: MODEL,
    basis: enough ? "history" : "insufficient",
    projectedRevenue: revenue,
    projectedFees,
    projectedIncentives: scheduled,
    projectedAllocation: allocation,
    stressedRevenue: stressed,
    expectedPer1000: per(revenue, allocation),
    stressedPer1000: per(
      stressed,
      allocation === null ? null : allocation * 1.5,
    ),
    signals,
    warnings: [
      ...snapshot.warnings,
      ...(!enough
        ? [
            "Baseline scenario only; insufficient history for persistence ranking.",
          ]
        : []),
    ],
    inputCount: samples.length,
    historyHours: span,
    input: snapshot,
  };
}
export function evaluateForecast(
  f: Forecast,
  history: Snapshot[],
  now: number,
): Evaluation {
  const result: Evaluation = {
    forecastId: f.id,
    poolId: f.poolId,
    dueAt: f.dueAt,
    status: "pending",
    reason: "The 48-hour forecast window has not closed.",
    projectedRevenue: f.projectedRevenue,
    observedRevenueProxy: null,
    revenueError: null,
    revenuePctError: null,
    projectedAllocation: f.projectedAllocation,
    observedAllocation: null,
    allocationError: null,
    allocationPctError: null,
    estimatedReturn: f.expectedPer1000,
    observedReturnProxy: null,
    returnError: null,
    returnPctError: null,
    observedFeeReturnPer1000: null,
  };
  if (now < f.dueAt) return result;
  result.status = "insufficient";
  result.reason =
    "Awaiting a complete 48h observation window and an endpoint within 45 minutes of maturity.";
  const rows = history
    .filter(
      (s) =>
        s.id === f.poolId &&
        s.mode === f.mode &&
        s.observedAt >= f.madeAt - 45 * 60 &&
        s.observedAt <= Math.min(now, f.dueAt + 45 * 60),
    )
    .sort((a, b) => a.observedAt - b.observedAt);
  const end = rows.find((s) => s.observedAt >= f.dueAt);
  if (!end) return result;
  result.observedAllocation = end.allocation;
  if (end.allocation !== null && f.projectedAllocation !== null) {
    result.allocationError = Math.abs(f.projectedAllocation - end.allocation);
    result.allocationPctError =
      end.allocation === 0
        ? null
        : (result.allocationError / end.allocation) * 100;
  }
  const anchor = rows.filter((s) => s.observedAt <= f.madeAt).at(-1);
  if (!anchor) return result;
  const cover = rows.filter(
    (s) => s.observedAt >= anchor.observedAt && s.observedAt <= end.observedAt,
  );
  if (
    cover.length < 80 ||
    cover[0].observedAt > f.madeAt ||
    cover.some(
      (s, i) => i > 0 && s.observedAt - cover[i - 1].observedAt > 75 * 60,
    )
  )
    return result;
  if (
    Math.abs(end.windowStart - f.madeAt) > 45 * 60 ||
    Math.abs(end.windowEnd - f.dueAt) > 45 * 60 ||
    end.eligibleFees48hUsd === null ||
    end.programs === null ||
    cover.some((s) => s.allocation === null)
  ) {
    result.reason =
      "Allocation endpoint is available; revenue window, prices or supply coverage are incomplete.";
    return result;
  }
  // This is explicitly an observed-data proxy, NOT a realized wallet claim. Never sum overlapping rolling fees.
  const actualIncentives = incentives(end.programs, f.madeAt, f.dueAt);
  result.observedRevenueProxy = sumKnown([
    end.eligibleFees48hUsd,
    actualIncentives,
  ]);
  if (result.observedRevenueProxy === null) {
    result.reason = "A realized-window incentive price is unavailable.";
    return result;
  }
  let earnings = 0;
  for (let i = 1; i < cover.length; i++) {
    const a = cover[i - 1],
      b = cover[i],
      left = Math.max(a.observedAt, f.madeAt),
      right = Math.min(b.observedAt, f.dueAt);
    if (right <= left) continue;
    const share =
      1000 / (((a.allocation as number) + (b.allocation as number)) / 2 + 1000);
    const inc = incentives(end.programs, left, right);
    if (inc === null) return result;
    earnings +=
      share * ((end.eligibleFees48hUsd * (right - left)) / HORIZON + inc);
  }
  result.observedReturnProxy = earnings;
  result.status = "proxy";
  result.reason =
    "Observed-window proxy: endpoint trailing eligible-fee approximation, uniform fee timing, endpoint prices, exact incentive schedules and sampled competing supply. Not realized claims or an event-level backtest.";
  const start = cover[0];
  if (
    start.feeAccumulator0 !== null &&
    end.feeAccumulator0 !== null &&
    start.feeAccumulator1 !== null &&
    end.feeAccumulator1 !== null
  ) {
    const d0 = BigInt(end.feeAccumulator0) - BigInt(start.feeAccumulator0),
      d1 = BigInt(end.feeAccumulator1) - BigInt(start.feeAccumulator1);
    const p0 = f.input.prices[start.token0.address]?.usd,
      p1 = f.input.prices[start.token1.address]?.usd;
    if (d0 >= 0n && d1 >= 0n && p0 !== undefined && p1 !== undefined)
      result.observedFeeReturnPer1000 =
        ((1000 * 1e18) / 1e24) *
        ((Number(d0) / 10 ** start.token0.decimals) * p0 +
          (Number(d1) / 10 ** start.token1.decimals) * p1);
  }
  for (const [pred, actual, abs, pct] of [
    [
      "projectedRevenue",
      "observedRevenueProxy",
      "revenueError",
      "revenuePctError",
    ],
    ["estimatedReturn", "observedReturnProxy", "returnError", "returnPctError"],
  ] as const) {
    const p = result[pred],
      a = result[actual];
    if (p !== null && a !== null) {
      result[abs] = Math.abs(p - a);
      result[pct] = a === 0 ? null : (Math.abs(p - a) / a) * 100;
    }
  }
  return result;
}
