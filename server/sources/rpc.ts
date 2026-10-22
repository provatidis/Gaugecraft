import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  type Abi,
  type Address,
} from "viem";
import { setTimeout as delay } from "node:timers/promises";
export interface Read {
  address: string;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])",
]);
export class Rpc {
  client: ReturnType<typeof createPublicClient>;
  private last = 0;
  constructor(
    url: string,
    private interval = 200,
  ) {
    this.client = createPublicClient({
      transport: http(url, { timeout: 20000, retryCount: 0 }),
    });
  }
  async retry<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(Math.max(0, this.interval - (Date.now() - this.last)));
      this.last = Date.now();
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (attempt < 2) await delay(600 * 2 ** attempt + Math.random() * 200);
      }
    }
    throw last;
  }
  async read<T = unknown>(q: Read, block: bigint): Promise<T> {
    return this.retry(() =>
      this.client.readContract({
        ...q,
        address: q.address as Address,
        blockNumber: block,
      } as never),
    ) as Promise<T>;
  }
  async batch(queries: Read[], block: bigint): Promise<(unknown | null)[]> {
    const all: (unknown | null)[] = [];
    for (let i = 0; i < queries.length; i += 60) {
      const chunk = queries.slice(i, i + 60);
      const calls = chunk.map((q) => ({
        target: q.address as Address,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: q.abi,
          functionName: q.functionName,
          args: q.args,
        }),
      }));
      const result = await this.read<
        readonly { success: boolean; returnData: `0x${string}` }[]
      >(
        {
          address: "0xca11bde05977b3631167028862be2a173976ca11",
          abi: multicallAbi,
          functionName: "aggregate3",
          args: [calls],
        },
        block,
      );
      all.push(
        ...result.map((r, j) => {
          if (!r.success) return null;
          try {
            return decodeFunctionResult({
              abi: chunk[j].abi,
              functionName: chunk[j].functionName,
              data: r.returnData,
            });
          } catch {
            return null;
          }
        }),
      );
    }
    return all;
  }
}
