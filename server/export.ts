import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Store } from "./store.js";
import { csvLines } from "./csv.js";
const db = new Store();
try {
  await pipeline(
    Readable.from(
      csvLines(
        db.observations(
          process.argv.includes("--demo") ? "demo" : "live",
          0,
          Number.MAX_SAFE_INTEGER,
          false,
        ),
      ),
    ),
    process.stdout,
  );
} finally {
  db.close();
}
