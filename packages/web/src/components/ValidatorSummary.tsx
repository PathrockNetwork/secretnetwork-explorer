import type { Dashboard } from "../useDashboard";
import { mapCoverage } from "../mapCoverage";
import { validatorSummary } from "../validatorSummary";
import { coin, fmt, pct, short } from "../lib";
import { commissionStats } from "../validatorDirectory";
import { BAD, OK, WARN, LockGlyph, Skeleton, panel } from "./ui";

/** Live set composition, staking pool, and observed proposer activity. */
export function ValidatorSummary({ d, health, onInspect }: { d: Dashboard; health: { text: string; color: string }; onInspect: (address: string) => void }) {
  const { counts, total, proposers } = validatorSummary(d.validators);
  const { countries, unplaced } = mapCoverage(d.validators);
  const commissions = commissionStats(d.validators);
  const denom = d.net?.chain.denom;
  const bonded = denom ? coin(d.staking?.pool.bonded, denom.base, denom, 0) : "—";
  const rate = (value: number | null) => value === null ? "—" : pct(value * 100);
  const loading = d.state === "loading";
  const unavailable = d.state === "dberror";
  const statuses = [
    { key: "active", label: "Active", color: OK },
    { key: "degraded", label: "Degraded", color: WARN },
    { key: "inactive", label: "Inactive", color: BAD },
  ] as const;
  let offset = 0;

  return <section className="validator-summary-panel" style={panel}>
    <header className="overview-panel-heading">
      <h2><span className="explainer-title-icon"><LockGlyph size={16} /></span>Validator Set Summary</h2>
      <span>{loading ? "Loading validator set…" : unavailable ? "Data unavailable" : `${total} validators · ${countries} known countries · ${unplaced.length} locations unknown`}</span>
    </header>
    {loading ? <div className="validator-summary-loading"><Skeleton h={120} w="100%" /></div> :
      unavailable || total === 0 ? <div className="validator-summary-empty">{unavailable ? "Validator data is temporarily unavailable." : "Waiting for the first indexed validator set."}</div> :
      <div className="validator-summary-body">
        <div className="validator-status-summary">
          <div className="validator-donut">
            <svg viewBox="0 0 120 120" role="img" aria-label={`${total} validators: ${counts.active} active, ${counts.degraded} degraded, ${counts.inactive} inactive`}>
              <circle cx="60" cy="60" r="49" fill="none" stroke="var(--line)" strokeWidth="10" />
              {statuses.map((s) => {
                const share = counts[s.key] / total * 100;
                const start = offset;
                offset += share;
                return <circle key={s.key} cx="60" cy="60" r="49" pathLength="100" fill="none" stroke={s.color} strokeWidth="10" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 60 60)" />;
              })}
            </svg>
            <div><strong>{fmt(total)}</strong><span>Validators</span></div>
          </div>
          <ul className="validator-status-legend">
            {statuses.map((s) => <li key={s.key}>
              <i style={{ background: s.color }} /><span>{s.label}</span>
              <strong>{counts[s.key]} <small>({pct(counts[s.key] / total * 100)})</small></strong>
            </li>)}
          </ul>
        </div>
        <div className="validator-summary-detail">
          <div className="validator-summary-metrics">
            <div><span className="summary-metric-icon" aria-hidden="true">▱</span><div><span>Total Bonded{denom ? ` (${denom.display})` : ""}</span><strong>{denom ? bonded.replace(` ${denom.display}`, "") : "—"}</strong><small>Network staking pool</small></div></div>
            <div><span className="summary-metric-icon" aria-hidden="true">%</span><div><span>Avg Commission</span><strong>{rate(commissions.mean)}</strong><small>range {rate(commissions.min)} – {rate(commissions.max)}</small></div></div>
          </div>
          <div className="validator-summary-bottom">
            <div className="summary-proposers">
              <h3>Top Proposer Share <span>(last 1k blocks)</span></h3>
              {proposers.slice(0, 3).map((v) => <button key={v.address} type="button" onClick={() => onInspect(v.address)} title={`Inspect ${v.moniker ?? v.address}`}>
                <span>{v.moniker ?? short(v.address)}</span><i><b style={{ width: `${Math.max(0, Math.min(100, (v.proposer_share_1000 ?? 0) / Math.max(1, proposers[0]?.proposer_share_1000 ?? 1) * 100))}%` }} /></i><small>{pct(v.proposer_share_1000)}</small>
              </button>)}
              {proposers.length === 0 && <p className="overview-muted">No proposer history yet.</p>}
            </div>
            <div className="summary-health">
              <strong style={{ color: health.color }}><span aria-hidden="true">✦</span> {health.text}</strong>
              <span>{counts.active} of {total} validators are active.</span>
              <span>{d.state === "stopped" ? "Waiting for fresh indexed blocks." : counts.degraded ? "Review validators with missed signatures." : "Latest indexed signing status."}</span>
            </div>
          </div>
        </div>
      </div>}
  </section>;
}
