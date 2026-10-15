import { Timestamp } from "../components/Timestamp";
/** Overview: stat tiles, validator table, signing heatmap and analytics row. */
import { useEffect, useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getSeries, type Series, type Validator } from "../api";
import { ValidatorSummary } from "../components/ValidatorSummary";
import { OverviewWatchlist, OverviewQuickInsights } from "../components/OverviewWatchlist";
import { blockTimeSummary, previousHourChange } from "../overviewStats";
import { Pipeline } from "../components/Pipeline";
import { UpgradeBanner } from "../components/Secret";
import {
  BAD,
  BRAND,
  Bar,
  CopyButton,
  EmptyState,
  Label,
  TimeSeriesChart,
  OK,
  Section,
  ValidatorAvatar,
  Skeleton,
  StatusPill,
  TX,
  TX2,
  TX3,
  WARN,
  mono,
  panel,
  sans,
} from "../components/ui";
import { area, clampPct, fill, fmt, pct, pts, secs, short } from "../lib";


export function Overview({
  d,
  live,
  selected,
  onSelect,
  copied,
  onCopy,
}: {
  d: Dashboard;
  live: boolean;
  selected: string | null;
  onSelect: (a: string) => void;
  copied: string | null;
  onCopy: (v: string) => void;
}) {
  const loading = d.state === "loading";
  const dash = d.state === "empty" || d.state === "dberror";
  const backfill = d.state === "backfill";
  const stopped = d.state === "stopped";
  const net = d.net;
  const [history, setHistory] = useState<Series | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void getSeries(120, 120).then((result) => { if (!cancelled) setHistory(result); }).catch(() => { if (!cancelled) setHistory(null); }); };
    refresh();
    const timer = live ? window.setInterval(refresh, 60_000) : undefined;
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [live]);
  const blockStats = blockTimeSummary(d.series?.points ?? []);
  const hourChange = history ? previousHourChange(d.series?.points ?? [], history.points, d.lastUpdated?.getTime() ?? Date.now()) : null;
  const inspectValidator = (address: string) => {
    onSelect(address);
    window.location.hash = "/validators";
  };

  const blocksSeries = useMemo(
    () => (d.series?.points ?? []).slice(-24).map((p) => p.n),
    [d.series],
  );
  const btSeries = useMemo(
    () => fill((d.series?.points ?? []).map((p) => p.block_time_s)),
    [d.series],
  );
  // "+N in last 10 min" — the trailing ten one-minute buckets.
  const last10 = useMemo(
    () => (d.series?.points ?? []).slice(-10).reduce((a, p) => a + p.n, 0),
    [d.series],
  );

  return (
    <div className="overview-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {loading ? (
        <div className="g5 tiles-sticky">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{ ...panel, padding: "15px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Skeleton h={9} w="64%" />
              <Skeleton h={26} w="78%" r={6} />
              <Skeleton h={22} w="100%" r={5} />
            </div>
          ))}
        </div>
      ) : (
        <div className="g5 tiles-sticky">
          <HeightTile
            dash={dash}
            stopped={stopped}
            height={net?.latest_indexed_height ?? null}
            last10={last10}
            spark={blocksSeries}
            lastBlock={net?.last_block_time ?? null}
          />
          <BlockTimeTile dash={dash} ms={net?.avg_block_time_ms ?? null} spark={btSeries} />
          <SigningTile dash={dash} net={net} />
          <ValidatorsTile dash={dash} d={d} />
          <LagTile dash={dash} d={d} />
        </div>
      )}

      <UpgradeBanner d={d} />

      <Pipeline live={live} />

      <div className="overview-main-grid">
        <div className="overview-column overview-primary">
          <ValidatorTable
            d={d}
            selected={selected}
            onSelect={onSelect}
            copied={copied}
            onCopy={onCopy}
            backfill={backfill}
          />
        </div>
        <div className="overview-column overview-secondary">
          <ValidatorSummary d={d} health={verdictFor(d)} onInspect={inspectValidator} />
        </div>
      </div>
      <div className="overview-analytics-row">
        <NetworkHealth d={d} dash={dash} />
        <MiniChart
          title="Block Time"
          now={secs(blockStats.latest)}
          series={btSeries}
          times={d.series?.points ?? []}
          min={Math.min(3, Math.floor(blockStats.min ?? 3))}
          max={Math.max(9, Math.ceil(blockStats.max ?? 9))}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
          dash={dash || !blockStats.count}
          stats={blockStats}
          change={dash || d.state === "stopped" ? null : hourChange}
          formatValue={(v) => `${v.toFixed(2)}s`}
        />
        <SetChanges d={d} onInspect={inspectValidator} />
      </div>
      <div className="overview-bottom-row">
        <OverviewWatchlist d={d} onInspect={inspectValidator} />
        <OverviewQuickInsights d={d} />
      </div>
    </div>
  );
}

/* ── stat tiles ─────────────────────────────────────────────────────────── */

const tile: React.CSSProperties = {
  ...panel,
  padding: "15px 16px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};

const bigValue: React.CSSProperties = {
  font: `600 31px/1 ${mono}`,
  letterSpacing: "-.02em",
};

function HeightTile({
  dash,
  stopped,
  height,
  last10,
  spark,
  lastBlock,
}: {
  dash: boolean;
  stopped: boolean;
  height: number | null;
  last10: number;
  spark: number[];
  lastBlock: string | null;
}) {
  const max = Math.max(1, ...spark);
  return (
    <div className="overview-stat-tile overview-height-tile" style={tile}>
      <MetricHeading icon="block" label="Latest Indexed Height" />
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash ? "—" : fmt(height)}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: `500 14px/1.3 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
          {dash ? "no blocks" : stopped ? <>stalled <Timestamp value={lastBlock} /></> : `+${fmt(last10)} in last 10 min`}
        </span>
        {!dash && spark.length > 1 && (
          <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ flex: "none", overflow: "visible" }}>
            <path d={area(spark, 76, 26, 0, max)} fill="var(--brandSoft)" />
            <polyline
              points={pts(spark, 76, 26, 0, max)}
              fill="none"
              stroke={BRAND}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

function BlockTimeTile({ dash, ms, spark }: { dash: boolean; ms: number | null; spark: number[] }) {
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="clock" label="Avg Block Time" />
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>
        {dash || ms === null ? "—" : secs(ms / 1000)}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: `500 14px/1.3 ${sans}`, color: TX2 }}>last 100 blocks</span>
        <div style={{ position: "relative", flex: "none" }}>
          <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ display: "block", overflow: "visible" }}>
            <line x1="0" y1="0.5" x2="76" y2="0.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            <line x1="0" y1="25.5" x2="76" y2="25.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            {!dash && spark.length > 1 && (
              <polyline
                points={pts(spark.slice(-24), 76, 26, 2, 6)}
                fill="none"
                stroke={OK}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>
          <span style={{ position: "absolute", right: -2, top: -11, font: `400 12px/1 ${mono}`, color: TX3 }}>6s</span>
          <span style={{ position: "absolute", right: -2, bottom: -11, font: `400 12px/1 ${mono}`, color: TX3 }}>2s</span>
        </div>
      </div>
    </div>
  );
}

function SigningTile({ dash, net }: { dash: boolean; net: Dashboard["net"] }) {
  const rate = net?.signing_rate_100 ?? null;
  const degraded = rate !== null && rate < 99.5;
  const segs =
    dash || !net
      ? new Array(100).fill(null).map(() => "var(--line)")
      : padStart(
          net.recent_signing.map((b) =>
            b.total && b.signed !== null && b.signed < b.total
              ? BAD
              : "color-mix(in srgb, var(--ok) 78%, transparent)",
          ),
          100,
          "var(--line)",
        );
  const signedNow = net?.recent_signing.at(-1);
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="signing" label="Signing Rate" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : degraded ? WARN : TX }}>
          {dash ? "—" : pct(rate)}
        </span>
        <span style={{ font: `500 14px/1 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
          {dash || !signedNow ? "" : `${signedNow.signed ?? 0} / ${signedNow.total ?? 0} signed`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", gap: 1, height: 18, alignItems: "stretch" }}>
          {segs.map((g, i) => (
            <div key={i} style={{ flex: 1, borderRadius: 1, background: g }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", font: `400 12px/1 ${mono}`, color: TX3 }}>
          <span>−100</span>
          <span>now</span>
        </div>
        {/* Power-weighted view of the same window: what fraction of the set's
            voting power actually committed (namada reference). */}
        <span
          title="share of the set's voting power that committed over the last 100 blocks"
          style={{ font: `500 13px/1 ${sans}`, color: TX3 }}
        >
          power online{" "}
          <strong style={{ color: net?.signing_power_online !== null && (net?.signing_power_online ?? 0) < 100 ? WARN : OK }}>
            {dash || !net || net.signing_power_online === null ? "—" : pct(net.signing_power_online)}
          </strong>
        </span>
      </div>
    </div>
  );
}

function ValidatorsTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const net = d.net;
  const dots = d.validators.length
    ? d.validators.map((v) =>
        dash
          ? "var(--line)"
          : v.status === "degraded"
            ? WARN
            : v.status === "inactive"
              ? "var(--line2)"
              : "color-mix(in srgb, var(--ok) 70%, transparent)",
      )
    : new Array(20).fill("var(--line)");
  return (
    <div className="overview-stat-tile" style={tile}>
      <MetricHeading icon="validators" label="Active Validators" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : TX }}>
          {dash ? "—" : fmt(net?.active_validators ?? 0)}
        </span>
        <span style={{ font: `500 19px/1 ${mono}`, color: TX3 }}>
          {dash ? "" : `/ ${net?.total_validators ?? 0}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {dots.map((c, i) => (
            <div key={i} style={{ flex: 1, height: 14, borderRadius: 2, background: c }} />
          ))}
        </div>
      </div>
      <span style={{ font: `500 14px/1.3 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
        {dash
          ? "set unknown"
          : net?.last_set_change
            ? <>last change <Timestamp value={net.last_set_change.time} /></>
            : "no membership change recorded"}
      </span>
    </div>
  );
}

function LagTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const lag = d.net?.indexer_lag_blocks ?? null;
  const unknown = lag === null;
  const warn = lag !== null && lag > 50;
  const fg = dash || unknown ? TX3 : warn ? WARN : OK;
  const icon = dash || unknown || warn ? "M10 6v5M10 14h.01" : "M4 10.5l4 4 8-9";
  return (
    <div
      className="overview-stat-tile overview-lag-tile"
      style={{
        ...tile,
        border: `1px solid ${warn ? "var(--warn)" : "var(--line)"}`,
      }}
    >
      <MetricHeading icon="lag" label="Indexer Lag" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...bigValue, color: fg }}>{dash || unknown ? "—" : fmt(lag)}</span>
        <span style={{ font: `500 15px/1 ${sans}`, color: TX3 }}>
          {dash || unknown ? "" : "blocks"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: "auto" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            flex: "none",
            background: dash || unknown ? "var(--panel2)" : warn ? "var(--warnSoft)" : "var(--okSoft)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke={fg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </span>
        <span style={{ font: `600 14px/1.3 ${sans}`, whiteSpace: "nowrap", color: fg }}>
          {dash
            ? "Not started"
            : unknown
              ? "Chain head unavailable"
              : warn
                ? "Behind chain head"
                : "Up to date"}
        </span>
      </div>
    </div>
  );
}

function padStart<T>(arr: T[], n: number, filler: T): T[] {
  if (arr.length >= n) return arr.slice(-n);
  return new Array(n - arr.length).fill(filler).concat(arr);
}

type MetricIcon = "block" | "clock" | "signing" | "validators" | "lag" | "health" | "changes";

function MetricHeading({ icon, label }: { icon: MetricIcon; label: string }) {
  return (
    <div className="metric-heading">
      <MetricGlyph icon={icon} />
      <Label>{label}</Label>
    </div>
  );
}

function MetricGlyph({ icon }: { icon: MetricIcon }) {
  const paths: Record<MetricIcon, string> = {
    block: "M10 2.7 16.2 6v8L10 17.3 3.8 14V6L10 2.7ZM3.8 6 10 9.4 16.2 6M10 9.4v7.9",
    clock: "M10 3.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6ZM10 6.2v4l2.7 1.7",
    signing: "m4 15 1.2-3.8L13.8 2.6a1.7 1.7 0 0 1 2.4 2.4L7.6 13.7 4 15Zm2.2-2.2 2.2 2.2M11.5 15.8H17",
    validators: "M10 9a2.7 2.7 0 1 0 0-5.4A2.7 2.7 0 0 0 10 9Zm-5.3 7.2c.2-3 2-4.7 5.3-4.7s5.1 1.7 5.3 4.7M4.2 9a2.2 2.2 0 0 1 2-3.4M15.8 9a2.2 2.2 0 0 0-2-3.4",
    lag: "M4 6.2 10 3l6 3.2-6 3.3-6-3.3ZM4 10.1l6 3.2 6-3.2M4 14l6 3 6-3",
    health: "M10 16.8S3.2 13 3.2 8.5A3.4 3.4 0 0 1 10 7.1a3.4 3.4 0 0 1 6.8 1.4c0 4.5-6.8 8.3-6.8 8.3Z",
    changes: "M6.3 8.6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM13.8 9.2a2.2 2.2 0 1 0 0-4.4M2.8 16.5c.2-3 1.3-4.5 3.5-4.5s3.3 1.5 3.5 4.5M11.2 12.2c2.8-.9 4.7.5 5.2 3.8",
  };
  return <span className={`metric-glyph metric-glyph-${icon}`} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} /></svg></span>;
}

/* ── validator table ────────────────────────────────────────────────────── */

function ValidatorTable({
  d, selected, onSelect, copied, onCopy, backfill,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
  copied: string | null;
  onCopy: (v: string) => void;
  backfill: boolean;
}) {
  const loading = d.state === "loading";
  const empty = d.state === "empty" || d.state === "dberror";
  return (
    <Section
      className="overview-validators"
      bodyStyle={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      title="Validators"
      aside={<span className="overview-validator-scale">Uptime meters scaled 98–100%</span>}
    >
      {loading && <div className="overview-validator-loading">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={42} w="100%" />)}
      </div>}
      {empty && <EmptyState
        title={d.state === "dberror" ? "No data available" : "Awaiting RPC"}
        text={d.state === "dberror"
          ? "The validator set cannot be read while the database is unreachable."
          : "No blocks indexed yet. Validators appear once the first commit is ingested."}
      />}
      {!loading && !empty && <>
        <div className="overview-validator-scroll" tabIndex={0} role="region" aria-label="Validator uptime and proposer activity">
          <div className="overview-validator-grid overview-validator-columns">
            <span>#</span><span>Validator / consensus address</span><span>Uptime 1k</span>
            <span>Uptime 10k</span><span className="overview-validator-missed">Miss</span>
            <span>Proposer 1k</span><span className="overview-validator-status">Status</span>
          </div>
          {d.validators.map((v) => <Row key={v.address} v={v} selected={v.address === selected}
            onSelect={onSelect} copied={copied === v.address} onCopy={onCopy}
            longTarget={d.net?.long_window.target ?? 10_000} />)}
        </div>
        <footer className="overview-validator-footer">
          <span><strong>{d.validators.length}</strong> validators <span aria-hidden="true">·</span> Scroll to explore</span>
          <span>{backfill ? `Long window ${longPct(d)}% backfilled` : "Monikers and stake from x/staking · local labels"}</span>
        </footer>
      </>}
    </Section>
  );
}

function longPct(d: Dashboard): number {
  const w = d.net?.long_window;
  if (!w) return 0;
  return Math.round((w.filled / w.target) * 100);
}

function uptimeColor(v: number | null, degraded: boolean): string {
  if (v === null) return TX3;
  if (degraded) return WARN;
  return v >= 99.9 ? OK : TX;
}

function Row({ v, selected, onSelect, copied, onCopy, longTarget }: {
  v: Validator;
  selected: boolean;
  onSelect: (a: string) => void;
  copied: boolean;
  onCopy: (v: string) => void;
  longTarget: number;
}) {
  const deg = v.status === "degraded";
  const partial = v.slots_10000 < longTarget;
  return (
    <div className={`overview-validator-grid overview-validator-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(v.address)} role="button" tabIndex={0}
      aria-pressed={selected} aria-label={`Select ${v.moniker ?? v.address}`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(v.address); }
      }}>
      <span className="overview-validator-rank">{v.rank}</span>
      <div className="overview-validator-identity">
        <ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} title={v.moniker ?? undefined} size={30} />
        <div className="overview-validator-name">
          <strong title={v.moniker ?? v.address}>{v.moniker ?? short(v.address)}</strong>
          <div className="overview-validator-address"><span title={v.address}>{short(v.address)}</span><CopyButton value={v.address} copied={copied} onCopy={onCopy} /></div>
        </div>
      </div>
      <div className="overview-validator-meter">
        <span style={{ color: uptimeColor(v.uptime_1000, deg) }}>{pct(v.uptime_1000)}</span>
        <Bar width={v.uptime_1000 === null ? "0%" : clampPct(v.uptime_1000, 98, 100)} color={uptimeColor(v.uptime_1000, deg)} />
      </div>
      <div className="overview-validator-meter">
        <span style={{ color: partial ? WARN : uptimeColor(v.uptime_10000, deg) }}>
          {partial ? `${fmt(v.slots_10000)} / ${longTarget / 1000}k` : pct(v.uptime_10000, 2)}
        </span>
        <Bar width={partial ? `${Math.min(100, Math.round((v.slots_10000 / longTarget) * 100))}%`
          : v.uptime_10000 === null ? "0%" : clampPct(v.uptime_10000, 98, 100)}
          color={partial ? "repeating-linear-gradient(115deg,var(--warn) 0 3px,transparent 3px 6px)" : uptimeColor(v.uptime_10000, deg)} />
      </div>
      <span className="overview-validator-missed" style={{ color: v.missed_streak >= 3 ? BAD : v.missed_streak > 0 ? WARN : TX3 }}>{v.missed_streak}</span>
      <div className="overview-validator-meter">
        <span>{pct(v.proposer_share_1000)}</span>
        <Bar width={clampPct(v.proposer_share_1000 ?? 0, 0, 10)} color={BRAND} />
      </div>
      <span className="overview-validator-status"><StatusPill status={v.status} /></span>
    </div>
  );
}

/* ── analytics row ──────────────────────────────────────────────────────── */

function NetworkHealth({ d, dash }: { d: Dashboard; dash: boolean }) {
  const net = d.net;
  const rate = net?.signing_rate_100 ?? null;
  const bt = net?.avg_block_time_ms !== null && net?.avg_block_time_ms !== undefined ? net.avg_block_time_ms / 1000 : null;
  const blocks24 = net?.blocks_indexed_24h ?? 0;
  // Without a measured block time there is no honest daily expectation, so the
  // meter reports the count and says the target is unknown rather than
  // inventing one.
  const expected = bt ? Math.round(86_400 / bt) : null;
  const behind = expected !== null && blocks24 < expected * 0.9;

  const verdict = verdictFor(d);

  const meters = dash || d.state === "loading"
    ? [
        { label: "Signing rate", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "Target ≥ 99.5%", range: ["0%", "100%"] },
        { label: "Average block time", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "Target ≤ 7s · last 100 blocks", range: ["0s", "7s"] },
        { label: "Blocks indexed · 24h", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "Waiting for indexed blocks", range: ["0", "—"] },
      ]
    : [
        {
          label: "Signing rate",
          value: pct(rate),
          w: rate === null ? "0%" : clampPct(rate, 0, 100),
          bg: rate !== null && rate < 99.5 ? WARN : OK,
          c: rate !== null && rate < 99.5 ? WARN : OK,
          scale: "Target ≥ 99.5%",
          range: ["0%", "100%"],
        },
        {
          label: "Average block time",
          value: secs(bt),
          w: bt === null ? "0%" : clampPct(bt, 0, Math.max(7, Math.ceil(bt))),
          bg: bt !== null && bt > 7 ? WARN : OK,
          c: bt !== null && bt > 7 ? WARN : OK,
          scale: "Target ≤ 7s · last 100 blocks",
          range: ["0s", `${Math.max(7, Math.ceil(bt ?? 7))}s`],
        },
        {
          label: "Blocks indexed · 24h",
          value: fmt(blocks24),
          w: expected === null ? "0%" : clampPct(blocks24, 0, Math.max(expected, blocks24)),
          bg: expected === null ? "var(--line)" : behind ? WARN : OK,
          c: expected === null ? TX3 : behind ? WARN : OK,
          scale: expected === null ? "Expected count unavailable" : `≈ ${fmt(expected)} expected at this pace`,
          range: ["0", expected === null ? "—" : fmt(Math.max(expected, blocks24))],
        },
      ];

  return (
    <section className="overview-health-card" style={panel}>
      <header className="overview-health-heading">
        <div className="analytics-heading"><MetricGlyph icon="health" /><h3>Network Health</h3></div>
        <span className="overview-health-verdict" style={{ color: verdict.color }}><i />{verdict.text}</span>
      </header>
      <p className="overview-health-description">{d.state === "loading" ? "Checking recent network activity…" : d.state === "dberror" ? "Network health is temporarily unavailable." : d.state === "stopped" ? "Indexer stopped. Showing last known activity." : d.state === "empty" ? "Waiting for the first indexed blocks." : verdict.text === "Healthy" ? "Overall network status is operating normally." : "Some validators need attention."}</p>
      <div className="overview-health-meters">
        {meters.map((m) => (
          <div className="overview-health-metric" key={m.label}>
            <div className="overview-health-metric-row"><span>{m.label}</span><strong style={{ color: m.c }}>{m.value}</strong></div>
            <p>{m.scale}</p>
            <Bar width={m.w} color={m.bg} h={4} />
            <div className="overview-health-range"><span>{m.range[0]}</span><span>{m.range[1]}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function verdictFor(d: Dashboard): { text: string; color: string } {
  if (d.state === "dberror") return { text: "Unknown — no data", color: BAD };
  if (d.state === "stopped") return { text: "Stale — indexer stopped", color: WARN };
  if (d.state === "empty") return { text: "Bootstrapping", color: TX3 };
  if (d.state === "loading") return { text: "Loading", color: TX3 };
  const bad = d.validators.filter((v) => v.status === "degraded").length;
  if (bad > 0)
    return {
      text: `Degraded signing on ${bad} validator${bad === 1 ? "" : "s"}`,
      color: WARN,
    };
  return { text: "Healthy", color: OK };
}

function MiniChart({
  title,
  now,
  series,
  times,
  min,
  max,
  stroke,
  fillColor,
  stats,
  change,
  dash,
  formatValue,
}: {
  title: string;
  now: string;
  series: number[];
  times: { t: string }[];
  min: number;
  max: number;
  stroke: string;
  fillColor: string;
  stats: ReturnType<typeof blockTimeSummary>;
  change: number | null;
  dash: boolean;
  formatValue: (v: number) => string;
}) {
  return (
    <section className="overview-mini-chart" style={panel}>
      <header className="overview-chart-heading">
        <div className="analytics-heading">
          <MetricGlyph icon={title === "Block Time" ? "clock" : "signing"} />
          <h3>{title}</h3>
        </div>
        <span>Last 60 minutes</span>
      </header>
      <div className="overview-chart-summary">
        <div className="overview-chart-reading">
          <strong style={{ color: dash ? TX3 : TX }}>{dash ? "—" : now}</strong>
          <span>Latest 1-minute average</span>
        </div>
        <div className="overview-chart-comparison" title="Change in the mean of observed one-minute averages. At least 45 sampled minutes are required in each hour.">
          <strong className={change === null ? "unknown" : change > 0 ? "slower" : "faster"}>{change === null ? "—" : `${change > 0 ? "↑ +" : change < 0 ? "↓ −" : ""}${Math.abs(change).toFixed(1)}%`}</strong>
          <span>vs. previous hour</span>
        </div>
      </div>
      <div className="overview-chart-area">
        <div className="overview-chart-y-axis" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i}>{Number((max - (max - min) * i / 3).toFixed(1))}s</span>)}</div>
        <div className="overview-mini-chart-plot">
        {!dash ? (
          <TimeSeriesChart
            values={series}
            times={times.map((p) => p.t)}
            min={min}
            max={max}
            stroke={stroke}
            fillColor={fillColor}
            height="fill"
            compact
            formatValue={formatValue}
            formatTime={(t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          />
        ) : (
          <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {[2, 6, 10, 14, 18].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        </div>
      </div>
      <div className="overview-chart-x-axis">
        <span>60 min ago</span>
        <span>45 min</span><span>30 min</span><span>15 min</span>
        <span>Now</span>
      </div>
      <dl className="overview-chart-stats" aria-label="Statistics of one-minute block-time averages">
        <div><dt>Min</dt><dd>{dash ? "—" : secs(stats.min)}</dd></div>
        <div><dt>Avg</dt><dd>{dash ? "—" : secs(stats.avg)}</dd></div>
        <div><dt>Max</dt><dd>{dash ? "—" : secs(stats.max)}</dd></div>
      </dl>
    </section>
  );
}
function SetChanges({ d, onInspect }: { d: Dashboard; onInspect: (address: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const changes = d.set?.changes ?? [];
  const events = expanded ? changes : changes.slice(0, 5);
  const unavailable = d.state === "dberror" || !d.set;
  return (
    <section className="overview-set-changes" style={panel}>
      <header className="set-changes-heading">
        <div>
          <div className="analytics-heading">
            <MetricGlyph icon="changes" />
            <h3>Recent Validator Set Changes</h3>
          </div>
          <p>{d.bootstrap ? "Genesis membership only. No churn recorded since bootstrap." : "Recent membership transitions in the indexed validator set."}</p>
        </div>
        {changes.length > 5 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Show recent" : "View all events"} <span aria-hidden="true">{expanded ? "↑" : "→"}</span></button>}
      </header>
      {d.state === "loading" ? <div className="set-changes-empty"><Skeleton h={120} w="100%" /></div> : unavailable ? <p className="set-changes-empty">Validator-set history is unavailable.</p> : events.length === 0 ? <p className="set-changes-empty">No validator-set changes recorded yet.</p> :
        <div className="set-changes-scroll">
          <table>
            <thead><tr><th>Time (UTC)</th><th>Validator</th><th>Change</th><th>Details</th></tr></thead>
            <tbody>{events.map((e, i) => {
              const added = e.type === "added";
              const removed = e.type === "removed";
              const validator = d.validators.find((v) => v.address === e.address);
              return <tr key={`${e.height}-${e.address}-${i}`}>
                <td title={new Date(e.time).toUTCString()}><Timestamp value={e.time} /></td>
                <td><button type="button" onClick={() => onInspect(e.address)} title={validator?.moniker ?? e.address}><span className={`set-change-symbol ${removed ? "removed" : ""}`} aria-hidden="true">{added ? "+" : removed ? "−" : "↔"}</span><span>{short(e.address)}</span></button></td>
                <td><span className={`set-change-pill ${removed ? "removed" : ""}`}>{added ? "Joined" : removed ? "Left" : e.type}</span></td>
                <td><span>height {fmt(e.height)}</span>{d.bootstrap && added && <small>Genesis validator</small>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </section>
  );
}
