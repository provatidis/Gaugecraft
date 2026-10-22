import test from "node:test";
import assert from "node:assert/strict";
import {
  annualized,
  HORIZON,
  incentives,
  SCENARIOS,
  simulate,
  streamAmount,
  units,
} from "../src/analysis/math.js";
import { demoSnapshot } from "../server/demo.js";
import type { Program } from "../src/shared/types.js";
const t = 1792656000;
const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-9,
    `${actual} ≈ ${expected}`,
  );
const p: Program = {
  id: "1",
  token: {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "USD",
    decimals: 6,
  },
  rateRaw: "1000000000000000000000000",
  start: t + 3600,
  end: t + 7200,
  priceUsd: 1,
};
test("scaled incentive rate clips start/end, with six-decimal token precision", () => {
  assert.equal(streamAmount(p, t, t + HORIZON), 3600);
  assert.equal(incentives([p], t, t + HORIZON), 3600);
  assert.equal(incentives([p], t, t + 1800), 0);
  assert.equal(incentives([p], t + 7200, t + HORIZON), 0);
  assert.equal(units("1234567890123456789", 18), 1.2345678901234567);
});
test("missing active token price blocks a total; inactive unpriced stream adds zero", () => {
  assert.equal(incentives([{ ...p, priceUsd: null }], t, t + HORIZON), null);
  assert.equal(incentives([{ ...p, priceUsd: null }], t, t + 1800), 0);
  assert.equal(incentives(null, t, t + HORIZON), null);
  assert.equal(incentives([], t, t + HORIZON), 0);
});
test("APR uses explicit capital and correct 48h annualization", () => {
  assert.equal(annualized(10, 1000), 182.5);
  assert.equal(annualized(10, 0), null);
  assert.equal(annualized(10, null), null);
  assert.equal(annualized(null, 100), null);
});
test("own dilution, existing power and competitor-only shocks", () => {
  const s = { ...demoSnapshot(t), allocation: 1000, programs: [] };
  const input = {
    power: 1000,
    existingPower: 0,
    stakeValueUsd: 1000,
    remainingDays: null,
    activationDelayHours: 0,
  };
  close(simulate(s, 100, input, SCENARIOS[0]).earnings, 50);
  assert.ok(
    Math.abs(simulate(s, 100, input, SCENARIOS[3]).earnings! - 100 / 3) < 1e-10,
  );
  close(
    simulate(s, 100, { ...input, existingPower: 1000 }, SCENARIOS[0]).earnings,
    100,
  );
  close(
    simulate(s, 100, { ...input, power: 500, existingPower: 500 }, SCENARIOS[0])
      .earnings,
    50,
  );
  close(
    simulate(s, 100, { ...input, power: 250, existingPower: 500 }, SCENARIOS[0])
      .earnings,
    100 / 3,
  );
  close(simulate(s, 100, input, SCENARIOS[4]).earnings, 25);
});
test("zero competitors does not imply no revenue; zero own power earns zero", () => {
  const s = { ...demoSnapshot(t), allocation: 0, programs: [] };
  const input = {
    power: 100,
    existingPower: 0,
    stakeValueUsd: null,
    remainingDays: null,
    activationDelayHours: 0,
  };
  close(simulate(s, 100, input, SCENARIOS[0]).earnings, 100);
  assert.equal(
    simulate(s, 100, { ...input, power: 0 }, SCENARIOS[0]).earnings,
    0,
  );
});
test("activation delay, exact incentive boundaries and decaying power", () => {
  const s = { ...demoSnapshot(t), allocation: 1000, programs: [p] };
  const input = {
    power: 1000,
    existingPower: 0,
    stakeValueUsd: null,
    remainingDays: null,
    activationDelayHours: 2,
  };
  assert.equal(simulate(s, 0, input, SCENARIOS[0]).earnings, 0);
  const decaying = simulate(
    { ...s, programs: [] },
    100,
    { ...input, activationDelayHours: 0, remainingDays: 2 },
    SCENARIOS[0],
  );
  // integral over a linear decay with other power=initial own power: 1 - ln(2)
  assert.ok(Math.abs(decaying.earnings! - 100 * (1 - Math.log(2))) < 0.001);
  assert.equal(
    simulate(s, 100, { ...input, activationDelayHours: 48 }, SCENARIOS[0])
      .earnings,
    0,
  );
});
test("invalid positions and inactive gauges fail closed", () => {
  const s = demoSnapshot(t);
  const input = {
    power: -1,
    existingPower: 0,
    stakeValueUsd: null,
    remainingDays: null,
    activationDelayHours: 0,
  };
  assert.equal(simulate(s, 100, input, SCENARIOS[0]).earnings, null);
  assert.equal(
    simulate(
      s,
      100,
      { ...input, power: 100, existingPower: s.allocation! + 1 },
      SCENARIOS[0],
    ).earnings,
    null,
  );
  assert.equal(
    simulate(
      { ...s, active: false },
      100,
      { ...input, power: 100 },
      SCENARIOS[0],
    ).earnings,
    null,
  );
});
