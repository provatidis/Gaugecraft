import { Store } from "./store.js";
import { toCsv } from "./csv.js";
const db = new Store();
process.stdout.write(
  toCsv(db.all(process.argv.includes("--demo") ? "demo" : "live")),
);
db.close();
