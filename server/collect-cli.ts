import { collect, scheduleCollector } from "./collector.js";
import { Store } from "./store.js";
const store = new Store();
if (process.argv.includes("--watch")) {
  const stop = scheduleCollector(store);
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
} else {
  const result = await collect(store);
  console.log(JSON.stringify(result));
  store.close();
  if (result.runs.length && result.runs.every((r) => r.error))
    process.exitCode = 1;
}
