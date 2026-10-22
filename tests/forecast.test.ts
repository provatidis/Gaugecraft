import test from "node:test";
import assert from "node:assert/strict";
import { evaluateForecast, forecast } from "../src/analysis/forecast.js";
import { demoSnapshot } from "../server/demo.js";
import { HORIZON } from "../src/analysis/math.js";
const t = 1792656000;
const sample = (at: number) => ({
  ...demoSnapshot(at),
  allocation: 1000,
  eligibleFees48hUsd: 100,
  incentives48hUsd: 0,
  rewards48hUsd: 100,
  programs: [],
});
const rows = Array.from({ length: 97 }, (_, i) =>
  sample(t - HORIZON + i * 1800),
);
test("launch forecast abstains and never manufactures confidence", () => {
  const f = forecast(sample(t), [sample(t)]);
  assert.equal(f.basis, "insufficient");
  assert.equal(f.projectedRevenue, 100);
  assert.equal(f.expectedPer1000, 50);
  assert.equal(f.stressedPer1000, 20);
  assert.ok(f.signals.some((s) => s.value === "Insufficient history"));
});
test("forecast uses only information available at prediction time", () => {
  const before = forecast(sample(t), rows);
  const after = forecast(sample(t), [
    ...rows,
    { ...sample(t + 1800), eligibleFees48hUsd: 1000000 },
  ]);
  assert.deepEqual(before, after);
  assert.equal(before.basis, "history");
  const delayed = {
    ...sample(t - 1800),
    retrievedAt: t + 3600,
    eligibleFees48hUsd: 1000000,
  };
  assert.deepEqual(forecast(sample(t), [...rows, delayed]), before);
});
test("coverage gaps and short source fee windows block persistence", () => {
  assert.equal(
    forecast(
      sample(t),
      rows.filter((_, i) => i < 20 || i > 25),
    ).basis,
    "insufficient",
  );
  assert.equal(
    forecast({ ...sample(t), windowStart: t - 3600 }, rows).basis,
    "insufficient",
  );
});
test("frozen forecasts evaluate only after maturity and do not sum overlapping fees", () => {
  const f = forecast(sample(t), rows),
    future = Array.from({ length: 97 }, (_, i) => sample(t + i * 1800));
  assert.equal(evaluateForecast(f, future, t + HORIZON - 1).status, "pending");
  const e = evaluateForecast(f, future, t + HORIZON);
  assert.equal(e.status, "proxy");
  assert.equal(e.observedRevenueProxy, 100);
  assert.ok(Math.abs(e.observedReturnProxy! - 50) < 1e-9);
  assert.equal(e.revenueError, 0);
  assert.equal(e.allocationError, 0);
  assert.ok(e.returnError! < 1e-9);
});
test("incomplete mature observations do not become realized returns", () => {
  const f = forecast(sample(t), rows),
    e = evaluateForecast(f, [sample(t), sample(t + HORIZON)], t + HORIZON);
  assert.equal(e.status, "insufficient");
  assert.equal(e.observedReturnProxy, null);
  assert.equal(e.observedAllocation, 1000);
});
test("evaluation uses an actual pre-origin anchor when collection finishes after block time", () => {
  const s = { ...sample(t), retrievedAt: t + 30 },
    f = forecast(s, rows);
  const future = Array.from({ length: 98 }, (_, i) => sample(t + i * 1800));
  const e = evaluateForecast(f, future, t + HORIZON + 1800);
  assert.equal(f.madeAt, t + 30);
  assert.equal(e.status, "proxy");
  assert.ok(Math.abs(e.observedReturnProxy! - 50) < 1e-8);
});
test("a forecast with zero observed revenue has no percentage error denominator", () => {
  const f = forecast(sample(t), rows),
    future = Array.from({ length: 97 }, (_, i) => ({
      ...sample(t + i * 1800),
      eligibleFees48hUsd: 0,
    }));
  const e = evaluateForecast(f, future, t + HORIZON);
  assert.equal(e.revenuePctError, null);
  assert.equal(e.revenueError, 100);
});
