import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { databasePath, Store } from "./store.js";
import {
  createBackup,
  fileDigest,
  restoreBackup,
} from "./storage-maintenance.js";
import { digest } from "./storage-codec.js";
import { tmpdir } from "node:os";

export interface ObjectStorage {
  put(key: string, file: string): Promise<void>;
  read(key: string): Promise<AsyncIterable<Uint8Array>>;
}
export function r2Storage(): ObjectStorage {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
    process.env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)
    throw new Error(
      "Configure all four R2 settings before enabling external backups",
    );
  const endpoint = new URL(R2_ENDPOINT);
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search
  )
    throw new Error(
      "R2_ENDPOINT must be the HTTPS account endpoint from Cloudflare",
    );
  const client = new S3Client({
    endpoint: R2_ENDPOINT,
    region: "auto",
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10000, socketTimeout: 120000 },
  });
  return {
    async put(key, file) {
      await new Upload({
        client,
        params: {
          Bucket: R2_BUCKET,
          Key: key,
          Body: createReadStream(file),
          ContentLength: (await stat(file)).size,
          ContentType: key.endsWith(".gz")
            ? "application/gzip"
            : "application/json",
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
    },
    async read(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      );
      if (!result.Body) throw new Error("Object storage returned no body");
      return result.Body as AsyncIterable<Uint8Array>;
    },
  };
}
async function verifyRemote(
  storage: ObjectStorage,
  key: string,
  sha256: string,
  size: number,
) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of await storage.read(key)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== size || hash.digest("hex") !== sha256)
    throw new Error("External backup verification failed");
}
export async function uploadVerified(
  storage: ObjectStorage,
  key: string,
  file: string,
) {
  await storage.put(key, file);
  await verifyRemote(
    storage,
    key,
    await fileDigest(file),
    (await stat(file)).size,
  );
}

export async function archiveEvidence(
  source: string,
  destination: string,
  from: number,
  to: number,
) {
  const store = new Store(source);
  let count = 0;
  function* records() {
    for (const s of store.observations("live", from, to)) {
      count++;
      yield JSON.stringify({
        version: 1,
        pool: s.id,
        observedAt: s.observedAt,
        retrievedAt: s.retrievedAt,
        block: s.block,
        blockHash: s.blockHash,
        inputHash: digest(s),
        rawHash: digest(s.raw),
        raw: s.raw,
      }) + "\n";
    }
  }
  try {
    await pipeline(
      Readable.from(records()),
      createGzip(),
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
  } finally {
    store.close();
  }
  return count;
}

// A complete manifest is uploaded last, after a streamed read-back of every object.
// Backups never overwrite a previous generation and never delete observations.
export async function backupToObjects(
  source = databasePath(),
  storage = r2Storage(),
) {
  const dir = await mkdtemp(
    join(process.env.BACKUP_TEMP_DIR || tmpdir(), "gaugecraft-backup-"),
  );
  const key = `backups/${new Date().toISOString().replaceAll(":", "-")}-${dir.split("-").at(-1)}`;
  const file = join(dir, "database.sqlite.gz");
  try {
    const manifest = await createBackup(source, file);
    await uploadVerified(storage, `${key}/database.sqlite.gz`, file);
    const until = Math.floor(new Date(manifest.createdAt).getTime() / 1000);
    const evidence = join(dir, "evidence.ndjson.gz");
    const archivedCopy = join(dir, "evidence-source.sqlite");
    await restoreBackup(file, archivedCopy);
    const records = await archiveEvidence(
      archivedCopy,
      evidence,
      until - 86400,
      until,
    );
    await uploadVerified(storage, `${key}/evidence.ndjson.gz`, evidence);
    const complete = {
      ...manifest,
      evidence: {
        records,
        from: until - 86400,
        to: until,
        sha256: await fileDigest(evidence),
        compressedBytes: (await stat(evidence)).size,
      },
    };
    await writeFile(`${file}.json`, JSON.stringify(complete, null, 2) + "\n");
    await uploadVerified(storage, `${key}/manifest.json`, `${file}.json`);
    return { key, ...complete };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function restoreFromObjects(
  key: string,
  destination: string,
  storage = r2Storage(),
) {
  if (!/^backups\/[a-zA-Z0-9T.-]+$/.test(key))
    throw new Error("Use an exact backup generation key");
  const dir = await mkdtemp(
    join(process.env.BACKUP_TEMP_DIR || tmpdir(), "gaugecraft-restore-"),
  );
  const file = join(dir, "database.sqlite.gz");
  try {
    await pipeline(
      Readable.from(await storage.read(`${key}/manifest.json`)),
      createWriteStream(`${file}.json`, { flags: "wx", mode: 0o600 }),
    );
    await pipeline(
      Readable.from(await storage.read(`${key}/database.sqlite.gz`)),
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
    );
    await restoreBackup(file, destination);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
