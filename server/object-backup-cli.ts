import { backupToObjects, restoreFromObjects } from "./object-backup.js";
if (process.argv[2] === "restore") {
  const [key, destination] = process.argv.slice(3);
  if (!key || !destination)
    throw new Error(
      "Usage: backup:r2 restore BACKUP_GENERATION NEW_DATABASE_PATH",
    );
  await restoreFromObjects(key, destination);
  console.log(
    "Restored to a new file and verified. No active database was replaced.",
  );
} else if (process.argv[2] === "save")
  console.log(JSON.stringify(await backupToObjects(), null, 2));
else throw new Error("Use save or restore");
