import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { backupReleaseToR2, recoverySummary } from "./release-backup.js";

try {
  const required = [
    "GITHUB_REPOSITORY",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing configuration names: ${missing.join(", ")}`);
    throw new Error(
      `Missing configuration: ${missing.join(", ")}. See DEPLOYMENT.md.`,
    );
  }
  const report = await backupReleaseToR2({
    repository: process.env.GITHUB_REPOSITORY!,
    token: process.env.GITHUB_TOKEN,
    onProgress: (stage) => console.log(stage),
  });
  const path = resolve(process.argv[2] || "data/r2-backup-report.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  const summary = recoverySummary(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
} catch {
  console.error(
    "R2 backup/recovery verification failed. Check that all four R2 repository secrets are configured, the key has Object Read & Write access to the private bucket, and the collector release is available. No verified recovery was reported. See DEPLOYMENT.md.",
  );
  process.exitCode = 1;
}
