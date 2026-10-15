import { Timestamp } from "../components/Timestamp";
/** Read-only RPC workbench. Endpoint drafts never change an in-flight query. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dashboard } from "../useDashboard";
import { fetchBlock, fetchNetInfo, probeNode, rpcCallRaw, type BlockInfo, type NetInfo, type NodeProbe, type RpcResult } from "../nodeRpc";
import { rpcConsoleRequest } from "../networkExplorer";
import { compileParams, formFromRaw, methodList, normalizeEndpoint, parameterObject, PUBLIC_RPC, RPC_CATEGORIES, RPC_DESCRIPTIONS, RPC_METHODS } from "../rpcConsole";
import { fmt } from "../lib";
import "./rpc-console.css";

const ENDPOINT_KEY = "sealed-rpc-url", METHOD_KEY = "sealed-rpc-console-method";
const initialEndpoint = () => { const request = rpcConsoleRequest(location.hash); if (request) return request.url; try { const value = localStorage.getItem(ENDPOINT_KEY); return value && !normalizeEndpoint(value).error ? value : PUBLIC_RPC; } catch { return PUBLIC_RPC; } };
const initialMethod = () => { const request = rpcConsoleRequest(location.hash); if (request) return request.method; try { const value = localStorage.getItem(METHOD_KEY); return RPC_METHODS.some(m => m.path === value) ? value! : "/status"; } catch { return "/status"; } };
type Connection = { probe: NodeProbe | null; net: RpcResult<NetInfo> | null; blocks: BlockInfo[]; blockError: string | null; loading: boolean; updated: number | null };
const EMPTY: Connection = { probe: null, net: null, blocks: [], blockError: null, loading: false, updated: null };

export function DirectRpc({ d }: { d: Dashboard }) {
  const [base, setBase] = useState(initialEndpoint);
  const [draft, setDraft] = useState(base);
  const [connection, setConnection] = useState<Connection>(EMPTY);
  const [connectError, setConnectError] = useState("");
  const [tick, setTick] = useState(0);
  const [guide, setGuide] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const normalized = normalizeEndpoint(draft);
  const dirty = !!normalized.error || normalized.url !== base;
  const suggestions = [...new Set([PUBLIC_RPC, ...(d.endpoints?.endpoints.map(e => e.rpc_url).filter((url): url is string => !!url) ?? [])])];
  useEffect(() => {
    let stopped = false, pending = false;
    const scope = ++generation.current;
    setConnection({ ...EMPTY, loading: true });
    const refresh = async () => {
      if (pending || stopped) return;
      pending = true;
      setConnection(previous => ({ ...previous, loading: true }));
      try {
        const probe = await probeNode(base);
        if (stopped || scope !== generation.current) return;
        setConnection(previous => ({ ...previous, probe, updated: Date.now() }));
        if (probe.state !== "ok") { setConnection({ ...EMPTY, probe, updated: Date.now() }); return; }
        const height = Number(probe.latest);
        const heights = Number.isSafeInteger(height) && height > 0 ? Array.from({ length: Math.min(5, height) }, (_, i) => height - i) : [];
        const [net, ...blocks] = await Promise.all([fetchNetInfo(base), ...heights.map(h => fetchBlock(base, h))]);
        if (stopped || scope !== generation.current) return;
        setConnection({ probe, net, blocks: blocks.flatMap(block => block.state === "ok" ? [block.data] : []), blockError: blocks.some(block => block.state !== "ok") ? "Some recent blocks could not be loaded." : null, loading: false, updated: Date.now() });
      } finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [base, tick]);
  const connect = (value = draft) => {
    const parsed = normalizeEndpoint(value);
    if (parsed.url === undefined) { setConnectError(parsed.error); return; }
    setConnectError(""); setDraft(parsed.url); setBase(parsed.url); setTick(t => t + 1);
    try { localStorage.setItem(ENDPOINT_KEY, parsed.url); } catch { /* Connection works without persistence. */ }
  };
  const probe = connection.probe;
  const connected = !dirty && probe?.state === "ok";
  const unexpectedChain = probe?.state === "ok" && d.net && probe.network !== d.net.chain.chain_id;
  return <div className="rce-page">
    <section className="rce-panel rce-endpoints"><Heading title="RPC Endpoint" description="Enter a Secret RPC endpoint or choose a quick connection." icon="link" aside={<button type="button" className="rce-text-button" aria-expanded={guide} onClick={() => setGuide(value => !value)}>{guide ? "Hide connection guide" : "View connection guide"} →</button>} />
      <form className="rce-connect-row" onSubmit={event => { event.preventDefault(); connect(); }}><label className="rce-url-input"><Icon name="link" /><input ref={input} list="rce-endpoint-options" aria-label="RPC endpoint URL" value={draft} spellCheck={false} placeholder="https://rpc.example.com" onChange={event => { setDraft(event.target.value); setConnectError(""); }} /><button type="button" aria-label="Clear endpoint URL" onClick={() => { setDraft(""); input.current?.focus(); }}>×</button></label><datalist id="rce-endpoint-options">{suggestions.map(url => <option key={url} value={url} />)}</datalist><span className={`rce-connection-state ${connected ? "ok" : ""}`} role="status"><i />{dirty ? "Not connected" : connection.loading && !probe ? "Connecting…" : connected ? "Connected" : "Unavailable"}</span><span className="rce-latency"><Icon name="latency" /><span><strong>{!dirty && probe ? `${probe.latencyMs} ms` : "—"}</strong><small>Probe latency</small></span></span><button type="submit" className="rce-primary" disabled={connection.loading && !dirty}><Icon name="link" />{connection.loading && !dirty ? "Connecting…" : "Connect"}</button></form>
      {connectError && <p className="rce-error" role="alert">{connectError}</p>}{dirty && !connectError && <p className="rce-draft-note">Connect to apply this endpoint before executing a query.</p>}
      <span className="rce-quick-label">Quick endpoints</span><div className="rce-quick-grid"><button type="button" className={`rce-quick-card ${base === PUBLIC_RPC && !dirty ? "selected" : ""}`} onClick={() => connect(PUBLIC_RPC)}><img src="/secret-symbol.svg" alt="" /><span><strong>Secret³ Mainnet <em>Public</em></strong><code>{PUBLIC_RPC}</code><small>Secret Network mainnet · explorer relay</small></span><b aria-hidden="true">{base === PUBLIC_RPC && !dirty ? "◉" : "○"}</b></button><button type="button" className="rce-quick-card custom" onClick={() => { setDraft(""); setConnectError(""); input.current?.focus(); }}><Icon name="plus" /><span><strong>Add Custom Endpoint</strong><small>Connect to an HTTP or HTTPS CometBFT RPC.</small></span><b>›</b></button></div>
      {guide && <div className="rce-guide"><strong>Connecting to a node</strong><p>Enter a base URL, then choose Connect. The public preset uses the explorer's relay and may fall back to its configured node if the public node is unavailable. Custom endpoints are queried by your browser and need compatible CORS and HTTPS settings.</p><p>Choose a read-only method, enter its parameters, and execute it. The response identifies the endpoint and method used. Connections are remembered in this browser.</p><a href="#/endpoints">Browse the Network directory →</a></div>}
    </section>
    {probe && probe.state !== "ok" && !dirty && <div className="rce-notice" role="status"><Icon name="info" /><div><strong>{probe.state === "blocked" ? "The browser could not reach this endpoint" : "The endpoint probe failed"}</strong><span>{probe.error}</span></div><button type="button" onClick={() => connect()}>Retry</button></div>}
    {unexpectedChain && <div className="rce-notice" role="status">This endpoint reports {probe.network}; the explorer follows {d.net?.chain.chain_id}. Block links below are disabled for this connection.</div>}
    <Workbench base={base} disabled={dirty} />
    <div className="rce-summary-grid"><section className="rce-panel"><Heading title="Node Status" icon="status" aside={probe?.state === "ok" ? <span className={`rce-badge ${probe.catchingUp ? "warn" : "ok"}`}>{probe.catchingUp ? "Catching up" : "Synced"}</span> : undefined} /><dl><Fact label="Network">{probe?.state === "ok" ? probe.network ?? "—" : "—"}</Fact><Fact label="Latest block">{probe?.state === "ok" ? fmt(Number(probe.latest)) : "—"}</Fact><Fact label="Catching up">{probe?.state === "ok" ? probe.catchingUp ? "Yes" : "No" : "—"}</Fact><Fact label="Node version">{probe?.state === "ok" ? probe.version ?? "—" : "—"}</Fact><Fact label="Moniker">{probe?.state === "ok" ? probe.moniker ?? "—" : "—"}</Fact></dl></section><section className="rce-panel"><Heading title="Network Info" icon="network" /><dl><Fact label="Chain ID">{probe?.state === "ok" ? probe.network ?? "—" : "—"}</Fact><Fact label="Peers">{connection.net?.state === "ok" ? fmt(connection.net.data.nPeers) : "—"}</Fact><Fact label="Listening">{connection.net?.state === "ok" ? connection.net.data.listening ? "Yes" : "No" : "—"}</Fact><Fact label="RPC endpoint"><span title={base}>{base}</span></Fact><Fact label="Earliest block">{probe?.state === "ok" && probe.earliest ? fmt(Number(probe.earliest)) : "—"}</Fact></dl>{connection.net && connection.net.state !== "ok" && <p className="rce-card-note">Network info unavailable: {connection.net.error}</p>}</section><section className="rce-panel"><Heading title="Latest Blocks" icon="block" aside={<a href="#/blocks">View all →</a>} /><div className="rce-latest-blocks">{connection.blocks.map(block => { const content = <><Icon name="block" /><strong>{fmt(Number(block.height))}</strong><span>{block.time ? <Timestamp value={block.time} /> : "—"}</span><small>{fmt(block.txCount)} txs</small></>; return unexpectedChain ? <div key={block.height}>{content}</div> : <a href={`#/blocks/${block.height}`} key={block.height}>{content}</a>; })}{!connection.blocks.length && <p>{connection.loading ? "Loading recent blocks…" : "Recent blocks are unavailable for this connection."}</p>}</div>{connection.blockError && <p className="rce-card-note">{connection.blockError}</p>}</section></div>
    <p className="rce-footnote">Node summaries update every 10 seconds for the connected endpoint.{connection.updated ? ` Last updated ${new Date(connection.updated).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC.` : ""}</p>
  </div>;
}

type Executed = { response: RpcResult<unknown>; base: string; method: string; params: Record<string, string>; at: number };
function Workbench({ base, disabled }: { base: string; disabled: boolean }) {
  const [method, setMethod] = useState(initialMethod);
  const [category, setCategory] = useState("Popular");
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("{}");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Executed | null>(null);
  const [format, setFormat] = useState("pretty");
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requestId = useRef(0), inFlight = useRef(false);
  const spec = RPC_METHODS.find(m => m.path === method) ?? RPC_METHODS[0];
  const visible = methodList(category, search);
  const invalidate = () => { requestId.current++; inFlight.current = false; setBusy(false); setResult(null); setFeedback(""); };
  useEffect(() => { invalidate(); return () => { requestId.current++; }; }, [base]);
  useEffect(() => { try { localStorage.setItem(METHOD_KEY, method); } catch { /* Method selection remains usable without storage. */ } }, [method]);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(""), 2500); return () => clearTimeout(timer); }, [feedback]);
  const choose = (value: string) => { invalidate(); setMethod(value); setValues({}); setRaw("{}"); setError(""); };
  const clear = () => { invalidate(); setValues({}); setRaw("{}"); setError(""); };
  const toggleRaw = () => {
    if (rawMode) { const parsed = formFromRaw(spec, raw); if (parsed === null) { setError(compileParams(spec, {}, raw).error ?? "Fix the JSON before switching to form fields."); return; } setValues(parsed); }
    else setRaw(JSON.stringify(parameterObject(spec, values), null, 2));
    setRawMode(!rawMode); setError("");
  };
  const execute = async () => {
    if (disabled || inFlight.current) return;
    const compiled = compileParams(spec, values, rawMode ? raw : null);
    if (compiled.params === undefined) { setError(compiled.error); return; }
    const id = ++requestId.current, target = base, path = spec.path;
    inFlight.current = true; setBusy(true); setError(""); setFeedback(""); setResult(null);
    try {
      const response = await rpcCallRaw(target, path, compiled.params);
      if (id !== requestId.current) return;
      setResult({ response, base: target, method: path, params: compiled.params, at: Date.now() });
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : "The query could not complete."); }
    finally { if (id === requestId.current) { inFlight.current = false; setBusy(false); } }
  };
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void execute(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); });
  const body = result?.response.data;
  const text = body === undefined ? "" : JSON.stringify(body, null, format === "pretty" ? 2 : undefined) ?? "null";
  const copy = async () => { try { await navigator.clipboard.writeText(text); setFeedback("Response copied."); } catch { setFeedback("Clipboard unavailable. Select the response text or download it."); } };
  const download = () => { if (!result || !text) return; const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `secret-rpc-${result.method.slice(1)}-${result.at}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const responsePanel = (modal = false) => <><Heading title="Response" description="JSON returned by the queried node." icon="response" aside={<div className="rce-response-tools">{result && <><span className={`rce-badge ${result.response.state === "ok" ? "ok" : "bad"}`}>{result.response.state === "ok" ? "Success" : result.response.state === "blocked" ? "Blocked" : "Error"}</span><span className="rce-response-ms">{result.response.latencyMs} ms</span></>}<button type="button" disabled={!text} onClick={() => void copy()}><Icon name="copy" />Copy</button><button type="button" disabled={!text} aria-label="Download JSON response" title="Download JSON response" onClick={download}><Icon name="download" /></button><button type="button" aria-label={modal ? "Close expanded response" : "Expand response"} onClick={() => setExpanded(!modal)}><Icon name={modal ? "close" : "expand"} /></button></div>} />{result && <div className="rce-response-context"><code>{result.method}</code><span title={result.base}>{result.base}</span><time>{new Date(result.at).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</time></div>}{result && result.response.state !== "ok" && <p className="rce-error" role="alert">{result.response.error}</p>}<div className="rce-code" role="region" aria-label="RPC JSON response" tabIndex={0}>{text ? <JsonCode text={text} /> : <div className="rce-response-empty"><Icon name="response" /><strong>{busy ? `Executing ${spec.path}…` : result ? "No JSON response body was received." : "Your response will appear here"}</strong><span>{busy ? "Waiting for the connected endpoint." : "Select a method and execute a read-only request."}</span></div>}</div><footer className="rce-response-footer"><span role="status">{feedback || (text ? `${new TextEncoder().encode(text).length.toLocaleString()} bytes` : "No response yet")}</span><select aria-label="Response JSON format" value={format} onChange={event => setFormat(event.target.value)}><option value="pretty">Pretty JSON</option><option value="compact">Compact JSON</option></select></footer></>;
  return <><section className="rce-panel rce-methods"><Heading title="Method Explorer" description="Browse read-only RPC methods. Select one to configure its parameters." icon="block" aside={<a href="#/api">View API Docs ↗</a>} /><div className="rce-method-toolbar"><div className="rce-categories" aria-label="RPC method categories">{Object.keys(RPC_CATEGORIES).map(value => <button type="button" key={value} aria-pressed={category === value && !search} onClick={() => { setCategory(value); setSearch(""); }}>{value}</button>)}</div><label className="rce-method-search"><Icon name="search" /><input aria-label="Search RPC methods" placeholder="Find a method…" value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="rce-method-grid">{visible.map(m => <button type="button" className={`rce-method ${m.path === spec.path ? "selected" : ""}`} aria-pressed={m.path === spec.path} key={m.path} onClick={() => choose(m.path)}><Icon name={methodIcon(m.path)} /><span><strong>{m.path}</strong><small>{RPC_DESCRIPTIONS[m.path]}</small></span></button>)}</div>{!visible.length && <p className="rce-empty">No methods match this search.</p>}</section>
    <div className="rce-workbench"><section className="rce-panel rce-parameters"><Heading title="Parameters" description={`Configure ${spec.path} parameters.`} icon="code" aside={<button type="button" className="rce-raw-toggle" role="switch" aria-checked={rawMode} onClick={toggleRaw}>Raw JSON <i /></button>} /><form onSubmit={event => { event.preventDefault(); void execute(); }}><div className="rce-fields">{rawMode ? <label><span>Parameters as JSON</span><textarea aria-label="Raw JSON parameters" value={raw} spellCheck={false} onChange={event => { setRaw(event.target.value); setError(""); }} /></label> : spec.params.length ? spec.params.map(p => <label key={p.key}><span>{p.label}<small>{p.kind === "numOrLatest" ? "optional · latest by default" : p.kind === "bool" ? "optional" : p.hint ?? ""}</small></span>{p.kind === "bool" ? <select aria-label={p.label} value={values[p.key] ?? ""} onChange={event => setValues(v => ({ ...v, [p.key]: event.target.value }))}><option value="">Node default</option><option value="true">true</option><option value="false">false</option></select> : <input aria-label={p.label} value={values[p.key] ?? ""} placeholder={p.placeholder} spellCheck={false} inputMode={p.kind === "num" ? "numeric" : undefined} onChange={event => { setValues(v => ({ ...v, [p.key]: event.target.value })); setError(""); }} />}</label>) : <div className="rce-no-params"><Icon name="info" /><div><strong>This method does not require any parameters.</strong><span>Execute the method with an empty request.</span></div></div>}</div>{spec.note && <p className="rce-param-note">{spec.note}</p>}{error && <p className="rce-error" role="alert">{error}</p>}<div className="rce-execute-row"><button type="submit" className="rce-primary" disabled={busy || disabled}><Icon name="play" />{busy ? "Executing…" : "Execute"} <code>{spec.path}</code></button><button type="button" className="rce-secondary" onClick={clear}><Icon name="refresh" />Clear</button><span title="Ctrl+Enter or Command+Enter">⌘ / Ctrl ↵</span></div>{disabled && <p className="rce-param-note">Connect the edited endpoint to enable execution.</p>}</form></section><section className="rce-panel rce-response">{responsePanel()}</section></div>
    {expanded && <ResponseDialog onClose={() => setExpanded(false)}>{responsePanel(true)}</ResponseDialog>}
  </>;
}
function JsonCode({ text }: { text: string }) {
  const preview = text.slice(0, 100_000).split("\n").slice(0, 1600);
  const truncated = preview.join("\n").length < text.length;
  return <><pre><code>{preview.map((line, i) => <span className="rce-code-line" key={i}><span className="rce-line-number" aria-hidden="true">{i + 1}</span><span>{line.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g).map((token, j) => <span key={j} className={token.startsWith('"') ? token.trimEnd().endsWith(":") ? "rce-json-key" : "rce-json-string" : /^(true|false|null)$/.test(token) ? "rce-json-literal" : /^-?\d/.test(token) ? "rce-json-number" : undefined}>{token}</span>)}</span>{"\n"}</span>)}</code></pre>{truncated && <p className="rce-preview-note">Large response: showing a preview. Copy or download the complete JSON.</p>}</>;
}
function ResponseDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { const previous = document.activeElement; ref.current?.showModal(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []); return <dialog ref={ref} className="rce-dialog rce-response" aria-label="Expanded RPC response" onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>; }
function Heading({ title, description, icon, aside }: { title: string; description?: string; icon: string; aside?: ReactNode }) { return <header className="rce-heading"><Icon name={icon} /><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</header>; }
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function methodIcon(path: string) { return path.includes("block") || path === "/commit" ? "block" : path.includes("tx") ? "search" : path.includes("validators") ? "people" : path.includes("consensus") ? "cube" : path.includes("abci") ? "response" : path === "/health" ? "heart" : path === "/net_info" ? "network" : "status"; }
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { link: "m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0", latency: "M3 20V10h3v10H3Zm6 0V6h3v14H9Zm6 0V2h3v18h-3Z", plus: "M12 3v18M3 12h18", close: "m5 5 14 14M5 19 19 5", info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7v7m0-11v1", status: "M2 12h5l3-8 4 16 3-8h5", network: "M12 7v5M5 16v-4h14v4M9 2h6v5H9V2ZM2 16h6v6H2v-6Zm14 0h6v6h-6v-6Z", block: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9", cube: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5m-9 5v9m-5-16 10 6", code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18", response: "M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h8", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6", people: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v3", heart: "m12 21-9-9a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9Z", play: "m6 3 15 9-15 9V3Z", copy: "M8 8h13v13H8V8ZM16 5V2H2v14h3", download: "M12 2v13m-5-5 5 5 5-5M4 16v5h16v-5", expand: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6", refresh: "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1" };
  return <svg className="rce-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.code} /></svg>;
}
