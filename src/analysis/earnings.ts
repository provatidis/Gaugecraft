import type { MarketRow, Maybe } from "../shared/types.js";
import { isFresh } from "./freshness.js";
import { finite, HOUR } from "./math.js";

export type EarningsBasis = "history" | "baseline" | "partial" | "unavailable";
export interface EarningsComparison {
  basis: EarningsBasis;
  earnings: Maybe;
  stress: Maybe;
  fees: Maybe;
  incentives: Maybe;
  reason: string;
}
export const EVIDENCE_LABELS: Record<EarningsBasis, string> = {
  history: "History-based estimate",
  baseline: "Baseline · limited history",
  partial: "Partial fee window",
  unavailable: "Unavailable",
};

// An immediate, constant-power comparison at the forecast cutoff. Forecast records
// remain immutable; personal inputs are used only by the client and are never saved there.
export function allocationEarnings(
  row: MarketRow,
  power: number,
  existingPower = 0,
  now = Date.now() / 1000,
): EarningsComparison {
  const { snapshot: s, forecast: f } = row;
  const blocked = (
    basis: EarningsBasis,
    reason: string,
  ): EarningsComparison => ({
    basis,
    earnings: null,
    stress: null,
    fees: null,
    incentives: null,
    reason,
  });
  if (!s.active) return blocked("unavailable", "Inactive pool");
  if (!isFresh(s, now)) return blocked("unavailable", "Stale observation");
  if (
    !Number.isFinite(power) ||
    power <= 0 ||
    !Number.isFinite(existingPower) ||
    existingPower < 0 ||
    (s.allocation !== null && existingPower > s.allocation)
  )
    return blocked(
      "unavailable",
      "Check intended and existing allocation power",
    );
  if (
    s.windowEnd - s.windowStart < 47 * HOUR ||
    s.windowEnd - s.windowStart > 49 * HOUR
  )
    return blocked(
      "partial",
      "A comparable 48h earnings estimate needs a near-full 48h fee window; short windows are not extrapolated.",
    );
  const values = [
    s.allocation,
    f.projectedAllocation,
    f.projectedFees,
    f.projectedIncentives,
  ];
  if (values.some((v) => v === null || !Number.isFinite(v) || v < 0))
    return blocked(
      "unavailable",
      "Allocation, eligible fees or priced incentives are unavailable",
    );
  const current = s.allocation!;
  // Apply the forecast's proportional growth to other allocators, then add the
  // user's intended total exactly once. No projected outflow benefit is assumed.
  const growth =
    current > 0 ? Math.max(1, f.projectedAllocation! / current) : 1;
  const other = (current - existingPower) * growth;
  const share = power / (other + power);
  const fees = finite(share * f.projectedFees!);
  const incentives = finite(share * f.projectedIncentives!);
  return {
    basis: f.basis === "history" ? "history" : "baseline",
    earnings: finite(share * (f.projectedFees! + f.projectedIncentives!)),
    stress: finite(
      (power / (other * 1.5 + power)) *
        (f.projectedFees! * 0.5 + f.projectedIncentives!),
    ),
    fees,
    incentives,
    reason:
      f.basis === "history"
        ? "Conservative fee and allocation forecasts; scheduled incentives stop at expiry."
        : "Current fees and competing allocation held constant; insufficient history to assess persistence.",
  };
}

// Evidence cohorts remain separate even for ascending sorts; nulls never rise to the top.
export function compareEarnings(
  a: EarningsComparison,
  b: EarningsComparison,
  metric: "earnings" | "stress",
  descending = true,
) {
  const order: Record<EarningsBasis, number> = {
    history: 0,
    baseline: 1,
    partial: 2,
    unavailable: 3,
  };
  if (a.basis !== b.basis) return order[a.basis] - order[b.basis];
  const av = a[metric],
    bv = b[metric];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * (descending ? -1 : 1);
}
