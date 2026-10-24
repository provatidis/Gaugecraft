import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { demoSnapshot } from "../server/demo.js";
import { createBackup, fingerprint } from "../server/storage-maintenance.js";
import {
  downloadReleaseDatabase,
  backupReleaseToR2,
  recoverySummary,
} from "../server/release-backup.js";
import type { ObjectStorage } from "../server/object-backup.js";

async function sourceFixture(dir: string) {
  const source = join(dir, "fixture.sqlite");
  const db = new Store(source);
  const time = Math.floor(Date.now() / 1800000) * 1800;
  const observation = demoSnapshot(time);
  db.ingest([{ ...observation, mode: "live" }, observation]);
  const run = db.startRun(observation.chainId, "live", time);
  db.finishRun(run, "success", 1, null, time + 1);
  db.close();
  const records = fingerprint(source);
  const archive = join(dir, "source.gz");
  const manifest = await createBackup(source, archive);
  const bytes = await readFile(archive);
  const asset = {
    id: 22,
    name: "gaugecraft-22-1.sqlite.gz",
    size: bytes.length,
    created_at: "2026-10-24T12:00:00Z",
    digest: `sha256:${manifest.sha256}`,
  };
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/releases/tags/collector-state"))
      return Response.json({
        assets: [
          {
            ...asset,
            id: 99,
            name: "gaugecraft-pre-v3-99-1.sqlite.gz",
            created_at: "2026-10-25T12:00:00Z",
          },
          {
            ...asset,
            id: 11,
            name: "gaugecraft-11-1.sqlite.gz",
            created_at: "2026-10-23T12:00:00Z",
          },
          asset,
        ],
      });
    if (url.endsWith("/releases/assets/22")) return new Response(bytes);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { records, asset, bytes, fetcher, requested };
}
function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage: ObjectStorage = {
    async put(key, file) {
      objects.set(key, await readFile(file));
    },
    async read(key) {
      if (!objects.has(key)) throw new Error("Missing object");
      return (async function* () {
        yield objects.get(key)!;
      })();
    },
  };
  return { objects, storage };
}

test("release backups restore the latest authoritative history and publish recovery evidence last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-release-r2-"));
  try {
    const fixture = await sourceFixture(dir);
    const { storage, objects } = memoryStorage();
    const report = await backupReleaseToR2({
      repository: "owner/repo",
      fetcher: fixture.fetcher,
      storage,
    });
    assert.equal(report.source.asset, fixture.asset.name);
    assert.equal(report.source.sha256, fixture.asset.digest.slice(7));
    assert.equal(report.restoredFromRemote, true);
    assert.equal(report.recordsMatch, true);
    assert.deepEqual(report.sourceRecords, fixture.records);
    assert.deepEqual(report.restoredRecords, fixture.records);
    assert.equal(report.sourceRecords["live.snapshots"].count, 1);
    assert.equal(report.sourceRecords["demo.forecasts"].count, 1);
    assert.equal(report.sourceRecords.runs.count, 1);
    assert.equal(
      [...objects.keys()].at(-1),
      `${report.backup.key}/recovery.json`,
    );
    assert.deepEqual(
      JSON.parse(objects.get(`${report.backup.key}/recovery.json`)!.toString()),
      report,
    );
    assert.match(
      recoverySummary(report),
      /does not establish collection freshness/,
    );
    assert.deepEqual(fixture.requested, [
      "https://api.github.com/repos/owner/repo/releases/tags/collector-state",
      "https://api.github.com/repos/owner/repo/releases/assets/22",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release backup rejection cannot silently seed history or upload an unverified source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-release-invalid-"));
  try {
    const fixture = await sourceFixture(dir);
    const { storage, objects } = memoryStorage();
    const absent = (async () => Response.json({ assets: [] })) as typeof fetch;
    await assert.rejects(
      backupReleaseToR2({ repository: "owner/repo", fetcher: absent, storage }),
      /No complete/,
    );
    const corrupted = (async (input: string | URL | Request) =>
      String(input).endsWith("/releases/assets/22")
        ? new Response("truncated")
        : fixture.fetcher(input)) as typeof fetch;
    await assert.rejects(
      backupReleaseToR2({
        repository: "owner/repo",
        fetcher: corrupted,
        storage,
      }),
      /checksum or size/,
    );
    const unverified = (async () =>
      Response.json({
        assets: [{ ...fixture.asset, digest: undefined }],
      })) as typeof fetch;
    await assert.rejects(
      backupReleaseToR2({
        repository: "owner/repo",
        fetcher: unverified,
        storage,
      }),
      /published SHA-256/,
    );
    assert.equal(objects.size, 0);
    const source = join(dir, "download.sqlite");
    await downloadReleaseDatabase(source, {
      repository: "owner/repo",
      fetcher: fixture.fetcher,
    });
    const before = fingerprint(source);
    await assert.rejects(
      downloadReleaseDatabase(source, {
        repository: "owner/repo",
        fetcher: fixture.fetcher,
      }),
      /EEXIST/,
    );
    assert.deepEqual(fingerprint(source), before);
    await assert.rejects(access(join(dir, "empty.sqlite")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a database corrupted after upload verification cannot receive a successful recovery receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gc-release-restore-"));
  try {
    const fixture = await sourceFixture(dir);
    const memory = memoryStorage();
    let databaseReads = 0;
    const storage: ObjectStorage = {
      put: memory.storage.put,
      async read(key) {
        if (key.endsWith("/database.sqlite.gz") && ++databaseReads === 2)
          return (async function* () {
            yield Buffer.from("corrupt on restore");
          })();
        return memory.storage.read(key);
      },
    };
    await assert.rejects(
      backupReleaseToR2({
        repository: "owner/repo",
        fetcher: fixture.fetcher,
        storage,
      }),
      /checksum or size/,
    );
    assert.equal(databaseReads, 2);
    assert.ok(
      [...memory.objects.keys()].some((key) => key.endsWith("/manifest.json")),
    );
    assert.equal(
      [...memory.objects.keys()].some((key) => key.endsWith("/recovery.json")),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
