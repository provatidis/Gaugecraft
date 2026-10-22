import { mkdir, writeFile, copyFile, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { markets } from "./markets.js";
import { performance } from "./performance.js";
import { configuredChains } from "./collector.js";
import { toCsv } from "./csv.js";
import type { HistoryPoint, Snapshot } from "../src/shared/types.js";

export function chartPoint(s: Snapshot): HistoryPoint {
  const {
    observedAt,
    retrievedAt,
    block,
    blockHash,
    windowStart,
    windowEnd,
    stakeApr,
    rewards48hUsd,
    allocation,
    volume48hUsd,
    eligibleFees48hUsd,
    incentives48hUsd,
  } = s;
  return {
    observedAt,
    retrievedAt,
    block,
    blockHash,
    windowStart,
    windowEnd,
    stakeApr,
    rewards48hUsd,
    allocation,
    volume48hUsd,
    eligibleFees48hUsd,
    incentives48hUsd,
  };
}

// Export one SQLite read transaction, so each deployment is a coherent observation set.
// Full records and frozen forecasts remain in SQLite; the website publishes a bounded view.
export async function exportPages(
  store: Store,
  destination: string,
  now = Math.floor(Date.now() / 1000),
) {
  store.db.exec("BEGIN");
  try {
    for (const mode of ["live", "demo"] as const) {
      const dir = join(destination, "data", mode);
      await mkdir(join(dir, "history"), { recursive: true });
      const rows = markets(store, mode);
      await writeFile(
        join(dir, "state.json"),
        JSON.stringify({
          mode,
          now,
          markets: rows,
          runs: store.runs(mode),
          collectorEnabled: true,
          collectionKind: "github-actions",
          configuredChains: configuredChains(),
        }),
      );
      await writeFile(
        join(dir, "performance.json"),
        JSON.stringify(performance(store, mode, now)),
      );
      const csv = await open(join(dir, "observations.csv"), "w");
      try {
        await csv.write(toCsv([]));
        for (const { snapshot } of rows) {
          const history = store.history(
            mode,
            snapshot.id,
            now - 30 * 86400,
            now,
          );
          await writeFile(
            join(dir, "history", `${snapshot.id.replace(":", "-")}.json`),
            JSON.stringify(history.map(chartPoint)),
          );
          if (history.length) {
            const text = toCsv(history);
            await csv.write(text.slice(text.indexOf("\n") + 1));
          }
        }
      } finally {
        await csv.close();
      }
      console.log(
        `Published ${mode}: ${rows.length} pools, up to 30 days of stored observations in that namespace.`,
      );
    }
    await copyFile("SOURCES.md", join(destination, "SOURCES.md"));
    await copyFile("PLAN.md", join(destination, "PLAN.md"));
    await writeFile(join(destination, ".nojekyll"), "");
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const store = new Store();
  try {
    await exportPages(store, resolve(process.argv[2] || "dist"));
  } finally {
    store.close();
  }
}
