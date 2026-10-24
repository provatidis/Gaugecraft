# Persistent hosting and storage

Status: compact storage is in use, and a real R2 backup and complete recovery were verified on October 24, 2026. The independent daily GitHub backup workflow is configured. A replacement persistent collector host, external monitors and the 48-hour operational observation period remain outstanding; Railway provisioning is deferred. GitHub Actions remains the public collector.

## Storage contract

Storage version 3 keeps every observation and frozen forecast. Snapshot metrics are compressed independently, raw source evidence is compressed and keyed by its SHA-256, and forecasts reference their exact immutable snapshot by content hash. Forecast outputs are compressed without recomputation. Mode, pool, timestamps and indexes remain directly queryable. Compression operates on one record at a time, not the database as a whole.

Historical metadata is retained as observed. A missing or mismatched forecast input aborts migration; it is never repaired using today's values. Migration compares canonical hashes and counts of all observations, full forecasts including their inputs, runs and benchmark decisions. SQLite integrity and foreign-key checks also run. The source file is retained. An old schema is refused by the application until explicitly migrated.

Raw evidence is retained in the database in this release. Daily external backups additionally publish a compressed JSONL evidence archive for the preceding 24 hours, with source blocks, timestamps and hashes. That convenience archive is not a complete independent history if a backup day was missed; full database backups retain the complete raw history. There is **no automatic history deletion or cold-storage eviction**. Implement and test retrieval from archives before ever introducing such a policy.

## Local migration and recovery

Run commands with Node 24 and the locked dependencies. Stop every process using the destination before selecting a new database. The source may be live: SQLite's backup API creates a consistent copy. Migration and restore refuse existing destinations.

```sh
pnpm storage:report data/gaugecraft.sqlite
pnpm storage:migrate data/gaugecraft.sqlite data/gaugecraft-v3.sqlite
pnpm storage:backup data/gaugecraft-v3.sqlite data/gaugecraft-v3.sqlite.gz
pnpm storage:restore data/gaugecraft-v3.sqlite.gz data/restore-test.sqlite
node --import tsx server/storage-cli.ts verify data/restore-test.sqlite
```

Keep the `.gz.json` checksum manifest with its `.gz`. Backups use the SQLite online backup API followed by streamed gzip; restoration streams into a new file and checks checksum, compressed and expanded sizes, SQLite integrity and references. No database-sized Buffer is used. Migration needs temporary disk headroom for the old and compacted copies and SQLite's VACUUM work.

After verifying the report and stopping the old process, set `GAUGECRAFT_DB` to the new file. Do not run old code against a v3 file. Rollback means using the preserved old database with the old code; observations gathered after the handover must be reconciled explicitly, not silently discarded.

The GitHub transition path streams release downloads/uploads, migrates its downloaded copy, and retains a `gaugecraft-pre-v3-…sqlite.gz` rollback asset outside its rolling three-generation retention. Its original launch seed remains unchanged.

## Capacity evidence

A consistent local copy measured on October 22, 2026 contained 10,070 live observations and forecasts, 1,685 fixture observations and forecasts, 164 collection runs and 359 decisions. Migration reduced its physical database from **118,562,816 to 53,030,912 bytes (55.27%)**. All logical record fingerprints were identical before migration, after migration and after backup restoration. The compressed backup was 27,212,287 bytes. This copy is a measurement sample, not the authoritative public history for cutover.

At 474 pools and 48 observations per pool per day, the measured blended physical size implies approximately **103 MB/day, 3.1 GB/30 days, 9.2 GB/90 days and 37.5 GB/year**. These are linear planning estimates using the current live/fixture mix, including forecasts and indexes. They exclude WAL, temporary files, backups, additional pools and future schema changes. Compression is lossless and does not make growth stop. Run `storage:report` again after a week and before resizing.

A separate synthetic stress test backed up and restored a **2,216,857,600-byte database**, crossing the previous 2 GiB whole-buffer boundary. It completed with a 128 MiB Node heap limit and approximately **139 MiB peak process memory**, and verified restored row counts, payload sizes and SQLite integrity. Its zero-filled payload is deliberately highly compressible; this tests memory behavior and recovery, not realistic backup sizes. Synthetic records were never added to research history. Automated object-storage tests use an in-memory test double; a real R2 recovery drill remains required.

Plan for Railway Pro rather than treating a 5 GB Hobby volume as a long-term solution. Start with enough persistent capacity for the next 90 days plus headroom; the current Pro default is 50 GB. Backup temporary storage must have at least twice the active database size free. Enable disk alerts before reaching 80% use. Reassess retention and archival retrieval well before a year. [Railway volume limits](https://docs.railway.com/volumes/reference).

## Railway service

Use this repository's Dockerfile and railway.json, one replica, one persistent volume mounted at `/data`. The container runs the normal Node application and its in-process collector. Do not deploy a separate writer against the same SQLite file. Railway volumes do not support replicas and cause brief deployment downtime; this is not a high-availability arrangement. [Railway volumes](https://docs.railway.com/volumes/reference), [health checks](https://docs.railway.com/deployments/healthchecks).

| Setting               | Value / purpose                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GAUGECRAFT_DB`       | `/data/gaugecraft.sqlite` (container default)                                                                        |
| `REQUIRE_EXISTING_DB` | `1` (container default); prevent an empty replacement database                                                       |
| `HOST`                | `0.0.0.0` (container default)                                                                                        |
| `PORT`                | Railway-provided port, otherwise 4317                                                                                |
| `COLLECT`             | `0` during import and verification; remove or set `1` only at handover                                               |
| `ALLOWED_HOSTS`       | Comma-separated custom hostnames, without scheme or port; Railway's generated public domain is allowed automatically |
| `CORS_ORIGINS`        | `https://provatidis.com` for the existing Pages frontend; explicit origins only                                      |
| `BACKUP_ENABLED`      | `1` after R2 configuration; default disabled                                                                         |
| `BACKUP_TEMP_DIR`     | Optional directory with sufficient temporary capacity; defaults to OS temp                                           |
| `BOOTSTRAP_R2_BACKUP` | Exact verified `backups/<generation>` key for first import only; remove after success                                |

Bootstrap only runs if the configured database is missing. It verifies the backup before creating the file. Without a database or explicit bootstrap generation the hosted container refuses to start. Never leave an old bootstrap key configured as an automatic disaster-recovery policy.

The code has a 25-second graceful-shutdown deadline. Configure Railway's deployment draining period to at least 30 seconds. The collector waits for its current run on shutdown; a forced interruption remains visible as an interrupted run on recovery. Scheduling resumes at the next UTC half-hour boundary without fabricating missed history.

The public API accepts GET/HEAD only, validates pool IDs, caches expensive views briefly, limits charts and HTTP CSV to 30 days, and streams CSV. Command-line CSV can stream full retained history. Personal simulator inputs never enter these requests.

## R2 backups while the collector remains on GitHub

The independent **Back up Gaugecraft to R2** workflow reads the latest complete `collector-state` release asset. It never substitutes the local measurement database, starts a collector, or creates empty history. The workflow uses the same concurrency lock as collection, checks GitHub's published SHA-256 and size, uploads a new private R2 generation, then downloads and restores it into a separate database. Success requires matching counts and canonical fingerprints for every observation, full frozen forecast, run and benchmark decision. A verified `recovery.json` receipt is uploaded only after that round trip succeeds.

Cloudflare setup:

1. Enable R2 if needed and create a **private Standard** bucket, for example `gaugecraft-backups`. Leave public access disabled; no public domain or CORS policy is needed.
2. Under **R2 → Manage API tokens**, create an S3 API token with **Object Read & Write**, restricted to that bucket. Use the generated Access Key ID and Secret Access Key, not the Cloudflare API token string.
3. Add four **repository secrets** under [Gaugecraft → Settings → Secrets and variables → Actions](https://github.com/provatidis/gaugecraft/settings/secrets/actions): `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The endpoint is the bucket's HTTPS S3 account endpoint, normally `https://<account-id>.r2.cloudflarestorage.com`. Never add these as frontend variables or paste the keys into chat.
4. Open [Back up Gaugecraft to R2](https://github.com/provatidis/gaugecraft/actions/workflows/backup.yml), select **Run workflow**, keep branch `main`, and run it. Missing credentials or an unavailable source cause a visible failed run, never a simulated success.
5. Check the job summary and download the `r2-recovery-report-…` artifact. Confirm `recordsMatch: true` and `restoredFromRemote: true`, with the expected source timestamps and counts. The private generation contains `database.sqlite.gz`, `evidence.ndjson.gz`, `manifest.json` and `recovery.json`.

The workflow is scheduled daily at **03:23 UTC**, with manual runs available, and also verifies a real backup after changes to the backup workflow or its implementation. GitHub can delay or skip scheduled runs; this is a best-effort daily backup, not a guaranteed 24-hour recovery point. Check successful runs and their source timestamps. GitHub failure notifications depend on the repository owner's notification settings. Backup verification does not establish fresh collection and does not repair missing observations.

The workflow only needs read access to repository contents. R2 credentials are supplied to the backup step, not the website build, and are never included in the report. No existing R2 generation is overwritten or automatically deleted. After the first real recovery succeeds, consider a 30-day lifecycle on `backups/`; account usage and any existing R2 storage share the free allowance. Configure billing notifications in Cloudflare and review actual usage before relying on a cost estimate. [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/), [pricing](https://developers.cloudflare.com/r2/pricing/), [GitHub repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

The same verified command can run locally with those environment settings:

```sh
GITHUB_REPOSITORY=provatidis/gaugecraft pnpm backup:github
```

### First verified R2 recovery

[Run 40094105394](https://github.com/provatidis/gaugecraft/actions/runs/40094105394) succeeded on **October 24, 2026 at 12:31:14 UTC**, using the authoritative `gaugecraft-40094105368-1.sqlite.gz` release asset. Its latest live source observation was **12:30:05 UTC**. The actual R2 download and separate database restoration matched all source fingerprints:

| Record group             |  Count |
| ------------------------ | -----: |
| Live observations        | 14,132 |
| Live frozen forecasts    | 14,132 |
| Fixture observations     |  1,685 |
| Fixture frozen forecasts |  1,685 |
| Collection runs          |    248 |
| Benchmark decisions      |    367 |

The R2 generation is `backups/2026-10-24T12-30-52.804Z-UlOfRq`; its `recovery.json` contains the full source and restored hashes. A [GitHub recovery report artifact](https://github.com/provatidis/gaugecraft/actions/runs/40094105394/artifacts/12559834037) provides the same verification evidence and expires after 30 days. This records one successful real recovery, not evidence that future schedules or collection are uninterrupted. The R2 setup does not require Railway or another application host.

## R2 and independent backups

Create a **private** R2 bucket dedicated to Gaugecraft. Keep database/archive objects private; no public bucket URL is needed. Supply a bucket-scoped access key in the deployment's secret store, never in Git, frontend build variables or chat text:

```text
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=<private-bucket-name>
R2_ACCESS_KEY_ID=<secret>
R2_SECRET_ACCESS_KEY=<secret>
```

The official S3 SDK uploads streams in bounded 8 MiB multipart chunks with concurrency two and retries. Each uploaded database and evidence archive is streamed back and checked against its local checksum before the complete manifest is published. The backup manifest contains no personal positions or credentials. [Cloudflare's S3 SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

```sh
GAUGECRAFT_DB=data/gaugecraft-v3.sqlite pnpm backup:r2 save
pnpm backup:r2 restore backups/<verified-generation> data/r2-restore-test.sqlite
node --import tsx server/storage-cli.ts verify data/r2-restore-test.sqlite
```

With `BACKUP_ENABLED=1`, the service attempts one verified full backup per day, retries failures after an hour and persists status alongside SQLite. Health reports a backup overdue after 36 hours. This initial cadence can lose up to roughly a day of collection after total volume loss, and longer if backup failures are ignored. It is not continuous replication or point-in-time recovery. Railway's own volume backups can complement it; they do not replace the independent copy and restore drill.

There is no automatic remote deletion in the application. After successful recovery testing, configure a **30-day lifecycle** for `backups/` generations and retain the final pre-migration copy separately. This lifecycle expires old full backup copies and their convenience evidence extracts, not observations in the live database. Any future permanent evidence archive needs a separate prefix without that lifecycle. Monitor incomplete multipart uploads and add an abort rule. At the measured growth rate, retaining daily full copies becomes a material storage cost; revisit incremental backup tooling once full-copy time or cost justifies it. [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Health and acceptance

| Endpoint          | Purpose                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health/live`    | Railway deployment check; server running. Does not restart the app because an RPC provider is down.                                                       |
| `/health/data`    | External monitor; HTTP 503 if any configured network is stale/missing or its latest run reports an issue. Same 75-minute freshness rule as the dashboard. |
| `/health/storage` | External monitor; HTTP 503 if free persistent disk is below 15% or 1 GiB, or enabled backups have failed/become overdue. Reports if backups are disabled. |

Configure external checks every five minutes and an alert recipient before handover. Endpoints provide signals; without an external monitor, no email/push notification is sent. Also configure provider memory/CPU/disk and spending alerts. Check the separate temporary filesystem capacity used by backups.

Acceptance requires all seven networks collecting for at least 48 hours, source timestamps advancing, restart and deployment survival, a real R2 restore into a separate environment with matching fingerprints, and confirmed alerts. Record actual gaps or missing inputs; infrastructure cannot recreate observations missed before migration. No claim of uninterrupted collection or completed migration should be made before this evidence exists.

## Controlled cutover from GitHub

1. Leave the existing collector active during code testing. Provision the new service with `COLLECT=0`. Connect R2 and verify account limits and a monthly budget before enabling paid resources.
2. Pause the GitHub workflow and let any active collection finish. Download the latest complete release asset and verify its digest. This is the authoritative public database; do not substitute the local measurement copy.
3. Migrate if needed, preserve a separate rollback copy, upload a verified R2 generation, and configure the Railway bootstrap key. Confirm fingerprints after import and remove the bootstrap setting.
4. Enable exactly one Railway collector. Verify fresh runs across all configured networks and start monitoring. Keep the old public frontend available during verification.
5. Set GitHub repository variables `COLLECTOR_HOSTING=railway` and `VITE_API_ORIGIN` to the verified Railway HTTPS origin. Re-enable the workflow and trigger it manually. This builds only the frontend, skips GitHub collection/storage and makes scheduled events no-ops. Confirm the published site reads the new API with CORS from `https://provatidis.com`.
6. Observe 48 hours and perform the real restore drill. Do not delete old backups or declare completion early. If rolling back, stop the new writer and reconcile its newer observations before resuming the old collector; avoid two divergent histories.

No DNS migration is required for this first step. Passiko and the personal website remain independent.
