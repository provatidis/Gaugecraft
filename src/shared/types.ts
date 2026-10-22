export type Mode = "live" | "demo";
export type Maybe = number | null;
export interface Token {
  address: string;
  symbol: string;
  decimals: number;
}
export interface Price {
  usd: number;
  basis: "stable-assumption" | "pool-spot";
  path: string[];
}
export interface Program {
  id: string;
  token: Token;
  rateRaw: string;
  start: number;
  end: number;
  priceUsd: Maybe;
}
export interface Snapshot {
  id: string;
  chainId: number;
  chain: string;
  address: string;
  gauge: string;
  rewardsManager: string;
  token0: Token;
  token1: Token;
  poolType: number;
  feeRaw: number;
  active: boolean;
  observedAt: number;
  retrievedAt: number;
  block: string;
  blockHash: string;
  mode: Mode;
  windowStart: number;
  windowEnd: number;
  createdAt: number;
  cooldownHours: Maybe;
  allocation: Maybe;
  tvlUsd: Maybe;
  volume48hUsd: Maybe;
  grossFees48hUsd: Maybe;
  eligibleFees48hUsd: Maybe;
  incentives48hUsd: Maybe;
  rewards48hUsd: Maybe;
  stakeApr: Maybe;
  aeroPriceUsd: Maybe;
  stakedFraction: Maybe;
  programs: Program[] | null;
  prices: Record<string, Price>;
  feeAccumulator0: string | null;
  feeAccumulator1: string | null;
  warnings: string[];
  raw: Record<string, unknown>;
}
export interface Signal {
  name: string;
  value: string;
  detail: string;
  severity: "neutral" | "good" | "warn";
}
export type HistoryPoint = Pick<
  Snapshot,
  | "observedAt"
  | "retrievedAt"
  | "block"
  | "blockHash"
  | "windowStart"
  | "windowEnd"
  | "stakeApr"
  | "rewards48hUsd"
  | "allocation"
  | "volume48hUsd"
  | "eligibleFees48hUsd"
  | "incentives48hUsd"
>;
export interface Forecast {
  id: string;
  poolId: string;
  mode: Mode;
  madeAt: number;
  dueAt: number;
  model: string;
  basis: "insufficient" | "history";
  projectedRevenue: Maybe;
  projectedFees: Maybe;
  projectedIncentives: Maybe;
  projectedAllocation: Maybe;
  stressedRevenue: Maybe;
  expectedPer1000: Maybe;
  stressedPer1000: Maybe;
  signals: Signal[];
  warnings: string[];
  inputCount: number;
  historyHours: number;
  input: Snapshot;
}
export interface MarketRow {
  snapshot: Snapshot;
  forecast: Forecast;
  aprChange: Maybe;
  allocationChange: Maybe;
}
export interface Run {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  chainId: number;
  mode: Mode;
  status: "running" | "success" | "partial" | "error";
  poolCount: number;
  error: string | null;
}
export interface Evaluation {
  forecastId: string;
  poolId: string;
  dueAt: number;
  status: "pending" | "insufficient" | "proxy";
  reason: string;
  projectedRevenue: Maybe;
  observedRevenueProxy: Maybe;
  revenueError: Maybe;
  revenuePctError: Maybe;
  projectedAllocation: Maybe;
  observedAllocation: Maybe;
  allocationError: Maybe;
  allocationPctError: Maybe;
  estimatedReturn: Maybe;
  observedReturnProxy: Maybe;
  returnError: Maybe;
  returnPctError: Maybe;
  observedFeeReturnPer1000: Maybe;
}
