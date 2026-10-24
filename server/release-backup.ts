import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import {
  fingerprint,
  fileDigest,
  verifyDatabase,
} from "./storage-maintenance.js";
import { STORAGE_VERSION, version } from "./storage-schema.js";
import {
  backupToObjects,
  restoreFromObjects,
  r2Storage,
  uploadVerified,
  type ObjectStorage,
} from "./object-backup.js";

type ReleaseAsset = {
  id: number;
  name: string;
  size: number;
  created_at: string;
  digest?: string;
};
type SourceOptions = {
  repository: string;
  token?: string;
  fetcher?: typeof fetch;
  onProgress?: (stage: string) => void;
};

// Read the authoritative release only. Never seed a new history or use a local collector copy.
export async function downloadReleaseDatabase(
  destination: string,
  options: SourceOptions,
) {
  const { repository, token, fetcher = fetch } = options;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository identity");
  const root = `https://api.github.com/repos/${repository}`;
  const request = async (url: string, accept: string) => {
    const response = await fetcher(url, {
      headers: {
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot read authoritative release: HTTP ${response.status}`,
      );
    return response;
  };
  const release = (await (
    await request(
      `${root}/releases/tags/collector-state`,
      "application/vnd.github+json",
    )
  ).json()) as { assets: ReleaseAsset[] };
  const asset = release.assets
    .filter(
      (a) => /^gaugecraft-\d+-\d+\.sqlite\.gz$/.test(a.name) && a.size > 0,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
  if (
    !asset ||
    !Number.isSafeInteger(asset.id) ||
    !Number.isSafeInteger(asset.size) ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")
  )
    throw new Error(
      "No complete collector backup with a published SHA-256. Refusing to create empty history.",
    );
  const compressed = `${destination}.download.gz`;
  const response = await request(
    `${root}/releases/assets/${asset.id}`,
    "application/octet-stream",
  );
  if (!response.body) throw new Error("Collector backup response has no body");
  await pipeline(
    Readable.fromWeb(response.body as any),
    createWriteStream(compressed, { flags: "wx", mode: 0o600 }),
  );
  if (
    (await stat(compressed)).size !== asset.size ||
    `sha256:${await fileDigest(compressed)}` !== asset.digest
  )
    throw new Error("Collector release checksum or size mismatch");
  await pipeline(
    createReadStream(compressed),
    createGunzip(),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  verifyDatabase(destination);
  const db = new DatabaseSync(destination, { readOnly: true });
  try {
    if (version(db) !== STORAGE_VERSION)
      throw new Error(
        "Collector storage must be migrated before enabling R2 backups",
      );
  } finally {
    db.close();
  }
  return {
    repository,
    asset: asset.name,
    assetId: asset.id,
    assetCreatedAt: asset.created_at,
    compressedBytes: asset.size,
    sha256: asset.digest.slice(7),
  };
}

export async function backupReleaseToR2(
  options: SourceOptions & { storage?: ObjectStorage },
) {
  const storage = options.storage ?? r2Storage();
  const dir = await mkdtemp(
    join(process.env.BACKUP_TEMP_DIR || tmpdir(), "gaugecraft-release-r2-"),
  );
  try {
    options.onProgress?.(
      "Downloading and validating the authoritative GitHub release",
    );
    const sourceFile = join(dir, "source.sqlite");
    const source = await downloadReleaseDatabase(sourceFile, options);
    options.onProgress?.("Fingerprinting every original research record");
    const before = fingerprint(sourceFile);
    const db = new DatabaseSync(sourceFile, { readOnly: true });
    let latest: number | null;
    try {
      latest = db
        .prepare("SELECT max(at) at FROM snapshots WHERE mode='live'")
        .get()!.at as number | null;
    } finally {
      db.close();
    }
    options.onProgress?.(
      "Uploading private R2 backup and verifying remote objects",
    );
    const saved = await backupToObjects(sourceFile, storage);
    options.onProgress?.(
      "Downloading and restoring the R2 generation into a separate database",
    );
    const restored = join(dir, "restored.sqlite");
    await restoreFromObjects(saved.key, restored, storage);
    options.onProgress?.(
      "Comparing recovered records against their original fingerprints",
    );
    const after = fingerprint(restored);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Restored research record fingerprints differ");
    const report = {
      version: 1,
      verifiedAt: new Date().toISOString(),
      source: {
        ...source,
        latestLiveObservation:
          latest === null ? null : new Date(latest * 1000).toISOString(),
      },
      backup: {
        key: saved.key,
        compressedBytes: saved.compressedBytes,
        databaseBytes: saved.databaseBytes,
        sha256: saved.sha256,
        evidenceRecords: saved.evidence.records,
      },
      restoredFromRemote: true,
      recordsMatch: true,
      sourceRecords: before,
      restoredRecords: after,
    };
    const receipt = join(dir, "recovery.json");
    await writeFile(receipt, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    await uploadVerified(storage, `${saved.key}/recovery.json`, receipt);
    return report;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function recoverySummary(
  report: Awaited<ReturnType<typeof backupReleaseToR2>>,
) {
  return [
    "## R2 backup and recovery verified",
    "",
    `Verified UTC: ${report.verifiedAt}`,
    `Source release asset: \`${report.source.asset}\``,
    `Latest live source observation: ${report.source.latestLiveObservation ?? "none"}`,
    `Private R2 generation: \`${report.backup.key}\``,
    "",
    "Every uploaded object was read back and checked. The database was downloaded from R2 into a separate file, passed SQLite integrity/reference checks, and matched every original research record fingerprint.",
    "",
    "| Records | Count |",
    "| --- | ---: |",
    ...Object.entries(report.sourceRecords).map(
      ([name, value]) => `| ${name} | ${value.count} |`,
    ),
    "",
    "Backup verification does not establish collection freshness. The source timestamps above remain unchanged. Full hashes are in the recovery report artifact and the generation's private recovery.json.",
    "",
  ].join("\n");
}
