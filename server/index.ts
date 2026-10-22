import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { databasePath, Store } from "./store.js";
import { scheduleCollector } from "./collector.js";
import { scheduleBackups } from "./backup-scheduler.js";
import { restoreFromObjects } from "./object-backup.js";
import { handler } from "./http.js";
const path = databasePath();
try {
  await access(path);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  if (process.env.BOOTSTRAP_R2_BACKUP)
    await restoreFromObjects(process.env.BOOTSTRAP_R2_BACKUP, path);
  else if (process.env.REQUIRE_EXISTING_DB === "1")
    throw new Error(
      "Database missing. Import a verified backup before starting this hosted service.",
    );
}
const store = new Store(path);
const production = process.argv.includes("--production");
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      server: { middlewareMode: true, hmr: { host: "127.0.0.1" } },
      appType: "spa",
    });
const port = Number(process.env.PORT) || 4317;
const hosts = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.ALLOWED_HOSTS || "").split(","),
  process.env.RAILWAY_PUBLIC_DOMAIN,
].filter((h): h is string => !!h);
if (process.env.RAILWAY_ENVIRONMENT_ID) hosts.push("healthcheck.railway.app");
const backups = await scheduleBackups(path);
const server = createServer(
  handler(store, {
    hosts,
    origins: (process.env.CORS_ORIGINS || "").split(",").filter(Boolean),
    collectorEnabled: process.env.COLLECT !== "0",
    database: path,
    backup: backups.status,
    development: vite ? (req, res) => vite.middlewares(req, res) : undefined,
  }),
);
let stop = async () => {};
server.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`Gaugecraft listening on port ${port}`);
  if (process.env.COLLECT !== "0") stop = scheduleCollector(store);
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    // A forced shutdown leaves a detectable interrupted run, never a claimed success.
    const deadline = setTimeout(() => process.exit(1), 25000);
    deadline.unref();
    const drained = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    server.closeIdleConnections();
    await Promise.all([stop(), backups.stop(), drained, vite?.close()]);
    store.close();
    clearTimeout(deadline);
  });
