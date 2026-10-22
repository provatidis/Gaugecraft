import type { DatabaseSync } from "node:sqlite";
import type { Forecast, Snapshot } from "../src/shared/types.js";
import { decode, digest, encode } from "./storage-codec.js";

export const STORAGE_VERSION = 3;
export function version(db: DatabaseSync) {
  return Number(db.prepare("PRAGMA user_version").get()!.user_version);
}
const schema = `
CREATE TABLE raw_evidence(hash TEXT PRIMARY KEY, body BLOB NOT NULL);
CREATE TABLE snapshots(mode TEXT NOT NULL,pool_id TEXT NOT NULL,bucket INTEGER NOT NULL,at INTEGER NOT NULL,chain_id INTEGER NOT NULL,block TEXT NOT NULL,body BLOB NOT NULL,input_hash TEXT NOT NULL UNIQUE,raw_hash TEXT NOT NULL REFERENCES raw_evidence(hash),PRIMARY KEY(mode,pool_id,bucket));
CREATE INDEX snapshot_history ON snapshots(mode,pool_id,at);
CREATE INDEX snapshot_export ON snapshots(mode,at,pool_id);
CREATE TABLE forecasts(id TEXT PRIMARY KEY,mode TEXT NOT NULL,pool_id TEXT NOT NULL,made_at INTEGER NOT NULL,due_at INTEGER NOT NULL,body BLOB NOT NULL,input_hash TEXT NOT NULL REFERENCES snapshots(input_hash));
CREATE INDEX forecast_dates ON forecasts(mode,made_at,due_at);
CREATE INDEX forecast_pool ON forecasts(mode,pool_id,made_at);
CREATE INDEX forecast_due ON forecasts(mode,due_at,made_at);
`;
const operational = `
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,startedAt INTEGER NOT NULL,finishedAt INTEGER,chainId INTEGER NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,poolCount INTEGER NOT NULL DEFAULT 0,error TEXT);
CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY,until INTEGER NOT NULL,owner TEXT,pid INTEGER);
CREATE TABLE IF NOT EXISTS decisions(mode TEXT NOT NULL,bucket INTEGER NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(mode,bucket));
`;

export function initialize(db: DatabaseSync) {
  const v = version(db);
  if (v === STORAGE_VERSION) return;
  if (
    v !== 0 ||
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()
  )
    throw new Error(
      `Storage version ${v} needs an offline migration. Run pnpm storage:migrate SOURCE DESTINATION; keep the source as a rollback copy.`,
    );
  db.exec(
    `BEGIN IMMEDIATE; ${schema} ${operational} PRAGMA user_version=3; COMMIT;`,
  );
}

// Run only on a consistent backup, with no app/collector connected. DDL and all
// record transformations commit together; a bad reference leaves v2 unchanged.
export function migrateSchema(db: DatabaseSync) {
  const v = version(db);
  if (v === STORAGE_VERSION) return false;
  if (v !== 2) throw new Error(`Unsupported migration source version ${v}`);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`DROP INDEX snapshot_history; DROP INDEX forecast_dates;
      ALTER TABLE snapshots RENAME TO old_snapshots;
      ALTER TABLE forecasts RENAME TO old_forecasts;
      ${schema} ${operational}`);
    const raw = db.prepare("INSERT OR IGNORE INTO raw_evidence VALUES(?,?)");
    const insert = db.prepare(
      "INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?)",
    );
    for (const r of db
      .prepare("SELECT * FROM old_snapshots ORDER BY mode,pool_id,bucket")
      .iterate()) {
      const s = decode<Snapshot>(r.body);
      const { raw: evidence, ...metrics } = s;
      const rawHash = digest(evidence);
      raw.run(rawHash, encode(evidence));
      insert.run(
        r.mode,
        r.pool_id,
        r.bucket,
        r.at,
        r.chain_id,
        r.block,
        encode(metrics),
        digest(s),
        rawHash,
      );
    }
    const input = db.prepare(
      "SELECT 1 FROM snapshots WHERE input_hash=? AND mode=? AND pool_id=?",
    );
    const save = db.prepare("INSERT INTO forecasts VALUES(?,?,?,?,?,?,?)");
    for (const r of db
      .prepare("SELECT * FROM old_forecasts ORDER BY id")
      .iterate()) {
      const f = decode<Forecast>(r.body);
      const hash = digest(f.input);
      if (!input.get(hash, f.mode, f.poolId))
        throw new Error(
          `Forecast ${f.id} does not match an immutable observation; migration aborted`,
        );
      const { input: _input, ...result } = f;
      save.run(
        r.id,
        r.mode,
        r.pool_id,
        r.made_at,
        r.due_at,
        encode(result),
        hash,
      );
    }
    if (db.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Migration reference check failed");
    db.exec(
      "DROP TABLE old_forecasts; DROP TABLE old_snapshots; PRAGMA user_version=3; COMMIT;",
    );
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
