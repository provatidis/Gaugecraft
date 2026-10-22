import type { HistoryPoint, Mode } from "../shared/types.js";

const apiOrigin = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
export const hosted = !apiOrigin && import.meta.env.VITE_DATA_MODE === "static";
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export const exportUrl = (mode: Mode) =>
  hosted
    ? assetUrl(`data/${mode}/observations.csv`)
    : `${apiOrigin}/api/export.csv?mode=${mode}`;

export async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const route = new URL(url, window.location.origin);
  const mode = route.searchParams.get("mode") === "demo" ? "demo" : "live";
  let target = `${apiOrigin}${url}`;
  if (hosted) {
    const resource = route.pathname.split("/").at(-1);
    if (resource === "history") {
      const id = route.searchParams.get("pool") ?? "";
      if (!/^\d+:0x[\da-f]{40}$/.test(id)) throw new Error("Invalid pool ID");
      target = assetUrl(`data/${mode}/history/${id.replace(":", "-")}.json`);
    } else if (resource === "state" || resource === "performance") {
      target = assetUrl(`data/${mode}/${resource}.json`);
    } else throw new Error("Unknown published data resource");
  }
  const response = await fetch(target, { signal, cache: "no-cache" });
  if (!response.ok)
    throw new Error(
      "Observation data is currently unavailable. Please refresh shortly.",
    );
  const result = await response.json();
  if (hosted && route.pathname === "/api/history") {
    const days = Math.min(
      30,
      Math.max(1, Number(route.searchParams.get("days")) || 2),
    );
    const now = Math.floor(Date.now() / 1000);
    return result.filter(
      (point: HistoryPoint) =>
        point.observedAt >= now - days * 86400 && point.observedAt <= now,
    ) as T;
  }
  return result as T;
}
