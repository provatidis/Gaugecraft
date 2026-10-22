import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat, statfs } from "node:fs/promises";
import { resolve, extname, sep, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Store } from "./store.js";
import { markets } from "./markets.js";
import { performance } from "./performance.js";
import { csvLines } from "./csv.js";
import { configuredChains } from "./collector.js";
import { dataHealth } from "../src/analysis/freshness.js";
import { chartPoint } from "./pages-export.js";
import type { BackupStatus } from "./backup-scheduler.js";
import type { Mode } from "../src/shared/types.js";

export function handler(
  store: Store,
  options: {
    hosts: string[];
    origins?: string[];
    collectorEnabled: boolean;
    database: string;
    backup?: BackupStatus;
    now?: () => number;
    development?: (req: IncomingMessage, res: ServerResponse) => void;
  },
) {
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  const cache = new Map<string, { until: number; value: any }>();
  const cached = <T>(key: string, seconds: number, build: () => T): T => {
    const old = cache.get(key);
    if (old && old.until > clock()) return old.value;
    const value = build();
    cache.set(key, { until: clock() + seconds, value });
    return value;
  };
  const rows = (mode: Mode) =>
    cached(`markets:${mode}`, 30, () => markets(store, mode));
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const send = (code: number, value: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = new URL(`http://${req.headers.host ?? "invalid"}`).hostname;
      if (!options.hosts.includes(host)) {
        send(403, { error: "Host not allowed" });
        return;
      }
      const origin = req.headers.origin;
      if (origin && options.origins?.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(405, { error: "Read-only service" });
        return;
      }
      const url = new URL(req.url || "/", "http://localhost");
      const mode: Mode =
        url.searchParams.get("mode") === "demo" ? "demo" : "live";
      if (url.pathname === "/health/live") {
        send(200, { status: "up" });
        return;
      }
      if (url.pathname === "/health/data") {
        const health = dataHealth(
          rows("live"),
          configuredChains(),
          store.runs("live"),
          "live",
          clock(),
        );
        const ok =
          health.currentNetworks === health.networks.length &&
          health.issues === 0;
        send(ok ? 200 : 503, {
          status: ok ? "current" : "attention",
          newest: health.newest,
          oldest: health.oldest,
          stalePools: health.stalePools,
          currentNetworks: health.currentNetworks,
          expectedNetworks: health.networks.length,
          collectionIssues: health.issues,
        });
        return;
      }
      if (url.pathname === "/health/storage") {
        const disk = await statfs(dirname(options.database));
        const free = disk.bavail * disk.bsize,
          total = disk.blocks * disk.bsize;
        const size = (await stat(options.database)).size;
        const backup = options.backup;
        const currentBackup =
          !!backup?.lastSuccess &&
          clock() - Date.parse(backup.lastSuccess) / 1000 < 36 * 3600;
        const ok =
          free > Math.max(1024 ** 3, total * 0.15) &&
          (!backup?.enabled || (currentBackup && !backup.error));
        send(ok ? 200 : 503, {
          status: ok ? "healthy" : "attention",
          databaseBytes: size,
          freeBytes: free,
          backup: {
            enabled: backup?.enabled ?? false,
            lastSuccess: backup?.lastSuccess ?? null,
            current: currentBackup,
            running: backup?.running ?? false,
            error: backup?.error ?? null,
          },
        });
        return;
      }
      if (url.pathname === "/api/state") {
        send(200, {
          mode,
          now: clock(),
          markets: rows(mode),
          runs: store.runs(mode),
          collectorEnabled: options.collectorEnabled,
          collectionKind: "persistent-service",
          configuredChains: configuredChains(),
        });
        return;
      }
      if (url.pathname === "/api/history") {
        const id = url.searchParams.get("pool") ?? "",
          days = Math.min(
            30,
            Math.max(1, Number(url.searchParams.get("days")) || 2),
          );
        if (!/^\d+:0x[\da-f]{40}$/.test(id)) {
          send(400, { error: "Invalid pool ID" });
          return;
        }
        send(
          200,
          cached(`history:${mode}:${id}:${days}`, 30, () =>
            store
              .history(mode, id, clock() - days * 86400, clock())
              .map(chartPoint),
          ),
        );
        // Bound cache growth when public callers request many different pools/windows.
        if (cache.size > 256) cache.clear();
        return;
      }
      if (url.pathname === "/api/performance") {
        send(
          200,
          cached(`performance:${mode}`, 60, () =>
            performance(store, mode, clock()),
          ),
        );
        return;
      }
      if (url.pathname === "/api/export.csv") {
        // A separate read connection gives the streamed export a consistent SQLite view.
        const reader = new Store(options.database);
        try {
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="gaugecraft-${mode}-30d.csv"`,
            "Cache-Control": "no-store",
          });
          await pipeline(
            Readable.from(
              csvLines(
                reader.observations(mode, clock() - 30 * 86400, clock(), false),
              ),
            ),
            res,
          );
        } finally {
          reader.close();
        }
        return;
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/health/")
      ) {
        send(404, { error: "Unknown endpoint" });
        return;
      }
      if (options.development) {
        options.development(req, res);
        return;
      }
      const base = resolve("dist");
      let file = resolve(base, "." + decodeURIComponent(url.pathname));
      if (file !== base && !file.startsWith(base + sep)) {
        send(404, { error: "Not found" });
        return;
      }
      if (file === base || !extname(file)) file = resolve(base, "index.html");
      if (url.pathname === "/SOURCES.md" || url.pathname === "/PLAN.md")
        file = resolve(url.pathname.slice(1));
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("Not a file");
        res.writeHead(200, {
          "Content-Type":
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".md": "text/plain; charset=utf-8",
              } as Record<string, string>
            )[extname(file)] ?? "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": file.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        if (req.method === "HEAD") res.end();
        else await pipeline(createReadStream(file), res);
      } catch {
        if (!res.headersSent) send(404, { error: "File not found" });
      }
    } catch {
      console.error("Read-only request failed");
      if (!res.headersSent) send(500, { error: "Data request failed" });
      else res.destroy();
    }
  };
}
