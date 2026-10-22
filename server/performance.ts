import { evaluateForecast } from "../src/analysis/forecast.js";
import type { Mode } from "../src/shared/types.js";
import type { Store } from "./store.js";

export function performance(
  store: Store,
  mode: Mode,
  now = Math.floor(Date.now() / 1000),
) {
  const decisions = store.decisions(mode);
  const wanted = new Set(
    decisions.flatMap((d) => Object.values(d.choices)).filter(Boolean),
  );
  const selected = store.evaluationForecasts(
    mode,
    now,
    [...wanted].filter((id): id is string => id !== null),
  );
  const histories = new Map<string, ReturnType<Store["history"]>>();
  const bounds = new Map<string, { from: number; to: number }>();
  for (const f of selected.filter((f) => f.dueAt <= now)) {
    const old = bounds.get(f.poolId);
    bounds.set(f.poolId, {
      from: Math.min(old?.from ?? Infinity, f.madeAt - 2700),
      to: Math.max(old?.to ?? 0, Math.min(now, f.dueAt + 2700)),
    });
  }
  const evaluations = selected.map((f) => {
    if (f.dueAt > now) return evaluateForecast(f, [], now);
    if (!histories.has(f.poolId))
      histories.set(
        f.poolId,
        store
          .history(
            mode,
            f.poolId,
            bounds.get(f.poolId)!.from,
            bounds.get(f.poolId)!.to,
          )
          .map((s) => ({ ...s, raw: {} })),
      );
    return evaluateForecast(f, histories.get(f.poolId)!, now);
  });
  return {
    evaluations,
    decisions,
    scope:
      "Latest 250 pending and 500 mature forecasts, plus saved selections from the latest 100 mature collection cohorts.",
    totalStored: store.db
      .prepare("SELECT count(*) n FROM forecasts WHERE mode=?")
      .get(mode)?.n,
  };
}
