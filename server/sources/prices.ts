import type { Price, Token } from "../../src/shared/types.js";
import { units } from "../../src/analysis/math.js";
export interface PricePool {
  lp: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  poolType: number;
  sqrtRatio: bigint;
}
/** Local, transparent two-hop spot estimates. No symbol-based stablecoin guesses. */
export function derivePrices(
  pools: PricePool[],
  tokens: Map<string, Token>,
  stable: string,
): Record<string, Price> {
  const prices: Record<string, Price> = {
    [stable]: { usd: 1, basis: "stable-assumption", path: [] },
  };
  for (let hop = 0; hop < 2; hop++) {
    const candidates = new Map<
      string,
      { price: number; depth: number; path: string[] }[]
    >();
    for (const p of pools) {
      const t0 = tokens.get(p.token0),
        t1 = tokens.get(p.token1);
      if (!t0 || !t1) continue;
      const r0 = units(p.reserve0, t0.decimals),
        r1 = units(p.reserve1, t1.decimals);
      if (r0 <= 0 || r1 <= 0) continue;
      // Stable AMMs need a different invariant. Skip their price discovery entirely.
      const ratio =
        p.poolType > 0
          ? (Number(p.sqrtRatio) / 2 ** 96) ** 2 *
            10 ** (t0.decimals - t1.decimals)
          : p.poolType === -1
            ? r1 / r0
            : NaN;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      for (const [target, known, scale, reserve] of [
        [p.token0, p.token1, ratio, r1],
        [p.token1, p.token0, 1 / ratio, r0],
      ] as const) {
        if (
          prices[target] ||
          !prices[known] ||
          prices[known].path.includes(p.lp)
        )
          continue;
        const depth = reserve * prices[known].usd,
          price = prices[known].usd * scale;
        if (depth < 1000 || !Number.isFinite(price) || price <= 0) continue;
        candidates.set(target, [
          ...(candidates.get(target) ?? []),
          { price, depth, path: [...prices[known].path, p.lp] },
        ]);
      }
    }
    for (const [token, options] of candidates) {
      options.sort((a, b) => b.depth - a.depth);
      const deepest = options[0],
        comparable = options.filter((x) => x.depth >= deepest.depth * 0.1);
      if (comparable.some((x) => Math.abs(x.price / deepest.price - 1) > 0.33))
        continue;
      prices[token] = {
        usd: deepest.price,
        basis: "pool-spot",
        path: deepest.path,
      };
    }
  }
  return prices;
}
