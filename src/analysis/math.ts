import type { Maybe, Program, Snapshot } from "../shared/types.js";
export const HOUR = 3600;
export const HORIZON = 48 * HOUR;
export const YEAR = 365 * 24 * HOUR;
export const finite = (n: number): Maybe =>
  Number.isFinite(n) && n >= 0 ? n : null;
export function sumKnown(values: Maybe[]): Maybe {
  return values.every((v) => v !== null && Number.isFinite(v))
    ? finite((values as number[]).reduce((a, b) => a + b, 0))
    : null;
}
export function units(raw: bigint | string, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Unsupported token decimals");
  const value = BigInt(raw);
  if (value < 0n) throw new Error("Negative token amount");
  const divisor = 10n ** BigInt(decimals);
  return Number(
    `${value / divisor}.${(value % divisor).toString().padStart(decimals, "0")}`,
  );
}
export function streamAmount(
  program: Program,
  from: number,
  to: number,
): number {
  const seconds = Math.max(
    0,
    Math.min(to, program.end) - Math.max(from, program.start),
  );
  if (!Number.isFinite(seconds)) throw new Error("Invalid stream window");
  // Keep the contract's 1e18 rate scaling in integer arithmetic before converting display units.
  return units(
    (BigInt(program.rateRaw) * BigInt(Math.floor(seconds))) / 10n ** 18n,
    program.token.decimals,
  );
}
export function incentives(
  programs: Program[] | null,
  from: number,
  to: number,
): Maybe {
  if (programs === null) return null;
  return sumKnown(
    programs.map((p) => {
      const amount = streamAmount(p, from, to);
      return amount === 0
        ? 0
        : p.priceUsd === null
          ? null
          : finite(amount * p.priceUsd);
    }),
  );
}
export function annualized(
  earnings: Maybe,
  capital: Maybe,
  seconds = HORIZON,
): Maybe {
  return earnings === null || capital === null || capital <= 0 || seconds <= 0
    ? null
    : finite((((earnings / capital) * YEAR) / seconds) * 100);
}
export function percentChange(current: Maybe, previous: Maybe): Maybe {
  return current === null || previous === null || previous === 0
    ? null
    : (current / previous - 1) * 100;
}
export function median(values: number[]): Maybe {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b),
    i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
export function cv(values: number[]): Maybe {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean <= 0
    ? null
    : Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
      ) / mean;
}
export interface SimulationInput {
  power: number;
  existingPower: number;
  stakeValueUsd: Maybe;
  remainingDays: Maybe;
  activationDelayHours: number;
}
export interface Scenario {
  label: string;
  competition: number;
  revenueFactor: number;
}
export const SCENARIOS: Scenario[] = [
  { label: "No new competing allocation", competition: 0, revenueFactor: 1 },
  {
    label: "25% more competing allocation",
    competition: 0.25,
    revenueFactor: 1,
  },
  {
    label: "50% more competing allocation",
    competition: 0.5,
    revenueFactor: 1,
  },
  { label: "100% more competing allocation", competition: 1, revenueFactor: 1 },
  { label: "50% less total USD revenue", competition: 0, revenueFactor: 0.5 },
];
export function simulate(
  snapshot: Snapshot,
  feeForecast: Maybe,
  input: SimulationInput,
  scenario: Scenario,
) {
  const invalid =
    !Number.isFinite(input.power) ||
    input.power < 0 ||
    !Number.isFinite(input.existingPower) ||
    input.existingPower < 0 ||
    (snapshot.allocation !== null &&
      input.existingPower > snapshot.allocation) ||
    !Number.isFinite(input.activationDelayHours) ||
    input.activationDelayHours < 0 ||
    input.activationDelayHours > 48 ||
    (input.remainingDays !== null &&
      (!Number.isFinite(input.remainingDays) || input.remainingDays <= 0)) ||
    (input.stakeValueUsd !== null &&
      (!Number.isFinite(input.stakeValueUsd) || input.stakeValueUsd <= 0));
  if (invalid)
    return {
      earnings: null,
      apr: null,
      share: null,
      error: "Check power, existing allocation, stake value and timing inputs.",
    };
  if (
    !snapshot.active ||
    snapshot.allocation === null ||
    feeForecast === null ||
    snapshot.programs === null
  )
    return {
      earnings: null,
      apr: null,
      share: null,
      error:
        "Active pool, allocation, eligible fee estimate and complete incentive schedules are required.",
    };
  const other =
    (snapshot.allocation - input.existingPower) * (1 + scenario.competition);
  let earnings = 0;
  const start = snapshot.observedAt,
    delay = input.activationDelayHours * HOUR;
  // Split at incentive boundaries and 15-minute points. Midpoint quadrature models decay and avoids
  // paying rewards before activation or extending a program beyond its fixed end.
  const cuts = new Set([start, start + HORIZON, start + delay]);
  for (let t = start; t < start + HORIZON; t += 900) cuts.add(t);
  for (const p of snapshot.programs)
    for (const t of [p.start, p.end])
      if (t > start && t < start + HORIZON) cuts.add(t);
  if (input.remainingDays !== null) {
    const end = start + input.remainingDays * 86400;
    if (end < start + HORIZON) cuts.add(end);
  }
  const times = [...cuts].sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1],
      b = times[i],
      mid = (a + b) / 2;
    if (mid < start + delay) continue;
    const mine =
      input.power *
      (input.remainingDays === null
        ? 1
        : Math.max(0, 1 - (mid - start) / (input.remainingDays * 86400)));
    const share = mine + other > 0 ? mine / (mine + other) : 0;
    if (share === 0) continue;
    const inc = incentives(snapshot.programs, a, b);
    if (inc === null)
      return {
        earnings: null,
        apr: null,
        share: null,
        error: "An active incentive token has no supported USD price.",
      };
    earnings +=
      share *
      ((feeForecast * (b - a)) / HORIZON + inc) *
      scenario.revenueFactor;
  }
  return {
    earnings: finite(earnings),
    apr: annualized(earnings, input.stakeValueUsd),
    share: input.power + other > 0 ? input.power / (input.power + other) : 0,
    error: null,
  };
}
