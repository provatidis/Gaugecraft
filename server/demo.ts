import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import type { Snapshot, Token } from "../src/shared/types.js";
import { annualized, HORIZON, incentives } from "../src/analysis/math.js";
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
export function demoSnapshot(
  at: number,
  index = 0,
  fixtureEnd = 1792656000,
): Snapshot {
  const t0: Token = {
    address: address(10 + index),
    symbol: ["WETH", "cbBTC", "AERO", "USDC", "NEW"][index],
    decimals: 18,
  };
  const t1: Token = { address: address(2), symbol: "USDC", decimals: 6 };
  const p = {
    id: "1",
    token: t1,
    rateRaw: "50000000000000000000000",
    start: fixtureEnd - 10 * 86400,
    end: fixtureEnd + (index === 2 ? 0.2 : 4) * HORIZON,
    priceUsd: 1,
  };
  const fees =
    [8400, 6200, 1300, 2200, 100][index] *
    (1 + 0.15 * Math.sin(at / 27000 + index));
  const allocation =
    [12000000, 8000000, 2500000, 4000000, 160000][index] *
    (1 + 0.12 * Math.sin(at / 80000 + index));
  const inc = incentives([p], at, at + HORIZON)!;
  return {
    id: `8453:${address(100 + index)}`,
    chainId: 8453,
    chain: "Base · fixture",
    address: address(100 + index),
    gauge: address(200 + index),
    rewardsManager: address(300 + index),
    token0: t0,
    token1: t1,
    poolType: 100,
    feeRaw: 500,
    active: true,
    observedAt: at,
    retrievedAt: at,
    block: "0",
    blockHash: "fixture",
    mode: "demo",
    windowStart: at - HORIZON,
    windowEnd: at,
    createdAt: at - 30 * 86400,
    cooldownHours: 47,
    allocation,
    tvlUsd: 1500000 * (index + 1),
    volume48hUsd: fees * 2000,
    grossFees48hUsd: fees * 1.1,
    eligibleFees48hUsd: fees,
    incentives48hUsd: inc,
    rewards48hUsd: fees + inc,
    stakeApr: annualized(fees + inc, allocation * 0.65),
    aeroPriceUsd: 0.65,
    stakedFraction: 1 / 1.1,
    programs: [p],
    prices: {
      [t0.address]: { usd: 3000, basis: "pool-spot", path: ["fixture"] },
      [t1.address]: { usd: 1, basis: "stable-assumption", path: [] },
    },
    feeAccumulator0: null,
    feeAccumulator1: null,
    warnings: [
      "Synthetic fixture. No financial decision should use these values.",
    ],
    raw: { fixture: true },
  };
}
export function seedDemo(store: Store) {
  if (store.latest("demo").length) return;
  const now = Math.floor(Date.now() / 1800000) * 1800;
  for (let at = now - 7 * 86400; at <= now; at += 1800) {
    store.ingest(Array.from({ length: 5 }, (_, i) => demoSnapshot(at, i, now)));
    store.saveDecision("demo", at);
  }
  console.log(
    "Created 7 days of explicitly synthetic demo observations in the separate demo namespace.",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const store = new Store();
  seedDemo(store);
  store.close();
}
