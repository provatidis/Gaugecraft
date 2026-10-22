import type { MarketRow, Mode, Run, Snapshot } from "../shared/types.js";

export const MAX_OBSERVATION_AGE = 75 * 60;
export function isFresh(snapshot: Snapshot, now = Date.now() / 1000) {
  return (
    snapshot.mode === "demo" ||
    now - snapshot.retrievedAt <= MAX_OBSERVATION_AGE
  );
}

export function dataHealth(
  rows: MarketRow[],
  chains: number[],
  runs: Run[],
  mode: Mode,
  now = Date.now() / 1000,
) {
  const times = rows.map((r) => r.snapshot.retrievedAt);
  const latestRuns = new Map<number, Run>();
  for (const run of [...runs].sort(
    (a, b) => b.startedAt - a.startedAt || b.id - a.id,
  ))
    if (!latestRuns.has(run.chainId)) latestRuns.set(run.chainId, run);
  const networks = chains.map((id) => {
    const observations = rows.filter((r) => r.snapshot.chainId === id);
    return {
      id,
      name: observations[0]?.snapshot.chain ?? `Chain ${id}`,
      retrievedAt: observations.length
        ? Math.max(...observations.map((r) => r.snapshot.retrievedAt))
        : null,
      current:
        observations.length > 0 &&
        observations.every((r) => isFresh(r.snapshot, now)),
      run: latestRuns.get(id),
    };
  });
  return {
    newest: times.length ? Math.max(...times) : null,
    oldest: times.length ? Math.min(...times) : null,
    stalePools: rows.filter((r) => !isFresh(r.snapshot, now)).length,
    issues:
      mode === "live"
        ? networks.filter(
            (n) => n.run?.status === "error" || n.run?.status === "partial",
          ).length
        : 0,
    currentNetworks: networks.filter((n) => n.current).length,
    networks,
  };
}
