import { readFile, writeFile, rename } from "node:fs/promises";
import { backupToObjects, r2Storage } from "./object-backup.js";
import { databasePath } from "./store.js";

export interface BackupStatus {
  enabled: boolean;
  lastSuccess: string | null;
  lastAttempt: string | null;
  key: string | null;
  error: string | null;
  running: boolean;
}
export async function scheduleBackups(path = databasePath()) {
  const enabled = process.env.BACKUP_ENABLED === "1";
  const status: BackupStatus = {
    enabled,
    lastSuccess: null,
    lastAttempt: null,
    key: null,
    error: null,
    running: false,
  };
  const file = `${path}.backup-status.json`;
  try {
    const prior = JSON.parse(await readFile(file, "utf8"));
    Object.assign(status, {
      lastSuccess: prior.lastSuccess,
      lastAttempt: prior.lastAttempt,
      key: prior.key,
      error: prior.error,
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      status.error = "Backup status unreadable";
  }
  const storage = enabled ? r2Storage() : null;
  let stopped = false,
    active: Promise<void> = Promise.resolve();
  const tick = () => {
    if (!storage || stopped || status.running) return;
    // One verified backup per day; failures are retried after an hour.
    if (
      status.lastSuccess &&
      Date.now() - Date.parse(status.lastSuccess) < 24 * 3600000
    )
      return;
    if (
      status.lastAttempt &&
      Date.now() - Date.parse(status.lastAttempt) < 3600000
    )
      return;
    status.running = true;
    status.lastAttempt = new Date().toISOString();
    active = (async () => {
      try {
        const result = await backupToObjects(path, storage);
        status.lastSuccess = new Date().toISOString();
        status.key = result.key;
        status.error = null;
        console.log("External backup verified", result.key);
      } catch {
        status.error =
          "External backup failed; previous verified backups remain available";
        console.error(status.error);
      } finally {
        status.running = false;
        try {
          await writeFile(`${file}.tmp`, JSON.stringify(status), {
            mode: 0o600,
          });
          await rename(`${file}.tmp`, file);
        } catch {
          status.error = "Could not persist backup status";
          console.error(status.error);
        }
      }
    })();
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  return {
    status,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}
