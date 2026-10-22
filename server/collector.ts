import { Store } from "./store.js";
import { AeroSource, chains, type Source } from "./sources/aero.js";
export const configuredChains = () =>
  process.env.CHAINS
    ? process.env.CHAINS.split(",").map(Number)
    : chains.map((c) => c.id);
export async function collect(
  store: Store,
  source: Source = new AeroSource(),
  ids = configuredChains(),
) {
  const now = Math.floor(Date.now() / 1000);
  if (!store.acquire(now)) return { skipped: true, runs: [] };
  const heartbeat = setInterval(
    () => store.renew(Math.floor(Date.now() / 1000)),
    60000,
  );
  heartbeat.unref();
  const runs: { chainId: number; added: number; error: string | null }[] = [];
  try {
    for (const id of ids) {
      const config = chains.find((c) => c.id === id);
      if (!config) throw new Error(`Unsupported chain: ${id}`);
      const run = store.startRun(id, "live", Math.floor(Date.now() / 1000));
      try {
        console.log(`Collecting ${config.name}…`);
        const result = await source.collect(config);
        const completed = Math.floor(Date.now() / 1000);
        for (const s of result.snapshots) s.retrievedAt = completed;
        if (result.registryCount > 0 && !result.snapshots.length)
          throw new Error(
            "Registry returned pools but no usable allocator observations",
          );
        const added = store.ingest(
          result.snapshots,
          process.env.SAVE_FORECASTS !== "0",
        );
        const partial =
          result.warnings.length > 0 ||
          result.snapshots.some(
            (s) => s.allocation === null || s.programs === null,
          );
        store.finishRun(
          run,
          partial ? "partial" : "success",
          result.snapshots.length,
          result.warnings.join(" ") || null,
        );
        runs.push({ chainId: id, added, error: null });
        console.log(
          `${config.name}: ${result.snapshots.length} allocator pools, ${added} new observations.`,
        );
      } catch (e) {
        // Do not leak provider URLs or credentials in logs or the API.
        const error =
          e instanceof Error
            ? "shortMessage" in e
              ? String(e.shortMessage)
              : e.message
            : "Source request failed";
        const safe = error
          .replace(/https?:\/\/\S+/g, "[provider]")
          .slice(0, 350);
        store.finishRun(run, "error", 0, safe);
        runs.push({ chainId: id, added: 0, error: safe });
        console.error(`${config.name}: ${safe}`);
      }
    }
    if (process.env.SAVE_FORECASTS !== "0" && runs.some((r) => !r.error))
      store.saveDecision("live", Math.floor(Date.now() / 1000));
    return { skipped: false, runs };
  } finally {
    clearInterval(heartbeat);
    store.release();
  }
}
export function scheduleCollector(store: Store) {
  let stopped = false,
    timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      await collect(store);
    } catch (e) {
      console.error("Collector:", e instanceof Error ? e.message : "failed");
    }
    if (!stopped) {
      const next = 1800000 - (Date.now() % 1800000);
      timer = setTimeout(tick, Math.max(next, 1000));
    }
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
