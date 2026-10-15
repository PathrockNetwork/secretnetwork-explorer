import type { PipelineBlock, Transaction } from "./api";
import { rpcCallRaw } from "./nodeRpc";

const RPC = "https://rpc.secret.mainnet.secret3.dev";
export type BlockMeta = { height: number; hash: string | null; parent: string | null; appHash: string | null; size: number | null; time: string; proposer: string | null; txCount: number | null };
export type BlockExecution = { gasUsed: number | null; gasWanted: number | null; events: { type: string; count: number }[] };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" && value ? value : null;
const number = (value: unknown): number | null => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);

export function parseBlockMetadata(data: unknown): BlockMeta[] {
  const metas = record(record(data).result).block_metas;
  if (!Array.isArray(metas)) return [];
  return metas.flatMap((raw) => {
    const meta = record(raw), header = record(meta.header);
    const height = number(header.height), time = str(header.time);
    if (!height || !Number.isSafeInteger(height) || !time || !Number.isFinite(Date.parse(time))) return [];
    return [{ height, time, hash: str(record(meta.block_id).hash), parent: str(record(header.last_block_id).hash), appHash: str(header.app_hash), size: number(meta.block_size), proposer: str(header.proposer_address)?.toLowerCase() ?? null, txCount: number(meta.num_txs) }];
  });
}

export async function getBlockMetadata(min: number, max: number) {
  const response = await rpcCallRaw(RPC, "/blockchain", { minHeight: String(min), maxHeight: String(max) });
  if (response.state !== "ok") throw new Error("Block headers are temporarily unavailable.");
  return parseBlockMetadata(response.data);
}

export function parseBlockExecution(data: unknown, expectedTxs: number | null): BlockExecution {
  const result = record(record(data).result);
  const txs = Array.isArray(result.txs_results) ? result.txs_results.map(record) : [];
  const sum = (field: string) => expectedTxs === null || txs.length !== expectedTxs || txs.some((tx) => number(tx[field]) === null) ? null : txs.reduce((n, tx) => n + number(tx[field])!, 0);
  const counts = new Map<string, number>();
  // Event names are public; event attributes may contain Secret ciphertext.
  const events = [result.begin_block_events, result.end_block_events, result.finalize_block_events, ...txs.map((tx) => tx.events)];
  for (const group of events) if (Array.isArray(group)) for (const event of group) {
    const type = str(record(event).type);
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return { gasUsed: sum("gas_used"), gasWanted: sum("gas_wanted"), events: [...counts].map(([type, count]) => ({ type, count })) };
}

export async function getBlockExecution(height: number, txCount: number | null) {
  const response = await rpcCallRaw(RPC, "/block_results", { height: String(height) });
  if (response.state !== "ok" || number(record(record(response.data).result).height) !== height) throw new Error("Block execution data is temporarily unavailable.");
  return parseBlockExecution(response.data, txCount);
}

/** Only complete transaction samples can establish total gas for a block. */
export function gasForBlock(block: PipelineBlock, txs: Transaction[]): number | null {
  if (block.tx_count === 0) return 0;
  const rows = txs.filter((tx) => tx.height === block.height);
  return block.tx_count !== null && rows.length === block.tx_count && rows.every((tx) => tx.gas_used !== null)
    ? rows.reduce((sum, tx) => sum + tx.gas_used!, 0) : null;
}

export function filterBlocks(blocks: PipelineBlock[], query: string, status: string, volume: string, ascending: boolean) {
  const q = query.trim().toLowerCase().replace(/,/g, "");
  return blocks.filter((b) => (!q || [String(b.height), b.hash, b.proposer?.moniker, b.proposer?.address].some((v) => v?.toLowerCase().includes(q))) &&
    (status !== "retry" || (b.round ?? 0) > 0) &&
    (status !== "partial" || (b.votes.signed !== null && b.votes.total !== null && b.votes.signed < b.votes.total)) &&
    (volume !== "empty" || b.tx_count === 0) && (volume !== "transactions" || (b.tx_count ?? 0) > 0))
    .slice().sort((a, b) => ascending ? a.height - b.height : b.height - a.height);
}
