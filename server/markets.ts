import type { MarketRow, Mode } from "../src/shared/types.js";
import { forecast } from "../src/analysis/forecast.js";
import { percentChange } from "../src/analysis/math.js";
import type { Store } from "./store.js";

export function markets(store: Store, mode: Mode): MarketRow[] {
  const saved = store.latestForecasts(mode);
  return store.latest(mode).map((snapshot) => {
    const prior = store.latestInWindow(
      mode,
      snapshot.id,
      snapshot.observedAt - 48 * 3600,
      snapshot.observedAt - 6 * 3600,
    );
    const stored = saved.get(snapshot.id);
    // Disabling forecast storage must not attach an old prediction to new inputs.
    // A current view may be computed on demand without rewriting the frozen ledger.
    const current =
      stored?.input.observedAt === snapshot.observedAt &&
      stored.input.retrievedAt === snapshot.retrievedAt &&
      stored.input.blockHash === snapshot.blockHash
        ? stored
        : forecast(
            snapshot,
            store.history(
              mode,
              snapshot.id,
              snapshot.observedAt - 48 * 3600,
              snapshot.observedAt,
            ),
          );
    return {
      snapshot: { ...snapshot, raw: {} },
      forecast: { ...current, input: { ...current.input, raw: {} } },
      aprChange:
        snapshot.stakeApr === null || prior?.stakeApr == null
          ? null
          : snapshot.stakeApr - prior.stakeApr,
      allocationChange: percentChange(
        snapshot.allocation,
        prior?.allocation ?? null,
      ),
    };
  });
}
