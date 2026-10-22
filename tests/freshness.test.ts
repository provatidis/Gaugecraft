import test from "node:test";
import assert from "node:assert/strict";
import { dataHealth, isFresh } from "../src/analysis/freshness.js";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import type { MarketRow, Run } from "../src/shared/types.js";
const now = 1792656000;
function row(chainId: number, age: number): MarketRow {
  const snapshot = {
    ...demoSnapshot(now - age),
    chainId,
    mode: "live" as const,
  };
  return {
    snapshot,
    forecast: forecast(snapshot, []),
    aprChange: null,
    allocationChange: null,
  };
}
test("a fresh network cannot hide old observations or an entirely missing network", () => {
  const health = dataHealth(
    [row(8453, 30), row(10, 4800)],
    [8453, 10, 1],
    [],
    "live",
    now,
  );
  assert.equal(health.currentNetworks, 1);
  assert.equal(health.stalePools, 1);
  assert.equal(health.newest, now - 30);
  assert.equal(health.oldest, now - 4800);
  assert.equal(health.networks[2].retrievedAt, null);
});
test("network health uses every retained pool and the latest collection result", () => {
  const run = {
    id: 1,
    startedAt: now - 60,
    finishedAt: now - 50,
    chainId: 8453,
    mode: "live",
    status: "error",
    poolCount: 0,
    error: "Public RPC unavailable",
  } as Run;
  const health = dataHealth(
    [row(8453, 10), row(8453, 4800)],
    [8453],
    [
      run,
      { ...run, id: 2, startedAt: now - 10, status: "success", error: null },
    ],
    "live",
    now,
  );
  assert.equal(health.currentNetworks, 0);
  assert.equal(health.issues, 0);
  assert.equal(health.networks[0].run?.status, "success");
  assert.equal(
    dataHealth([row(8453, 10)], [8453], [run], "live", now).issues,
    1,
  );
});
test("freshness respects the threshold and keeps synthetic fixtures explicit", () => {
  assert.equal(isFresh(row(8453, 4500).snapshot, now), true);
  assert.equal(isFresh(row(8453, 4501).snapshot, now), false);
  assert.equal(isFresh(demoSnapshot(now - 7 * 86400), now), true);
  assert.equal(dataHealth([], [8453], [], "live", now).newest, null);
});
