import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationEarnings,
  compareEarnings,
} from "../src/analysis/earnings.js";
import { forecast } from "../src/analysis/forecast.js";
import { demoSnapshot } from "../server/demo.js";
import type { MarketRow } from "../src/shared/types.js";
const t = 1792656000;
function row(allocation = 1000, fees = 100): MarketRow {
  const snapshot = {
    ...demoSnapshot(t),
    allocation,
    programs: [],
    eligibleFees48hUsd: fees,
  };
  return {
    snapshot,
    forecast: forecast(snapshot, [snapshot]),
    aprChange: null,
    allocationChange: null,
  };
}
test("reference earnings match frozen forecasts and are nonlinear in allocation size", () => {
  const r = row();
  assert.equal(
    allocationEarnings(r, 1000).earnings,
    r.forecast.expectedPer1000,
  );
  assert.equal(allocationEarnings(r, 1000).stress, r.forecast.stressedPer1000);
  assert.equal(allocationEarnings(r, 2000).earnings, (2000 / 3000) * 100);
  const smallPool = row(100, 20),
    largePool = row(10000, 500);
  assert.ok(
    allocationEarnings(smallPool, 10).earnings! >
      allocationEarnings(largePool, 10).earnings!,
  );
  assert.ok(
    allocationEarnings(smallPool, 10000).earnings! <
      allocationEarnings(largePool, 10000).earnings!,
  );
});
test("existing power is removed before forecast growth and intended allocation", () => {
  const r = row();
  r.forecast.projectedAllocation = 2000;
  r.forecast.projectedIncentives = 50;
  r.forecast.basis = "history";
  const e = allocationEarnings(r, 300, 200);
  assert.equal(e.earnings, (300 / (800 * 2 + 300)) * 150);
  assert.equal(e.stress, (300 / (800 * 2 * 1.5 + 300)) * 100);
  assert.equal(e.earnings, e.fees! + e.incentives!);
});
test("partial windows, stale, missing, inactive and invalid inputs do not rank", () => {
  const r = row();
  r.snapshot.windowStart = t - 12 * 3600;
  assert.equal(allocationEarnings(r, 1000).basis, "partial");
  assert.equal(allocationEarnings(r, 1000).earnings, null);
  r.snapshot.windowStart = t - 48 * 3600;
  r.snapshot.mode = "live";
  assert.equal(allocationEarnings(r, 1000, 0, t + 76 * 60).earnings, null);
  r.snapshot.mode = "demo";
  for (const power of [0, -1, NaN, Infinity])
    assert.equal(allocationEarnings(r, power).earnings, null);
  assert.equal(allocationEarnings(r, 1000, 1001).earnings, null);
  r.forecast.projectedFees = null;
  assert.equal(allocationEarnings(r, 1000).earnings, null);
  r.snapshot.active = false;
  assert.equal(allocationEarnings(r, 1000).basis, "unavailable");
});
test("zero competition and zero revenue are valid; stress retains scheduled incentives", () => {
  const r = row(0, 0);
  assert.equal(allocationEarnings(r, 1000).earnings, 0);
  r.forecast.projectedIncentives = 50;
  assert.equal(allocationEarnings(r, 1000).earnings, 50);
  assert.equal(allocationEarnings(r, 1000).stress, 50);
});
test("sorting separates evidence cohorts and keeps unavailable values last", () => {
  const baseline = allocationEarnings(row(), 1000);
  const history = { ...baseline, basis: "history" as const, earnings: 1 };
  const partial = { ...baseline, basis: "partial" as const, earnings: null };
  for (const descending of [true, false]) {
    assert.ok(compareEarnings(history, baseline, "earnings", descending) < 0);
    assert.ok(compareEarnings(baseline, partial, "earnings", descending) < 0);
  }
});
