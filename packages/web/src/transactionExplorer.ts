import type { Denom, Transaction } from "./api";

export const transactionCategories = ["All", "Contract calls", "Token transfers", "Staking", "Governance", "IBC", "Others"] as const;
export type TransactionCategory = typeof transactionCategories[number];

/** The list API describes the primary message; additional messages retain their +N label. */
export function transactionCategory(tx: Transaction): TransactionCategory {
  const type = tx.type.replace(/ \+\d+$/, "").toLowerCase();
  if (type.startsWith("ibc ")) return "IBC";
  if (/contract|store code/.test(type)) return "Contract calls";
  if (/^(send|multi-send)$/.test(type)) return "Token transfers";
  if (/delegate|claim rewards|claim commission|validator|unjail/.test(type)) return "Staking";
  if (/^(vote|deposit|proposal)$/.test(type)) return "Governance";
  return "Others";
}

export type TransactionFilters = { query: string; category: TransactionCategory; status: string; privacy: string; contract: string; hours: number };
export function filterTransactions(rows: Transaction[], filters: TransactionFilters, now: number) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((tx) => {
    const time = tx.timestamp ? Date.parse(tx.timestamp) : NaN;
    return (!query || [tx.hash, tx.signer, tx.contract, tx.contract_label, tx.memo, tx.type, String(tx.height ?? "")].some((value) => value?.toLowerCase().includes(query))) &&
      (filters.category === "All" || transactionCategory(tx) === filters.category) &&
      (filters.status === "all" || (filters.status === "success" ? tx.ok : !tx.ok)) &&
      (filters.privacy === "all" || (filters.privacy === "sealed" ? tx.encrypted : !tx.encrypted)) &&
      (filters.contract === "all" || tx.contract === filters.contract) &&
      (!filters.hours || (Number.isFinite(time) && time >= now - filters.hours * 3_600_000 && time <= now));
  });
}

/** Fees are comparable only when paid in the chain's native denomination. */
export function nativeFees(rows: Transaction[], denom: Denom | null): number[] {
  if (!denom) return [];
  return rows.flatMap((tx) => {
    const fees = tx.fee.filter((fee) => fee.denom === denom.base);
    if (!fees.length || fees.some((fee) => !/^\d+$/.test(fee.amount) || !Number.isSafeInteger(Number(fee.amount)))) return [];
    const total = fees.reduce((sum, fee) => sum + Number(fee.amount), 0);
    return Number.isSafeInteger(total) ? [total / 10 ** denom.exponent] : [];
  });
}

/** What the global search box was given, decided from its shape alone. */
export type SearchTarget =
  | { kind: "transaction"; hash: string }
  | { kind: "address"; address: string }
  | { kind: "block"; height: number }
  | { kind: "text"; query: string };

/**
 * A 64-hex string is a tx hash, `<prefix>1…` an account or contract address
 * (operator `<prefix>valoper1…` addresses stay validator searches), a bare
 * number a block height; anything else is a validator name search.
 */
export function searchTarget(input: string, prefix = "secret"): SearchTarget | null {
  const q = input.trim();
  if (!q) return null;
  if (/^[0-9a-f]{64}$/i.test(q)) return { kind: "transaction", hash: q.toUpperCase() };
  const lower = q.toLowerCase();
  if (lower.startsWith(`${prefix}1`) && /^[a-z0-9]+1[02-9ac-hj-np-z]{38,58}$/.test(lower)) return { kind: "address", address: lower };
  if (/^\d{1,15}$/.test(q) && Number(q) > 0) return { kind: "block", height: Number(q) };
  return { kind: "text", query: q };
}

export const addressRoute = (address: string) => `#/transactions/address/${address}`;

/** `#/transactions/address/<addr>` → addr, else null. */
export function addressFromHash(hash: string): string | null {
  return hash.match(/^#\/transactions\/address\/([a-z0-9]+1[02-9ac-hj-np-z]+)$/)?.[1] ?? null;
}
