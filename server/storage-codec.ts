import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

// Compression is bounded to one record, never a complete database or export.
export function json(value: unknown) {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Non-finite metric");
    return v;
  });
}
export function encode(value: unknown) {
  return gzipSync(json(value));
}
export function decode<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  if (!(value instanceof Uint8Array)) throw new Error("Invalid stored record");
  return JSON.parse(gunzipSync(value).toString("utf8")) as T;
}
// Object property order is irrelevant; every value (including raw evidence) is retained.
export function digest(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(json(canonical(value)))
    .digest("hex");
}
