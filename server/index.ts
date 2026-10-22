import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Store } from "./store.js";
import { scheduleCollector, configuredChains } from "./collector.js";
import { toCsv } from "./csv.js";
import { performance } from "./performance.js";
import { markets } from "./markets.js";
import type { Mode } from "../src/shared/types.js";
const store = new Store();
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
const server = createServer(async (req, res) => {
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
    const host = req.headers.host?.split(":")[0];
    if (!host || !["localhost", "127.0.0.1", "[::1]"].includes(host)) {
      send(403, { error: "Local requests only" });
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const mode: Mode =
      url.searchParams.get("mode") === "demo" ? "demo" : "live";
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "GET") {
        send(405, { error: "Read-only API" });
        return;
      }
      if (url.pathname === "/api/state") {
        send(200, {
          mode,
          now: Math.floor(Date.now() / 1000),
          markets: markets(store, mode),
          runs: store.runs(mode),
          collectorEnabled: process.env.COLLECT !== "0",
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
        const now = Math.floor(Date.now() / 1000);
        send(
          200,
          store
            .history(mode, id, now - days * 86400, now)
            .map((s) => ({ ...s, raw: {} })),
        );
        return;
      }
      if (url.pathname === "/api/performance") {
        send(200, performance(store, mode));
        return;
      }
      if (url.pathname === "/api/export.csv") {
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="gaugecraft-${mode}.csv"`,
          "Cache-Control": "no-store",
        });
        res.end(toCsv(store.all(mode)));
        return;
      }
      send(404, { error: "Unknown endpoint" });
      return;
    }
    if (url.pathname === "/SOURCES.md" || url.pathname === "/PLAN.md") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(await readFile(resolve(url.pathname.slice(1))));
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const base = resolve("dist");
    let file = resolve(base, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + sep)) {
      file = resolve(base, "index.html");
    }
    if (!extname(file)) file = resolve(base, "index.html");
    try {
      const data = await readFile(file);
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(file)] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      send(404, { error: "File not found" });
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Request failed");
    if (!res.headersSent) send(500, { error: "Local data request failed" });
    else res.end();
  }
});
let stop = () => {};
server.listen(port, "127.0.0.1", () => {
  console.log(`Gaugecraft: http://127.0.0.1:${port}`);
  if (process.env.COLLECT !== "0") stop = scheduleCollector(store);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stop();
    server.close();
    void vite?.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
