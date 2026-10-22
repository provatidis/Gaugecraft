import { parseAbi, type Abi } from "viem";
import chains from "../../config/chains.json" with { type: "json" };
import signatures from "../../config/sugar-abi.json" with { type: "json" };
import type { Program, Snapshot, Token } from "../../src/shared/types.js";
import {
  annualized,
  finite,
  HORIZON,
  incentives,
  sumKnown,
  units,
} from "../../src/analysis/math.js";
import { derivePrices, type PricePool } from "./prices.js";
import { Rpc, type Read } from "./rpc.js";
export { chains };
export type ChainConfig = (typeof chains)[number];
export const sugarAbi = parseAbi(signatures);
const vrmAbi = parseAbi([
  "function totalSupply() view returns(uint256)",
  "function incentiveCount() view returns(uint256)",
  "function feeRewardPerVotingPower() view returns(uint256 feeReward0,uint256 feeReward1,uint256 feeReward0xTime,uint256 feeReward1xTime)",
  "function incentives(uint256[] ids) view returns(Program[])",
  "struct Program { address token; uint256 amount; uint256 rate; uint48 start; uint48 end; address creator; }",
]);
const cooldownAbi = parseAbi([
  "function allocationCooldown() view returns(uint48)",
]);
const zero = "0x0000000000000000000000000000000000000000";
interface RawPool extends PricePool {
  symbol: string;
  liquidity: bigint;
  gaugeLiquidity: bigint;
  gauge: string;
  gaugeAlive: boolean;
  rewardsManager: string;
  poolFee: bigint;
  createdAt: number;
  windowStart: number;
  windowEnd: number;
  windowVolume0: bigint;
  windowVolume1: bigint;
  windowFee0: bigint;
  windowFee1: bigint;
  [key: string]: unknown;
}
export interface SourceResult {
  snapshots: Snapshot[];
  registryCount: number;
  warnings: string[];
}
export interface Source {
  collect(config: ChainConfig): Promise<SourceResult>;
}
export function poolId(chainId: number, address: string) {
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !/^0x[\da-f]{40}$/i.test(address)
  )
    throw new Error("Invalid pool identity");
  return `${chainId}:${address.toLowerCase()}`;
}
const jsonSafe = (o: unknown) =>
  JSON.parse(
    JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
export class AeroSource implements Source {
  async collect(config: ChainConfig): Promise<SourceResult> {
    const rpc = new Rpc(
      process.env[`RPC_${config.id}`] || config.rpc,
      Number(process.env.RPC_INTERVAL_MS) || 200,
    );
    if ((await rpc.retry(() => rpc.client.getChainId())) !== config.id)
      throw new Error("RPC chain ID differs from configured network");
    const block = await rpc.retry(() =>
      rpc.client.getBlock({ blockTag: "latest" }),
    );
    const at = Number(block.timestamp),
      retrievedAt = Math.floor(Date.now() / 1000);
    if (Math.abs(retrievedAt - at) > 900)
      throw new Error(
        "RPC block is more than 15 minutes from current UTC time",
      );
    const code = await rpc.retry(() =>
      rpc.client.getCode({
        address: config.sugar as `0x${string}`,
        blockNumber: block.number,
      }),
    );
    if (!code || code === "0x")
      throw new Error("Official app Sugar address has no code on this chain");
    const count = Number(
      await rpc.read<bigint>(
        { address: config.sugar, abi: sugarAbi, functionName: "count" },
        block.number,
      ),
    );
    if (!Number.isSafeInteger(count) || count < 0 || count > 20000)
      throw new Error("Unexpected pool registry size");
    const all: RawPool[] = [];
    for (let offset = 0; offset < count; offset += 15) {
      const page = await rpc.read<RawPool[]>(
        {
          address: config.sugar,
          abi: sugarAbi,
          functionName: "all",
          args: [15n, BigInt(offset), HORIZON, 0],
        },
        block.number,
      );
      for (const p of page) {
        for (const key of [
          "lp",
          "token0",
          "token1",
          "gauge",
          "rewardsManager",
        ] as const)
          p[key] = (p[key] as string).toLowerCase();
        all.push(p);
      }
    }
    // Preserve only pools with a real rewards manager; LP-only pools are not allocator opportunities.
    const pools = all.filter(
      (p) => p.rewardsManager !== zero && p.gauge !== zero,
    );
    const addresses = [
      ...new Set([
        ...all.flatMap((p) => [p.token0, p.token1]),
        config.aero,
        config.stable,
      ]),
    ];
    const tokenMap = new Map<string, Token>();
    const loadTokens = async (addrs: string[]) => {
      for (let i = 0; i < addrs.length; i += 60) {
        const rows = await rpc.read<
          { tokenAddress: string; symbol: string; decimals: number }[]
        >(
          {
            address: config.sugar,
            abi: sugarAbi,
            functionName: "tokens",
            args: [
              BigInt(addrs.slice(i, i + 60).length),
              0n,
              0,
              addrs.slice(i, i + 60),
            ],
          },
          block.number,
        );
        for (const t of rows)
          if (Number(t.decimals) <= 36)
            tokenMap.set(t.tokenAddress.toLowerCase(), {
              address: t.tokenAddress.toLowerCase(),
              symbol: t.symbol,
              decimals: Number(t.decimals),
            });
      }
    };
    await loadTokens(addresses);
    const anchor = tokenMap.get(config.stable);
    if (!anchor || anchor.decimals !== config.stableDecimals)
      throw new Error(
        "Configured dollar anchor metadata unavailable or changed",
      );
    const prices = derivePrices(all, tokenMap, config.stable);
    const specs: Read[] = pools.flatMap((p) =>
      ["totalSupply", "incentiveCount", "feeRewardPerVotingPower"].map(
        (functionName) => ({
          address: p.rewardsManager,
          abi: vrmAbi,
          functionName,
        }),
      ),
    );
    const values = await rpc.batch(specs, block.number);
    type RawProgram = {
      token: string;
      amount: bigint;
      rate: bigint;
      start: number;
      end: number;
      creator: string;
    };
    const programs = new Map<string, RawProgram[] | null>();
    const req: Read[] = [],
      owners: { address: string; offset: number }[] = [];
    for (let i = 0; i < pools.length; i++) {
      const n = values[i * 3 + 1] === null ? null : Number(values[i * 3 + 1]);
      if (n === null || n > 5000) {
        programs.set(pools[i].lp, null);
        continue;
      }
      programs.set(pools[i].lp, []);
      for (let j = 0; j < n; j += 50) {
        req.push({
          address: pools[i].rewardsManager,
          abi: vrmAbi,
          functionName: "incentives",
          args: [
            Array.from({ length: Math.min(50, n - j) }, (_, k) =>
              BigInt(j + k + 1),
            ),
          ],
        });
        owners.push({ address: pools[i].lp, offset: j });
      }
    }
    const programResults = await rpc.batch(req, block.number);
    const idMap = new Map<string, string[]>();
    programResults.forEach((v, i) => {
      const o = owners[i];
      if (v === null) {
        programs.set(o.address, null);
        return;
      }
      if (programs.get(o.address) === null) return;
      const list = v as RawProgram[];
      programs.get(o.address)!.push(...list);
      idMap.set(o.address, [
        ...(idMap.get(o.address) ?? []),
        ...list.map((_, j) => String(o.offset + j + 1)),
      ]);
    });
    const missing = [
      ...new Set(
        [...programs.values()]
          .flatMap((v) => v ?? [])
          .map((p) => p.token.toLowerCase()),
      ),
    ].filter((t) => !tokenMap.has(t));
    await loadTokens(missing);
    const cooldown = await rpc
      .read<bigint>(
        {
          address: config.leafVoter,
          abi: cooldownAbi,
          functionName: "allocationCooldown",
        },
        block.number,
      )
      .catch(() => null);
    const usd = (raw: bigint, token: Token | undefined) =>
      raw === 0n
        ? 0
        : !token || prices[token.address] === undefined
          ? null
          : finite(units(raw, token.decimals) * prices[token.address].usd);
    const snapshots: Snapshot[] = [];
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i],
        t0 = tokenMap.get(p.token0),
        t1 = tokenMap.get(p.token1);
      if (!t0 || !t1) continue;
      const warnings: string[] = [
        `USD values use local spot estimates anchored to ${anchor.symbol} = $1 on ${config.name}; no oracle guarantee.`,
        "Eligible fees approximate past eligibility using the current staked-liquidity fraction.",
      ];
      const allocation =
        values[i * 3] === null
          ? null
          : finite(units(values[i * 3] as bigint, 18));
      const progs = programs.get(p.lp);
      let parsed: Program[] | null =
        progs === null
          ? null
          : (progs ?? [])
              .map((x, j): Program | null => {
                const token = tokenMap.get(x.token.toLowerCase());
                if (!token) return null;
                return {
                  id: idMap.get(p.lp)?.[j] ?? String(j + 1),
                  token,
                  rateRaw: x.rate.toString(),
                  start: Number(x.start),
                  end: Number(x.end),
                  priceUsd: prices[token.address]?.usd ?? null,
                };
              })
              .filter((p): p is Program => p !== null);
      if (parsed !== null && parsed.length !== (progs ?? []).length)
        parsed = null;
      const staked =
        p.liquidity > 0n ? Number(p.gaugeLiquidity) / Number(p.liquidity) : 0;
      const gross = sumKnown([usd(p.windowFee0, t0), usd(p.windowFee1, t1)]);
      const windowValid =
        p.windowStart > 0 &&
        p.windowEnd >= p.windowStart &&
        p.windowEnd <= at + 60;
      const eligible =
        !windowValid || gross === null || staked > 1.000001
          ? null
          : gross * staked;
      const inc = incentives(parsed, at, at + HORIZON),
        rewards = sumKnown([eligible, inc]);
      if (!windowValid) warnings.push("Source activity window unavailable.");
      if (p.windowEnd - p.windowStart < 47 * 3600)
        warnings.push(
          "Fee window contains less than 47 hours; launch data is not annualized into missing history.",
        );
      if (allocation === null)
        warnings.push("Reward allocation supply read failed.");
      if (inc === null)
        warnings.push(
          "Incentive schedule or token USD price unavailable; reward total withheld.",
        );
      if (!p.gaugeAlive)
        warnings.push(
          "Gauge inactive: excluded from opportunity ranking and simulation.",
        );
      const feeAcc = values[i * 3 + 2] as bigint[] | null;
      const aeroPrice = prices[config.aero]?.usd ?? null;
      const rawPrices = Object.fromEntries(
        [
          t0.address,
          t1.address,
          config.aero,
          ...(parsed ?? []).map((p) => p.token.address),
        ]
          .filter((a) => prices[a])
          .map((a) => [a, prices[a]]),
      );
      snapshots.push({
        id: poolId(config.id, p.lp),
        chainId: config.id,
        chain: config.name,
        address: p.lp,
        gauge: p.gauge,
        rewardsManager: p.rewardsManager,
        token0: t0,
        token1: t1,
        poolType: Number(p.poolType),
        feeRaw: Number(p.poolFee),
        active: p.gaugeAlive,
        observedAt: at,
        retrievedAt,
        block: block.number.toString(),
        blockHash: block.hash!,
        mode: "live",
        windowStart: Number(p.windowStart),
        windowEnd: Number(p.windowEnd),
        createdAt: Number(p.createdAt),
        cooldownHours: cooldown === null ? null : Number(cooldown) / 3600,
        allocation,
        tvlUsd: sumKnown([usd(p.reserve0, t0), usd(p.reserve1, t1)]),
        volume48hUsd: !windowValid
          ? null
          : sumKnown([usd(p.windowVolume0, t0), usd(p.windowVolume1, t1)]) ===
              null
            ? null
            : (usd(p.windowVolume0, t0)! + usd(p.windowVolume1, t1)!) / 2,
        grossFees48hUsd: windowValid ? gross : null,
        eligibleFees48hUsd: eligible,
        incentives48hUsd: inc,
        rewards48hUsd: rewards,
        stakeApr: annualized(
          rewards,
          allocation === null || aeroPrice === null
            ? null
            : allocation * aeroPrice,
        ),
        aeroPriceUsd: aeroPrice,
        stakedFraction: finite(staked),
        programs: parsed,
        prices: rawPrices,
        feeAccumulator0: feeAcc?.[0]?.toString() ?? null,
        feeAccumulator1: feeAcc?.[1]?.toString() ?? null,
        warnings,
        raw: jsonSafe(p),
      });
    }
    const check = await rpc.retry(() =>
      rpc.client.getBlock({ blockNumber: block.number }),
    );
    if (check.hash !== block.hash)
      throw new Error(
        "Source block reorganized during collection; retry next run",
      );
    return {
      snapshots,
      registryCount: count,
      warnings:
        snapshots.length < pools.length
          ? ["Some pool token metadata unavailable; those pools were skipped."]
          : [],
    };
  }
}
export const asAbi = (a: Abi) => a;
