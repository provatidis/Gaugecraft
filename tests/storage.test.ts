import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { createServer, get as httpGet } from "node:http";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.js";
import { demoSnapshot } from "../server/demo.js";
import { forecast } from "../src/analysis/forecast.js";
import {
  createBackup,
  restoreBackup,
  fingerprint,
  migrateDatabase,
  fileDigest,
} from "../server/storage-maintenance.js";
import {
  backupToObjects,
  restoreFromObjects,
  type ObjectStorage,
} from "../server/object-backup.js";
import { handler } from "../server/http.js";
import { csvLines, toCsv } from "../server/csv.js";
const t = 1792656000;
function legacy(path: string, mismatched = false) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE snapshots(mode TEXT,pool_id TEXT,bucket INTEGER,at INTEGER,chain_id INTEGER,block TEXT,body TEXT,PRIMARY KEY(mode,pool_id,bucket));
    CREATE INDEX snapshot_history ON snapshots(mode,pool_id,at);
    CREATE TABLE forecasts(id TEXT PRIMARY KEY,mode TEXT,pool_id TEXT,made_at INTEGER,due_at INTEGER,body TEXT);
    CREATE INDEX forecast_dates ON forecasts(mode,made_at,due_at);
    CREATE TABLE runs(id INTEGER PRIMARY KEY,startedAt INTEGER,finishedAt INTEGER,chainId INTEGER,mode TEXT,status TEXT,poolCount INTEGER,error TEXT);
    CREATE TABLE decisions(mode TEXT,bucket INTEGER,at INTEGER,body TEXT,PRIMARY KEY(mode,bucket));
    CREATE TABLE leases(name TEXT PRIMARY KEY,until INTEGER,owner TEXT,pid INTEGER);
    PRAGMA user_version=2;`);
  for (const mode of ["live", "demo"] as const) {
    const s = {
      ...demoSnapshot(t),
      mode,
      raw: {
        exact: "12345678901234567890",
        unicode: "Ελλάδα",
        source: [null, 0, false],
      },
    };
    const f = forecast(s, [s]);
    if (mismatched) f.input = { ...s, allocation: 1 };
    db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?)").run(
      mode,
      s.id,
      Math.floor(t / 1800),
      t,
      s.chainId,
      s.block,
      JSON.stringify(s),
    );
    db.prepare("INSERT INTO forecasts VALUES(?,?,?,?,?,?)").run(
      f.id,
      mode,
      s.id,
      f.madeAt,
      f.dueAt,
      JSON.stringify(f),
    );
  }
  db.prepare("INSERT INTO decisions VALUES(?,?,?,?)").run(
    "live",
    1,
    t,
    JSON.stringify({ highestApr: "frozen choice" }),
  );
  db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)").run(
    1,
    t,
    t + 5,
    8453,
    "live",
    "success",
    1,
    null,
  );
  db.close();
}

test("offline migration preserves every logical record and refuses to overwrite its source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-migration-"));
  try {
    const old = join(dir, "old.sqlite"),
      next = join(dir, "next.sqlite");
    legacy(old);
    const before = fingerprint(old),
      hash = await fileDigest(old);
    assert.throws(() => new Store(old), /offline migration/);
    await migrateDatabase(old, next);
    assert.deepEqual(fingerprint(next), before);
    assert.equal(await fileDigest(old), hash);
    const db = new Store(next);
    const data = db.db
      .prepare("SELECT body,input_hash FROM forecasts LIMIT 1")
      .get()!;
    assert.equal(
      JSON.parse(gunzipSync(data.body as Uint8Array).toString()).input,
      undefined,
    );
    assert.equal(
      db.forecasts("live")[0].input.raw.exact,
      "12345678901234567890",
    );
    assert.equal(db.ingest([demoSnapshot(t)]), 0);
    db.close();
    await assert.rejects(migrateDatabase(old, next), /already exists/);
    await assert.rejects(migrateDatabase(old, old), /already exists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a mismatched frozen input aborts migration without installing a partial destination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-abort-"));
  try {
    const old = join(dir, "old.sqlite"),
      next = join(dir, "next.sqlite");
    legacy(old, true);
    const before = await fileDigest(old);
    await assert.rejects(migrateDatabase(old, next), /does not match/);
    await assert.rejects(access(next));
    assert.equal(await fileDigest(old), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("streamed backup restores exact records and rejects corruption and existing destinations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-backup-"));
  try {
    const source = join(dir, "source.sqlite"),
      archive = join(dir, "backup.gz"),
      restored = join(dir, "restore.sqlite");
    const db = new Store(source);
    db.ingest([demoSnapshot(t)]);
    db.close();
    await createBackup(source, archive);
    await restoreBackup(archive, restored);
    assert.deepEqual(fingerprint(restored), fingerprint(source));
    await assert.rejects(restoreBackup(archive, source), /already exists/);
    await writeFile(archive, Buffer.from("truncated"));
    await assert.rejects(
      restoreBackup(archive, join(dir, "bad.sqlite")),
      /checksum or size/,
    );
    await assert.rejects(access(join(dir, "bad.sqlite")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("external backups publish their manifest only after verified read-back and restore completely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-objects-"));
  try {
    const source = join(dir, "source.sqlite");
    const db = new Store(source);
    db.ingest([
      { ...demoSnapshot(Math.floor(Date.now() / 1000)), mode: "live" },
    ]);
    db.close();
    const objects = new Map<string, Buffer>();
    const storage: ObjectStorage = {
      async put(key, file) {
        objects.set(key, await readFile(file));
      },
      async read(key) {
        if (!objects.has(key)) throw new Error("missing");
        return (async function* () {
          yield objects.get(key)!;
        })();
      },
    };
    const saved = await backupToObjects(source, storage);
    assert.equal([...objects.keys()].at(-1), `${saved.key}/manifest.json`);
    assert.equal(saved.evidence.records, 1);
    const evidence = JSON.parse(
      gunzipSync(objects.get(`${saved.key}/evidence.ndjson.gz`)!).toString(),
    );
    assert.equal(evidence.raw.fixture, true);
    const restored = join(dir, "restored.sqlite");
    await restoreFromObjects(saved.key, restored, storage);
    assert.deepEqual(fingerprint(restored), fingerprint(source));
    const failed = new Map<string, Buffer>();
    const corrupt: ObjectStorage = {
      async put(key, file) {
        failed.set(key, await readFile(file));
      },
      async read() {
        return (async function* () {
          yield Buffer.from("corrupt");
        })();
      },
    };
    await assert.rejects(
      backupToObjects(source, corrupt),
      /verification failed/,
    );
    assert.equal(
      [...failed.keys()].some((k) => k.endsWith("manifest.json")),
      false,
    );
    assert.deepEqual(fingerprint(restored), fingerprint(source));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CSV rows are generated lazily and retain the existing export format", () => {
  let read = 0;
  function* rows() {
    for (let i = 0; i < 3; i++) {
      read++;
      yield demoSnapshot(t + i * 1800);
    }
  }
  const stream = csvLines(rows());
  stream.next();
  assert.equal(read, 0);
  stream.next();
  assert.equal(read, 1);
  assert.equal(
    [...csvLines([demoSnapshot(t)])].join(""),
    toCsv([demoSnapshot(t)]),
  );
});
test("hosted API remains read-only, distinguishes liveness from stale data, and streams bounded history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-http-"));
  const path = join(dir, "db.sqlite"),
    db = new Store(path);
  db.ingest([
    { ...demoSnapshot(t), mode: "live" },
    { ...demoSnapshot(t - 31 * 86400), mode: "live" },
  ]);
  const server = createServer(
    handler(db, {
      hosts: ["127.0.0.1"],
      origins: ["https://provatidis.com"],
      collectorEnabled: false,
      database: path,
      now: () => t + 76 * 60,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${root}/health/live`)).status, 200);
    assert.equal((await fetch(`${root}/health/data`)).status, 503);
    assert.equal(
      (await fetch(`${root}/api/state`, { method: "POST" })).status,
      405,
    );
    const rejectedHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        httpGet(
          `${root}/api/state`,
          { headers: { Host: "untrusted.test" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(rejectedHost, 403);
    const state = await fetch(`${root}/api/state`, {
      headers: { Origin: "https://provatidis.com" },
    });
    assert.equal(
      state.headers.get("access-control-allow-origin"),
      "https://provatidis.com",
    );
    assert.equal((await state.json()).collectionKind, "persistent-service");
    assert.equal(
      (await fetch(`${root}/api/export.csv`)).headers.get("content-type"),
      "text/csv; charset=utf-8",
    );
    const csv = await (await fetch(`${root}/api/export.csv`)).text();
    assert.equal(csv.trim().split("\n").length, 2);
    assert.equal((await fetch(`${root}/api/history?pool=bad`)).status, 400);
    const history = await (
      await fetch(`${root}/api/history?pool=${demoSnapshot(t).id}`)
    ).json();
    assert.equal(history.length, 1);
    assert.equal(history[0].raw, undefined);
    assert.equal(
      (
        await fetch(`${root}/api/state`, {
          headers: { Origin: "https://untrusted.test" },
        })
      ).headers.get("access-control-allow-origin"),
      null,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
