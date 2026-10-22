import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Evaluation,
  HistoryPoint,
  MarketRow,
  Maybe,
  Mode,
  Run,
  Snapshot,
} from "../shared/types.js";
import {
  HORIZON,
  incentives,
  SCENARIOS,
  simulate,
  type SimulationInput,
} from "../analysis/math.js";
import { get, assetUrl, exportUrl, hosted } from "./data.js";
const money = (n: Maybe | undefined, compact = false) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n < 10 ? 2 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(n);
const number = (n: Maybe | undefined, compact = false) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: compact ? 1 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(n);
const pct = (n: Maybe | undefined) => (n == null ? "—" : `${n.toFixed(2)}%`);
const date = (t: number) =>
  new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
function useLocal<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* Storage may be disabled; inputs still work in memory. */
      }
    },
  ];
}
interface State {
  mode: Mode;
  now: number;
  markets: MarketRow[];
  runs: Run[];
  collectorEnabled: boolean;
  collectionKind?: "github-actions";
  configuredChains: number[];
}
const metricInfo: Record<string, string> = {
  pool: "Chain ID plus pool contract address uniquely identifies each market. Token symbols alone are not unique.",
  stakeApr:
    "Annualized pool revenue estimate ÷ (current reward allocation power × AERO spot price) × 182.5 × 100. This is Stake APR, not LP APR or your personal capital APR.",
  rewards48hUsd:
    "All allocators share this pool total. Historical eligible fee approximation + fixed onchain incentives overlapping the next 48 hours. Not your individual earnings.",
  eligibleFees48hUsd:
    "Observed gross trading fees in the returned window × current staked-liquidity fraction. This approximates historical eligibility; it is not exact fee-distribution accounting.",
  incentives48hUsd:
    "Fixed onchain program rates integrated over the next 48 hours, stopping at expiry, valued at current spot estimates. No renewals assumed.",
  allocation:
    "Current decayed reward voting supply from VotingRewardsManager.totalSupply(), in 18-decimal allocation power units.",
  tvlUsd:
    "Pool reserves valued at local spot price estimates; zero or unknown prices do not silently become zero TVL.",
  volume48hUsd:
    "Observed token-side trading volumes valued at current spot prices and divided by two to avoid counting both legs. Actual source window may be shorter at launch.",
  aprChange:
    "Change in Stake APR in percentage points versus the last observation at least 6 hours earlier.",
  allocationChange:
    "Percentage change in reward allocation supply versus the last observation at least 6 hours earlier. Includes stake decay, not just new competitors.",
};
const nav = [
  ["markets", "◫", "Markets"],
  ["opportunities", "↗", "Opportunities"],
  ["analysis", "⌁", "Pool analysis"],
  ["simulator", "⊞", "Simulator"],
  ["performance", "▥", "Performance"],
] as const;
type Page = (typeof nav)[number][0];
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Pair({ s, small = false }: { s: Snapshot; small?: boolean }) {
  return (
    <div className={`pair ${small ? "small" : ""}`}>
      <div className="coins">
        <span>{s.token0.symbol.slice(0, 1)}</span>
        <span>{s.token1.symbol.slice(0, 1)}</span>
      </div>
      <div>
        <strong>
          {s.token0.symbol} <span className="muted">/</span> {s.token1.symbol}
        </strong>
        <div className="pair-meta">
          {s.chain} <span>·</span> {s.poolType > 0 ? "CL" : "Basic"}{" "}
          <span>·</span> <span title={s.id}>{short(s.address)}</span>
        </div>
      </div>
    </div>
  );
}
function Info({ name, label }: { name: string; label: string }) {
  return (
    <span title={metricInfo[name]}>
      {label}{" "}
      <span className="info" aria-label={metricInfo[name]}>
        ⓘ
      </span>
    </span>
  );
}
export default function App() {
  const [mode, setMode] = useLocal<Mode>("gc-mode", "live"),
    [page, setPage] = useState<Page>("markets"),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState("");
  const [watch, setWatch] = useLocal<string[]>("gc-watchlist", []);
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    setLoading(true);
    setState(null);
    const load = () =>
      get<State>(`/api/state?mode=${mode}`, abort.signal)
        .then((s) => {
          if (alive) {
            setState(s);
            setError("");
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive && e.name !== "AbortError") {
            setError(e.message);
            setLoading(false);
          }
        });
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      abort.abort();
      clearInterval(timer);
    };
  }, [mode, refresh]);
  const rows = useMemo(() => state?.markets ?? [], [state]);
  const current =
    rows.find((r) => r.snapshot.id === selected) ??
    [...rows].sort(
      (a, b) =>
        (b.snapshot.rewards48hUsd ?? -1) - (a.snapshot.rewards48hUsd ?? -1),
    )[0];
  const last = rows.length
    ? Math.max(...rows.map((r) => r.snapshot.retrievedAt))
    : null;
  const liveAge = last === null ? null : (Date.now() / 1000 - last) / 60;
  function open(row: MarketRow, p: Page = "analysis") {
    setSelected(row.snapshot.id);
    setPage(p);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const stale = mode === "live" && liveAge !== null && liveAge > 75;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("markets");
          }}
        >
          <span className="brand-mark">
            g<span>↗</span>
          </span>
          <span>
            gaugecraft<small>ALLOCATION RESEARCH</small>
          </span>
        </a>
        <div className="sidebar-caption">RESEARCH WORKSPACE</div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={page === id ? "nav-item active" : "nav-item"}
              onClick={() => setPage(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <span>{icon}</span>
              {label}
              {id === "opportunities" && (
                <small>
                  {rows.filter((r) => r.forecast.basis === "history").length}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="research-note">
            <span className="status-dot" />
            Read-only by design
            <p>
              Your research stays on this device.
              <br />
              No wallet connection.
            </p>
          </div>
          <a href={assetUrl("SOURCES.md")} target="_blank" rel="noreferrer">
            Sources & methodology ↗
          </a>
          <span className="version">Aero / MetaDEX03 · v0.1</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <b>{nav.find((n) => n[0] === page)?.[2]}</b>
          </div>
          <div className="top-actions">
            <span className="utc-date">
              {new Date().toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <select
              aria-label="Data source mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="live">Live observations</option>
              <option value="demo">Sample fixtures</option>
            </select>
            <button
              className="icon-button"
              title="Refresh observations"
              aria-label="Refresh observations"
              onClick={() => setRefresh((r) => r + 1)}
            >
              ↻
            </button>
          </div>
        </header>
        <main>
          {mode === "demo" && (
            <div className="notice demo">
              <b>Sample fixtures</b> Every pool, metric and historical
              observation in this view is synthetic. This is not live Aero data.
            </div>
          )}
          {error && (
            <div className="notice danger">
              {error} {state ? "Showing the last loaded observations." : ""}
            </div>
          )}
          {stale && (
            <div className="notice warning">
              Latest successful collection is {Math.floor(liveAge!)} minutes
              old. Treat the market view as stale; opportunity ranking is paused
              for stale pools.
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">AERO PREDICTIVE ALLOCATION</div>
              <h1>
                {page === "markets"
                  ? "Allocation markets"
                  : page === "opportunities"
                    ? "Allocation opportunities"
                    : page === "analysis"
                      ? "Pool analysis"
                      : page === "simulator"
                        ? "Allocation simulator"
                        : "Forecast performance"}
              </h1>
              <p>
                {page === "markets"
                  ? "Compare pool revenue, incentives and allocation pressure over the next 48 hours."
                  : page === "opportunities"
                    ? "Transparent signals, explicit stress tests, and no invented confidence scores."
                    : page === "analysis"
                      ? "A record of what was observable, with each estimate kept in context."
                      : page === "simulator"
                        ? "Test allocation dilution and incentive runway before you decide."
                        : "Frozen forecasts, observed outcomes, and simple benchmarks."}
              </p>
            </div>
            {page === "markets" && (
              <a
                className="button secondary"
                href={exportUrl(mode)}
                download={`gaugecraft-${mode}.csv`}
                title={
                  hosted
                    ? "Published observations from the last 30 days"
                    : "All stored observations"
                }
              >
                ↓ Export observations
              </a>
            )}
          </div>
          <div className="freshness">
            <span className={`status-dot ${last && !stale ? "" : "amber"}`} />
            <b>
              {mode === "demo"
                ? "Fixture dataset"
                : last
                  ? "Onchain observations"
                  : "Waiting for observations"}
            </b>
            <span>
              {last
                ? `Retrieved ${date(last)}`
                : "The collector will preserve genuine observations as they arrive."}
            </span>
            <span className="freshness-end">
              48h horizon <span>·</span>{" "}
              {hosted ? "Scheduled snapshots" : "30 min collection"}
            </span>
          </div>
          {loading && !state ? (
            <div className="loading">
              <div className="spinner" />
              Reading observations…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty panel">
              <span className="empty-symbol">◫</span>
              <h2>
                {mode === "demo"
                  ? "Fixtures have not been seeded."
                  : "No live observations yet."}
              </h2>
              <p>
                {mode === "demo"
                  ? "Run “npm run demo” locally to create a separate, explicitly synthetic dataset."
                  : "The collector is reading public contracts. Successful observations will appear here automatically."}
              </p>
              {state?.runs
                .filter((r) => r.status === "error")
                .slice(0, 2)
                .map((r) => (
                  <p key={r.id} className="error-text">
                    Chain {r.chainId}: {r.error}
                  </p>
                ))}
            </div>
          ) : (
            <>
              {page === "markets" && (
                <Markets
                  rows={rows}
                  open={open}
                  watch={watch}
                  setWatch={setWatch}
                />
              )}
              {page === "opportunities" && (
                <Opportunities rows={rows} open={open} mode={mode} />
              )}
              {page === "analysis" && current && (
                <Analysis
                  row={current}
                  rows={rows}
                  select={setSelected}
                  mode={mode}
                  simulate={() => setPage("simulator")}
                />
              )}
              {page === "simulator" && current && (
                <Simulator row={current} rows={rows} select={setSelected} />
              )}
              {page === "performance" && (
                <Performance mode={mode} rows={rows} />
              )}
            </>
          )}
          <footer>
            <span>
              Research estimates. Returns are variable. USD values use pool spot
              estimates and configured USDC / USDG = $1 anchors.
            </span>
            <a href={assetUrl("SOURCES.md")} target="_blank" rel="noreferrer">
              Read the methodology ↗
            </a>
          </footer>
          {state && (
            <details className="source-health">
              <summary>
                Collector status · {state.runs[0]?.status ?? "waiting"} ·
                configured networks {state.configuredChains.join(", ")}
              </summary>
              <p>
                {state.collectionKind === "github-actions"
                  ? "Public chain observations are refreshed by GitHub Actions, scheduled twice an hour. Runs may be delayed or fail; the retrieval timestamp shows actual freshness. History is retained between runs. Your personal inputs never enter the collector."
                  : state.collectorEnabled
                    ? "Collection runs every 30 minutes while the local server is running."
                    : "Background collection is disabled for this server."}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>Started (UTC)</th>
                      <th>Status</th>
                      <th>Pools</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.runs.slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td>{r.chainId}</td>
                        <td>{date(r.startedAt)}</td>
                        <td>{r.status}</td>
                        <td>{r.poolCount}</td>
                        <td>{r.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
function Markets({
  rows,
  open,
  watch,
  setWatch,
}: {
  rows: MarketRow[];
  open: (r: MarketRow, p?: Page) => void;
  watch: string[];
  setWatch: (s: string[]) => void;
}) {
  const [search, setSearch] = useState(""),
    [chain, setChain] = useState("all"),
    [starred, setStarred] = useState(false),
    [sort, setSort] = useState("rewards48hUsd"),
    [desc, setDesc] = useState(true),
    [page, setPage] = useState(0);
  const active = rows.filter((r) => r.snapshot.active),
    knownRewards = active.filter((r) => r.snapshot.rewards48hUsd !== null),
    knownTvl = active.filter((r) => r.snapshot.tvlUsd !== null),
    ready = active.filter((r) => r.forecast.basis === "history");
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => {
          const s = r.snapshot;
          return (
            (chain === "all" || s.chain === chain) &&
            (!starred || watch.includes(s.id)) &&
            `${s.token0.symbol} ${s.token1.symbol} ${s.address} ${s.chain}`
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
        .sort((a, b) => {
          const value = (r: MarketRow): number | string | null =>
            sort === "pool"
              ? `${r.snapshot.token0.symbol}/${r.snapshot.token1.symbol}`
              : sort === "aprChange"
                ? r.aprChange
                : sort === "allocationChange"
                  ? r.allocationChange
                  : (r.snapshot[sort as keyof Snapshot] as number | null);
          const av = value(a),
            bv = value(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (
            (typeof av === "string"
              ? av.localeCompare(String(bv))
              : av - Number(bv)) * (desc ? -1 : 1)
          );
        }),
    [rows, chain, starred, watch, search, sort, desc],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1),
  );
  const columns = [
    ["pool", "Pool"],
    ["stakeApr", "Stake APR"],
    ["rewards48hUsd", "Est. rewards 48h"],
    ["eligibleFees48hUsd", "Eligible fees 48h"],
    ["incentives48hUsd", "Incentives 48h"],
    ["allocation", "Allocation power"],
    ["tvlUsd", "TVL"],
    ["volume48hUsd", "Volume 48h"],
    ["aprChange", "APR Δ 6h"],
    ["allocationChange", "Allocation Δ 6h"],
  ];
  function sortBy(key: string) {
    if (sort === key) setDesc(!desc);
    else {
      setSort(key);
      setDesc(true);
    }
    setPage(0);
  }
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Allocation markets"
          value={number(active.length)}
          detail={`${rows.length - active.length} inactive · chain-aware identities`}
        />
        <Stat
          label="Pool rewards · next 48h"
          value={money(
            knownRewards.length
              ? knownRewards.reduce((a, r) => a + r.snapshot.rewards48hUsd!, 0)
              : null,
            true,
          )}
          detail={`Estimate · ${knownRewards.length}/${active.length} pools priced`}
        />
        <Stat
          label="Tracked liquidity"
          value={money(
            knownTvl.length
              ? knownTvl.reduce((a, r) => a + r.snapshot.tvlUsd!, 0)
              : null,
            true,
          )}
          detail={`Spot estimate · ${knownTvl.length}/${active.length} pools priced`}
        />
        <Stat
          label="Persistence evidence"
          value={`${ready.length} pools`}
          detail={
            ready.length
              ? "Meet the minimum history gate"
              : "Insufficient history · collecting"
          }
          highlight
        />
      </div>
      <section className="panel market-panel">
        <div className="panel-header">
          <div>
            <h2>
              Markets <span className="count">{rows.length}</span>
            </h2>
            <p>
              Pool totals first. Your individual earnings depend on your share.
            </p>
          </div>
          <div className="legend">
            <span>
              <i className="observed" />
              Observed inputs
            </span>
            <span>
              <i className="estimated" />
              Derived estimates
            </span>
          </div>
        </div>
        <div className="toolbar">
          <label className="search">
            <span>⌕</span>
            <input
              aria-label="Search pools"
              placeholder="Search tokens, pool address or network"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <select
            aria-label="Filter network"
            value={chain}
            onChange={(e) => {
              setChain(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All networks</option>
            {[...new Set(rows.map((r) => r.snapshot.chain))].sort().map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            className={starred ? "button filter selected" : "button filter"}
            onClick={() => {
              setStarred(!starred);
              setPage(0);
            }}
          >
            ☆ Watchlist <span>{watch.length}</span>
          </button>
        </div>
        <div className="table-scroll">
          <table className="markets-table">
            <thead>
              <tr>
                <th className="star-col" aria-label="Watchlist" />
                {columns.map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort === key
                        ? desc
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button onClick={() => sortBy(key)}>
                      <Info name={key} label={label} />
                      {sort === key ? (
                        <span className="sort-active">{desc ? "↓" : "↑"}</span>
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice(currentPage * 25, (currentPage + 1) * 25)
                .map((r) => {
                  const s = r.snapshot;
                  return (
                    <tr key={s.id} className={!s.active ? "inactive" : ""}>
                      <td className="star-col">
                        <button
                          className={`star ${watch.includes(s.id) ? "on" : ""}`}
                          aria-label={`${watch.includes(s.id) ? "Remove" : "Add"} ${s.token0.symbol}/${s.token1.symbol} ${short(s.address)} ${watch.includes(s.id) ? "from" : "to"} watchlist`}
                          onClick={() =>
                            setWatch(
                              watch.includes(s.id)
                                ? watch.filter((x) => x !== s.id)
                                : [...watch, s.id],
                            )
                          }
                        >
                          {watch.includes(s.id) ? "★" : "☆"}
                        </button>
                      </td>
                      <td>
                        <button className="pool-button" onClick={() => open(r)}>
                          <Pair s={s} />
                        </button>
                        {!s.active && <Badge tone="warn">Inactive</Badge>}
                        {s.mode === "live" &&
                          Date.now() / 1000 - s.retrievedAt > 75 * 60 && (
                            <Badge tone="warn">Stale observation</Badge>
                          )}
                      </td>
                      <td className="apr">
                        <button
                          className="metric-button"
                          title={metricInfo.stakeApr}
                          onClick={() => open(r, "simulator")}
                        >
                          {pct(s.stakeApr)}
                        </button>
                        <small>power APR · est.</small>
                      </td>
                      <td className="emphasis">
                        {money(s.rewards48hUsd)}
                        <small>pool total · est.</small>
                      </td>
                      <td>
                        {money(s.eligibleFees48hUsd)}
                        <small>
                          {Math.max(
                            0,
                            (s.windowEnd - s.windowStart) / 3600,
                          ).toFixed(1)}
                          h source window · est.
                        </small>
                      </td>
                      <td>
                        {money(s.incentives48hUsd)}
                        <small>
                          {s.programs?.filter(
                            (p) =>
                              p.end > s.observedAt &&
                              p.start < s.observedAt + HORIZON,
                          ).length ?? "—"}{" "}
                          programs · est.
                        </small>
                      </td>
                      <td>
                        {number(s.allocation, true)}
                        <small>reward supply</small>
                      </td>
                      <td>{money(s.tvlUsd, true)}</td>
                      <td>{money(s.volume48hUsd, true)}</td>
                      <td
                        className={
                          r.aprChange === null
                            ? ""
                            : r.aprChange >= 0
                              ? "positive"
                              : "negative"
                        }
                      >
                        {r.aprChange === null
                          ? "—"
                          : `${r.aprChange >= 0 ? "+" : ""}${r.aprChange.toFixed(2)} pp`}
                      </td>
                      <td
                        className={
                          r.allocationChange !== null && r.allocationChange > 10
                            ? "negative"
                            : ""
                        }
                      >
                        {r.allocationChange === null
                          ? "—"
                          : `${r.allocationChange >= 0 ? "+" : ""}${r.allocationChange.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty compact">No pools match these filters.</div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {filtered.length ? currentPage * 25 + 1 : 0}–
            {Math.min((currentPage + 1) * 25, filtered.length)} of{" "}
            {filtered.length} pools{" "}
            <span className="muted">· missing values stay blank</span>
          </span>
          <div>
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Previous page"
            >
              ←
            </button>
            <span>
              {currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              disabled={(currentPage + 1) * 25 >= filtered.length}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Next page"
            >
              →
            </button>
          </div>
        </div>
      </section>
      <div className="insight-strip">
        <span>⌁</span>
        <div>
          <b>A high APR is a starting point.</b>
          <p>
            Check incentive expiry, source-window length and incoming
            allocation. Launch-day revenue is a partial observation, not a full
            48-hour history.
          </p>
        </div>
        <button onClick={() => open(filtered[0] ?? rows[0])}>
          Inspect a pool →
        </button>
      </div>
    </>
  );
}
function Stat({
  label,
  value,
  detail,
  highlight = false,
}: {
  label: string;
  value: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat ${highlight ? "highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Opportunities({
  rows,
  open,
  mode,
}: {
  rows: MarketRow[];
  open: (r: MarketRow, p?: Page) => void;
  mode: Mode;
}) {
  const fresh = (r: MarketRow) =>
    mode === "demo" || Date.now() / 1000 - r.snapshot.retrievedAt <= 75 * 60;
  const ranked = rows
    .filter(
      (r) =>
        r.snapshot.active &&
        fresh(r) &&
        r.forecast.basis === "history" &&
        r.forecast.stressedPer1000 !== null,
    )
    .sort((a, b) => b.forecast.stressedPer1000! - a.forecast.stressedPer1000!);
  const baseline = rows
    .filter(
      (r) =>
        r.snapshot.active && fresh(r) && r.forecast.expectedPer1000 !== null,
    )
    .sort((a, b) => b.forecast.expectedPer1000! - a.forecast.expectedPer1000!)
    .slice(0, 10);
  const list = ranked.length ? ranked.slice(0, 20) : baseline;
  return (
    <>
      <div className="notice warning">
        <b>
          {ranked.length
            ? "Ranking uses a declared stress case."
            : "Insufficient history for persistence ranking."}
        </b>{" "}
        {ranked.length
          ? "Candidates are ordered by earnings per 1,000 power after a 50% fee decline and 50% more competing allocation. This is a stress assumption, not a confidence interval."
          : "The comparison below holds current allocation and eligible fees constant. It is a baseline scenario, not evidence that these APRs will persist."}
      </div>
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>
              {ranked.length
                ? "Persistence candidates"
                : "Baseline comparisons"}
            </h2>
            <p>
              Reference allocation: 1,000 additional power. Own dilution
              included.
            </p>
          </div>
          <Badge tone={ranked.length ? "good" : "warn"}>
            {ranked.length ? "History gate passed" : "Unranked for persistence"}
          </Badge>
        </div>
        <div className="candidate-list">
          {list.map((r, i) => (
            <div className="candidate" key={r.snapshot.id}>
              <span className="rank">
                {ranked.length ? String(i + 1).padStart(2, "0") : "—"}
              </span>
              <Pair s={r.snapshot} />
              <div>
                <span className="small-label">Baseline / 48h</span>
                <strong>{money(r.forecast.expectedPer1000)}</strong>
              </div>
              <div>
                <span className="small-label">Stress / 48h</span>
                <strong>{money(r.forecast.stressedPer1000)}</strong>
              </div>
              <div className="candidate-note">
                {
                  r.forecast.signals.find((s) => s.name === "Incentive runway")
                    ?.value
                }
                <small>
                  {
                    r.forecast.signals.find(
                      (s) => s.name === "Allocation pressure",
                    )?.value
                  }
                </small>
              </div>
              <button className="button secondary" onClick={() => open(r)}>
                Analyze →
              </button>
            </div>
          ))}
          {!list.length && (
            <div className="empty compact">
              No fresh candidates have complete priced estimates.
            </div>
          )}
        </div>
      </div>
      <div className="method-grid">
        <div className="panel text-panel">
          <h3>How the forecast changes the baseline</h3>
          <p>
            Once the history gate passes, fees use the lower of the current
            estimate and the latest six-hour median. Positive allocation growth
            over six hours is extended linearly to 48 hours, capped at a
            doubling. Outflows earn no forecast credit.
          </p>
        </div>
        <div className="panel text-panel">
          <h3>How uncertainty affects the ranking</h3>
          <p>
            There is no composite score or arbitrary weight. Exact incentive
            expiry affects revenue directly. Fee variability, APR volatility,
            volume spikes and uncalibrated allocator behavior remain visible
            signals. Missing inputs block a total.
          </p>
        </div>
      </div>
    </>
  );
}
function PoolPicker({
  row,
  rows,
  select,
}: {
  row: MarketRow;
  rows: MarketRow[];
  select: (id: string) => void;
}) {
  return (
    <select
      className="pool-picker"
      aria-label="Selected pool"
      value={row.snapshot.id}
      onChange={(e) => select(e.target.value)}
    >
      {[...rows]
        .sort(
          (a, b) =>
            (b.snapshot.rewards48hUsd ?? -1) - (a.snapshot.rewards48hUsd ?? -1),
        )
        .map((r) => (
          <option key={r.snapshot.id} value={r.snapshot.id}>
            {r.snapshot.token0.symbol}/{r.snapshot.token1.symbol} ·{" "}
            {r.snapshot.chain} · {short(r.snapshot.address)}
          </option>
        ))}
    </select>
  );
}
function Analysis({
  row,
  rows,
  select,
  mode,
  simulate: goSim,
}: {
  row: MarketRow;
  rows: MarketRow[];
  select: (s: string) => void;
  mode: Mode;
  simulate: () => void;
}) {
  const [days, setDays] = useState(2),
    [history, setHistory] = useState<HistoryPoint[]>([]),
    [error, setError] = useState("");
  const s = row.snapshot;
  useEffect(() => {
    const abort = new AbortController();
    setHistory([]);
    setError("");
    get<HistoryPoint[]>(
      `/api/history?mode=${mode}&pool=${s.id}&days=${days}`,
      abort.signal,
    )
      .then(setHistory)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [s.id, mode, days]);
  const charts: [keyof HistoryPoint, string, string][] = [
    ["stakeApr", "Stake APR", "% · estimate"],
    ["rewards48hUsd", "Pool rewards · next 48h", "USD · estimate"],
    ["allocation", "Allocation power", "observed reward supply"],
    ["volume48hUsd", "Trading volume", "USD · trailing source window"],
    [
      "eligibleFees48hUsd",
      "Eligible fee revenue",
      "USD · eligibility estimate",
    ],
    ["incentives48hUsd", "Scheduled incentives", "USD · next 48h estimate"],
  ];
  const events = history
    .flatMap((v, i) => {
      const p = history[i - 1];
      if (!p) return [];
      const e: string[] = [];
      if (
        p.stakeApr !== null &&
        p.stakeApr > 0 &&
        v.stakeApr !== null &&
        v.stakeApr / p.stakeApr > 1.5
      )
        e.push("APR increased more than 50%");
      if (
        p.allocation !== null &&
        p.allocation > 0 &&
        v.allocation !== null &&
        v.allocation / p.allocation > 1.2
      )
        e.push("Allocation power increased more than 20%");
      if (
        p.eligibleFees48hUsd !== null &&
        p.eligibleFees48hUsd > 0 &&
        v.eligibleFees48hUsd !== null &&
        Math.abs(v.eligibleFees48hUsd / p.eligibleFees48hUsd - 1) > 0.5
      )
        e.push("Eligible fee estimate changed more than 50%");
      return e.map((label) => ({ at: v.observedAt, label }));
    })
    .reverse()
    .slice(0, 8);
  return (
    <>
      <div className="pool-selection">
        <PoolPicker row={row} rows={rows} select={select} />
        <button className="button primary" onClick={goSim}>
          Simulate allocation →
        </button>
      </div>
      <section className="panel pool-summary">
        <Pair s={s} />
        <div>
          <span className="small-label">Pool identity</span>
          <code title={s.id}>{s.id}</code>
        </div>
        <div>
          <span className="small-label">Source block</span>
          <b>{s.block}</b>
        </div>
        <Badge tone={row.forecast.basis === "history" ? "good" : "warn"}>
          {row.forecast.basis === "history"
            ? "History available"
            : "Insufficient history"}
        </Badge>
      </section>
      <div className="stat-grid">
        <Stat
          label="Stake APR · estimate"
          value={pct(s.stakeApr)}
          detail="Uses allocation power value"
        />
        <Stat
          label="Pool rewards · next 48h"
          value={money(s.rewards48hUsd)}
          detail="Shared by all allocators"
        />
        <Stat
          label="Current reward supply"
          value={number(s.allocation, true)}
          detail="Decayed allocation power"
        />
        <Stat
          label="Configured cooldown"
          value={s.cooldownHours === null ? "—" : `${s.cooldownHours} hours`}
          detail="Per stake and network"
        />
      </div>
      <div className="section-line">
        <div>
          <h2>Observation history</h2>
          <p>
            {history.length} snapshots ·{" "}
            {history.length
              ? `${date(history[0].observedAt)} onward`
              : "Loading observation history"}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="History range">
          {[
            [1, "24h"],
            [2, "48h"],
            [7, "7d"],
            [30, "30d"],
          ].map(([n, label]) => (
            <button
              className={days === n ? "selected" : ""}
              key={n}
              onClick={() => setDays(Number(n))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="notice danger">{error}</div>}
      <div className="chart-grid">
        {charts.map(([key, label, unit]) => (
          <div className="panel chart-card" key={key}>
            <div className="chart-heading">
              <h3 title={metricInfo[key]}>
                {label} <span className="info">ⓘ</span>
              </h3>
              <span>{unit}</span>
            </div>
            {history.some((s) => s[key] !== null) ? (
              <>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={history}
                      margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="#e8edee"
                        strokeDasharray="3 4"
                      />
                      <XAxis
                        dataKey="observedAt"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(t) =>
                          new Date(Number(t) * 1000)
                            .toISOString()
                            .slice(days > 2 ? 5 : 11, days > 2 ? 10 : 16)
                        }
                        tick={{ fontSize: 10, fill: "#819096" }}
                        minTickGap={60}
                      />
                      <YAxis
                        width={58}
                        tickFormatter={(v) => number(Number(v), true)}
                        tick={{ fontSize: 10, fill: "#819096" }}
                        domain={[0, "auto"]}
                      />
                      <Tooltip
                        labelFormatter={(t) => date(Number(t))}
                        formatter={(v) =>
                          key === "stakeApr"
                            ? pct(Number(v))
                            : key === "allocation"
                              ? number(Number(v))
                              : money(Number(v))
                        }
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid #d9e1e3",
                        }}
                      />
                      <Line
                        type="linear"
                        dataKey={key}
                        name={label}
                        stroke="#14877f"
                        strokeWidth={2}
                        dot={history.length < 3 ? { r: 4 } : false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {history.length < 2 && (
                  <div className="chart-caption">
                    First observation saved. A trend needs more snapshots.
                  </div>
                )}
              </>
            ) : (
              <div className="chart-empty">
                No supported observations in this window.
                <small>Missing values are not plotted as zero.</small>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="section-line">
        <div>
          <h2>Persistence signals</h2>
          <p>
            Every signal has an explicit interpretation. None is a probability.
          </p>
        </div>
      </div>
      <div className="signals-grid">
        {row.forecast.signals.map((signal) => (
          <div className="panel signal" key={signal.name}>
            <span className="small-label">{signal.name}</span>
            <b className={signal.severity === "warn" ? "warning-text" : ""}>
              {signal.value}
            </b>
            <p>{signal.detail}</p>
          </div>
        ))}
      </div>
      <div className="method-grid">
        <div className="panel text-panel">
          <h3>Changes worth investigating</h3>
          {row.forecast.basis === "insufficient" && (
            <div className="event">
              <Badge tone="warn">New history</Badge>
              <span>Insufficient history to establish APR persistence.</span>
            </div>
          )}
          {events.map((e, i) => (
            <div className="event" key={i}>
              <small>{date(e.at)}</small>
              <span>{e.label}</span>
            </div>
          ))}
          {!events.length && (
            <p>No threshold changes detected in the available observations.</p>
          )}
        </div>
        <div className="panel text-panel">
          <h3>Incentive schedule</h3>
          {s.programs === null ? (
            <p>Schedule unavailable.</p>
          ) : (
            s.programs
              .filter(
                (p) => p.end > s.observedAt && p.start < s.observedAt + HORIZON,
              )
              .map((p) => (
                <div className="program" key={p.id}>
                  <b>
                    {p.token.symbol} <small>#{p.id}</small>
                  </b>
                  <span>
                    {money(
                      incentives([p], s.observedAt, s.observedAt + HORIZON),
                    )}{" "}
                    / next 48h
                  </span>
                  <small>
                    Starts {date(p.start)}
                    <br />
                    Ends {date(p.end)}
                  </small>
                  {p.end < s.observedAt + HORIZON && (
                    <Badge tone="warn">Expires within forecast</Badge>
                  )}
                </div>
              ))
          )}
          {s.programs?.length === 0 && (
            <p>No incentive programs returned by the rewards contract.</p>
          )}
        </div>
      </div>
      <details className="panel assumptions">
        <summary>
          Source limitations and assumptions ({s.warnings.length})
        </summary>
        {s.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p>
          Source activity window: {date(s.windowStart)} → {date(s.windowEnd)}.
          Observed at {date(s.observedAt)}. Block hash:{" "}
          <code>{s.blockHash}</code>.
        </p>
      </details>
    </>
  );
}
function Simulator({
  row,
  rows,
  select,
}: {
  row: MarketRow;
  rows: MarketRow[];
  select: (s: string) => void;
}) {
  const [fields, setFields] = useLocal<Record<string, string>>("gc-simulator", {
    power: "1000",
    existingPower: "0",
    stakeValueUsd: "",
    remainingDays: "",
    activationDelayHours: "0",
  });
  const input: SimulationInput = {
    power: Number(fields.power),
    existingPower: Number(fields.existingPower),
    stakeValueUsd:
      fields.stakeValueUsd === "" ? null : Number(fields.stakeValueUsd),
    remainingDays:
      fields.remainingDays === "" ? null : Number(fields.remainingDays),
    activationDelayHours: Number(fields.activationDelayHours),
  };
  const outputs = SCENARIOS.map((s) => ({
    ...s,
    ...simulate(row.snapshot, row.forecast.projectedFees, input, s),
  }));
  return (
    <>
      <div className="pool-selection">
        <PoolPicker row={row} rows={rows} select={select} />
        <Badge>Inputs stay in this browser</Badge>
      </div>
      <div className="simulator-layout">
        <section className="panel simulator-inputs">
          <h2>Your allocation</h2>
          <p>Enter power manually. No wallet or address needed.</p>
          {[
            [
              "power",
              "Allocation power",
              "Total power you intend to direct to this pool.",
            ],
            [
              "existingPower",
              "Already allocated to this pool",
              "Power already included in the current pool total; subtract it before adding your intended allocation.",
            ],
            [
              "stakeValueUsd",
              "Stake value in USD · optional",
              "Your capital denominator for personal APR. Blank means APR is unavailable.",
            ],
            [
              "remainingDays",
              "Fixed stake remaining days · optional",
              "Blank models a perpetual stake. A fixed stake’s power decays linearly to zero.",
            ],
            [
              "activationDelayHours",
              "Activation delay in hours",
              "Earnings begin after the assumed delay, within the 48-hour horizon.",
            ],
          ].map(([key, label, help]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min="0"
                step="any"
                max={key === "activationDelayHours" ? 48 : undefined}
                value={fields[key]}
                onChange={(e) =>
                  setFields({ ...fields, [key]: e.target.value })
                }
              />
              <small>{help}</small>
            </label>
          ))}
          <div className="privacy-note">
            ⌂ Saved only in local browser storage.
          </div>
        </section>
        <div>
          <section className="panel sim-result">
            <div className="panel-header">
              <Pair s={row.snapshot} />
              <Badge tone="warn">Hypothetical</Badge>
            </div>
            <div className="earnings">
              <span>Estimated earnings · next 48 hours</span>
              <strong>{money(outputs[0].earnings)}</strong>
              <p>
                {outputs[0].error ??
                  `${pct(outputs[0].share === null ? null : outputs[0].share * 100)} initial share after your allocation`}
              </p>
            </div>
            <div className="sim-facts">
              <div>
                <span>Personal capital APR</span>
                <b>{pct(outputs[0].apr)}</b>
                <small>
                  {input.stakeValueUsd === null
                    ? "Enter stake value to calculate"
                    : "Annualized, without compounding"}
                </small>
              </div>
              <div>
                <span>Pool eligible fee forecast</span>
                <b>{money(row.forecast.projectedFees)}</b>
                <small>
                  {row.forecast.basis === "history"
                    ? "Conservative history heuristic"
                    : "Current baseline · insufficient history"}
                </small>
              </div>
              <div>
                <span>Scheduled pool incentives</span>
                <b>{money(row.forecast.projectedIncentives)}</b>
                <small>Stops at program expiry</small>
              </div>
            </div>
          </section>
          <section className="panel scenario-panel">
            <div className="panel-header">
              <div>
                <h2>What changes your return?</h2>
                <p>
                  Competing allocation shocks apply immediately to other
                  allocators.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Your earnings / 48h</th>
                    <th>Capital APR</th>
                    <th>vs. baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((s, i) => (
                    <tr key={s.label}>
                      <td>
                        {s.label}
                        {i === 0 && (
                          <small>
                            Fixed competing power, scheduled revenue
                          </small>
                        )}
                      </td>
                      <td className="emphasis">{money(s.earnings)}</td>
                      <td>{pct(s.apr)}</td>
                      <td className={i === 0 ? "" : "negative"}>
                        {s.earnings === null ||
                        outputs[0].earnings === null ||
                        outputs[0].earnings === 0
                          ? "—"
                          : `${((s.earnings / outputs[0].earnings - 1) * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="panel text-panel formula">
            <span className="eyebrow">THE MODEL</span>
            <h3>Your share × revenue, integrated over time</h3>
            <code>
              share(t) = your power(t) / [other power(t) + your power(t)]
            </code>
            <p>
              Fees use a constant rate over the forecast window. Incentives use
              actual program times. Optional stake decay and activation delay
              change your share. The revenue-down scenario halves all USD
              revenue, including incentive token value.
            </p>
            <p>
              Competition scenarios hold other power constant after the
              immediate shock. They do not include endogenous liquidity changes,
              price moves, bridging fees, gas, or exact contract rounding. These
              are estimates, not claimable balances.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
interface PerformanceData {
  evaluations: Evaluation[];
  decisions: { at: number; choices: Record<string, string | null> }[];
  scope: string;
  totalStored: number;
}
function Performance({ mode, rows }: { mode: Mode; rows: MarketRow[] }) {
  const [data, setData] = useState<PerformanceData | null>(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    setPage(0);
    get<PerformanceData>(`/api/performance?mode=${mode}`, abort.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [mode]);
  if (error) return <div className="notice danger">{error}</div>;
  if (!data)
    return <div className="loading">Evaluating stored forecast windows…</div>;
  const done = data.evaluations.filter((e) => e.status === "proxy"),
    pending = data.evaluations.filter((e) => e.status === "pending");
  const mean = (key: "revenueError" | "returnError") => {
    const a = done.flatMap((e) => (e[key] === null ? [] : [e[key]!]));
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };
  const byId = new Map(data.evaluations.map((e) => [e.forecastId, e]));
  const pools = new Map(rows.map((r) => [r.snapshot.id, r.snapshot]));
  const priority = { proxy: 0, insufficient: 1, pending: 2 };
  const ledger = data.evaluations
    .filter((e) => filter === "all" || e.status === filter)
    .sort(
      (a, b) => priority[a.status] - priority[b.status] || b.dueAt - a.dueAt,
    );
  const pages = Math.max(1, Math.ceil(ledger.length / 25));
  const benchmarkNames: Record<string, string> = {
    persistence: "Persistence stress ranking",
    highestApr: "Highest current Stake APR",
    highestRewards: "Highest estimated pool rewards",
    highestFees: "Highest eligible fee estimate",
  };
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Frozen forecasts stored"
          value={number(data.totalStored)}
          detail="Inputs and model saved at prediction time"
        />
        <Stat
          label="Evaluated return proxies"
          value={number(done.length)}
          detail="Require mature windows and adequate coverage"
        />
        <Stat
          label="Revenue mean absolute error"
          value={money(mean("revenueError"))}
          detail="Versus the observed-window proxy"
        />
        <Stat
          label="Return mean absolute error"
          value={money(mean("returnError"))}
          detail="USD / 1,000 additional power"
        />
      </div>
      {done.length === 0 && (
        <div className="notice warning">
          <b>No completed return evaluation yet.</b> {pending.length} forecasts
          in this view are still inside their 48-hour window. Results will
          appear only after sufficient genuine observations are available.
        </div>
      )}
      <div className="notice">
        <b>Evaluation is an observed-data proxy.</b> Trailing eligible fees are
        approximated at the endpoint, fee timing is uniform, incentives use
        their actual schedules, and allocation shares use collected snapshots.
        This is not a wallet’s realized return or an event-level backtest.
        Overlapping trailing windows are never summed.
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Strategy benchmarks</h2>
            <p>
              Selections were saved at collection time. Equal reference power;
              no hindsight reselection.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Selection rule</th>
                <th>Completed selections</th>
                <th>Mean observed return proxy / 48h</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(benchmarkNames).map(([key, label]) => {
                // Compare strategies only on identical, fully evaluated cohorts.
                const paired = data.decisions.filter((d) =>
                  Object.keys(benchmarkNames).every(
                    (k) =>
                      d.choices[k] &&
                      byId.get(d.choices[k]!)?.status === "proxy",
                  ),
                );
                const e = paired.map((d) => byId.get(d.choices[key]!)!);
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{e.length}</td>
                    <td>
                      {money(
                        e.length
                          ? e.reduce(
                              (s, e) => s + (e.observedReturnProxy ?? 0),
                              0,
                            ) / e.length
                          : null,
                      )}
                    </td>
                    <td>
                      {e.length
                        ? "Matched complete cohorts"
                        : "Insufficient matched history"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel performance-table">
        <div className="panel-header">
          <div>
            <h2>Forecast ledger</h2>
            <p>{data.scope}</p>
          </div>
          <Badge>
            {mode === "demo" ? "Synthetic evaluation" : "Observation history"}
          </Badge>
        </div>
        <div className="toolbar">
          <select
            aria-label="Forecast status"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All forecasts · evaluated first</option>
            <option value="proxy">Evaluated proxies</option>
            <option value="pending">Awaiting 48h</option>
            <option value="insufficient">Incomplete observations</option>
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Pool / maturity (UTC)</th>
                <th>Revenue forecast → proxy</th>
                <th>Revenue error</th>
                <th>Allocation forecast → observed</th>
                <th>Allocation error</th>
                <th>Return forecast → proxy</th>
                <th>Return error</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ledger.slice(page * 25, (page + 1) * 25).map((e) => (
                <tr key={e.forecastId}>
                  <td>
                    <b>
                      {pools.has(e.poolId)
                        ? `${pools.get(e.poolId)!.token0.symbol}/${pools.get(e.poolId)!.token1.symbol}`
                        : "Pool"}
                    </b>
                    <small>
                      <code title={e.poolId}>{short(e.poolId)}</code>
                    </small>
                    <small>{date(e.dueAt)}</small>
                  </td>
                  <td>
                    {money(e.projectedRevenue)} →{" "}
                    {money(e.observedRevenueProxy)}
                  </td>
                  <td>
                    {money(e.revenueError)}
                    <small>{pct(e.revenuePctError)}</small>
                  </td>
                  <td>
                    {number(e.projectedAllocation, true)} →{" "}
                    {number(e.observedAllocation, true)}
                  </td>
                  <td>
                    {number(e.allocationError, true)}
                    <small>{pct(e.allocationPctError)}</small>
                  </td>
                  <td>
                    {money(e.estimatedReturn)} → {money(e.observedReturnProxy)}
                  </td>
                  <td>
                    {money(e.returnError)}
                    <small>{pct(e.returnPctError)}</small>
                  </td>
                  <td title={e.reason}>
                    <Badge tone={e.status === "proxy" ? "good" : "warn"}>
                      {e.status === "proxy"
                        ? "Evaluated proxy"
                        : e.status === "pending"
                          ? "Awaiting 48h"
                          : "Incomplete data"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{ledger.length} forecasts in this filter</span>
          <div>
            <button
              aria-label="Previous forecast page"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button
              aria-label="Next forecast page"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        </div>
      </section>
      <div className="panel text-panel">
        <h3>What this evaluation can tell you</h3>
        <p>
          Revenue and allocation errors are reported separately. Percentage
          error is unavailable when the observed denominator is zero. Benchmark
          means use only cohorts where every strategy has a complete evaluation,
          and represent independent 48-hour holds rather than a compounded
          strategy.
        </p>
        <p>
          These overlapping forecast cohorts are correlated. The MVP does not
          claim statistical significance, calibrated accuracy or measured wallet
          returns. Stored fee-accumulator changes provide an additional
          per-power check when both token prices exist; exact counterfactual
          accounting needs event-level reconstruction.
        </p>
      </div>
    </>
  );
}
