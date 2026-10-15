import { useState } from "react";
import type { Dashboard } from "../useDashboard";
import { validatorSummary } from "../validatorSummary";
import { short } from "../lib";
import { Skeleton, ValidatorAvatar, panel } from "./ui";

export function OverviewWatchlist({ d, onInspect }: { d: Dashboard; onInspect: (address: string) => void }) {
  const [overrides] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sealed-validator-watch") ?? "{}");
      return saved && typeof saved === "object"
        ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>
        : {};
    } catch { return {}; }
  });
  const watched = d.validators.filter((v) => overrides[v.address] ?? v.watched);
  const { proposers } = validatorSummary(d.validators);
  const loading = d.state === "loading";
  const unavailable = d.state === "dberror" || d.state === "empty";

  return <section className="overview-watchlist" style={panel}>
    <header>
      <h3><span className="watchlist-star" aria-hidden="true">★</span> Validator Watchlist <small>{unavailable || loading ? "—" : watched.length}</small></h3>
      <a href="#/validators" aria-label="Manage validator watchlist" title="Manage watchlist">Manage watchlist <span aria-hidden="true">→</span></a>
    </header>
    <div className="overview-watchlist-items">
      {loading ? <Skeleton h={70} w="100%" /> : unavailable ? <p className="overview-muted">Validator data is unavailable.</p> : watched.length === 0 ? <div className="overview-watchlist-empty"><span className="watchlist-empty-star" aria-hidden="true">★</span><strong>No validators in your watchlist</strong><p>Star validators in the validator directory to follow them here.</p><a href="#/validators"><span aria-hidden="true">☆</span> Browse validators</a></div> : watched.map((v) => {
        const badge = v.status === "degraded" ? "Degraded" : v.status === "inactive" ? "Inactive" : proposers[0]?.address === v.address ? "Top Proposer" : v.staking?.commission_rate != null && v.staking.commission_rate <= .05 ? "Low Commission" : "Active";
        return <button type="button" key={v.address} onClick={() => onInspect(v.address)} title={`Inspect ${v.moniker ?? v.address}`}>
          <ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} size={20} />
          <span>{v.moniker ?? short(v.address)}</span>
          <small className={`watch-badge ${v.status === "active" ? "active" : v.status}`}>{badge}</small>
        </button>;
      })}
    </div>
    {d.state === "stopped" && <p className="overview-muted">Indexer stopped · showing last known data.</p>}
  </section>;
}

export function OverviewQuickInsights({ d }: { d: Dashboard }) {
  const { counts } = validatorSummary(d.validators);
  const loading = d.state === "loading";
  const unavailable = d.state === "dberror" || d.state === "empty";
  const changesByHeight = new Map<number, number>();
  for (const change of d.set?.changes ?? []) changesByHeight.set(change.height, (changesByHeight.get(change.height) ?? 0) + 1);
  const changes = [...changesByHeight.entries()].sort((a, b) => a[0] - b[0]).slice(-24).map(([, count]) => count);
  const rows = [
    { icon: "M4 4h16v16H4zM7 8h10M7 12h10M7 16h6", title: "Validator set changes", description: "Changes in the recorded set history", value: d.set?.changes.length ?? null, note: d.bootstrap ? "genesis membership" : "recorded changes", values: changes, chartLabel: "Recorded changes grouped by block height; oldest to newest" },
    { icon: "m12 3 9 9-9 9-9-9zM12 8v5M12 16h.01", title: "Inactive validators", description: "Validators not signing blocks", value: counts.inactive, note: "current set", values: d.validators.map((v) => v.status === "inactive" ? 1 : 0), chartLabel: "Current set: one mark per validator; highlighted when inactive" },
    { icon: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", title: "Validators degraded", description: "Below performance thresholds", value: counts.degraded, note: counts.degraded ? "review signing" : "current set", values: d.validators.map((v) => v.status === "degraded" ? 1 : 0), chartLabel: "Current set: one mark per validator; highlighted when degraded" },
  ];
  return <section className="overview-insights-panel" style={panel}>
    <header><span className="overview-insight-icon" aria-hidden="true">▥</span><h3>Quick Insights</h3></header>
    {loading ? <Skeleton h={170} w="100%" /> : unavailable ? <p className="overview-muted">Insights will return when data is available.</p> : <ul>
      {rows.map((row) => <li key={row.title}>
        <span className="overview-insight-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={row.icon} /></svg></span>
        <div className="overview-insight-copy"><strong>{row.title}</strong><span>{row.description}</span></div>
        <div className="overview-insight-value"><strong>{row.value ?? "—"}</strong><span>{row.note}</span></div>
        <div className="overview-insight-bars" role="img" aria-label={row.chartLabel} title={row.chartLabel}>
          {row.values.length ? row.values.map((value, i) => <i key={i} style={{ height: `${value ? Math.max(12, value / Math.max(1, ...row.values) * 100) : 12}%`, background: value ? "var(--brand2)" : "var(--line2)" }} />) : <span>—</span>}
        </div>
      </li>)}
    </ul>}
  </section>;
}
