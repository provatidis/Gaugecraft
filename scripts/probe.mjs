import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
const chains = JSON.parse(readFileSync("config/chains.json"));
for (const c of chains) {
  const client = createPublicClient({
    transport: http(c.rpc, { timeout: 12000, retryCount: 0 }),
  });
  try {
    const id = await client.getChainId();
    const block = await client.getBlock({ blockTag: "latest" });
    const count = await client.readContract({
      address: c.sugar,
      abi: parseAbi(["function count() view returns(uint256)"]),
      functionName: "count",
      blockNumber: block.number,
    });
    console.log(
      JSON.stringify({
        chain: c.name,
        id,
        block: String(block.number),
        at: new Date(Number(block.timestamp) * 1000).toISOString(),
        pools: String(count),
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({ chain: c.name, error: e.shortMessage ?? e.message }),
    );
  }
}
