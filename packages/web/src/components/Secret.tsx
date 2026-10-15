/**
 * Secret-specific Overview panels: the software-upgrade countdown and the
 * "what's public / what's sealed" explainer.
 */
import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getGovernance, getStaking, type Proposal, type Upgrade } from "../api";
import { fmt } from "../lib";
import { LockGlyph, TX, TX2, TX3, mono, panel, sans } from "./ui";

/**
 * Countdown to the next software upgrade. The ETA is blocks remaining times
 * the measured average block time — an estimate, labelled as one. Progress
 * runs from the proposal's submission to that ETA. Renders nothing when no
 * upgrade is scheduled or pending a vote.
 */
export function UpgradeBanner({ d }: { d: Dashboard }) {
  const [upgrade, setUpgrade] = useState<Upgrade | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStaking()
        .then(async (s) => {
          if (cancelled) return;
          setUpgrade(s.upgrade);
          if (s.upgrade?.proposal_id) {
            const g = await getGovernance().catch(() => null);
            if (!cancelled) setProposal(g?.proposals.find((p) => p.id === s.upgrade?.proposal_id) ?? null);
          }
        })
        .catch(() => {});
    void load();
    const poll = window.setInterval(load, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  const head = d.net?.chain_head_height ?? d.net?.latest_indexed_height ?? null;
  if (!upgrade || upgrade.height === null || head === null) return null;
  const remaining = upgrade.height - head;
  if (remaining < -100) return null;

  const btS = d.net?.avg_block_time_ms ? d.net.avg_block_time_ms / 1000 : null;
  const etaMs = btS !== null ? now + Math.max(0, remaining) * btS * 1000 : null;
  const left = etaMs !== null ? Math.max(0, (etaMs - now) / 1000) : null;
  const start = proposal?.submit_time ? new Date(proposal.submit_time).getTime() : null;
  const progress = etaMs !== null && start !== null && etaMs > start ? Math.min(100, ((now - start) / (etaMs - start)) * 100) : null;
  const parts =
    left === null
      ? null
      : [
          [Math.floor(left / 86400), "days"],
          [Math.floor((left % 86400) / 3600), "hours"],
          [Math.floor((left % 3600) / 60), "mins"],
          [Math.floor(left % 60), "secs"],
        ];

  return (
    <section className="upgrade-banner enclave-frame" style={{ ...panel }}>
      <div className="upgrade-shield" aria-hidden="true">
        <svg width="22" height="24" viewBox="0 0 34 38" fill="none">
          <path d="M17 1.5 31.5 7v11.2c0 8.6-6 15.4-14.5 18.3C8.5 33.6 2.5 26.8 2.5 18.2V7z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="2" />
          <path d="M12 18.5l3.5 3.5 7-7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="upgrade-copy">
        <span className="upgrade-eyebrow">Network upgrade</span>
        <div className="upgrade-title">
          <b>{upgrade.name}</b>
          <span>— chain halts at height</span>
          <b style={{ fontFamily: mono }}>{fmt(upgrade.height)}</b>
        </div>
        <div className="upgrade-sub">
          {upgrade.proposal_id && <a href="#/governance" className="upgrade-proposal">Proposal #{upgrade.proposal_id}</a>}
          {etaMs !== null && <span>~{new Date(etaMs).toISOString().slice(0, 16).replace("T", " ")} UTC</span>}
          <span>{upgrade.status === "pending_vote" ? "Network upgrade proposal still in voting" : "Scheduled by governance"}</span>
          {remaining <= 0 && <span>Halt height reached — operators install the new binary</span>}
        </div>
        {progress !== null && (
          <div className="upgrade-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="upgrade-count">
        <span className="upgrade-eyebrow">Estimated time until upgrade</span>
        {parts ? (
          <div className="upgrade-clock">
            {parts.map(([n, unit]) => (
              <div key={unit}>
                <strong>{String(n).padStart(2, "0")}</strong>
                <small>{unit}</small>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: TX3, font: `500 15px/1 ${sans}` }}>ETA unknown</div>
        )}
        <div style={{ color: TX2, font: `500 13px/1 ${mono}`, textAlign: "right" }}>
          {remaining > 0 ? `${fmt(remaining)} blocks remaining` : "halt height reached"}
        </div>
      </div>
      <a className="upgrade-view" href="#/governance">View Proposal <span aria-hidden="true">→</span></a>
    </section>
  );
}

const PUBLIC = ["Transaction sender", "Fees and gas", "Contract address and label", "SCRT transfers and staking", "Validator signatures"];
const SEALED = ["Contract inputs", "Contract outputs", "Contract state", "Private token balances", "Most contract event attributes"];

/** The privacy model in one card: same chain, different visibility. `wide` lays
 *  the two lists side by side for full-width placement. */
export function SealedExplainer({ wide }: { wide?: boolean }) {
  return (
    <section className={wide ? "sealed-explainer wide" : "sealed-explainer"} style={{ ...panel, padding: "15px 16px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
      <h3 className="explainer-title" style={{ margin: 0, font: `600 16px/1 ${sans}`, color: TX }}><span className="explainer-title-icon"><LockGlyph size={16} /></span>What's public / what's sealed</h3>
      <div className="explainer-box public">
        <span className="explainer-head">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 2.5 16.5 5v5c0 4-2.7 6.6-6.5 7.8C6.2 16.6 3.5 14 3.5 10V5z" /></svg>
          What's public (on chain)
        </span>
        {PUBLIC.map((t) => (
          <span key={t} className="explainer-item">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>
            {t}
          </span>
        ))}
      </div>
      <div className="explainer-box sealed cipher-texture">
        <span className="explainer-head">
          <LockGlyph size={12} />
          What's sealed (in enclaves)
        </span>
        {SEALED.map((t) => (
          <span key={t} className="explainer-item">
            <LockGlyph size={11} />
            {t}
          </span>
        ))}
      </div>
      <span className="explainer-foot" style={{ color: TX3, font: `400 13px/1.3 ${sans}`, textAlign: "center" }}>Same chain. Different visibility.</span>
    </section>
  );
}
