import { preferredScrollBehavior } from "../appearance";
import { Timestamp } from "../components/Timestamp";
/** Recent transactions and their public envelope; encrypted fields stay sealed. */
import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { getAccount, getTransaction, getTransactions, type AccountFunds, isSealed, type Denom, type Transaction, type TransactionDetail, type TransactionPage } from "../api";
import { coin, fmt, middle, pct, pts } from "../lib";
import { Chip, CopyButton, LockGlyph, SealedBar, Skeleton } from "../components/ui";
import { addressFromHash, addressRoute, filterTransactions, searchTarget, nativeFees, transactionCategories, transactionCategory, type TransactionFilters } from "../transactionExplorer";
import "./transactions.css";

const defaults: TransactionFilters = { query: "", category: "All", status: "all", privacy: "all", contract: "all", hours: 0 };

export function Transactions({ d, live }: { d: Dashboard; live: boolean }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [open, setOpen] = useState<string | null>(hashFromLocation);
  /** Address whose history is shown (#/transactions/address/<addr>), else the live feed. */
  const [address, setAddress] = useState<string | null>(() => addressFromHash(window.location.hash));
  /** Older pages fetched with "Load older"; the newest page keeps refreshing. */
  const [older, setOlder] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [index, setIndex] = useState<TransactionPage["index"]>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const initialized = useRef(false);
  const inspector = useRef<HTMLDivElement>(null);
  const denom = d.net?.chain.denom ?? null;

  useEffect(() => {
    const sync = () => {
      const next = addressFromHash(window.location.hash);
      setAddress(next);
      if (!next) setOpen(hashFromLocation());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setOlder([]); setCursor(null); setPage(1);
    if (address) { initialized.current = false; setOpen(null); }
    let first = true;
    const load = async () => {
      try {
        const result = await getTransactions(100, { address: address ?? undefined });
        if (cancelled) return;
        setTransactions(result.transactions); setError(null); setLoading(false); setUpdated(Date.now()); setIndex(result.index ?? null);
        // The cursor follows the first page only until "Load older" takes over.
        if (first) { setCursor(result.next_before ?? null); first = false; }
        if (!initialized.current && result.transactions.length) {
          initialized.current = true;
          setOpen((current) => current ?? result.transactions[0]!.hash);
        }
      } catch {
        if (!cancelled) { setError(address ? "This address history is temporarily unavailable." : "The transaction feed is temporarily unavailable."); setLoading(false); }
      }
    };
    void load();
    const timer = live ? window.setInterval(load, 15_000) : undefined;
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [live, address]);

  const loadOlder = async () => {
    if (cursor === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await getTransactions(100, { address: address ?? undefined, before: cursor });
      setOlder((rows) => [...rows, ...result.transactions]); setCursor(result.next_before ?? null);
    } catch { setError("Older transactions could not be loaded."); }
    finally { setLoadingOlder(false); }
  };
  // The refreshed newest page and appended older pages can overlap by a block.
  const rows = [...new Map([...transactions, ...older].map((tx) => [tx.hash, tx])).values()];

  const updateFilter = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1); };
  const onCopy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied((current) => current === value ? null : current), 2000); } catch { /* Leave the selectable value visible when clipboard access is unavailable. */ }
  };
  const inspect = (hash: string) => {
    initialized.current = true; setOpen(hash);
    if (!address) window.history.replaceState(null, "", `#/transactions/${hash}`);
    if (window.innerWidth < 1800) requestAnimationFrame(() => inspector.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" }));
  };
  const shown = filterTransactions(rows, filters, updated ?? Date.now());
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * perPage;
  const visible = shown.slice(start, start + perPage);
  const contracts = [...new Map(rows.filter((tx) => tx.contract).map((tx) => [tx.contract!, tx.contract_label || middle(tx.contract, 10, 5)])).entries()];
  const successful = rows.filter((tx) => tx.ok).length;
  const failed = rows.length - successful;
  const fees = nativeFees(rows, denom);
  const averageFee = fees.length ? fees.reduce((sum, value) => sum + value, 0) / fees.length : null;
  const blocks = new Map<number, number>();
  for (const tx of rows) if (tx.height !== null) blocks.set(tx.height, (blocks.get(tx.height) ?? 0) + 1);
  const blockCounts = [...blocks.entries()].sort((a, b) => a[0] - b[0]).slice(-12).map(([, count]) => count);
  const unavailable = loading || (!rows.length && !!error);
  // A full address or hash in the filter box reaches the whole index, not just the loaded rows.
  const target = searchTarget(filters.query, d.net?.chain.bech32_prefix ?? "secret");
  const jump = target?.kind === "address" && target.address !== address ? target : target?.kind === "transaction" && !rows.some((tx) => tx.hash === target.hash) ? target : null;
  const followJump = () => {
    if (!jump) return;
    setFilters(defaults); setPage(1);
    if (jump.kind === "address") window.location.hash = addressRoute(jump.address).slice(1);
    else inspect(jump.hash);
  };
  const activeFilters = Object.keys(defaults).some((key) => filters[key as keyof TransactionFilters] !== defaults[key as keyof TransactionFilters]);

  return <div className="txe-page">
    <div className="txe-workspace">
      <div className="txe-primary">
        <div className="txe-kpis">
          <Stat icon="transactions" label={address ? "Address transactions" : "Recent transactions"} value={unavailable ? "—" : fmt(rows.length)} note={address ? (cursor !== null ? "Loaded so far · more available" : index ? `Full history the node retains` : "All indexed history") : index ? `Indexed from block ${fmt(index.earliest)}` : "Newest indexed blocks · up to 100"}>
            <div className="txe-mini-bars" role="img" aria-label="Loaded transaction count by block, oldest to newest">{blockCounts.map((count, i) => <i key={i} style={{ height: `${count / Math.max(1, ...blockCounts) * 100}%` }} title={`${count} loaded transactions`} />)}</div>
          </Stat>
          <Stat icon="success" label="Successful" value={unavailable || !rows.length ? "—" : pct(successful / rows.length * 100)} note={`${successful} of ${rows.length} loaded transactions`}>
            <div className="txe-stat-meter success"><i style={{ width: `${rows.length ? successful / rows.length * 100 : 0}%` }} /></div>
          </Stat>
          <Stat icon="failed" label="Failed" value={unavailable || !rows.length ? "—" : pct(failed / rows.length * 100)} note={`${failed} of ${rows.length} loaded transactions`}>
            <div className="txe-stat-meter failed"><i style={{ width: `${rows.length ? failed / rows.length * 100 : 0}%` }} /></div>
          </Stat>
          <Stat icon="fee" label="Average fee" value={unavailable || averageFee === null ? "—" : `${averageFee.toLocaleString("en-US", { maximumSignificantDigits: 4 })} ${denom?.display ?? ""}`} note={fees.length ? `${fees.length} native-token fees in this sample` : "No native-token fee data"}>
            {fees.length > 1 && <svg className="txe-fee-chart" viewBox="0 0 180 24" preserveAspectRatio="none" role="img" aria-label="Native-token fees in the loaded sample, oldest to newest"><polyline points={pts(fees.slice(0, 24).reverse(), 180, 22, 0, Math.max(...fees) || 1)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
          </Stat>
        </div>
        {address && <section className="txe-card txe-address" aria-label="Address history">
          <div><span>Address history</span><strong title={address}>{address}</strong></div>
          <CopyButton value={address} copied={copied === address} onCopy={onCopy} size={26} />
          <a href="#/transactions">Back to all transactions</a>
        </section>}
        {address && <AccountFundsCard address={address} denom={denom} live={live} />}
        <section className="txe-card txe-directory" aria-label={address ? "Address transactions" : "Recent transactions"}>
          <div className="txe-directory-top">
            <div className="txe-categories" aria-label="Filter by primary message type">{transactionCategories.map((category) => <button type="button" key={category} aria-pressed={filters.category === category} onClick={() => updateFilter("category", category)}>{category}</button>)}</div>
            <select aria-label="Time range within loaded transactions" value={filters.hours} onChange={(event) => updateFilter("hours", Number(event.target.value))}><option value={0}>Recent sample</option><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select>
          </div>
          <div className="txe-toolbar">
            <label className="txe-search"><Glyph name="search" /><input aria-label="Search loaded transactions, or enter an address or hash" placeholder="Search hash, address, contract, memo…" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && jump) { event.preventDefault(); followJump(); } }} />{jump && <button type="button" className="txe-search-jump" onClick={followJump}>{jump.kind === "address" ? "Address history" : "Open transaction"} ↵</button>}</label>
            <select aria-label="Transaction status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="all">All statuses</option><option value="success">Successful</option><option value="failed">Failed</option></select>
            <select aria-label="Transaction privacy" value={filters.privacy} onChange={(event) => updateFilter("privacy", event.target.value)}><option value="all">All data types</option><option value="sealed">Sealed data</option><option value="public">Public only</option></select>
            <select aria-label="Contract" value={filters.contract} onChange={(event) => updateFilter("contract", event.target.value)}><option value="all">All contracts</option>{contracts.map(([address, label]) => <option key={address} value={address}>{label}</option>)}</select>
          </div>
          <div className="txe-sample-note"><span>Filters and statistics cover the loaded sample.</span><span className={error ? "txe-warning" : ""}>{error ? "Feed unavailable" : live ? "Updates every 15s" : "Updates paused"}</span></div>
          {error && <div className="txe-notice" role="status">{error}{rows.length > 0 ? " Showing the last loaded sample." : " Please try again when the feed returns."}</div>}
          <div className="txe-table-scroll" tabIndex={0} role="region" aria-label="Transaction results">
            <table className="txe-table">
              <thead><tr><th>#</th><th>Tx hash</th><th>Type</th><th>From</th><th>Contract</th><th>Fee</th><th>Age</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? Array.from({ length: 10 }, (_, i) => <tr key={i}><td colSpan={8}><Skeleton h={22} w={`${95 - i * 3}%`} /></td></tr>) : visible.map((tx, i) => <tr key={tx.hash} className={open === tx.hash ? "selected" : undefined} onClick={() => inspect(tx.hash)}>
                  <td>{start + i + 1}</td>
                  <td><button className="txe-hash" type="button" aria-label={`Inspect transaction ${tx.hash}`} aria-pressed={open === tx.hash} onClick={(event) => { event.stopPropagation(); inspect(tx.hash); }}>{middle(tx.hash, 6, 4)}</button><small>#{fmt(tx.height)}</small></td>
                  <td><span className={`txe-type ${categoryTone(tx)}`}><Glyph name={categoryGlyph(tx)} /><span title={tx.type}>{tx.type}</span></span></td>
                  <td title={tx.signer ?? undefined}>{tx.signer && tx.signer !== address ? <a className="txe-address-link" href={addressRoute(tx.signer)} onClick={(event) => event.stopPropagation()}>{middle(tx.signer, 9, 4)}</a> : middle(tx.signer, 9, 4)}</td>
                  <td><span className="txe-contract" title={tx.contract ?? undefined}>{tx.encrypted && <LockGlyph size={12} />}<span>{tx.contract_label || (tx.contract ? middle(tx.contract, 9, 4) : "—")}</span></span></td>
                  <td>{tx.fee.map((fee) => coin(fee.amount, fee.denom, denom, 4)).join(", ") || "—"}</td>
                  <td title={tx.timestamp ?? undefined}>{tx.timestamp ? <Timestamp value={tx.timestamp} /> : "—"}</td>
                  <td><Chip tone={tx.ok ? "ok" : "bad"}>{tx.ok ? "Success" : "Failed"}</Chip></td>
                </tr>)}
                {!loading && !visible.length && <tr><td className="txe-empty" colSpan={8}>{error ? "Transaction data is unavailable." : rows.length ? "No transactions match these filters." : address ? "No transactions for this address in the history the node retains."  : "No transactions in the newest indexed blocks."}{jump && <button type="button" onClick={followJump}>{jump.kind === "address" ? "Search this address's full history" : "Look up this transaction"}</button>}{activeFilters && <button type="button" onClick={() => { setFilters(defaults); setPage(1); }}>Clear filters</button>}</td></tr>}
              </tbody>
            </table>
          </div>
          {cursor !== null && currentPage >= pages && <button type="button" className="txe-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : `Load older transactions (before block ${fmt(cursor)})`}</button>}
          <footer className="txe-footer"><span>{shown.length ? `${start + 1}–${Math.min(start + perPage, shown.length)} of ${shown.length}` : "0"} transactions</span>
            <nav aria-label="Transaction pages"><button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage} / {pages}</span><button type="button" aria-label="Next page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>›</button></nav>
            <label>Rows <select aria-label="Transactions per page" value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}>{[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          </footer>
        </section>
      </div>
      <div className="txe-inspector-column" ref={inspector}>
        {open ? <TxDetailPanel key={open} hash={open} denom={denom} copied={copied} onCopy={onCopy} onClose={() => { initialized.current = true; setOpen(null); window.history.replaceState(null, "", "#/transactions"); }} /> : <aside className="txe-card txe-inspector-placeholder"><Glyph name="transactions" /><h2>Transaction inspector</h2><p>Select a transaction to explore its public details, messages, and events.</p><div><LockGlyph size={16} />Encrypted contract data stays sealed.</div></aside>}
      </div>
    </div>
  </div>;
}

function hashFromLocation(): string | null {
  return window.location.hash.match(/^#\/transactions\/([0-9A-Fa-f]{64})$/)?.[1]?.toUpperCase() ?? null;
}

function Stat({ icon, label, value, note, children }: { icon: string; label: string; value: string; note: string; children: React.ReactNode }) {
  return <section className={`txe-card txe-stat ${icon}`}><div className="txe-stat-label"><Glyph name={icon} /><span>{label}</span></div><strong>{value}</strong><span className="txe-stat-note">{note}</span><div className="txe-stat-chart">{children}</div></section>;
}
function categoryTone(tx: Transaction) { return transactionCategory(tx) === "Contract calls" ? "contract" : transactionCategory(tx) === "Token transfers" ? "transfer" : transactionCategory(tx) === "IBC" ? "ibc" : "other"; }
function categoryGlyph(tx: Transaction) { return ({ "Contract calls": "contract", "Token transfers": "transfer", Staking: "staking", Governance: "governance", IBC: "ibc", Others: "transactions", All: "transactions" })[transactionCategory(tx)]; }

function TxDetailPanel({ hash, denom, copied, onCopy, onClose }: { hash: string; denom: Denom | null; copied: string | null; onCopy: (v: string) => void; onClose: () => void }) {
  const [tx, setTx] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<"overview" | "messages" | "events" | "raw">("overview");
  const [fields, setFields] = useState<"public" | "sealed">("public");
  useEffect(() => {
    let cancelled = false;
    setError(false);
    void getTransaction(hash).then((result) => { if (!cancelled) setTx(result.transaction); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [hash, retry]);
  const contractMessages = tx?.messages.filter((message) => message.contract || message.encrypted) ?? [];
  return <>
    <aside className="txe-card txe-inspector" aria-label="Transaction inspector">
      <header><div><h2><Glyph name="transactions" />Transaction</h2><div className="txe-selected-hash"><strong title={hash}>{middle(hash, 8, 6)}</strong><CopyButton value={hash} copied={copied === hash} onCopy={onCopy} size={26} /></div></div><button type="button" className="txe-close" onClick={onClose} aria-label="Close transaction">×</button></header>
      {error ? <div className="txe-empty" role="status">This transaction could not be loaded.<button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : !tx ? <div className="txe-detail-loading"><Skeleton h={25} w="70%" /><Skeleton h={150} w="100%" /></div> : <>
        <div className="txe-detail-meta"><span title={tx.timestamp ?? undefined}>{tx.timestamp ? <Timestamp value={tx.timestamp} /> : "Time unavailable"}</span>{tx.height !== null && <a href={`#/blocks/${tx.height}`}>Block #{fmt(tx.height)}</a>}<Chip tone={tx.ok ? "ok" : "bad"}>{tx.ok ? "Success" : `Failed · ${tx.code}`}</Chip></div>
        <div className="txe-detail-tabs" role="tablist" aria-label="Transaction details">{(["overview", "messages", "events", "raw"] as const).map((value) => <button key={value} id={`txe-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="txe-detail-content" onClick={() => setTab(value)}>{value === "overview" ? "Overview" : value === "messages" ? `Messages (${tx.messages.length})` : value === "events" ? `Events (${tx.events.length})` : "Raw JSON"}</button>)}</div>
        <div className="txe-detail-content" id="txe-detail-content" role="tabpanel" aria-labelledby={`txe-tab-${tab}`}>
          {tab === "overview" && <>
            <dl className="txe-facts">
              <Fact label="Type"><span className="txe-type"><Glyph name={categoryGlyph(tx)} />{tx.type}</span></Fact>
              <Fact label="From">{tx.signer ? <a className="txe-address-link" href={addressRoute(tx.signer)} title={tx.signer}>{middle(tx.signer, 10, 5)}</a> : "—"}{tx.signer && <CopyButton value={tx.signer} copied={copied === tx.signer} onCopy={onCopy} size={24} />}</Fact>
              <Fact label="Fee">{tx.fee.map((fee) => coin(fee.amount, fee.denom, denom, 6)).join(", ") || "—"}</Fact>
              <Fact label="Gas used / limit">{fmt(tx.gas_used)} / {fmt(tx.gas_wanted)}</Fact>
              <Fact label="Contract">{tx.contract ? <a className="txe-address-link" href={addressRoute(tx.contract)} title={tx.contract}>{tx.contract_label || middle(tx.contract, 10, 5)}</a> : "—"}{tx.contract && <CopyButton value={tx.contract} copied={copied === tx.contract} onCopy={onCopy} size={24} />}</Fact>
              <Fact label="Memo">{tx.memo || "—"}</Fact>
            </dl>
            {contractMessages.length > 0 && <section className="txe-contract-details"><header><Glyph name="contract" /><div><h3>Contract interaction</h3><span>{tx.contract_label || (tx.contract ? middle(tx.contract, 12, 6) : "Encrypted message")}</span></div></header>
              <div className="txe-field-switch" aria-label="Contract field visibility"><button type="button" aria-pressed={fields === "public"} onClick={() => setFields("public")}>Public fields</button><button type="button" aria-pressed={fields === "sealed"} onClick={() => setFields("sealed")}>Sealed fields</button></div>
              {contractMessages.map((message, index) => { const entries = Object.entries(message.fields).filter(([, value]) => isSealed(value) === (fields === "sealed")); return <div key={index} className="txe-contract-fields">{contractMessages.length > 1 && <h4>{message.label} · {index + 1}</h4>}{entries.length ? <FieldList fields={Object.fromEntries(entries)} /> : <p className="txe-muted">No {fields} fields reported for this message.</p>}</div>; })}
            </section>}
            {tx.encrypted ? <div className="txe-privacy-note"><LockGlyph size={18} /><div><strong>Contract data is encrypted</strong><p>Public metadata is shown here. Encrypted fields stay sealed; wallet decryption is not available in this explorer.</p></div></div> : <div className="txe-privacy-note public"><Glyph name="success" /><div><strong>Public transaction data</strong><p>No encrypted contract fields were reported for this transaction.</p></div></div>}
            {tx.raw_log && <section className="txe-message"><h3>Execution log</h3><pre>{tx.raw_log}</pre></section>}
          </>}
          {tab === "messages" && (tx.messages.length ? tx.messages.map((message, index) => <section className="txe-message" key={index}><h3>{message.label}</h3><code className="txe-message-type">{message.type}</code><FieldList fields={message.fields} /></section>) : <p className="txe-muted">No messages reported.</p>)}
          {tab === "events" && (tx.events.length ? tx.events.map((event, index) => <section className="txe-message" key={index}><h3>{event.type}</h3>{event.attributes.map((attribute, i) => <div className="txe-event-attribute" key={i}>{attribute.sealed ? <SealedBar compact label="Sealed event attribute" /> : <><span>{attribute.key ?? "Attribute"}</span><code>{attribute.value ?? "—"}</code></>}</div>)}</section>) : <p className="txe-muted">No events reported.</p>)}
          {tab === "raw" && <><p className="txe-muted">Explorer API response. Encrypted values are represented by sealed-field markers.</p><pre className="txe-json">{JSON.stringify(tx, null, 2)}</pre><section className="txe-message"><h3>Transaction response data</h3>{isSealed(tx.data) ? <SealedBar bytes={tx.data.bytes} /> : tx.data ? <pre>{tx.data}</pre> : <p className="txe-muted">No response data.</p>}</section></>}
        </div>
      </>}
    </aside>
    {tx && <section className="txe-card txe-related"><h3>Related</h3>{tx.height !== null && <a href={`#/blocks/${tx.height}`}><Glyph name="block" /><span>View block #{fmt(tx.height)}</span><span>→</span></a>}<button type="button" onClick={() => onCopy(`${location.origin}${location.pathname}#/transactions/${hash}`)}><Glyph name="link" /><span>{copied?.endsWith(`/transactions/${hash}`) ? "Link copied" : "Copy transaction link"}</span><span>↗</span></button></section>}
  </>;
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function FieldList({ fields }: { fields: Record<string, unknown> }) {
  return <dl className="txe-fields">{Object.entries(fields).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{isSealed(value) ? <SealedBar bytes={value.bytes} /> : <code>{typeof value === "string" ? value || "—" : JSON.stringify(value, null, 2)}</code>}</dd></div>)}</dl>;
}
function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    transactions: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4", success: "m5 12 4 4L19 6", failed: "m6 6 12 12M6 18 18 6", fee: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12", search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5", contract: "M7 3h10v18H7zM10 7h4M10 11h4M10 15h4", transfer: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4", staking: "m12 3 9 5-9 5-9-5 9-5M3 12l9 5 9-5M3 16l9 5 9-5", governance: "m3 8 9-5 9 5H3M6 11v7m6-7v7m6-7v7M3 21h18", ibc: "M8 4H4v4m0-4 7 7M16 20h4v-4m0 4-7-7M4 16v4h4m-4 0 7-7M20 8V4h-4m4 0-7 7", block: "m12 3 9 5v9l-9 5-9-5V8l9-5M3 8l9 5 9-5M12 13v9", link: "m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.transactions} /></svg>;
}

/** Public funds of the address on display: bank balance, stake, rewards, unbonding. */
function AccountFundsCard({ address, denom, live }: { address: string; denom: Denom | null; live: boolean }) {
  const [funds, setFunds] = useState<AccountFunds | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFunds(null); setFailed(false);
    const load = () => getAccount(address).then((f) => { if (!cancelled) { setFunds(f); setFailed(false); } }).catch(() => { if (!cancelled) setFailed(true); });
    void load();
    const timer = live ? window.setInterval(load, 30_000) : undefined;
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [address, live]);

  const base = denom?.base ?? "uscrt";
  const native = (coins: { denom: string; amount: string }[]) => coins.filter((c) => c.denom === base).reduce((sum, c) => sum + BigInt(c.amount), 0n);
  const available = funds ? native(funds.balances) : 0n;
  const staked = funds ? funds.delegations.reduce((sum, d) => sum + (d.amount.denom === base ? BigInt(d.amount.amount) : 0n), 0n) : 0n;
  const rewards = funds ? native(funds.rewards_total) : 0n;
  const unbonding = funds ? funds.unbonding.reduce((sum, u) => sum + BigInt(u.amount), 0n) : 0n;
  const total = available + staked + rewards + unbonding;
  // Small amounts keep micro-unit precision; large ones read better rounded.
  const precise = (amount: string) => (Number(amount) < 1000 * 10 ** (denom?.exponent ?? 6) ? 6 : 2);
  const show = (v: bigint) => (funds ? coin(v.toString(), base, denom, precise(v.toString())) : "—");
  const others = funds?.balances.filter((c) => c.denom !== base) ?? [];

  return <section className="txe-card txe-funds" aria-label="Address funds">
    <div className="txe-funds-head">
      <span>Funds</span>
      {funds?.contract && <em>Contract · {funds.contract.label ?? "unlabelled"}{funds.contract.code_id !== null && ` · code ${funds.contract.code_id}`}</em>}
      {funds && !funds.contract && funds.account_type && <em>{funds.account_type.replace(/([a-z])([A-Z])/g, "$1 $2")}{funds.account_number !== null && ` · #${funds.account_number}`}{funds.sequence !== null && ` · sequence ${fmt(funds.sequence)}`}</em>}
    </div>
    {failed && !funds ? <p className="txe-funds-note">Balances are temporarily unavailable.</p> : <>
      <div className="txe-funds-grid">
        <div className="total"><span>Total</span><strong>{show(total)}</strong></div>
        <div><span>Available</span><strong>{show(available)}</strong></div>
        <div><span>Staked</span><strong>{show(staked)}</strong></div>
        <div><span>Unclaimed rewards</span><strong>{show(rewards)}</strong></div>
        <div><span>Unbonding</span><strong>{show(unbonding)}</strong></div>
      </div>
      {!!funds?.delegations.length && <ul className="txe-funds-list" aria-label="Delegations">
        {funds.delegations.map((d) => <li key={d.validator}><span title={d.validator}>Delegated to {d.moniker ?? middle(d.validator, 14, 5)}</span><b>{coin(d.amount.amount, d.amount.denom, denom, precise(d.amount.amount))}</b></li>)}
      </ul>}
      {!!funds?.unbonding.length && <ul className="txe-funds-list" aria-label="Unbonding">
        {funds.unbonding.map((u, i) => <li key={i}><span title={u.validator}>Unbonding from {u.moniker ?? middle(u.validator, 14, 5)}{u.completion_time && ` · until ${new Date(u.completion_time).toLocaleDateString()}`}</span><b>{coin(u.amount, base, denom, precise(u.amount))}</b></li>)}
      </ul>}
      {!!others.length && <ul className="txe-funds-list" aria-label="Other tokens">
        {others.map((c) => <li key={c.denom}><span>{c.denom.startsWith("ibc/") ? "IBC token" : "Token"}</span><b>{coin(c.amount, c.denom, denom, 2)}</b></li>)}
      </ul>}
      <p className="txe-funds-note">SNIP-20 token balances are private and need the owner's viewing key.</p>
    </>}
  </section>;
}
