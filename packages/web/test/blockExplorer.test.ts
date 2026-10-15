import { describe, expect, it } from "vitest";
import { filterBlocks, gasForBlock, parseBlockExecution, parseBlockMetadata } from "../src/blockExplorer";
import type { PipelineBlock, Transaction } from "../src/api";
const block = (height: number, extra: Partial<PipelineBlock> = {}): PipelineBlock => ({ height, hash: `hash-${height}`, time: "2026-10-13T20:00:00Z", tx_count: 1, round: 0, votes: { signed: 23, total: 23 }, proposer: { address: "abc", moniker: "Pathrock", avatar_url: null }, ...extra });

describe("block explorer", () => {
  it("filters heights, hashes, missing signatures, extra rounds and transaction volume without changing the input", () => {
    const blocks = [block(3000), block(3001, { tx_count: 0, round: 2, votes: { signed: 22, total: 23 } }), block(3002, { votes: { signed: null, total: null } })];
    expect(filterBlocks(blocks, "3,000", "all", "all", false).map(b => b.height)).toEqual([3000]);
    expect(filterBlocks(blocks, "HASH-3001", "partial", "empty", false).map(b => b.height)).toEqual([3001]);
    expect(filterBlocks(blocks, "pathrock", "retry", "transactions", false)).toEqual([]);
    expect(filterBlocks(blocks, "", "all", "all", false).map(b => b.height)).toEqual([3002, 3001, 3000]);
    expect(blocks.map(b => b.height)).toEqual([3000, 3001, 3002]);
  });
  it("never reports partial transaction gas as a complete block total", () => {
    const txs = [{ height: 1, gas_used: 7 }, { height: 2, gas_used: 100 }] as Transaction[];
    expect(gasForBlock(block(1, { tx_count: 2 }), txs)).toBeNull();
    expect(gasForBlock(block(1), txs)).toBe(7);
    expect(gasForBlock(block(3, { tx_count: 0 }), txs)).toBe(0);
    expect(gasForBlock(block(3), [{ height: 3, gas_used: null }] as Transaction[])).toBeNull();
  });
  it("parses block size and parent hash without deriving size from JSON bytes", () => {
    const data = { result: { block_metas: [{ block_size: "2048", num_txs: "0", block_id: { hash: "HASH" }, header: { height: "100", time: "2026-10-13T20:00:00Z", proposer_address: "ABCD", app_hash: "APP", last_block_id: { hash: "PARENT" } } }, { header: { height: "NaN" } }] } };
    expect(parseBlockMetadata(data)).toEqual([{ height: 100, hash: "HASH", parent: "PARENT", appHash: "APP", size: 2048, time: "2026-10-13T20:00:00Z", proposer: "abcd", txCount: 0 }]);
    expect(parseBlockMetadata({ result: null })).toEqual([]);
  });
  it("exposes only public event names and sums gas only for complete execution data", () => {
    const raw = { result: { txs_results: [{ gas_used: "10", gas_wanted: "100", events: [{ type: "wasm", attributes: [{ key: "secret", value: "ciphertext" }] }] }], end_block_events: [{ type: "wasm" }] } };
    expect(parseBlockExecution(raw, 1)).toEqual({ gasUsed: 10, gasWanted: 100, events: [{ type: "wasm", count: 2 }] });
    expect(parseBlockExecution(raw, 2).gasUsed).toBeNull();
    expect(parseBlockExecution({ result: { txs_results: null } }, 0).gasUsed).toBe(0);
    expect(parseBlockExecution({ result: { txs_results: [{ gas_used: null }] } }, 1).gasUsed).toBeNull();
  });
});
