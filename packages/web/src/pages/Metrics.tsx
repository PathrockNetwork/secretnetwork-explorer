/** Analytics uses recorded consensus aggregates; missing samples remain visible gaps. */
import { useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Metrics as MetricsData } from "../api";
import { fmt, pct, secs, short } from "../lib";
import { ANALYTICS_RANGES, THRESHOLDS, bucketMs, chartDomain, chartPoints, chartSegments, expectedVolume, outlierWindows, seriesExtent, volumeBuckets, type ChartPoint, type OutlierWindow } from "../analyticsExplorer";
import "./analytics.css";

const rangeLabel = (hours: number) => ANALYTICS_RANGES.find(r => r.hours === hours)?.label ?? `${hours}h`;
const time = (ms: number, day = false) => new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", ...(day ? { month: "short", day: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });
const outlierLabel = (o: OutlierWindow) => o.kind === "block" ? "High block time" : o.kind === "signing" ? "Low signing rate" : "Low indexed volume";
const outlierDetail = (o: OutlierWindow) => o.kind === "block" ? `Bucket mean up to ${secs(o.value)}` : o.kind === "signing" ? `Bucket rate down to ${pct(o.value, 2)}` : `${o.value.toFixed(0)}% of estimated full-bucket volume`;

export function Metrics({ d, hours, onHours }: { d: Dashboard; hours: number; onHours: (h: number) => void }) {
  const m = d.metrics;
  const shown = m?.hours ?? hours, label = rangeLabel(shown);
  const end = d.metricsUpdatedAt?.getTime() ?? Date.now();
  const start = end - shown * 3_600_000;
  const bt = useMemo(() => chartPoints(m?.series ?? [], "block_time_s"), [m]);
  const sr = useMemo(() => chartPoints(m?.series ?? [], "signing_rate"), [m]);
  const outliers = useMemo(() => m ? outlierWindows(m, end) : [], [m, end]);
  const [outlierPage, setOutlierPage] = useState(0);
  const pages = Math.max(1, Math.ceil(outliers.length / 4)), page = Math.min(pages - 1, outlierPage);
  const top = m?.proposer_distribution.find(p => p.share !== null);
  const topName = top ? d.validators.find(v => v.address === top.address)?.moniker ?? short(top.address) : "No proposer sample";
  const ext = seriesExtent(sr);
  const average = m?.stats.avg_block_time_s ?? null;
  const rate = m?.stats.signing_rate ?? null;
  const summary = [
    { label: `Avg block time · ${label}`, value: secs(average), note: `Display target ≤ ${THRESHOLDS.blockTime}s`, icon: "clock", tone: average === null ? "muted" : average <= THRESHOLDS.blockTime ? "ok" : "warn", points: bt },
    { label: `P95 block time · ${label}`, value: secs(m?.stats.p95_block_time_s), note: "95% of measured intervals at or below", icon: "bars", tone: "normal" },
    { label: `Blocks indexed · ${label}`, value: fmt(m?.stats.blocks), note: "Recorded by this explorer", icon: "block", tone: "normal", points: (m?.volume.points ?? []).map(p => ({ t: Date.parse(p.t), value: p.n })) },
    { label: `Signing rate · ${label}`, value: pct(rate, 2), note: `Display target ≥ ${THRESHOLDS.signing}%`, icon: "shield", tone: rate === null ? "muted" : rate >= THRESHOLDS.signing ? "ok" : "warn", points: sr },
    { label: "Top proposer share", value: pct(top?.share), note: `${topName} · last 1k blocks`, icon: "people", tone: "normal" },
  ];
  const thresholds = [
    { label: "Average block time", current: secs(average), target: `≤ ${THRESHOLDS.blockTime}s`, pass: average === null ? null : average <= THRESHOLDS.blockTime },
    { label: "P95 block time", current: secs(m?.stats.p95_block_time_s), target: `≤ ${THRESHOLDS.p95}s`, pass: m?.stats.p95_block_time_s == null ? null : m.stats.p95_block_time_s <= THRESHOLDS.p95 },
    { label: "Signing rate", current: pct(rate, 2), target: `≥ ${THRESHOLDS.signing}%`, pass: rate === null ? null : rate >= THRESHOLDS.signing },
  ];
  const allHealthy = thresholds.every(row => row.pass === true);
  return <div className="ane-page">
    <div className="ane-toolbar"><span>{m ? `${time(start, true)} – ${time(end, true)} UTC` : "Loading network history…"}</span><div className="ane-ranges" aria-label="Analytics time range">{ANALYTICS_RANGES.map(r => <button key={r.hours} type="button" aria-pressed={hours === r.hours} onClick={() => { onHours(r.hours); setOutlierPage(0); }}>{r.label}</button>)}</div></div>
    {(d.metricsError || (m && hours !== shown)) && <div className="ane-notice" role="status"><span>{d.metricsError ? `Analytics could not refresh.${m ? ` Showing the last loaded ${label} snapshot.` : ""}` : `Loading ${rangeLabel(hours)} · showing ${label} until it arrives.`}</span>{d.metricsError && <button type="button" onClick={d.refresh}>Retry</button>}</div>}
    <div className="ane-stats">{summary.map(s => <section className={`ane-panel ane-stat ${s.tone}`} key={s.label}><div className="ane-stat-label"><Icon name={s.icon} /><span>{s.label}</span></div><div className="ane-stat-value"><strong>{s.value}</strong>{s.points && <Sparkline points={s.points} step={s.icon === "block" ? (m?.volume.unit === "day" ? 86_400_000 : 3_600_000) : bucketMs(shown)} />}</div><p title={s.note}>{s.note}</p></section>)}</div>
    <div className="ane-main-grid">
      <section className="ane-panel ane-chart-card"><PanelHeading title="Block time" description="Time between consecutive blocks, averaged per sample." icon="clock" right={<span className="ane-range-label">{label}</span>} /><HistoryChart points={bt} start={start} end={end} hours={shown} signing={false} loading={!m && !d.metricsError} /><div className="ane-chart-footer"><Legend label="Block time" /><Legend label={`Target ≤ ${THRESHOLDS.blockTime}s`} target /><span>Avg <b>{secs(average)}</b> <i>·</i> P95 <b>{secs(m?.stats.p95_block_time_s)}</b></span></div></section>
      <section className="ane-panel ane-chart-card"><PanelHeading title="Signing rate" description="Recorded validator signatures as a share of expected signatures." icon="shield" right={<span className="ane-range-label">{label}</span>} /><HistoryChart points={sr} start={start} end={end} hours={shown} signing loading={!m && !d.metricsError} /><div className="ane-chart-footer"><Legend label="Signing rate" /><Legend label={`Target ≥ ${THRESHOLDS.signing}%`} target /><span>Avg <b>{pct(rate, 2)}</b> <i>·</i> Min <b>{pct(ext.min, 2)}</b></span></div></section>
    </div>
    <div className="ane-support-grid">
      <section className="ane-panel ane-volume"><PanelHeading title={`Blocks indexed per ${m?.volume.unit ?? "hour"}`} description="Number of blocks recorded by this explorer." icon="block" right={<span className="ane-range-label">{label}</span>} />{m ? <VolumeChart metrics={m} end={end} /> : <Empty loading={!d.metricsError} />}</section>
      <section className="ane-panel ane-proposers"><Proposers d={d} /></section>
      <section className="ane-panel ane-outliers"><PanelHeading title="Outlier windows" description="Aggregate samples outside the display thresholds." icon="alert" right={<span className="ane-count">{m ? outliers.length : "—"}</span>} /><div className="ane-outlier-table"><div className="ane-outlier-head"><span>Time (UTC)</span><span>Type & observation</span></div>{outliers.slice(page * 4, page * 4 + 4).map(o => <div className="ane-outlier-row" key={`${o.kind}-${o.start}`}><time title={`${time(o.start, true)} – ${time(o.end, true)} UTC`}>{time(o.start, shown > 24)}<small>to {time(o.end)}</small></time><div><strong><Dot tone={o.kind === "signing" ? "bad" : "warn"} />{outlierLabel(o)}</strong><span>{outlierDetail(o)}</span></div></div>)}{!outliers.length && <Empty loading={!m && !d.metricsError} text={m?.series.length ? "No threshold breaches in the measured samples." : "No measured samples in this window."} />}</div><footer className="ane-outlier-footer"><span>Bucket windows, not exact incident durations.</span>{pages > 1 && <div><button type="button" aria-label="Previous outlier page" disabled={page === 0} onClick={() => setOutlierPage(page - 1)}>‹</button><span>{page + 1}/{pages}</span><button type="button" aria-label="Next outlier page" disabled={page === pages - 1} onClick={() => setOutlierPage(page + 1)}>›</button></div>}</footer></section>
      <section className="ane-panel ane-summary"><PanelHeading title="Performance summary" icon="pulse" /><ul className="ane-observations"><li><Dot tone={average === null ? "muted" : average <= THRESHOLDS.blockTime ? "ok" : "warn"} /><div><strong>{average === null ? "Block timing unavailable" : average <= THRESHOLDS.blockTime ? "Average block time within target" : "Average block time above target"}</strong><span>{secs(average)} average · {secs(m?.stats.p95_block_time_s)} P95 over {label}.</span></div></li><li><Dot tone={rate === null ? "muted" : rate >= THRESHOLDS.signing ? "ok" : "warn"} /><div><strong>{rate === null ? "Signing data unavailable" : `Signing rate ${pct(rate, 2)}`}</strong><span>{ext.min === null ? "Waiting for recorded signatures." : `Lowest sample ${pct(ext.min, 2)} · ${ext.count} measured samples.`}</span></div></li><li><Dot tone="brand" /><div><strong>{fmt(m?.stats.blocks)} blocks indexed</strong><span>{m ? `${m.volume.unit === "day" ? "Daily" : "Hourly"} totals; edge buckets cover part of the period.` : "Waiting for indexed block counts."}</span></div></li><li><Dot tone="brand" /><div><strong>Top proposer {pct(top?.share)}</strong><span>{topName} · observed share of the last 1,000 blocks.</span></div></li></ul></section>
      <section className="ane-panel ane-thresholds"><PanelHeading title="Health thresholds" description="Explorer display targets, not protocol requirements." icon="shield" /><div className="ane-table-wrap"><table><thead><tr><th>Metric</th><th>Current</th><th>Target</th><th>Status</th></tr></thead><tbody>{thresholds.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.current}</td><td>{row.target}</td><td><span className={`ane-health ${row.pass === null ? "muted" : row.pass ? "ok" : "warn"}`}><Dot tone={row.pass === null ? "muted" : row.pass ? "ok" : "warn"} />{row.pass === null ? "Unknown" : row.pass ? "Within" : "Outside"}</span></td></tr>)}</tbody></table></div><p className="ane-footnote">Proposer share reflects block production. It does not measure voting-power concentration.</p></section>
      <section className="ane-panel ane-notes"><PanelHeading title="Observed notes" icon="notes" right={<span className="ane-updated">{d.metricsUpdatedAt ? `Updated ${time(end)} UTC` : "Waiting for data"}</span>} /><ul className="ane-observations">{outliers.slice(0, 2).map(o => <li key={`${o.kind}-${o.start}`}><Dot tone="warn" /><div><strong>{time(o.start, shown > 24)} · {outlierLabel(o)}</strong><span>{outlierDetail(o)}. Based on recorded buckets.</span></div></li>)}<li><Dot tone={m && allHealthy ? "ok" : "muted"} /><div><strong>{m ? allHealthy ? "Window metrics are within display targets" : "Review the measured values against targets" : "Waiting for network metrics"}</strong><span>Charts show bucket averages; short per-block spikes can be hidden.</span></div></li><li><Dot tone="muted" /><div><strong>Read gaps as missing observations</strong><span>Missing readings remain gaps. Low indexed volume alone does not establish a network outage.</span></div></li></ul></section>
    </div>
    <div className="ane-method-note">All times UTC · {Math.round(bucketMs(shown) / 60_000)}-minute chart samples · block intervals outside 0–600s excluded by the data source · proposer distribution always uses the latest 1,000 blocks.</div>
  </div>;
}

function PanelHeading({ title, description, icon, right }: { title: string; description?: string; icon: string; right?: React.ReactNode }) { return <header className="ane-panel-heading"><div><h2><Icon name={icon} />{title}</h2>{description && <p>{description}</p>}</div>{right}</header>; }
function Dot({ tone }: { tone: string }) { return <i className={`ane-dot ${tone}`} aria-hidden="true" />; }
function Legend({ label, target = false }: { label: string; target?: boolean }) { return <span className="ane-legend">{target ? <i className="ane-target-key" /> : <Dot tone="brand" />}{label}</span>; }
function Empty({ loading = false, text = "No measured data in this window." }: { loading?: boolean; text?: string }) { return <div className="ane-empty" role="status">{loading ? "Loading measurements…" : text}</div>; }

function Sparkline({ points, step }: { points: ChartPoint[]; step: number }) {
  const ext = seriesExtent(points), segments = chartSegments(points, step);
  if (!ext.count) return null;
  const start = points[0].t, width = Math.max(1, points[points.length - 1].t - start), span = Math.max(.1, ext.max! - ext.min!);
  return <svg className="ane-spark" viewBox="0 0 100 32" aria-hidden="true">{segments.map((segment, i) => <polyline key={i} points={segment.map(p => `${(p.t - start) / width * 100},${27 - (p.value - ext.min!) / span * 21}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />)}</svg>;
}

function HistoryChart({ points, start, end, hours, signing, loading }: { points: ChartPoint[]; start: number; end: number; hours: number; signing: boolean; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [min, max] = chartDomain(points, signing), ext = seriesExtent(points);
  const segments = chartSegments(points, bucketMs(hours));
  const x = (t: number) => Math.max(0, Math.min(1000, (t - start) / (end - start) * 1000));
  const y = (v: number) => 200 - (v - min) / (max - min) * 200;
  const format = (v: number | null) => signing ? pct(v, 2) : secs(v);
  const target = signing ? THRESHOLDS.signing : THRESHOLDS.blockTime;
  const selected = hover !== null ? points[Math.min(hover, points.length - 1)] : undefined;
  const ticks = [0, 1, 2, 3, 4];
  const selectNearest = (clientX: number, rect: DOMRect) => {
    const targetTime = start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (end - start);
    let nearest = 0; points.forEach((p, i) => { if (Math.abs(p.t - targetTime) < Math.abs(points[nearest].t - targetTime)) nearest = i; });
    if (points.length) setHover(nearest);
  };
  return <div className="ane-history"><div className="ane-y-axis">{ticks.map(t => <span key={t}>{signing ? `${(max - (max - min) * t / 4).toFixed(max - min <= 2 ? 2 : 1)}%` : `${Number(((max - min) * (1 - t / 4) + min).toFixed(1))}s`}</span>)}</div><div className="ane-history-plot" tabIndex={0} role="group" aria-label={`${signing ? "Signing rate" : "Block time"} chart. Use left and right arrow keys to inspect measured samples.`} onFocus={() => points.length && setHover(points.length - 1)} onBlur={() => setHover(null)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && points.length) { event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (hover ?? 0) + (event.key === "ArrowRight" ? 1 : -1)))); } }} onPointerMove={event => selectNearest(event.clientX, event.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y={signing ? 0 : y(target)} width="1000" height={signing ? y(target) : 200 - y(target)} fill="var(--ok)" opacity=".035" />{ticks.map(t => <line key={t} x1="0" x2="1000" y1={t * 50} y2={t * 50} className="ane-grid-line" />)}{[0, 1, 2, 3, 4, 5, 6, 7, 8].map(t => <line key={t} y1="0" y2="200" x1={t * 125} x2={t * 125} className="ane-grid-line" />)}<line x1="0" x2="1000" y1={y(target)} y2={y(target)} className="ane-target-line" />{segments.map((segment, i) => { const line = segment.map(p => `${x(p.t)},${y(p.value)}`).join(" "); return <g key={i}>{segment.length > 1 && <polygon points={`${x(segment[0].t)},200 ${line} ${x(segment[segment.length - 1].t)},200`} fill="var(--brandSoft)" />}<polyline points={line} className="ane-series-line" />{segment.length === 1 && <circle cx={x(segment[0].t)} cy={y(segment[0].value)} r="3" fill="var(--brand2)" />}</g>; })}{selected && <line x1={x(selected.t)} x2={x(selected.t)} y1="0" y2="200" className="ane-cursor-line" />}</svg>
      {!ext.count && <Empty loading={loading} />}{selected && <div className="ane-chart-tooltip" role="status" style={{ left: `${Math.min(72, Math.max(0, x(selected.t) / 10 - 12))}%` }}><span>{time(selected.t, hours > 24)} UTC</span><strong>{selected.value === null ? "No reading" : format(selected.value)}</strong><small>Bucket average</small></div>}
    </div><div className="ane-x-axis">{[0, 1, 2, 3, 4].map(t => <span key={t}>{time(start + (end - start) * t / 4, hours > 24)}</span>)}</div><div className="ane-chart-extents"><span>Sample min <b>{format(ext.min)}</b></span><span>Sample max <b>{format(ext.max)}</b></span><span>{ext.count} readings</span></div></div>;
}

function VolumeChart({ metrics, end }: { metrics: MetricsData; end: number }) {
  const buckets = volumeBuckets(metrics, end), expected = expectedVolume(metrics);
  const max = Math.max(1, ...buckets.map(p => p.n), expected ?? 0) * 1.12;
  const [selected, setSelected] = useState<number | null>(null);
  const hovered = selected === null ? null : buckets[selected];
  return <><div className="ane-volume-total"><span>Total ({rangeLabel(metrics.hours)}) <strong>{fmt(metrics.stats.blocks)}</strong></span><span>{expected === null ? "Expected volume unavailable" : `~${fmt(Math.round(expected))}/${metrics.volume.unit} expected`}</span></div><div className="ane-volume-chart"><div className="ane-volume-axis">{[1, .5, 0].map(f => <span key={f}>{Math.round(max * f).toLocaleString("en-US", { notation: "compact" })}</span>)}</div><div className="ane-volume-plot">{expected !== null && <i className="ane-volume-target" style={{ bottom: `${expected / max * 100}%` }} />}{buckets.map((b, i) => <button type="button" key={b.t} className={`${b.complete ? "" : "partial"} ${b.complete && expected !== null && b.n < expected * THRESHOLDS.volume ? "low" : ""}`} style={{ height: `${Math.max(1, b.n / max * 100)}%` }} aria-label={`${time(b.t, true)} UTC: ${fmt(b.n)} indexed blocks${b.complete ? "" : ", partial bucket"}`} onPointerEnter={() => setSelected(i)} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(i)} onBlur={() => setSelected(null)} />)}</div></div><div className="ane-volume-x"><span>{time(buckets[0]?.t ?? end, metrics.hours > 24)}</span><span>UTC</span><span>{time(buckets[buckets.length - 1]?.t ?? end, metrics.hours > 24)}</span></div><p className="ane-volume-note" aria-live="polite">{hovered ? `${time(hovered.t, true)} UTC · ${fmt(hovered.n)} blocks${hovered.complete ? "" : " · partial bucket"}` : "Lighter bars are partial buckets. Dashed line: estimated full-bucket volume."}</p></>;
}

function Proposers({ d }: { d: Dashboard }) {
  const [limit, setLimit] = useState(5);
  const dist = d.metrics?.proposer_distribution ?? [], shown = dist.slice(0, limit);
  const other = dist.slice(limit), otherShare = other.every(p => p.share !== null) ? other.reduce((sum, p) => sum + p.share!, 0) : null;
  const max = Math.max(1, ...shown.map(p => p.share ?? 0), otherShare ?? 0);
  return <><PanelHeading title="Proposer distribution" description="Share of blocks proposed · last 1,000 blocks." icon="people" right={<select aria-label="Number of proposers" value={limit} onChange={event => setLimit(Number(event.target.value))}><option value={5}>Top 5</option><option value={10}>Top 10</option><option value={1000}>All</option></select>} /><div className="ane-proposer-list" tabIndex={0} aria-label="Proposer rankings">{shown.map((p, i) => { const validator = d.validators.find(v => v.address === p.address); const name = validator?.moniker ?? validator?.label ?? short(p.address); return <div className="ane-proposer-row" key={p.address} title={`${name} · ${p.address} · ${pct(p.share, 2)}`}><span className="ane-rank">{i + 1}</span><span className="ane-proposer-name">{name}</span><i><b style={{ width: `${(p.share ?? 0) / max * 100}%` }} /></i><strong>{pct(p.share)}</strong></div>; })}{other.length > 0 && <div className="ane-proposer-row others"><span /><span className="ane-proposer-name">Others ({other.length})</span><i><b style={{ width: `${Math.min(100, (otherShare ?? 0) / max * 100)}%` }} /></i><strong>{pct(otherShare)}</strong></div>}{!dist.length && <Empty loading={!d.metrics && !d.metricsError} />}</div><p className="ane-footnote">Ranked by observed proposals; unequal shares can reflect different voting power.</p></>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2", bars: "M4 20V12h3v8H4Zm6 0V7h3v13h-3Zm6 0V3h3v17h-3Z", block: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9M7 6l9 5", shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z", people: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 1a3 3 0 0 1 0 6M3 20v-4a6 6 0 0 1 12 0v4H3Zm14-7a5 5 0 0 1 4 5v2h-3", alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3v1", pulse: "M3 12h4l3-8 4 16 3-8h4", notes: "M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h8" };
  return <svg className="ane-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.pulse} /></svg>;
}
