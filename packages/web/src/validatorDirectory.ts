import type { Validator } from "./api";

export type ValidatorFilter = "all" | "bonded" | "unbonding" | "unbonded" | "jailed" | "tombstoned" | "at-risk" | "watched" | "degraded" | "inactive";
export type ValidatorSort = "power" | "stake" | "commission" | "uptime" | "proposer" | "name";

export function isAtRisk(v: Validator, threshold: number | null): boolean {
  return !v.staking?.jailed && !v.staking?.tombstoned && (v.status === "degraded" ||
    (threshold !== null && threshold > 0 && v.staking?.missed_blocks_counter != null && v.staking.missed_blocks_counter >= threshold * .8));
}

export function matchesValidatorFilter(v: Validator, filter: ValidatorFilter, threshold: number | null): boolean {
  if (filter === "all") return true;
  if (filter === "watched") return v.watched;
  if (filter === "at-risk") return isAtRisk(v, threshold);
  if (filter === "jailed" || filter === "tombstoned") return v.staking?.[filter] === true;
  if (filter === "degraded" || filter === "inactive") return v.status === filter;
  return v.staking?.bond_status === `BOND_STATUS_${filter.toUpperCase()}`;
}

export function directoryRows(validators: Validator[], query: string, filter: ValidatorFilter, sort: ValidatorSort, descending: boolean, threshold: number | null) {
  const q = query.trim().toLowerCase();
  const metric = (v: Validator): number | null => {
    const value = sort === "power" ? v.voting_power : sort === "stake" ? (v.staking?.tokens == null ? null : Number(v.staking.tokens)) : sort === "commission" ? v.staking?.commission_rate : sort === "uptime" ? v.uptime_1000 : v.proposer_share_1000;
    return value != null && Number.isFinite(value) ? value : null;
  };
  return validators.filter((v) => matchesValidatorFilter(v, filter, threshold) &&
    (!q || [v.address, v.moniker, v.label, v.identity, v.staking?.operator_address].some((s) => s?.toLowerCase().includes(q))))
    .sort((a, b) => {
      if (sort === "name") return (descending ? -1 : 1) * (a.moniker ?? a.address).localeCompare(b.moniker ?? b.address);
      const av = metric(a), bv = metric(b);
      if (av === null) return bv === null ? a.address.localeCompare(b.address) : 1;
      if (bv === null) return -1;
      return (descending ? -1 : 1) * (av - bv) || a.address.localeCompare(b.address);
    });
}

export function commissionStats(validators: Validator[]) {
  const values = validators.map((v) => v.staking?.commission_rate).filter((n): n is number => n != null && Number.isFinite(n) && n >= 0 && n <= 1).sort((a, b) => a - b);
  const buckets = Array.from({ length: 10 }, (_, i) => ({ min: i / 10, count: 0 }));
  for (const value of values) buckets[Math.min(9, Math.floor(value * 10))].count++;
  const mid = Math.floor(values.length / 2);
  return { values, buckets, min: values[0] ?? null, max: values.at(-1) ?? null,
    mean: values.length ? values.reduce((s, n) => s + n, 0) / values.length : null,
    median: values.length ? (values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2) : null };
}

/** A readable commission scale that expands to include every known rate. */
export function commissionHistogram(values: number[]) {
  const known = values.filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  const max = Math.min(1, Math.max(.2, Math.ceil(Math.max(0, ...known) * 10) / 10));
  const step = max / 10;
  const buckets = Array.from({ length: 10 }, (_, i) => ({ min: i * step, max: (i + 1) * step, count: 0 }));
  for (const value of known) buckets[Math.min(9, Math.floor(value / step + 1e-9))].count++;
  return { max, buckets };
}

/** Mutually exclusive staking states; unknown records are never called bonded. */
export function stakingStatusSummary(validators: Validator[]) {
  const counts = { bonded: 0, unbonding: 0, unbonded: 0, jailed: 0, tombstoned: 0, unknown: 0 };
  for (const v of validators) {
    const s = v.staking;
    if (s?.tombstoned) counts.tombstoned++;
    else if (s?.jailed) counts.jailed++;
    else if (s?.bond_status === "BOND_STATUS_BONDED") counts.bonded++;
    else if (s?.bond_status === "BOND_STATUS_UNBONDING") counts.unbonding++;
    else if (s?.bond_status === "BOND_STATUS_UNBONDED") counts.unbonded++;
    else counts.unknown++;
  }
  return counts;
}
