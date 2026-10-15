import { preferredScrollBehavior } from "../appearance";
import { Timestamp } from "../components/Timestamp";
/** Validator directory and inspector, backed by indexed consensus and staking data. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import type { Validator, SetChange } from "../api";
import { Chip, CopyButton, Skeleton, ValidatorAvatar } from "../components/ui";
import { compactUnits, copyText, downloadCsv, fmt, pct, short, toCsv } from "../lib";
import { commissionHistogram, commissionStats, directoryRows, isAtRisk, matchesValidatorFilter, stakingStatusSummary, type ValidatorFilter, type ValidatorSort } from "../validatorDirectory";
import { validatorSummary } from "../validatorSummary";
import "./validators.css";

const FILTERS: { id: ValidatorFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "bonded", label: "Bonded" }, { id: "unbonding", label: "Unbonding" },
  { id: "unbonded", label: "Unbonded" }, { id: "jailed", label: "Jailed" }, { id: "tombstoned", label: "Tombstoned" },
  { id: "at-risk", label: "At risk" }, { id: "watched", label: "Watched" },
];
const COLUMNS = [
  ["power", "Voting power"], ["stake", "Stake"], ["commission", "Comm."], ["self", "Min. self bond"],
  ["uptime", "Uptime 1k"], ["long", "Uptime 10k"], ["missed", "Missed"], ["streak", "Streak"],
  ["proposer", "Proposer"], ["sgx", "SGX"], ["status", "Status"],
] as const;
type Column = typeof COLUMNS[number][0];
type Tab = "Overview" | "Identity" | "Performance" | "Attestation" | "Delegations" | "History";
const TABS: Tab[] = ["Overview", "Identity", "Performance", "Attestation", "Delegations", "History"];
const rate = (n: number | null | undefined) => n == null ? "—" : pct(n * 100);

export function Validators({ d, selected, onSelect, win, onWindow }: {
  d: Dashboard; selected: string | null; onSelect: (a: string) => void; win: number; onWindow: (w: number) => void;
}) {
  const [filter, setFilter] = useState<ValidatorFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ValidatorSort>("power");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(11);
  const [columns, setColumns] = useState<Column[]>(COLUMNS.map(([id]) => id));
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [watchOverrides, setWatchOverrides] = useState<Record<string, boolean>>(() => {
    try { const saved = JSON.parse(localStorage.getItem("sealed-validator-watch") ?? "{}"); return saved && typeof saved === "object" ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean> : {}; } catch { return {}; }
  });
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    try { const saved = JSON.parse(localStorage.getItem("sealed-validator-labels") ?? "{}"); return saved && typeof saved === "object" ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string")) as Record<string, string> : {}; } catch { return {}; }
  });
  const saveLabel = (address: string, label: string) => {
    const next = { ...labels, [address]: label.trim() };
    try { localStorage.setItem("sealed-validator-labels", JSON.stringify(next)); setLabels(next); setActionError(""); }
    catch { setActionError("Your browser could not save the label."); }
  };
  const validators = useMemo(() => d.validators.map((v) => ({ ...v, label: labels[v.address] ?? v.label, watched: watchOverrides[v.address] ?? v.watched })), [d.validators, watchOverrides, labels]);
  const threshold = d.staking?.slashing?.jail_threshold ?? null;
  const rows = useMemo(() => directoryRows(validators, query, filter, sort, descending, threshold), [validators, query, filter, sort, descending, threshold]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  const picked = validators.find((v) => v.address === selected) ?? rows[0] ?? validators[0];
  const totalPower = validators.reduce((s, v) => s + (v.is_active ? v.voting_power ?? 0 : 0), 0);
  const commissions = commissionStats(validators);
  const knownStaking = validators.some((v) => v.staking !== null);
  const loading = d.state === "loading";
  const failed = d.state === "dberror";
  const unavailable = loading || failed || validators.length === 0;

  useEffect(() => { if (picked && picked.address !== selected) onSelect(picked.address); }, [picked?.address, selected, onSelect]);
  useEffect(() => { setPage(0); }, [query, filter, sort, descending, pageSize]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 1800); return () => clearTimeout(timer); }, [copied]);
  const onCopy = async (value: string) => { try { await copyText(value); setCopied(value); } catch { setActionError("Could not copy to clipboard."); } };
  const toggleWatch = (v: Validator) => {
    const next = { ...watchOverrides, [v.address]: !v.watched };
    try { localStorage.setItem("sealed-validator-watch", JSON.stringify(next)); setWatchOverrides(next); setActionError(""); }
    catch { setActionError("Your browser could not save the watchlist."); }
  };
  const exportCsv = () => downloadCsv("secret-validators.csv", toCsv([
    ["rank", "moniker", "consensus_address", "operator_address", "status", "bond_status", "voting_power", "tokens", "commission_rate", "min_self_delegation", "uptime_1000", "uptime_10000", "slots_10000", "missed_blocks_counter", "missed_streak", "proposed_blocks_1000", "proposer_share_1000", "jailed", "tombstoned", "watched"],
    ...rows.map((v, i) => [i + 1, v.moniker, v.address, v.staking?.operator_address ?? null, v.status, v.staking?.bond_status ?? null, v.voting_power, v.staking?.tokens ?? null, v.staking?.commission_rate ?? null, v.staking?.min_self_delegation ?? null, v.uptime_1000, v.uptime_10000, v.slots_10000, v.staking?.missed_blocks_counter ?? null, v.missed_streak, v.proposed_blocks_1000 ?? null, v.proposer_share_1000, v.staking?.jailed == null ? "" : String(v.staking.jailed), v.staking?.tombstoned == null ? "" : String(v.staking.tombstoned), v.watched ? "yes" : "no"]),
  ]));
  const stats = [
    { label: "Bonded validators", value: knownStaking ? `${validators.filter((v) => v.staking?.bond_status === "BOND_STATUS_BONDED").length} / ${validators.length}` : "—", note: "Chain staking status", tone: "ok" },
    { label: "Signing rate", value: pct(d.net?.signing_rate_100), note: "Last 100 blocks", tone: "brand" },
    { label: "Average uptime", value: pct(average(validators.map((v) => v.uptime_1000))), note: "Last 1,000 observed slots", tone: "ok" },
    { label: "Validators at risk", value: fmt(validators.filter((v) => isAtRisk(v, threshold)).length), note: "Degraded or ≥80% of jail limit", tone: "warn" },
    { label: "Jailed validators", value: knownStaking ? fmt(validators.filter((v) => v.staking?.jailed).length) : "—", note: "Currently jailed", tone: "bad" },
    { label: "Total voting power", value: totalPower ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(totalPower) : "—", note: "Active consensus set", tone: "brand" },
    { label: "Avg. commission", value: rate(commissions.mean), note: `${commissions.values.length} known rates`, tone: "blue" },
    { label: "Proposer concentration", value: pct(validatorSummary(validators).proposers[0]?.proposer_share_1000), note: "Top validator · last 1k blocks", tone: "brand" },
  ];

  return <div className="vpage">
    <div className="vstats">{stats.map((s, i) => <section className="vstat" key={s.label}>
      <span className={`vstat-icon ${s.tone}`} aria-hidden="true"><StatGlyph index={i} /></span><div><span className="v-eyebrow">{s.label}</span>{loading ? <Skeleton h={22} w="70%" /> : <strong className={s.tone}>{unavailable ? "—" : s.value}</strong>}<small>{s.note}</small></div>
    </section>)}</div>
    <div className="vtoolbar">
      <label className="vsearch"><span aria-hidden="true">⌕</span><input aria-label="Filter validators" placeholder="Filter validators by moniker or operator address…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="vfilters" aria-label="Validator status filters">{FILTERS.map((f) => <button type="button" key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <small>({validators.filter((v) => matchesValidatorFilter(v, f.id, threshold)).length})</small></button>)}</div>
      <div className="vsort"><label>Sort by <select aria-label="Sort validators" value={sort} onChange={(e) => setSort(e.target.value as ValidatorSort)}><option value="power">Voting power</option><option value="stake">Stake</option><option value="commission">Commission</option><option value="uptime">Uptime</option><option value="proposer">Proposer share</option><option value="name">Name</option></select></label><button type="button" onClick={() => setDescending((v) => !v)} aria-label="Reverse sort direction">{descending ? "↓ Desc" : "↑ Asc"}</button>
        <details className="vcolumns"><summary>Columns <span>⌄</span></summary><div>{COLUMNS.map(([id, name]) => <label key={id}><input type="checkbox" checked={columns.includes(id)} onChange={(e) => setColumns((old) => e.target.checked ? [...old, id] : old.filter((c) => c !== id))} />{name}</label>)}</div></details>
        <button type="button" onClick={exportCsv} disabled={unavailable}>↓ Export CSV</button>
      </div>
    </div>
    {actionError && <p className="vnotice" role="alert">{actionError}</p>}
    <div className="vworkspace">
      <div className="vdirectory">
      <section className="vtable-panel">
        <div className="vtable-scroll"><table className="vtable"><thead><tr><th>#</th><th>Validator</th>{COLUMNS.filter(([id]) => columns.includes(id)).map(([id, name]) => <th key={id}>{name}</th>)}<th>Actions</th></tr></thead><tbody>
          {unavailable ? <tr><td colSpan={columns.length + 3} className="vempty">{loading ? "Loading validators…" : failed ? "Validator data is temporarily unavailable." : "No validators indexed yet."}</td></tr> : visible.length === 0 ? <tr><td colSpan={columns.length + 3} className="vempty">No validators match this filter. <button onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></td></tr> : visible.map((v, i) => <tr key={v.address} className={`${picked?.address === v.address ? "selected" : ""} ${isAtRisk(v, threshold) ? "at-risk" : ""} ${v.staking?.jailed ? "jailed" : ""}`} onClick={() => onSelect(v.address)}>
            <td className="vmuted">{current * pageSize + i + 1}</td><td><button className="videntity" onClick={() => onSelect(v.address)} aria-pressed={picked?.address === v.address}><ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} size={26} /><span><strong>{v.moniker ?? short(v.address)}</strong><small>{short(v.staking?.operator_address ?? v.address)}</small></span></button></td>
            {COLUMNS.filter(([id]) => columns.includes(id)).map(([id]) => <td key={id}>{cell(id, v, d, totalPower, threshold)}</td>)}
            <td><button className={`vwatch ${v.watched ? "watched" : ""}`} title={v.watched ? "Remove from browser watchlist" : "Watch in this browser"} aria-label={`${v.watched ? "Unwatch" : "Watch"} ${v.moniker ?? short(v.address)}`} onClick={(e) => { e.stopPropagation(); toggleWatch(v); }}>{v.watched ? "★" : "☆"}</button><button className="vinspect" aria-label={`Inspect ${v.moniker ?? short(v.address)}`} onClick={() => { onSelect(v.address); document.querySelector('.vinspector')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" }); }}>···</button></td>
          </tr>)}
        </tbody></table></div>
        <footer className="vtable-footer"><span>{rows.length ? `Showing ${current * pageSize + 1}–${Math.min((current + 1) * pageSize, rows.length)} of ${rows.length} validators` : "0 validators"}</span><nav aria-label="Validator pages"><button aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: pages }, (_, i) => <button key={i} aria-label={`Page ${i + 1}`} aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</button>)}<button aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>›</button></nav><label>Rows per page <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[11, 25, 50].map((n) => <option key={n}>{n}</option>)}</select></label></footer>
      </section>
      {!unavailable && <Analytics d={d} validators={validators} onSelect={onSelect} commissions={commissions} onViewProposers={() => { setFilter("all"); setQuery(""); setSort("proposer"); setDescending(true); setPageSize(25); document.querySelector('.vtable-panel')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" }); }} />}
      </div>
      <Inspector key={picked?.address ?? "empty"} v={unavailable ? undefined : picked} d={d} win={win} onWindow={onWindow} totalPower={totalPower} copied={copied} onCopy={onCopy} onLabel={saveLabel} />
    </div>
    <div className="vfootnote"><span>* Partial uptime history · hover for observed slots</span><span>SECRET NETWORK EXPLORER · VALIDATOR INTELLIGENCE · {d.net?.chain.chain_id ?? "SECRET NETWORK"}</span><span>What the chain shows, and what it seals.</span></div>
  </div>;
}

function StatGlyph({ index }: { index: number }) {
  const paths = [
    "M8 11h8l3 8H5l3-8Zm1-5a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM9 15h6",
    "m12 3 9 9-9 9-9-9 9-9Zm0 5 4 4-4 4-4-4 4-4Z",
    "m12 3 9 9-9 9-9-9 9-9Zm-4 9 3 3 5-6",
    "m12 3 10 18H2L12 3Zm0 6v5m0 3v1",
    "M10 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM3 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm14 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM12 7v5m0 0-6 4m6-4 6 4",
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z",
    "m6 19 12-14M5 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z",
    "M4 4h16v16H4V4Zm5 0v16m6-16v16",
  ];
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[index]} /></svg>;
}

function average(values: (number | null)[]) { const present = values.filter((v): v is number => v !== null); return present.length ? present.reduce((s, v) => s + v, 0) / present.length : null; }
function power(v: Validator, total: number) { return v.voting_power !== null && total > 0 ? v.voting_power / total * 100 : null; }
function Status({ v, threshold }: { v: Validator; threshold: number | null }) {
  if (v.staking?.tombstoned) return <Chip tone="bad">Tombstoned</Chip>;
  if (v.staking?.jailed) return <Chip tone="bad">Jailed</Chip>;
  if (isAtRisk(v, threshold)) return <Chip tone="warn">△ At risk</Chip>;
  const bond = v.staking?.bond_status;
  if (bond === "BOND_STATUS_BONDED") return <Chip tone={v.status === "inactive" ? "warn" : "ok"}>{v.status === "inactive" ? "Bonded · offline" : "▪ Bonded"}</Chip>;
  if (bond === "BOND_STATUS_UNBONDING") return <Chip tone="warn">Unbonding</Chip>;
  if (bond === "BOND_STATUS_UNBONDED") return <Chip tone="muted">Unbonded</Chip>;
  return <Chip tone={v.status === "active" ? "ok" : "muted"}>{v.status}</Chip>;
}
function Uptime({ value, partial }: { value: number | null; partial?: string }) { return <span title={partial ? `Partial history: ${partial} observed slots` : undefined} className={`vuptime ${value !== null && value < 99 ? "bad" : "ok"}`}><strong>{pct(value)}{partial && <sup className="vpartial">*</sup>}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></i></span>; }
function cell(id: Column, v: Validator, d: Dashboard, total: number, threshold: number | null): ReactNode {
  const denom = d.net?.chain.denom ?? null;
  switch (id) {
    case "power": return <span className="vmetric"><strong>{pct(power(v, total), 2)}</strong><small>{fmt(v.voting_power)}</small></span>;
    case "stake": return compactUnits(v.staking?.tokens, denom);
    case "commission": return rate(v.staking?.commission_rate);
    case "self": return <span title="Chain-declared minimum self delegation, in base units">{v.staking?.min_self_delegation ?? "—"}</span>;
    case "uptime": return <Uptime value={v.uptime_1000} />;
    case "long": return <Uptime value={v.uptime_10000} partial={v.slots_10000 < (d.net?.long_window.target ?? 10000) ? `${fmt(v.slots_10000)} / ${fmt(d.net?.long_window.target ?? 10000)}` : undefined} />;
    case "missed": return fmt(v.staking?.missed_blocks_counter);
    case "streak": return <span className={v.missed_streak >= 3 ? "bad" : "vmuted"}>{fmt(v.missed_streak)}</span>;
    case "proposer": return pct(v.proposer_share_1000);
    case "sgx": return <span className="vunknown" title="SGX registration is not indexed">—</span>;
    case "status": return <Status v={v} threshold={threshold} />;
  }
}

function Inspector({ v, d, win, onWindow, totalPower, copied, onCopy, onLabel }: { v?: Validator; d: Dashboard; win: number; onWindow: (n: number) => void; totalPower: number; copied: string | null; onCopy: (value: string) => void; onLabel: (address: string, label: string) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(v?.label ?? "");
  const slots = v && d.detail?.validator.address === v.address && d.detail.window === win ? d.detail.slots : [];
  const signed = slots.filter((s) => s.signed === true).length;
  const eligible = slots.filter((s) => s.signed !== null).length;
  const denom = d.net?.chain.denom ?? null;
  const website = safeUrl(v?.staking?.website);
  const explorer = safeUrl(d.net?.chain.blockscout_url);
  return <aside className="vinspector" aria-label="Selected validator details">
    {!v ? <div className="vempty">{d.state === "loading" ? "Loading validator details…" : d.state === "dberror" ? "Validator data is unavailable." : "Select a validator to inspect its performance."}</div> : <>
      <header className="vinspector-head"><ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} size={36} /><div><h2>{v.moniker ?? short(v.address)}</h2><span>{short(v.staking?.operator_address ?? v.address)} <CopyButton value={v.staking?.operator_address ?? v.address} copied={copied === (v.staking?.operator_address ?? v.address)} onCopy={onCopy} /></span></div><Status v={v} threshold={d.staking?.slashing?.jail_threshold ?? null} /></header>
      <div className="vinspector-links">{website && <a href={website} target="_blank" rel="noreferrer">Website ↗</a>}{explorer && v.staking?.operator_address && <a href={`${explorer.replace(/\/$/, '')}/validators/${encodeURIComponent(v.staking.operator_address)}`} target="_blank" rel="noreferrer">View in explorer ↗</a>}</div>
      <nav className="vdetail-tabs" aria-label="Validator detail sections">{TABS.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <div className="vinspector-body">
        {(tab === "Overview" || tab === "Performance") && <>
          <div className="vdetail-facts"><Fact label="Voting power" value={pct(power(v, totalPower), 2)} note={fmt(v.voting_power)} /><Fact label="Commission" value={rate(v.staking?.commission_rate)} /><Fact label="Min. self bond" value={v.staking?.min_self_delegation ?? "—"} note="Base units · declared minimum" /><Fact label="Status" value={<Status v={v} threshold={d.staking?.slashing?.jail_threshold ?? null} />} /><Fact label="Rank" value={`#${v.rank} of ${d.validators.length}`} /><Fact label="Proposer share" value={pct(v.proposer_share_1000)} /></div>
          <section className="vdetail-section"><div className="vsection-title"><h3>Signing history</h3><label>Last <select aria-label="Signing history window" value={win} onChange={(e) => onWindow(Number(e.target.value))}>{[100, 500, 1000].map((n) => <option key={n}>{n}</option>)}</select> blocks</label></div>
            <div className="vsigning-summary"><span>{slots.length ? `${fmt(signed)} / ${fmt(eligible)} signed` : "Signing history is loading or unavailable"}</span><strong className="ok">{eligible ? pct(signed / eligible * 100, 2) : "—"}</strong></div>
            <div className="vheatmap" aria-label="Signing history, newest block first">{slots.map((s) => <span key={s.height} style={{ background: s.signed === null ? "var(--line2)" : s.signed ? "var(--ok)" : "var(--bad)" }} title={`Block ${fmt(s.height)} · ${s.signed === null ? "No signature data" : s.signed ? "Signed" : "Missed"}`} />)}</div>
            <div className="vheatmap-legend"><span><i className="signed" />Signed</span><span><i className="missed" />Missed</span><span><i />No data</span></div>
          </section>
          <section className="vdetail-section"><div className="vsection-title"><h3>Slashing & safety</h3><span className={v.staking?.jailed || v.staking?.tombstoned ? "bad" : "vmuted"}>{v.staking === null ? "Not indexed" : v.staking.jailed === false && v.staking.tombstoned === false ? "No active penalties" : "See chain status"}</span></div><div className="vsafety"><Fact label="Missed blocks counter" value={fmt(v.staking?.missed_blocks_counter)} /><Fact label="Jailed until" value={v.staking?.jailed_until ? new Date(v.staking.jailed_until).toLocaleString() : "—"} /><Fact label="Tombstoned" value={v.staking?.tombstoned == null ? "—" : String(v.staking.tombstoned)} /><Fact label="Last signed height" value={fmt(v.last_signed_height)} /></div></section>
          <Enclave />
        </>}
        {tab === "Identity" && <div className="videntity-details"><Fact label="Moniker" value={v.moniker ?? "—"} /><Fact label="Consensus address" value={v.address} /><Fact label="Operator address" value={v.staking?.operator_address ?? "—"} /><Fact label="Public key" value={v.pub_key ?? "—"} /><Fact label="Keybase identity" value={v.identity ?? "—"} /><Fact label="Description" value={v.staking?.details ?? "No description published."} /><Fact label="First seen" value={fmt(v.first_seen_height)} /><div className="vlabel-editor"><span>Label · saved in this browser</span>{editing ? <form onSubmit={(e) => { e.preventDefault(); onLabel(v.address, label); setEditing(false); }}><input aria-label="Local validator label" value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} /><button>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <button onClick={() => setEditing(true)}>{v.label || "Add label"} ✎</button>}</div></div>}
        {tab === "Attestation" && <Enclave expanded />}
        {tab === "History" && <section className="vdetail-section"><div className="vsection-title"><h3>Validator history</h3><span>Indexed membership</span></div><ValidatorEvents d={d} validators={[v]} events={d.set?.changes.filter((e) => e.address === v.address) ?? []} /><p className="vmuted">First observed at block {fmt(v.first_seen_height)}. Commission and penalty changes are not indexed.</p></section>}
        {tab === "Delegations" && <><div className="vdetail-facts"><Fact label="Validator stake" value={`${compactUnits(v.staking?.tokens, denom)} ${denom?.display ?? ""}`} /><Fact label="Commission" value={rate(v.staking?.commission_rate)} /><Fact label="Min. self delegation" value={v.staking?.min_self_delegation ?? "—"} note="Base units" /></div><p className="vmuted">Individual delegations and actual self-bond amounts are not indexed by this monitor.</p></>}
      </div>
    </>}
  </aside>;
}
function safeUrl(value: string | null | undefined) { if (!value) return null; try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) { return <div className="vfact"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function Enclave({ expanded = false }: { expanded?: boolean }) { return <section className="vdetail-section venclave"><div className="vsection-title"><h3>Enclave attestation (SGX)</h3><Chip tone="muted">Not indexed</Chip></div><div className="vattestation-facts"><Fact label="Registration transaction" value="—" /><Fact label="Registration height" value="—" /><Fact label="Measurement (MRENCLAVE)" value="—" /><Fact label="Attestation provider" value="—" /></div><p>Registration and attestation proofs are not available from the current indexer.</p>{expanded && <p>Validator uptime and bonded status do not establish enclave attestation. Verification requires a chain registration record and its proof.</p>}</section>; }

function Analytics({ d, validators, onSelect, commissions, onViewProposers }: { d: Dashboard; validators: Validator[]; onSelect: (a: string) => void; commissions: ReturnType<typeof commissionStats>; onViewProposers: () => void }) {
  const { total, proposers } = validatorSummary(validators);
  const counts = stakingStatusSummary(validators);
  const distribution = commissionHistogram(commissions.values);
  const tallest = Math.max(1, ...distribution.buckets.map((b) => b.count));
  const statuses = [
    { key: "bonded", label: "Bonded", color: "var(--ok)" },
    { key: "unbonding", label: "Unbonding", color: "var(--warn)" },
    { key: "unbonded", label: "Unbonded", color: "var(--brand2)" },
    { key: "jailed", label: "Jailed", color: "var(--bad)" },
    ...(counts.tombstoned ? [{ key: "tombstoned" as const, label: "Tombstoned", color: "var(--bad)" }] : []),
    ...(counts.unknown ? [{ key: "unknown" as const, label: "Unknown", color: "var(--tx3)" }] : []),
  ] as const;
  let offset = 0;
  const segments = statuses.map((status) => {
    const start = offset;
    offset += total ? counts[status.key] / total * 100 : 0;
    return `${status.color} ${start}% ${offset}%`;
  });
  const [allEvents, setAllEvents] = useState(false);
  const events = d.set?.changes ?? [];
  return <div className="vanalytics">
    <section className="vanalytic"><h3>Top proposers <small>(last 1,000 blocks)</small><button onClick={onViewProposers}>View all →</button></h3><div className="vtop-head"><span>#　 Validator</span><span>Proposer share</span></div>{proposers.map((v, i) => <button className="vtop-row" key={v.address} onClick={() => onSelect(v.address)}><span>{i + 1}</span><ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} size={18} /><strong>{v.moniker ?? short(v.address)}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, (v.proposer_share_1000 ?? 0) / Math.max(1, proposers[0]?.proposer_share_1000 ?? 1) * 100))}%` }} /></i><small>{pct(v.proposer_share_1000)}</small></button>)}{proposers.length === 0 && <p className="vmuted">No proposer history yet.</p>}</section>
    <section className="vanalytic"><h3>Commission distribution <small>{commissions.values.length} known rates</small></h3><div className="vcommission-plot"><div className="vcommission-axis"><span>{tallest}</span><span>{Math.round(tallest / 2)}</span><span>0</span></div><div className="vcommission-chart" role="img" aria-label={`Commission distribution for ${commissions.values.length} validators; median ${rate(commissions.median)}`}>{distribution.buckets.map((b) => <div key={b.min} title={`${rate(b.min)}–${rate(b.max)}: ${b.count} validators`}><i style={{ height: `${b.count / tallest * 100}%` }} /></div>)}{commissions.median !== null && <div className="vcommission-median" style={{ left: `${commissions.median / distribution.max * 100}%` }}><span>Median<br /><b>{rate(commissions.median)}</b></span></div>}</div></div><div className="vchart-axis"><span>0%</span><span>{rate(distribution.max / 4)}</span><span>{rate(distribution.max / 2)}</span><span>{rate(distribution.max * .75)}</span><span>{rate(distribution.max)}</span></div><div className="vcommission-stats">{[["Min", commissions.min], ["Median", commissions.median], ["Mean", commissions.mean], ["Max", commissions.max]].map(([label, value]) => <Fact key={String(label)} label={String(label)} value={rate(value as number | null)} />)}</div></section>
    <section className="vanalytic"><h3>Validator status <small>Chain staking status</small></h3><div className="vstatus-chart"><div className="vstatus-donut" style={{ background: total ? `conic-gradient(${segments.join(",")})` : "var(--line)" }} role="img" aria-label={statuses.map((s) => `${counts[s.key]} ${s.label}`).join(", ")}><div><strong>{total}</strong><small>Total</small></div></div><ul>{statuses.map((s) => <li key={s.key}><i style={{ background: s.color }} /><span>{s.label}</span><strong>{counts[s.key]} <small>({pct(total ? counts[s.key] / total * 100 : null)})</small></strong></li>)}</ul></div></section>
    <section className="vanalytic"><h3>Recent validator events {events.length > 5 && <button aria-expanded={allEvents} onClick={() => setAllEvents((v) => !v)}>{allEvents ? "Show less" : "View all →"}</button>}</h3>{d.bootstrap && <p className="vevents-note">Initial set membership; no later changes observed.</p>}<ValidatorEvents d={d} validators={validators} events={allEvents ? events : events.slice(0, 5)} onSelect={onSelect} /></section>
  </div>;
}

function ValidatorEvents({ d, validators, events, onSelect }: { d: Dashboard; validators: Validator[]; events: SetChange[]; onSelect?: (address: string) => void }) {
  return <div className="vevents">{events.map((e, i) => {
    const name = validators.find((v) => v.address === e.address)?.moniker ?? short(e.address);
    const removed = e.type === "removed";
    const content = <><span className={`vevent-icon ${removed ? "bad" : "ok"}`} aria-hidden="true">{removed ? "−" : "+"}</span><div><strong className={removed ? "bad" : "ok"}>{removed ? "Validator left" : e.type === "added" ? "Validator joined" : e.type}</strong><small title={name}>{name}</small></div><time title={new Date(e.time).toUTCString()}><Timestamp value={e.time} /><small>#{fmt(e.height)}</small></time></>;
    return onSelect && validators.some((v) => v.address === e.address) ? <button className="vevent" key={`${e.height}-${e.address}-${i}`} onClick={() => onSelect(e.address)}>{content}</button> : <div className="vevent" key={`${e.height}-${e.address}-${i}`}>{content}</div>;
  })}{events.length === 0 && <p className="vmuted">{d.set ? "No validator-set changes recorded." : "Validator-set history is unavailable."}</p>}</div>;
}
