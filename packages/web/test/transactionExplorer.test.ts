import { describe, expect, it } from "vitest";
import type { Transaction } from "../src/api";
import { addressFromHash, addressRoute, filterTransactions, nativeFees, searchTarget, transactionCategory, type TransactionFilters } from "../src/transactionExplorer";
const now = Date.parse("2026-10-14T12:00:00Z");
const tx = (override: Partial<Transaction> = {}): Transaction => ({ hash: "A".repeat(64), height: 123, timestamp: new Date(now - 1000).toISOString(), ok: true, code: 0, codespace: null, gas_used: 100, gas_wanted: 200, fee: [{ amount: "1000", denom: "uscrt" }], memo: "test memo", signer: "secret1sender", type: "Send", message_count: 1, encrypted: false, contract: null, contract_label: null, ...override });
const filters: TransactionFilters = { query: "", category: "All", status: "all", privacy: "all", contract: "all", hours: 0 };
describe("transaction explorer", () => {
  it("classifies the primary message while preserving the full display label", () => {
    for (const [type, category] of [["Execute contract +2", "Contract calls"], ["IBC transfer", "IBC"], ["Multi-send", "Token transfers"], ["Undelegate", "Staking"], ["Claim rewards", "Staking"], ["Vote", "Governance"], ["Authz exec", "Others"]] as const) expect(transactionCategory(tx({ type }))).toBe(category);
  });
  it("combines search, category, status, privacy, and contract filters", () => {
    const match = tx({ type: "Execute contract", ok: false, encrypted: true, contract: "secret1contract", contract_label: "My Contract" });
    const search = { ...filters, query: "MY CONTRACT", category: "Contract calls" as const, status: "failed", privacy: "sealed", contract: "secret1contract" };
    expect(filterTransactions([tx(), match, { ...match, ok: true }, { ...match, encrypted: false }], search, now)).toEqual([match]);
    expect(filterTransactions([tx()], { ...filters, query: "test memo" }, now)).toHaveLength(1);
    expect(filterTransactions([tx()], { ...filters, query: "123" }, now)).toHaveLength(1);
  });
  it("excludes missing, invalid, old and future timestamps only when a time filter is active", () => {
    const rows = [tx(), tx({ timestamp: null }), tx({ timestamp: "invalid" }), tx({ timestamp: new Date(now - 3_600_001).toISOString() }), tx({ timestamp: new Date(now + 1000).toISOString() })];
    expect(filterTransactions(rows, { ...filters, hours: 1 }, now)).toEqual([rows[0]]);
    expect(filterTransactions(rows, filters, now)).toHaveLength(5);
  });
  it("averages only known native-denomination fees without mixing token units", () => {
    const denom = { base: "uscrt", display: "SCRT", exponent: 6 };
    expect(nativeFees([tx(), tx({ fee: [{ amount: "2000000", denom: "uatom" }] }), tx({ fee: [] }), tx({ fee: [{ amount: "0", denom: "uscrt" }] }), tx({ fee: [{ amount: "NaN", denom: "uscrt" }] }), tx({ fee: [{ amount: "999999999999999999999", denom: "uscrt" }] })], denom)).toEqual([.001, 0]);
    expect(nativeFees([tx()], null)).toEqual([]);
  });
});

describe("global search intent", () => {
  const ADDRESS = "secret1p55wr2n6f63wyap8g9dckkxmf4wvq73ensxrw4";
  it("recognises hashes, addresses, heights and names", () => {
    expect(searchTarget(` ${"ab".repeat(32)} `)).toEqual({ kind: "transaction", hash: "AB".repeat(32) });
    expect(searchTarget(ADDRESS.toUpperCase())).toEqual({ kind: "address", address: ADDRESS });
    expect(searchTarget("27630042")).toEqual({ kind: "block", height: 27630042 });
    expect(searchTarget("secretvaloper1wg085tj9xtv84q9l2zgdml46n6ju3mryun4fsu")).toEqual({ kind: "text", query: "secretvaloper1wg085tj9xtv84q9l2zgdml46n6ju3mryun4fsu" });
    expect(searchTarget("Kraken")).toEqual({ kind: "text", query: "Kraken" });
    expect(searchTarget("0")).toEqual({ kind: "text", query: "0" });
    expect(searchTarget("   ")).toBeNull();
  });
  it("round-trips the address route", () => {
    expect(addressFromHash(addressRoute(ADDRESS))).toBe(ADDRESS);
    expect(addressFromHash("#/transactions/ABCD")).toBeNull();
  });
});
