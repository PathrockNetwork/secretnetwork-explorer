import { preferredScrollBehavior } from "../appearance";
import { Timestamp } from "../components/Timestamp";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { getBlocks, getBlockTransactions, getTransactions, type PipelineBlock, type Transaction } from "../api";
import { filterBlocks, gasForBlock, getBlockExecution, getBlockMetadata, type BlockExecution, type BlockMeta } from "../blockExplorer";
import { copyText, fmt, pct, short } from "../lib";
import { CopyButton, LockGlyph, ValidatorAvatar } from "../components/ui";
import { transactionCategory } from "../transactionExplorer";
import "./blocks.css";

const compact = (n: number | null | undefined) => n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const size = (n: number | null | undefined) => n == null ? "—" : `${(n / 1024).toFixed(1)} KiB`;
const heightFromLocation = () => { const match = location.hash.match(/^#\/blocks\/(\d+)$/); const h = Number(match?.[1]); return Number.isSafeInteger(h) && h > 0 ? h : null; };
type Detail = { execution: BlockExecution | null; transactions: Transaction[]; txError: string | null; executionError: string | null; loading: boolean };

export function Blocks({ d, live }: { d: Dashboard; live: boolean }) {
  const [blocks, setBlocks] = useState<PipelineBlock[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txError, setTxError] = useState(false);
  const [txLoading, setTxLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<number | null>(heightFromLocation);
  const [meta, setMeta] = useState<Record<number, BlockMeta>>({});
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [volume, setVolume] = useState("all");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [jumpHeight, setJumpHeight] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const running = live && !paused;
  const pick = (height: number) => { setSelected(height); location.hash = `/blocks/${height}`; };
  const copy = async (value: string) => { try { await copyText(value); setCopied(value); setCopyError(false); } catch { setCopyError(true); } };
  useEffect(() => { const sync = () => setSelected(heightFromLocation()); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 1800); return () => clearTimeout(t); }, [copied]);
  useEffect(() => {
    let cancelled = false;
    const load = () => getBlocks(50).then((r) => { if (!cancelled) { setBlocks(r.blocks); setError(null); setLoading(false); } }).catch(() => { if (!cancelled) { setError("Recent blocks are temporarily unavailable."); setLoading(false); } });
    void load(); const timer = running ? window.setInterval(load, 10000) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [running]);
  useEffect(() => {
    let cancelled = false;
    const load = () => getTransactions(100).then((r) => { if (!cancelled) { setTransactions(r.transactions); setTxError(false); setTxLoading(false); } }).catch(() => { if (!cancelled) { setTxError(true); setTxLoading(false); } });
    void load(); const timer = running ? window.setInterval(load, 30000) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [running]);
  const rows = useMemo(() => filterBlocks(blocks, query, status, volume, ascending), [blocks, query, status, volume, ascending]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * perPage, current * perPage + perPage);
  useEffect(() => setPage(0), [query, status, volume, ascending, perPage]);
  const head = blocks[0];
  const selectedHeight = selected ?? head?.height ?? null;
  const selectedMeta = selectedHeight ? meta[selectedHeight] : undefined;
  const picked: PipelineBlock | undefined = blocks.find((b) => b.height === selectedHeight) ?? (selectedMeta ? {
    height: selectedMeta.height, hash: selectedMeta.hash, time: selectedMeta.time, tx_count: selectedMeta.txCount, round: null, votes: { signed: null, total: null },
    proposer: selectedMeta.proposer ? { address: selectedMeta.proposer, moniker: d.validators.find((v) => v.address === selectedMeta.proposer)?.moniker ?? null, avatar_url: d.validators.find((v) => v.address === selectedMeta.proposer)?.avatar_url ?? null } : null,
  } : undefined);
  const visibleMin = visible.length ? Math.min(...visible.map((b) => b.height)) : null;
  const visibleMax = visible.length ? Math.max(...visible.map((b) => b.height)) : null;
  useEffect(() => {
    if (!head) return;
    let cancelled = false;
    setMetaLoading(true);
    const ranges: [number, number][] = [[Math.max(1, head.height - 19), head.height]];
    if (visibleMin && visibleMax && visibleMin < head.height - 19) ranges.push([visibleMin, Math.min(visibleMax, visibleMin + 19)]);
    if (selectedHeight && !ranges.some(([min, max]) => selectedHeight >= min && selectedHeight <= max)) ranges.push([Math.max(1, selectedHeight - 1), Math.max(selectedHeight, Math.min(head.height, selectedHeight + 1))]);
    void Promise.allSettled(ranges.map(([min, max]) => getBlockMetadata(min, max))).then((results) => {
      if (cancelled) return;
      setMetaLoading(false);
      const found = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
      setMetaError(results.some((r) => r.status === "rejected") ? "Some block headers are unavailable." : null);
      setMeta((old) => Object.fromEntries([...Object.values(old), ...found].filter((m) => m.height >= head.height - 100 || (selectedHeight !== null && Math.abs(m.height - selectedHeight) <= 1)).map((m) => [m.height, m])));
    });
    return () => { cancelled = true; };
  }, [head?.height, visibleMin, visibleMax, selectedHeight]);
  useEffect(() => {
    if (!picked || details[picked.height]?.loading === false) return;
    let cancelled = false;
    const b = picked;
    setDetails((old) => ({ ...old, [b.height]: { execution: null, transactions: [], txError: null, executionError: null, loading: true } }));
    void Promise.allSettled([getBlockExecution(b.height, b.tx_count), b.tx_count === 0 ? Promise.resolve({ transactions: [] as Transaction[] }) : getBlockTransactions(b.height)]).then(([execution, txs]) => {
      if (cancelled) return;
      setDetails((old) => ({ ...Object.fromEntries(Object.entries(old).slice(-99)), [b.height]: { execution: execution.status === "fulfilled" ? execution.value : null, transactions: txs.status === "fulfilled" ? txs.value.transactions : [], txError: txs.status === "rejected" ? "Transactions are temporarily unavailable." : null, executionError: execution.status === "rejected" ? "Execution details are temporarily unavailable." : null, loading: false } }));
    });
    return () => { cancelled = true; };
  }, [picked?.height, picked?.tx_count]);
  const gas = (b: PipelineBlock) => details[b.height]?.execution?.gasUsed ?? gasForBlock(b, transactions);
  const maxGas = Math.max(1, ...blocks.map((b) => gas(b) ?? 0));
  const streamLive = running && !error && d.state !== "stopped" && d.state !== "dberror";
  const selectedDetail = picked ? details[picked.height] : undefined;
  return <div className="bx-page bx-history">
    <div className="bx-chain-toolbar"><span>Chain explorer <i>/</i> Blocks <i>/</i> Consensus</span><div><form onSubmit={(event) => { event.preventDefault(); const height = Number(jumpHeight); if (Number.isSafeInteger(height) && height > 0 && (!head || height <= head.height)) pick(height); }}><input type="number" min={1} max={head?.height} step={1} required aria-label="Jump to block height" placeholder="Jump to height…" value={jumpHeight} onChange={(event) => setJumpHeight(event.target.value)} /><button type="submit">Go →</button></form><a href="#/rpc">↗ Query via RPC</a></div></div>
    <section className="bx-card bx-sequence">
      <header><div><h2>Live block sequence</h2><span>Follow the head or inspect an earlier height.</span><LiveBadge live={streamLive} /></div><div className="bx-sequence-meta"><span>Height <strong>{head ? fmt(head.height) : "—"}</strong></span><span>{d.net?.avg_block_time_ms == null ? "—" : `${(d.net.avg_block_time_ms / 1000).toFixed(2)}s`} cadence</span><button type="button" disabled={!live} onClick={() => setPaused(!paused)} aria-label={paused ? "Resume block updates" : "Pause block updates"}>{paused ? "▶ Resume" : "Ⅱ Pause"}</button><button type="button" onClick={() => { setSelected(null); location.hash = "/blocks"; }}>Follow head →</button></div></header>
      <div className="bx-sequence-track">{blocks.slice(0, 9).map((block) => <button type="button" key={block.height} className={`bx-sequence-block ${block.height === picked?.height ? "selected" : ""}`} onClick={() => pick(block.height)} aria-pressed={block.height === picked?.height} aria-label={`Inspect block ${block.height}`}>
        <strong><Glyph name="cube" />#{fmt(block.height)}</strong><span title={block.proposer?.moniker ?? block.proposer?.address}>{block.proposer?.moniker ?? (block.proposer ? short(block.proposer.address) : "Unknown proposer")}</span><SignatureStrip block={block} compact /><small><span>{fmt(block.tx_count)} tx</span><span><Timestamp value={block.time} /></span></small>
      </button>)}{!blocks.length && <p className="bx-muted">{loading ? "Loading block sequence…" : error ?? "Waiting for indexed blocks."}</p>}</div>
    </section>
    {error && <p className="bx-notice" role="alert">{error} {blocks.length > 0 && "Showing the last successful snapshot."}</p>}
    {copyError && <p className="bx-notice" role="alert">Could not copy to clipboard.</p>}
    <div className="bx-workspace"><section className="bx-card bx-directory"><header><div><h2>Block ledger <small>{blocks.length} recently indexed</small></h2><p>Committed history · {ascending ? "oldest" : "newest"} height first</p></div><div className="bx-ledger-actions"><button type="button" aria-pressed={volume === "all" && status === "all"} onClick={() => { setVolume("all"); setStatus("all"); setQuery(""); }}>All blocks</button><button type="button" aria-pressed={volume === "transactions"} onClick={() => { setVolume("transactions"); setStatus("all"); }}>With transactions</button><button type="button" aria-pressed={status === "partial"} onClick={() => { setStatus("partial"); setVolume("all"); }}>Missing signatures</button><button type="button" aria-expanded={filtersOpen} aria-controls="block-ledger-filters" onClick={() => setFiltersOpen(!filtersOpen)}>☷ Filters</button></div></header>
      {filtersOpen && <div className="bx-filters" id="block-ledger-filters"><label className="bx-search"><Glyph name="search" /><input aria-label="Search blocks" placeholder="Search height, hash, or proposer…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Block status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All commits</option><option value="partial">Missing signatures</option><option value="retry">Extra rounds</option></select><select aria-label="Transaction volume" value={volume} onChange={(event) => setVolume(event.target.value)}><option value="all">Any tx count</option><option value="transactions">With transactions</option><option value="empty">Empty blocks</option></select><select aria-label="Sort blocks" value={ascending ? "asc" : "desc"} onChange={(event) => setAscending(event.target.value === "asc")}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div>}
      <div className="bx-table-scroll" tabIndex={0} role="region" aria-label="Block ledger"><table className="bx-table"><thead><tr><th>Height</th><th>UTC time</th><th>Proposed by</th><th>Txs</th><th title="Bars scale to the largest known gas total in the recent sample, not a block gas limit">Gas used</th><th>Commit</th><th>Finality</th><th><span className="bx-action-label">Inspect</span></th></tr></thead><tbody>{visible.map((block) => <tr key={block.height} className={block.height === picked?.height ? "selected" : ""} onClick={() => pick(block.height)}>
        <td><button className="bx-height" type="button" onClick={() => pick(block.height)} aria-pressed={block.height === picked?.height}>{fmt(block.height)}</button></td><td title={new Date(block.time).toUTCString()}><span>{utcTime(block.time)}</span><small className="bx-ledger-age"><Timestamp value={block.time} /></small></td><td><div className="bx-proposer">{block.proposer && <ValidatorAvatar address={block.proposer.address} avatarUrl={block.proposer.avatar_url} size={26} />}<span title={block.proposer?.moniker ?? block.proposer?.address}>{block.proposer?.moniker ?? (block.proposer ? short(block.proposer.address) : "Unknown")}</span></div></td><td>{fmt(block.tx_count)}</td><td><BarValue value={gas(block)} max={maxGas} /></td><td><Commit block={block} /></td><td><Finalized /></td><td><button className="bx-inspect-button" type="button" aria-label={`Open block ${block.height} inspector`} onClick={(event) => { event.stopPropagation(); pick(block.height); document.querySelector('.bx-inspector')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" }); }}>›</button></td>
      </tr>)}{visible.length === 0 && <tr><td colSpan={8} className="bx-empty">{loading ? "Loading indexed blocks…" : error ?? (blocks.length ? "No blocks match your filters." : "No blocks indexed yet.")}{blocks.length > 0 && <button type="button" onClick={() => { setQuery(""); setStatus("all"); setVolume("all"); }}>Clear filters</button>}</td></tr>}</tbody></table></div>
      <footer><span>{rows.length ? `${current * perPage + 1}–${Math.min((current + 1) * perPage, rows.length)} of ${rows.length} recent blocks` : "0 matching blocks"}</span><nav aria-label="Block pages"><button type="button" aria-label="Previous block page" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: pages }, (_, i) => <button type="button" key={i} aria-label={`Block page ${i + 1}`} aria-current={i === current ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</button>)}<button type="button" aria-label="Next block page" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>›</button></nav><label>Rows <select aria-label="Blocks per page" value={perPage} onChange={(event) => setPerPage(Number(event.target.value))}>{[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}</select></label></footer>
    </section>
    <BlockInspector key={picked?.height ?? "empty"} block={picked} meta={selectedMeta} childMeta={picked ? meta[picked.height + 1] : undefined} headHeight={head?.height} onSelect={pick} detail={selectedDetail} copied={copied} onCopy={copy} pending={loading || metaLoading} error={metaError} /></div>
    <BlockAnalytics blocks={blocks} selected={picked} detail={selectedDetail} gas={gas} onSelect={pick} samplePending={txLoading} sampleError={txError} />
    <div className="bx-footnote"><span>SECRET NETWORK / CHAIN HISTORY / {d.net?.chain.chain_id ?? "secret-4"}</span><span>Public consensus. Private contracts.</span></div>
  </div>;
}

function utcTime(time: string) { return new Date(time).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }); }
function SignatureStrip({ block, compact = false }: { block: PipelineBlock; compact?: boolean }) {
  const { signed, total } = block.votes;
  const known = signed !== null && total !== null && total > 0;
  const segments = compact ? 10 : Math.min(total && total > 0 ? total : 23, 100);
  const filled = known ? Math.floor(signed / total * segments) : 0;
  return <span className={`bx-signature-strip ${compact ? "compact" : ""} ${known ? "" : "unknown"}`} role="img" aria-label={known ? `${signed} of ${total} signatures observed` : "Commit signatures pending"}>{Array.from({ length: segments }, (_, i) => <i key={i} className={i < filled ? "signed" : ""} />)}</span>;
}

function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = { cube: "m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5", pulse: "M2 12h4l3-8 5 16 3-8h5", clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2", hourglass: "M7 3h10M7 21h10M8 3v5l8 8v5M16 3v5l-8 8v5M9 7h6M9 17h6", people: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a6 6 0 0 1 12 0v3M17 4a4 4 0 0 1 0 7m1 3a5 5 0 0 1 4 5v2", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6", gas: "M12 3C6 3 3 5 3 7s3 4 9 4 9-2 9-4-3-4-9-4ZM3 7v10c0 2 3 4 9 4s9-2 9-4V7M3 12c0 2 3 4 9 4s9-2 9-4" };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.cube} /></svg>;
}
function LiveBadge({ live = true }: { live?: boolean }) { return <span className={`bx-live ${live ? "" : "paused"}`}><i />{live ? "Live" : "Paused"}</span>; }
function Finalized() { return <span className="bx-finalized"><i />Finalized</span>; }
function BarValue({ value, max }: { value: number | null; max: number }) { return <span className="bx-bar-value"><span>{compact(value)}</span><i><b style={{ width: `${Math.min(100, (value ?? 0) / max * 100)}%` }} /></i></span>; }
function Commit({ block: b }: { block: PipelineBlock }) { const rate = b.votes.signed !== null && b.votes.total ? b.votes.signed / b.votes.total : null; return <span className="bx-commit" title={rate === null ? "Commit signatures pending" : `${pct(rate * 100)} of validators signed`}><span>{Array.from({ length: 6 }, (_, i) => <i key={i} className={rate !== null && (i + 1) / 6 <= rate ? "signed" : ""} />)}</span><small>{b.votes.signed == null || b.votes.total == null ? "—" : `${b.votes.signed} / ${b.votes.total}`}</small></span>; }

function BlockInspector({ block: b, meta, childMeta, headHeight, onSelect, detail, copied, onCopy, pending, error }: { block?: PipelineBlock; meta?: BlockMeta; childMeta?: BlockMeta; headHeight?: number; onSelect: (height: number) => void; detail?: Detail; copied: string | null; onCopy: (value: string) => void; pending: boolean; error: string | null }) {
  const [tab, setTab] = useState("Header");
  const execution = detail?.execution;
  const hash = b?.hash ?? meta?.hash;
  const knownCommit = b?.votes.signed != null && b.votes.total != null && b.votes.total > 0;
  const headerFields = [["Block hash", hash], ["Parent hash", meta?.parent], ["App hash", meta?.appHash]];
  return <aside className="bx-card bx-inspector" aria-label="Block inspector">
    <header><div><span className="bx-inspector-kicker">Block inspector · selected</span><h2>{b ? `#${fmt(b.height)}` : "Select a height"}</h2></div><div className="bx-inspector-state">{b && <Finalized />}{b && <small><Timestamp value={b.time} /> · {utcTime(b.time)} UTC</small>}</div></header>
    {!b ? <p className="bx-empty">{pending ? "Loading selected block…" : error ?? "This block could not be loaded."}</p> : <>
      <nav className="bx-tabs" aria-label="Block detail tabs">{["Header", "Transactions", "Consensus", "Events", "Raw JSON"].map((value) => <button type="button" key={value} onClick={() => setTab(value)} aria-pressed={tab === value}>{value}{value === "Transactions" && b.tx_count !== null ? ` (${b.tx_count})` : ""}</button>)}</nav>
      <div className="bx-detail-metrics">{[["Transactions", fmt(b.tx_count)], ["Block size", size(meta?.size)], ["Gas used", compact(execution?.gasUsed)], ["Proposer", b.proposer?.moniker ?? (b.proposer ? short(b.proposer.address) : "—")]].map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>
      <section className="bx-participation"><header><h3>Commit participation</h3><span>{knownCommit ? `${b.votes.signed} / ${b.votes.total} · ${pct(b.votes.signed! / b.votes.total! * 100)}` : "Commit pending"}</span></header><SignatureStrip block={b} /><p>{knownCommit ? `${b.votes.signed} signatures observed · ${b.votes.total! - b.votes.signed!} not observed` : "Signatures arrive with the successor block’s commit."}</p></section>
      <div className="bx-detail-body">
        {tab === "Header" && <><div className="bx-public-header"><h3>Public block header</h3><button type="button" onClick={() => onCopy(JSON.stringify({ height: b.height, hash, parent_hash: meta?.parent ?? null, app_hash: meta?.appHash ?? null }, null, 2))}>{copied?.startsWith('{\n  "height"') ? "Copied ✓" : "Copy values ↗"}</button></div><dl className="bx-fields">{headerFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><span title={value ?? undefined}>{value ? short(value) : "—"}</span>{value && <CopyButton value={value} copied={copied === value} onCopy={onCopy} />}</dd></div>)}</dl>{!meta && <p className="bx-muted">{error ?? "Loading block header metadata…"}</p>}<HashContinuity block={b} meta={meta} childMeta={childMeta} headHeight={headHeight} onSelect={onSelect} /></>}
        {tab === "Transactions" && (detail?.loading || !detail ? <p className="bx-muted">Loading this block’s transactions…</p> : detail.txError ? <p className="bx-notice">{detail.txError}</p> : <div className="bx-transactions">{detail.transactions.map((tx) => <a href={`#/transactions/${tx.hash}`} key={tx.hash}><span><strong>{tx.type}</strong><small>Tx {short(tx.hash)}</small></span>{tx.encrypted && <LockGlyph size={13} />}<span className={tx.ok ? "bx-success" : "bx-notice"}>{tx.ok ? "Success" : "Failed"}</span><span aria-hidden="true">↗</span></a>)}{!detail.transactions.length && <p className="bx-muted">{b.tx_count === 0 ? "This block contains no transactions." : "No transactions returned by the node."}</p>}{detail.transactions.length < (b.tx_count ?? 0) && <p className="bx-muted">Showing {detail.transactions.length} of {b.tx_count} transactions (up to 100 per request).</p>}</div>)}
        {tab === "Consensus" && <><dl className="bx-fields"><div><dt>Finality</dt><dd><Finalized /></dd></div><div><dt>Consensus round</dt><dd>{b.round === null ? "Pending successor commit" : b.round}</dd></div><div><dt>Proposer address</dt><dd><span title={b.proposer?.address}>{b.proposer ? short(b.proposer.address) : "—"}</span>{b.proposer && <CopyButton value={b.proposer.address} copied={copied === b.proposer.address} onCopy={onCopy} />}</dd></div><div><dt>Gas used</dt><dd>{fmt(execution?.gasUsed)}</dd></div><div><dt>Gas wanted by transactions</dt><dd>{fmt(execution?.gasWanted)}</dd></div></dl><p className="bx-muted">These are committed blocks. Missing signatures do not mean a transaction failed. Gas wanted is the transaction total, not a block gas limit.</p></>}
        {tab === "Events" && (detail?.loading || !detail ? <p className="bx-muted">Loading block events…</p> : detail.executionError ? <p className="bx-notice">{detail.executionError}</p> : <><dl className="bx-fields">{execution?.events.map((event) => <div key={event.type}><dt>{event.type}</dt><dd>{event.count} event{event.count === 1 ? "" : "s"}</dd></div>)}</dl>{!execution?.events.length && <p className="bx-muted">No public event types returned for this block.</p>}<p className="bx-muted">Public event types only; encrypted attributes remain sealed.</p></>)}
        {tab === "Raw JSON" && <><p className="bx-muted">Public block metadata and execution summary reported by the explorer.</p><pre className="bx-raw-json">{JSON.stringify({ block: b, header: meta ?? null, execution: execution ?? null }, null, 2)}</pre></>}
      </div>
      <div className="bx-visibility"><LockGlyph size={16} /><span><strong>Visibility boundary</strong> · Contract inputs and internal state remain sealed within finalized blocks.</span></div>
    </>}
  </aside>;
}

function HashContinuity({ block, meta, childMeta, headHeight, onSelect }: { block: PipelineBlock; meta?: BlockMeta; childMeta?: BlockMeta; headHeight?: number; onSelect: (height: number) => void }) {
  const currentHash = block.hash ?? meta?.hash;
  const hasChild = headHeight !== undefined && block.height < headHeight;
  const childMatches = currentHash && childMeta?.parent ? currentHash.toUpperCase() === childMeta.parent.toUpperCase() : null;
  const nodes = [
    { label: "Parent", height: block.height - 1, hash: meta?.parent, enabled: block.height > 1, note: block.height > 1 ? "Header pending" : "No parent" },
    { label: "Selected", height: block.height, hash: currentHash, enabled: false, note: "Header pending" },
    { label: "Child", height: block.height + 1, hash: childMeta?.hash, enabled: hasChild, note: hasChild ? "Header pending" : "Waiting for next block" },
  ];
  return <section className="bx-continuity"><header><h3>Hash-linked continuity</h3><span>Public headers</span></header><div className="bx-continuity-track">{nodes.map((node) => <button type="button" key={node.label} className={node.label === "Selected" ? "selected" : ""} disabled={!node.enabled} onClick={() => onSelect(node.height)} title={node.hash ?? undefined}><span>{node.label}</span><code>{node.hash ? short(node.hash) : "—"}</code><small>{node.hash || node.enabled ? `#${fmt(node.height)}` : node.note}</small></button>)}</div>{childMatches !== null && <p className={childMatches ? "bx-muted" : "bx-notice"}>{childMatches ? "Child header references this block’s hash." : "The child header reports a different parent hash."}</p>}</section>;
}

function BlockAnalytics({ blocks, selected, detail, gas, onSelect, samplePending, sampleError }: { blocks: PipelineBlock[]; selected?: PipelineBlock; detail?: Detail; gas: (block: PipelineBlock) => number | null; onSelect: (height: number) => void; samplePending: boolean; sampleError: boolean }) {
  const transactions = detail?.transactions ?? [];
  const groups = [
    { name: "Contract", category: "Contract calls", color: "var(--brand)", n: 0 },
    { name: "Transfer", category: "Token transfers", color: "var(--ok)", n: 0 },
    { name: "IBC", category: "IBC", color: "var(--tx3)", n: 0 },
    { name: "Staking", category: "Staking", color: "var(--warn)", n: 0 },
    { name: "Other", category: "Others", color: "var(--line2)", n: 0 },
  ];
  for (const tx of transactions) (groups.find((group) => group.category === transactionCategory(tx)) ?? groups[4]).n++;
  const gasBlocks = blocks.slice(0, 32).reverse();
  const gasValues = gasBlocks.map(gas);
  const knownGas = gasValues.filter((value): value is number => value !== null);
  const maxGas = Math.max(1, ...knownGas);
  const [expanded, setExpanded] = useState(false);
  return <div className="bx-analytics bx-chain-analytics">
    <Analytic title="Transaction types" subtitle={selected ? `Selected block #${fmt(selected.height)}` : "Select a block"} icon="cube">
      {detail?.loading || !detail ? <p className="bx-muted">Loading the selected block’s contents…</p> : detail.txError ? <p className="bx-notice">{detail.txError}</p> : <><p className="bx-muted">Primary public message types across {transactions.length} loaded transactions.</p><div className="bx-message-distribution" role="img" aria-label={groups.map((group) => `${group.name}: ${group.n}`).join(", ")}>{groups.filter((group) => group.n > 0).map((group) => <i key={group.name} title={`${group.name}: ${group.n}`} style={{ flex: group.n, background: group.color }} />)}</div><ul className="bx-message-legend">{groups.map((group) => <li key={group.name}><i style={{ background: group.color }} /><span>{group.name}</span><strong>{transactions.length ? pct(group.n / transactions.length * 100, 0) : "—"}</strong></li>)}</ul><p className="bx-muted">{selected?.tx_count === 0 ? "This block contains no transactions." : transactions.length < (selected?.tx_count ?? 0) ? `Partial sample: ${transactions.length} of ${selected?.tx_count} transactions.` : "Encrypted contract payloads remain sealed."}</p></>}
    </Analytic>
    <Analytic title="Gas used per block" subtitle={`Recent ${gasBlocks.length} blocks · ${knownGas.length} measured`} icon="gas"><p className="bx-muted">{samplePending ? "Loading gas observations…" : sampleError ? "Recent transaction sample unavailable; showing known totals." : "Measured gas totals, scaled to this sample’s maximum."}</p><div className="bx-gas-columns">{gasBlocks.map((block, index) => <button type="button" key={block.height} className={`${block.height === selected?.height ? "selected" : ""} ${gasValues[index] === null ? "unknown" : ""}`} onClick={() => onSelect(block.height)} title={`Block ${fmt(block.height)} · ${gasValues[index] === null ? "gas unavailable" : `${fmt(gasValues[index])} gas`}`} aria-label={`Inspect block ${block.height}: ${gasValues[index] === null ? "gas unavailable" : `${gasValues[index]} gas`}`}><i style={{ height: `${gasValues[index] === null || gasValues[index] === 0 ? 4 : Math.max(5, gasValues[index]! / maxGas * 100)}%` }} /></button>)}</div><div className="bx-chart-axis"><span>Older</span><span>Peak {compact(knownGas.length ? maxGas === 1 && knownGas.every((value) => value === 0) ? 0 : maxGas : null)} gas</span><span>Head →</span></div><p className="bx-muted">Gray marks indicate unavailable totals.</p></Analytic>
    <Analytic title="Block signals" subtitle="Recent consensus observations" icon="pulse" action={<button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Show less" : "View all →"}</button>}><div className="bx-events">{blocks.slice(0, expanded ? 50 : 5).map((block) => <button type="button" key={block.height} onClick={() => onSelect(block.height)}><i className={(block.round ?? 0) > 0 || (block.votes.signed !== null && block.votes.total !== null && block.votes.signed < block.votes.total) ? "warn" : ""} /><span>#{fmt(block.height)}</span><strong>{(block.round ?? 0) > 0 ? `${block.round} extra round${block.round === 1 ? "" : "s"}` : block.votes.signed !== null && block.votes.total !== null && block.votes.signed < block.votes.total ? `${block.votes.total - block.votes.signed} signatures not observed` : block.votes.signed === null ? "Finalized · commit pending" : "Finalized"}</strong><small><Timestamp value={block.time} /></small></button>)}</div></Analytic>
  </div>;
}
function Analytic({ title, subtitle, icon, children, action }: { title: string; subtitle?: string; icon: string; children: ReactNode; action?: ReactNode }) { return <section className="bx-card bx-analytic"><header><Glyph name={icon} /><div><h3>{title}</h3>{subtitle && <small>{subtitle}</small>}</div>{action}</header>{children}</section>; }
