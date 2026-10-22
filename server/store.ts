import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Forecast, Mode, Run, Snapshot } from "../src/shared/types.js";
import { forecast } from "../src/analysis/forecast.js";
import { initialize } from "./storage-schema.js";
import { decode, digest, encode } from "./storage-codec.js";
export const databasePath = () =>
  resolve(process.env.GAUGECRAFT_DB || "data/gaugecraft.sqlite");
export class Store {
  db: DatabaseSync;
  private leaseOwner = randomUUID();
  constructor(path = databasePath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    try {
      initialize(this.db);
      this.db.exec("PRAGMA journal_mode=WAL");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private snapshot(row: Record<string, unknown>, includeRaw = true): Snapshot {
    const metrics = decode<Omit<Snapshot, "raw">>(row.body);
    const evidence = includeRaw
      ? this.db
          .prepare("SELECT body FROM raw_evidence WHERE hash=?")
          .get(String(row.raw_hash))
      : null;
    if (includeRaw && !evidence) throw new Error("Missing raw evidence");
    return { ...metrics, raw: evidence ? decode(evidence.body) : {} };
  }
  private prediction(row: Record<string, unknown>): Forecast {
    const result = decode<Omit<Forecast, "input">>(row.body);
    const input = this.db
      .prepare("SELECT body,raw_hash FROM snapshots WHERE input_hash=?")
      .get(String(row.input_hash));
    if (!input) throw new Error("Missing immutable forecast input");
    return { ...result, input: this.snapshot(input) };
  }

  close() {
    this.db.close();
  }
  acquire(now: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT until,pid FROM leases WHERE name=?")
        .get("collector");
      let alive = false;
      if (prior?.pid) {
        try {
          process.kill(Number(prior.pid), 0);
          alive = true;
        } catch (e) {
          alive = (e as NodeJS.ErrnoException).code === "EPERM";
        }
      }
      if (prior && Number(prior.until) >= now && alive) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db
        .prepare(
          "INSERT INTO leases(name,until,owner,pid) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET until=excluded.until,owner=excluded.owner,pid=excluded.pid",
        )
        .run("collector", now + 1200, this.leaseOwner, process.pid);
      this.db
        .prepare(
          "UPDATE runs SET status='error',finishedAt=?,error='Collector interrupted before completion; last successful observations preserved.' WHERE status='running'",
        )
        .run(now);
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  renew(now: number) {
    this.db
      .prepare("UPDATE leases SET until=? WHERE name=? AND owner=?")
      .run(now + 1200, "collector", this.leaseOwner);
  }
  release() {
    this.db
      .prepare("DELETE FROM leases WHERE name=? AND owner=?")
      .run("collector", this.leaseOwner);
  }
  startRun(chainId: number, mode: Mode, now: number) {
    return Number(
      this.db
        .prepare(
          "INSERT INTO runs(startedAt,chainId,mode,status) VALUES(?,?,?,?)",
        )
        .run(now, chainId, mode, "running").lastInsertRowid,
    );
  }
  finishRun(
    id: number,
    status: Run["status"],
    count: number,
    error: string | null,
    now = Math.floor(Date.now() / 1000),
  ) {
    this.db
      .prepare(
        "UPDATE runs SET finishedAt=?,status=?,poolCount=?,error=? WHERE id=?",
      )
      .run(now, status, count, error, id);
  }
  runs(mode: Mode): Run[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE mode=? ORDER BY id DESC LIMIT 30")
      .all(mode) as unknown as Run[];
  }
  ingest(snapshots: Snapshot[], saveForecasts = true) {
    const insert = this.db.prepare(
      "INSERT INTO snapshots(mode,pool_id,bucket,at,chain_id,block,body,input_hash,raw_hash) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    let added = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const s of snapshots) {
        if (
          !Number.isFinite(s.observedAt) ||
          s.observedAt < 0 ||
          s.retrievedAt < s.observedAt - 60
        )
          throw new Error("Invalid UTC observation time");
        if (
          !/^\d+:0x[0-9a-f]{40}$/.test(s.id) ||
          s.id !== `${s.chainId}:${s.address.toLowerCase()}`
        )
          throw new Error("Pool identity mismatch");
        if (!["live", "demo"].includes(s.mode))
          throw new Error("Invalid source mode");
        const bucket = Math.floor(s.observedAt / 1800);
        if (
          this.db
            .prepare(
              "SELECT 1 FROM snapshots WHERE mode=? AND pool_id=? AND bucket=?",
            )
            .get(s.mode, s.id, bucket)
        )
          continue;
        const hash = digest(s);
        const { raw, ...metrics } = s;
        const rawHash = digest(raw);
        this.db
          .prepare("INSERT OR IGNORE INTO raw_evidence VALUES(?,?)")
          .run(rawHash, encode(raw));
        const changes = Number(
          insert.run(
            s.mode,
            s.id,
            bucket,
            s.observedAt,
            s.chainId,
            s.block,
            encode(metrics),
            hash,
            rawHash,
          ).changes,
        );
        added += changes;
        if (changes && saveForecasts) {
          const f = forecast(
            s,
            this.history(s.mode, s.id, s.observedAt - 48 * 3600, s.observedAt),
          );
          this.db
            .prepare("INSERT OR IGNORE INTO forecasts VALUES(?,?,?,?,?,?,?)")
            .run(
              f.id,
              f.mode,
              f.poolId,
              f.madeAt,
              f.dueAt,
              encode({ ...f, input: undefined }),
              hash,
            );
        }
      }
      this.db.exec("COMMIT");
      return added;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  history(
    mode: Mode,
    id: string,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
  ): Snapshot[] {
    return this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND pool_id=? AND at>=? AND at<=? ORDER BY at",
      )
      .all(mode, id, from, to)
      .map((r) => this.snapshot(r));
  }
  latestInWindow(
    mode: Mode,
    id: string,
    from: number,
    to: number,
  ): Snapshot | undefined {
    const row = this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND pool_id=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 1",
      )
      .get(mode, id, from, to);
    return row ? this.snapshot(row) : undefined;
  }
  latest(mode: Mode): Snapshot[] {
    return this.db
      .prepare(
        "SELECT s.body,s.raw_hash FROM snapshots s JOIN (SELECT pool_id,MAX(at) AS at FROM snapshots WHERE mode=? GROUP BY pool_id) t ON s.pool_id=t.pool_id AND s.at=t.at WHERE s.mode=?",
      )
      .all(mode, mode)
      .map((r) => this.snapshot(r));
  }
  *observations(
    mode: Mode,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    includeRaw = true,
  ): Generator<Snapshot> {
    for (const row of this.db
      .prepare(
        "SELECT body,raw_hash FROM snapshots WHERE mode=? AND at>=? AND at<=? ORDER BY at,pool_id",
      )
      .iterate(mode, from, to))
      yield this.snapshot(row, includeRaw);
  }
  all(mode: Mode): Snapshot[] {
    return [...this.observations(mode)];
  }
  *frozenForecasts(mode: Mode): Generator<Forecast> {
    for (const row of this.db
      .prepare("SELECT body,input_hash FROM forecasts WHERE mode=? ORDER BY id")
      .iterate(mode))
      yield this.prediction(row);
  }
  forecasts(mode: Mode, limit = 3000): Forecast[] {
    return this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts WHERE mode=? ORDER BY made_at DESC LIMIT ?",
      )
      .all(mode, limit)
      .map((r) => this.prediction(r));
  }
  evaluationForecasts(mode: Mode, now: number, ids: string[]): Forecast[] {
    const recent = this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts WHERE mode=? AND due_at>? ORDER BY made_at DESC LIMIT 250",
      )
      .all(mode, now);
    const mature = this.db
      .prepare(
        "SELECT body,input_hash FROM forecasts WHERE mode=? AND due_at<=? ORDER BY made_at DESC LIMIT 500",
      )
      .all(mode, now);
    const selected = ids.flatMap((id) => {
      const r = this.db
        .prepare("SELECT body,input_hash FROM forecasts WHERE mode=? AND id=?")
        .get(mode, id);
      return r ? [r] : [];
    });
    const parsed = [...recent, ...mature, ...selected].map((r) =>
      this.prediction(r),
    );
    return [...new Map(parsed.map((f) => [f.id, f])).values()];
  }
  latestForecasts(mode: Mode): Map<string, Forecast> {
    const rows = this.db
      .prepare(
        "SELECT f.body,f.input_hash FROM forecasts f JOIN (SELECT pool_id,MAX(made_at) AS at FROM forecasts WHERE mode=? GROUP BY pool_id) t ON f.pool_id=t.pool_id AND f.made_at=t.at WHERE f.mode=?",
      )
      .all(mode, mode);
    return new Map(
      rows.map((r) => {
        const f = this.prediction(r);
        return [f.poolId, f];
      }),
    );
  }
  saveDecision(mode: Mode, now: number) {
    const candidates = [...this.latestForecasts(mode).values()].filter(
      (f) => f.madeAt <= now && now - f.madeAt < 3600 && f.input.active,
    );
    const choose = (
      metric: (f: Forecast) => number | null,
      filter = (f: Forecast) => f.input.active,
    ) =>
      candidates
        .filter((f) => filter(f) && metric(f) !== null)
        .sort(
          (a, b) =>
            (metric(b) ?? 0) - (metric(a) ?? 0) ||
            a.poolId.localeCompare(b.poolId),
        )[0]?.id ?? null;
    const choices = {
      persistence: choose(
        (f) => f.stressedPer1000,
        (f) => f.basis === "history",
      ),
      highestApr: choose((f) => f.input.stakeApr),
      highestRewards: choose((f) => f.input.rewards48hUsd),
      highestFees: choose((f) => f.input.eligibleFees48hUsd),
    };
    this.db
      .prepare("INSERT OR IGNORE INTO decisions VALUES(?,?,?,?)")
      .run(mode, Math.floor(now / 1800), now, JSON.stringify(choices));
  }
  decisions(mode: Mode) {
    return this.db
      .prepare(
        "SELECT at,body FROM decisions WHERE mode=? AND at<=? ORDER BY at DESC LIMIT 100",
      )
      .all(mode, Math.floor(Date.now() / 1000) - 48 * 3600)
      .map((r) => ({
        at: Number(r.at),
        choices: JSON.parse(r.body as string) as Record<string, string | null>,
      }));
  }
}
