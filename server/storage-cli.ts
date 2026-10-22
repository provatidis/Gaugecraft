import {
  migrateDatabase,
  createBackup,
  restoreBackup,
  storageReport,
  fingerprint,
} from "./storage-maintenance.js";
const [command, source, destination] = process.argv.slice(2);
if (!source)
  throw new Error(
    "Usage: storage-cli.ts report|verify SOURCE, or migrate|backup|restore SOURCE NEW_DESTINATION",
  );
if (command === "report")
  console.log(JSON.stringify(await storageReport(source), null, 2));
else if (command === "verify")
  console.log(JSON.stringify(fingerprint(source), null, 2));
else if (!destination) throw new Error("A new destination path is required");
else if (command === "migrate")
  console.log(
    JSON.stringify(await migrateDatabase(source, destination), null, 2),
  );
else if (command === "backup")
  console.log(JSON.stringify(await createBackup(source, destination), null, 2));
else if (command === "restore") {
  await restoreBackup(source, destination);
  console.log(
    "Restored and verified. Start the application only after choosing this database explicitly.",
  );
} else throw new Error("Unknown storage command");
