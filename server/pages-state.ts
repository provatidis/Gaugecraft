import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { databasePath } from "./store.js";
import { dirname } from "node:path";

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
async function request(url: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(180000),
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
function verifyDatabase(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("Backup failed SQLite integrity check");
    db.prepare("SELECT count(*) FROM snapshots").get();
  } finally {
    db.close();
  }
}
await mkdir(dirname(path), { recursive: true });
if (process.argv.includes("restore")) {
  const r = await release();
  let bytes: Buffer;
  if (r) {
    const asset = assets(r)[0];
    if (!asset)
      throw new Error(
        "Existing collector release has no complete backup. Refusing to reset history.",
      );
    const response = await request(`${root}/releases/assets/${asset.id}`, {
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok)
      throw new Error(
        `Cannot download collector backup: HTTP ${response.status}`,
      );
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.size)
      throw new Error("Incomplete backup download");
    if (
      asset.digest &&
      asset.digest !==
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    )
      throw new Error("Backup digest mismatch");
    console.log(`Restoring ${asset.name}`);
  } else {
    bytes = await readFile("config/launch-history.sqlite.gz");
    console.log(
      "First deployment: restoring verified launch-day public observations.",
    );
  }
  await writeFile(`${path}.restore`, gunzipSync(bytes));
  verifyDatabase(`${path}.restore`);
  await rename(`${path}.restore`, path);
} else if (process.argv.includes("save")) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    await backup(db, `${path}.backup`);
  } finally {
    db.close();
  }
  verifyDatabase(`${path}.backup`);
  const bytes = gzipSync(await readFile(`${path}.backup`), { level: 9 });
  await unlink(`${path}.backup`);
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
  const response = await request(`${r.upload_url.split("{")[0]}?name=${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/gzip" },
    body: new Uint8Array(bytes),
  });
  if (!response.ok)
    throw new Error(`Cannot upload collector backup: HTTP ${response.status}`);
  const saved = (await response.json()) as Asset;
  if (
    saved.size !== bytes.length ||
    (saved.digest &&
      saved.digest !==
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`)
  )
    throw new Error("Uploaded collector backup failed verification");
  console.log(`Stored ${name} (${bytes.length} bytes).`);
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
