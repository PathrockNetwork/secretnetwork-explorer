import { preferredScrollBehavior } from "../appearance";
/** Proposal cards and current governance parameters, backed by the latest x/gov sample. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { getGovernance, type Denom, type GovernanceData, type Proposal } from "../api";
import { coin, copyText, duration, fmt, middle } from "../lib";
import { Chip, Skeleton } from "../components/ui";
import { featuredProposals, filterProposals, inProposalGroup, isActiveProposal, proposalDeposit, proposalKind, proposalStatuses, proposalTurnout, tallyShares, type ProposalGroup } from "../governanceExplorer";
import "./governance.css";

const groups = [["active", "Active"], ["passed", "Passed"], ["rejected", "Rejected"], ["all", "All"]] as const;
const voteChoices = [{ key: "yes", label: "Yes", color: "var(--ok)" }, { key: "no", label: "No", color: "var(--bad)" }, { key: "veto", label: "Veto", color: "var(--warn)" }, { key: "abstain", label: "Abstain", color: "var(--tx3)" }] as const;
const selectedFromLocation = () => { const id = Number(location.hash.match(/^#\/governance\/(\d+)$/)?.[1]); return Number.isSafeInteger(id) && id > 0 ? id : null; };
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const date = (value: string | null, full = false) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC", ...(full ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } : {}) }) : "—";
const statusFor = (proposal: Proposal) => proposalStatuses[proposal.status] ?? { label: "Unknown", tone: "muted" as const };

export function Governance({ d, live }: { d: Dashboard; live: boolean }) {
  const [gov, setGov] = useState<GovernanceData | null>(null);
  const [error, setError] = useState(false);
  const [group, setGroup] = useState<ProposalGroup>("all");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(selectedFromLocation);
  const [now, setNow] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  const directory = useRef<HTMLElement>(null);
  const denom = d.net?.chain.denom ?? null;
  const bonded = d.staking?.pool.bonded ?? null;
  useEffect(() => {
    const sync = () => setSelected(selectedFromLocation());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => { void getGovernance().then((result) => { if (!cancelled) { setGov(result); setError(false); } }).catch(() => { if (!cancelled) setError(true); }); };
    load();
    const timer = live ? window.setInterval(load, 30_000) : undefined;
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); clearInterval(clock); };
  }, [live, retry]);
  const proposals = gov?.proposals ?? [];
  const featured = featuredProposals(proposals);
  const shown = filterProposals(proposals, query, group, kind, status, sort, now);
  const pages = Math.max(1, Math.ceil(shown.length / 12));
  const current = Math.min(page, pages - 1);
  const visible = shown.slice(current * 12, current * 12 + 12);
  const kinds = [...new Set(proposals.map(proposalKind))].sort();
  const inspect = (proposal: Proposal) => { setSelected(proposal.id); history.replaceState(null, "", `#/governance/${proposal.id}`); };
  const close = () => { setSelected(null); history.replaceState(null, "", "#/governance"); };
  const reset = () => { setGroup("all"); setQuery(""); setKind("all"); setStatus("all"); setPage(0); };
  const selectGroup = (value: ProposalGroup) => { setGroup(value); setStatus("all"); setPage(0); };
  const params = gov ? [
    { label: "Quorum", value: percent(gov.params.quorum), icon: "quorum" },
    { label: "Threshold", value: percent(gov.params.threshold), icon: "shield" },
    { label: "Veto threshold", value: percent(gov.params.veto_threshold), icon: "veto" },
    { label: "Min. deposit", value: gov.params.min_deposit.map((value) => coin(value.amount, value.denom, denom, 0)).join(", ") || "—", icon: "deposit" },
    { label: "Voting period", value: duration(gov.params.voting_period_s), icon: "clock" },
  ] : [];
  return <div className="gve-page">
    <section className="gve-panel gve-overview" aria-label="Governance parameters and proposal statuses">
      <div className="gve-status-tabs" aria-label="Proposal status groups">{groups.map(([value, label]) => <button type="button" key={value} aria-pressed={group === value} onClick={() => selectGroup(value)}>{label}<span>{gov ? proposals.filter((proposal) => inProposalGroup(proposal, value)).length : "—"}</span></button>)}</div>
      <div className="gve-parameters">{gov ? params.map((param) => <div key={param.label}><Glyph name={param.icon} /><div><span>{param.label}</span><strong>{param.value}</strong></div></div>) : <Skeleton h={34} w="100%" />}</div>
    </section>
    {error && <div className="gve-panel gve-notice" role="status"><span>Governance data is temporarily unavailable.{gov ? " Showing the last loaded proposals and parameters." : ""}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    <section className="gve-featured" aria-labelledby="featured-proposals-title"><header className="gve-section-heading"><div><Glyph name="star" /><div><h2 id="featured-proposals-title">Featured proposals</h2><p>Active proposals and the latest decisions.</p></div></div><button type="button" onClick={() => { reset(); directory.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" }); }}>View all proposals <span aria-hidden="true">→</span></button></header>
      <div className="gve-featured-grid">{!gov && !error ? [0, 1, 2].map((index) => <LoadingCard key={index} />) : featured.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} gov={gov!} denom={denom} now={now} featured onInspect={inspect} />)}</div>
      {gov && !featured.length && <div className="gve-panel gve-empty">No proposals have been returned by the network.</div>}
    </section>
    <section className="gve-directory" ref={directory} aria-labelledby="all-proposals-title">
      <header className="gve-section-heading"><div><Glyph name="list" /><div><h2 id="all-proposals-title">All proposals</h2><p>Browse the latest {gov ? proposals.length : "30"} proposals returned by the network.</p></div></div><div className="gve-filters"><label className="gve-search"><Glyph name="search" /><input aria-label="Search proposals" placeholder="Search proposals, titles, or IDs…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label><select aria-label="Sort proposals" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="ending">Ending soon</option></select><select aria-label="Proposal type" value={kind} onChange={(event) => { setKind(event.target.value); setPage(0); }}><option value="all">All types</option>{kinds.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Proposal status" value={status} onChange={(event) => { setStatus(event.target.value); setGroup("all"); setPage(0); }}><option value="all">All statuses</option>{Object.entries(proposalStatuses).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}</select></div></header>
      <div className="gve-proposal-grid">{!gov && !error ? [0, 1, 2, 3].map((index) => <LoadingCard key={index} />) : visible.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} gov={gov!} denom={denom} now={now} onInspect={inspect} />)}</div>
      {gov && !visible.length && <div className="gve-panel gve-empty"><strong>No matching proposals</strong><p>Try another status, type, or search within the loaded proposals.</p><button type="button" onClick={reset}>Clear filters</button></div>}
      {gov && <footer className="gve-pagination"><span>{shown.length ? `${current * 12 + 1}–${Math.min((current + 1) * 12, shown.length)} of ${shown.length}` : "0"} matching proposals <i>·</i> {live ? "Updates every 30s" : "Updates paused"}</span><nav aria-label="Proposal pages"><button type="button" aria-label="Previous proposal page" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-label={`Proposal page ${index + 1}`} aria-current={index === current ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}<button type="button" aria-label="Next proposal page" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>›</button></nav></footer>}
    </section>
    {selected !== null && gov && <ProposalDetails key={selected} proposal={proposals.find((proposal) => proposal.id === selected)} id={selected} gov={gov} denom={denom} bonded={bonded} now={now} onClose={close} />}
  </div>;
}

function ProposalCard({ proposal, gov, denom, now, featured = false, onInspect }: { proposal: Proposal; gov: GovernanceData; denom: Denom | null; now: number; featured?: boolean; onInspect: (proposal: Proposal) => void }) {
  const status = statusFor(proposal);
  const depositing = proposal.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD";
  const deposit = depositing ? proposalDeposit(proposal, gov.params) : null;
  const active = isActiveProposal(proposal);
  return <article className={`gve-panel gve-card ${featured ? "featured" : ""}`}>
    <header><span className="gve-id">#{proposal.id}</span><Chip tone={status.tone}>{status.label}</Chip>{proposal.expedited && <Chip tone="warn">Expedited</Chip>}<span className="gve-kind" title={proposalKind(proposal)}>{proposalKind(proposal)}<Glyph name={proposal.upgrade ? "upgrade" : "parameters"} /></span></header>
    <h3><button type="button" onClick={() => onInspect(proposal)}>{proposal.title ?? "Untitled proposal"}</button></h3>
    <p className="gve-summary">{proposal.summary || (proposal.upgrade ? `Upgrade ${proposal.upgrade.name}${proposal.upgrade.height ? ` at height ${fmt(proposal.upgrade.height)}` : ""}.` : "Open this proposal to inspect its available details.")}</p>
    {depositing ? <div className="gve-card-deposit"><span>Deposit {deposit ? `${coin(deposit.deposited.amount, deposit.deposited.denom, denom, 0)} / ${coin(deposit.minimum.amount, deposit.minimum.denom, denom, 0)}` : "unavailable"}</span><div className="gve-meter"><i style={{ width: `${Math.min(100, deposit?.percent ?? 0)}%` }} /></div></div> : <VoteBreakdown proposal={proposal} />}
    <footer><span title={deadline(proposal) ?? undefined}><Glyph name="calendar" />{deadlineLabel(proposal, now)}</span><button type="button" onClick={() => onInspect(proposal)}>{active ? depositing ? "View deposit" : "Track vote" : "View details"}<span aria-hidden="true">→</span></button></footer>
  </article>;
}
function deadline(proposal: Proposal) { return proposal.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD" ? proposal.deposit_end_time : proposal.voting_end_time; }
function deadlineLabel(proposal: Proposal, now: number) {
  const end = deadline(proposal);
  if (!end || !Number.isFinite(Date.parse(end))) return "Deadline unavailable";
  if (isActiveProposal(proposal)) return Date.parse(end) > now ? `Ends in ${duration((Date.parse(end) - now) / 1000)}` : "Awaiting final status";
  return `Ended ${date(end)}`;
}
function VoteBreakdown({ proposal, detailed = false }: { proposal: Proposal; detailed?: boolean }) {
  const tally = tallyShares(proposal.tally);
  return <div className={`gve-votes ${detailed ? "detailed" : ""}`}><div className="gve-vote-bar" role="img" aria-label={tally.total === null ? "Tally unavailable" : tally.total === 0n ? "No votes recorded" : voteChoices.map((choice) => `${choice.label} ${tally.shares[choice.key]!.toFixed(1)}%`).join(", ")}>{voteChoices.map((choice) => <i key={choice.key} style={{ width: `${tally.shares[choice.key] ?? 0}%`, background: choice.color }} />)}</div><ul className="gve-vote-legend">{voteChoices.map((choice) => <li key={choice.key}><i style={{ background: choice.color }} /><span>{choice.label}</span><strong>{tally.total === null || tally.total === 0n ? "—" : `${tally.shares[choice.key]!.toFixed(1)}%`}</strong>{detailed && <small>{/^\d+$/.test(proposal.tally[choice.key]) ? BigInt(proposal.tally[choice.key]).toLocaleString("en-US") : "—"} voting units</small>}</li>)}</ul>{detailed && <p className="gve-muted">{tally.total === null ? "The vote tally is unavailable." : tally.total === 0n ? "No votes have been recorded in this tally." : "Shares of recorded voting power, including abstentions. These are not counts of individual voters."}</p>}</div>;
}
function LoadingCard() { return <div className="gve-panel gve-loading"><Skeleton h={18} w="55%" /><Skeleton h={44} w="95%" /><Skeleton h={30} w="100%" /><Skeleton h={10} w="100%" /></div>; }

function ProposalDetails({ proposal, id, gov, denom, bonded, now, onClose }: { proposal?: Proposal; id: number; gov: GovernanceData; denom: Denom | null; bonded: string | null; now: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const copyLink = async () => { try { await copyText(`${location.origin}${location.pathname}#/governance/${id}`); setCopied(true); setCopyError(false); } catch { setCopyError(true); } };
  const turnout = proposal ? proposalTurnout(proposal, bonded) : null;
  const deposit = proposal ? proposalDeposit(proposal, gov.params) : null;
  const status = proposal ? statusFor(proposal) : null;
  return <dialog className="gve-dialog" ref={dialog} aria-labelledby="proposal-detail-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><div><span className="gve-detail-kicker">Proposal #{id}{proposal ? ` · ${proposalKind(proposal)}` : ""}</span><h2 id="proposal-detail-title">{proposal?.title ?? "Proposal unavailable"}</h2>{proposal && <div className="gve-detail-badges"><Chip tone={status!.tone}>{status!.label}</Chip>{proposal.expedited && <Chip tone="warn">Expedited</Chip>}<span>{deadlineLabel(proposal, now)}</span></div>}</div><button type="button" className="gve-close" aria-label="Close proposal details" onClick={onClose}>×</button></header>
    <div className="gve-detail-body">{!proposal ? <p className="gve-muted">Proposal #{id} is outside the latest {gov.proposals.length} proposals returned by this explorer.</p> : <>
      <section><h3>Proposal summary</h3><p className="gve-full-summary">{proposal.summary || "No summary was supplied."}</p>{proposal.summary && proposal.summary.length >= 1000 && <p className="gve-muted">The API provides up to 1,000 characters of the proposal summary.</p>}{proposal.upgrade && <div className="gve-upgrade"><Glyph name="upgrade" /><span>Upgrade <strong>{proposal.upgrade.name}</strong>{proposal.upgrade.height !== null && <> at block <a href={`#/blocks/${proposal.upgrade.height}`} onClick={onClose}>{fmt(proposal.upgrade.height)}</a></>}</span></div>}</section>
      <section><h3>Vote breakdown</h3><VoteBreakdown proposal={proposal} detailed />{turnout !== null && <div className="gve-turnout"><div><span>Estimated participation</span><strong>{turnout.toFixed(1)}%</strong></div><div className="gve-meter"><i style={{ width: `${Math.min(100, turnout)}%` }} />{gov.params.quorum !== null && <b style={{ left: `${Math.min(100, Math.max(0, gov.params.quorum * 100))}%` }} title={`Current quorum ${percent(gov.params.quorum)}`} />}</div><p className="gve-muted">Recorded voting power compared with current bonded stake. Current quorum: {percent(gov.params.quorum)}.</p></div>}</section>
      <section><h3>Timeline & deposit</h3><dl className="gve-detail-facts"><Fact label="Submitted">{date(proposal.submit_time, true)}</Fact><Fact label="Deposit deadline">{date(proposal.deposit_end_time, true)}</Fact><Fact label="Voting started">{date(proposal.voting_start_time, true)}</Fact><Fact label="Voting ended / ends">{date(proposal.voting_end_time, true)}</Fact><Fact label="Total deposit">{proposal.total_deposit.map((value) => coin(value.amount, value.denom, denom, 2)).join(", ") || "—"}</Fact><Fact label="Proposer"><span title={proposal.proposer ?? undefined}>{middle(proposal.proposer, 20, 10)}</span></Fact></dl>{proposal.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD" && deposit && <div className="gve-turnout"><div><span>Current minimum deposit</span><strong>{coin(deposit.minimum.amount, deposit.minimum.denom, denom, 0)}</strong></div><div className="gve-meter"><i style={{ width: `${Math.min(100, deposit.percent)}%` }} /></div></div>}</section>
      <section><h3>Current governance rules</h3><p className="gve-muted">Current network parameters; historical proposals may have used different rules.</p><dl className="gve-detail-facts"><Fact label="Quorum">{percent(gov.params.quorum)}</Fact><Fact label={proposal.expedited ? "Expedited threshold" : "Threshold"}>{percent(proposal.expedited ? gov.params.expedited_threshold : gov.params.threshold)}</Fact><Fact label="Veto threshold">{percent(gov.params.veto_threshold)}</Fact><Fact label="Voting period">{duration(proposal.expedited ? gov.params.expedited_voting_period_s : gov.params.voting_period_s)}</Fact></dl></section>
      <section><h3>On-chain message types</h3>{proposal.messages.length ? <ul className="gve-message-types">{proposal.messages.map((message, index) => <li key={index}><code>{message}</code></li>)}</ul> : <p className="gve-muted">No message types reported.</p>}</section>
    </>}</div><footer><span role="status">{copyError ? "Clipboard unavailable. Copy the URL from your browser." : "Proposal details · read-only"}</span><button type="button" onClick={() => void copyLink()}>{copied ? "Link copied ✓" : "Copy proposal link ↗"}</button></footer>
  </dialog>;
}
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = { star: "m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z", list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6", quorum: "M11 3a9 9 0 1 0 10 10H11V3Zm3-1v8h8a9 9 0 0 0-8-8Z", shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 4v9", veto: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 6l12 12", deposit: "M12 3C7 3 3 5 3 7s4 4 9 4 9-2 9-4-4-4-9-4ZM3 7v10c0 2 4 4 9 4s9-2 9-4V7M3 12c0 2 4 4 9 4s9-2 9-4", clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2", calendar: "M4 5h16v16H4V5Zm3-3v6m10-6v6M4 10h16", upgrade: "m7 11 5-5 5 5M12 6v12M5 21h14", parameters: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.parameters} /></svg>;
}
