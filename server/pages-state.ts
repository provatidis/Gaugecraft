import { DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, rename, unlink, stat, copyFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import {
  createBackup,
  fileDigest,
  migrateDatabase,
  verifyDatabase,
} from "./storage-maintenance.js";
import { version } from "./storage-schema.js";

import { databasePath } from "./store.js";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

// The release is durable collector storage, separate from source commits and expiring caches.
// Each backup has a unique name. Keep three complete copies; only prune after a verified upload.
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const tag = "collector-state";
const path = databasePath();
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
  throw new Error(
    "GITHUB_REPOSITORY and GITHUB_TOKEN are required for release storage.",
  );
const root = `https://api.github.com/repos/${repository}`;
type Asset = {
  id: number;
  name: string;
  size: number;
  created_at: string;
  digest?: string;
};
type Release = { id: number; upload_url: string; assets: Asset[] };
async function request(
  url: string,
  init: RequestInit & { duplex?: "half" } = {},
) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(600000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < 2 &&
      (!init.method || init.method === "GET")
    ) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    return response;
  }
}
async function release(): Promise<Release | null> {
  const response = await request(`${root}/releases/tags/${tag}`);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `Cannot read collector backup release: HTTP ${response.status}`,
    );
  return response.json();
}
function assets(r: Release) {
  return r.assets
    .filter(
      (a) => /^gaugecraft-\d+-\d+\.sqlite\.gz$/.test(a.name) && a.size > 0,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}
async function uploadBackup(r: Release, name: string, file: string) {
  const size = (await stat(file)).size;
  const checksum = await fileDigest(file);
  const response = await request(`${r.upload_url.split("{")[0]}?name=${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
    },
    body: createReadStream(file) as any,
    duplex: "half",
  });
  if (!response.ok)
    throw new Error(`Cannot upload collector backup: HTTP ${response.status}`);
  const saved = (await response.json()) as Asset;
  if (
    saved.size !== size ||
    (saved.digest && saved.digest !== `sha256:${checksum}`)
  )
    throw new Error("Uploaded collector backup failed verification");
  if (!saved.digest) {
    const check = await request(`${root}/releases/assets/${saved.id}`, {
      headers: { Accept: "application/octet-stream" },
    });
    if (!check.ok || !check.body)
      throw new Error("Cannot verify remote backup");
    const hash = createHash("sha256");
    let length = 0;
    for await (const chunk of Readable.fromWeb(check.body as any)) {
      hash.update(chunk);
      length += chunk.length;
    }
    if (length !== size || hash.digest("hex") !== checksum)
      throw new Error("Remote backup checksum mismatch");
  }
}
await mkdir(dirname(path), { recursive: true });
if (process.argv.includes("restore")) {
  const r = await release();
  const download = `${path}.download.gz`;
  if (r) {
    const asset = assets(r)[0];
    if (!asset)
      throw new Error(
        "Existing collector release has no complete backup. Refusing to reset history.",
      );
    const response = await request(`${root}/releases/assets/${asset.id}`, {
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Cannot download collector backup: HTTP ${response.status}`,
      );
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(download, { mode: 0o600 }),
    );
    if ((await stat(download)).size !== asset.size)
      throw new Error("Incomplete backup download");
    if (asset.digest && asset.digest !== `sha256:${await fileDigest(download)}`)
      throw new Error("Backup digest mismatch");
    console.log(`Restoring ${asset.name}`);
  } else {
    await copyFile("config/launch-history.sqlite.gz", download);
    console.log(
      "First deployment: restoring verified launch-day public observations.",
    );
  }
  const restored = `${path}.restore`;
  await pipeline(
    createReadStream(download),
    createGunzip(),
    createWriteStream(restored, { flags: "wx", mode: 0o600 }),
  );
  verifyDatabase(restored);
  const check = new DatabaseSync(restored, { readOnly: true });
  const oldVersion = version(check);
  check.close();
  if (oldVersion !== 3) {
    // Retain a permanent pre-migration rollback asset outside rolling retention.
    if (r)
      await uploadBackup(
        r,
        `gaugecraft-pre-v3-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.sqlite.gz`,
        download,
      );
    const report = await migrateDatabase(restored, `${path}.migrated`);
    console.log(
      `Verified storage migration: ${report.beforeBytes} → ${report.afterBytes} bytes; all record fingerprints unchanged.`,
    );
    await rename(`${path}.migrated`, path);
    await unlink(restored);
  } else await rename(restored, path);
  await unlink(download);
} else if (process.argv.includes("save")) {
  const upload = `${path}.upload.gz`;
  const manifest = await createBackup(path, upload);
  let r = await release();
  if (!r) {
    const response = await request(`${root}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: process.env.GITHUB_SHA,
        name: "Collector history",
        prerelease: true,
        body: "Public onchain observations and frozen research forecasts. Automatic durable backups for the GitHub Pages collector. No personal position inputs. Latest three complete backups are retained.",
      }),
    });
    if (!response.ok)
      throw new Error(
        `Cannot create collector release: HTTP ${response.status}`,
      );
    r = (await response.json()) as Release;
  }
  const name = `gaugecraft-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.sqlite.gz`;
  if (!/^gaugecraft-\d+-\d+\.sqlite\.gz$/.test(name))
    throw new Error("Missing GitHub run identity");
  await uploadBackup(r, name, upload);
  console.log(`Stored ${name} (${manifest.compressedBytes} bytes).`);
  await unlink(upload);
  await unlink(`${upload}.json`);
  const latest = await release();
  for (const old of latest ? assets(latest).slice(3) : []) {
    const removed = await request(`${root}/releases/assets/${old.id}`, {
      method: "DELETE",
    });
    if (!removed.ok)
      console.warn(
        `Old backup retention cleanup deferred: HTTP ${removed.status}`,
      );
  }
} else throw new Error("Use restore or save");
