import type { GovParams, Proposal, Tally } from "./api";

export type ProposalGroup = "active" | "passed" | "rejected" | "all";
export const proposalStatuses: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "brand" | "muted" }> = {
  PROPOSAL_STATUS_VOTING_PERIOD: { label: "Voting", tone: "brand" },
  PROPOSAL_STATUS_DEPOSIT_PERIOD: { label: "Deposit", tone: "warn" },
  PROPOSAL_STATUS_PASSED: { label: "Passed", tone: "ok" },
  PROPOSAL_STATUS_REJECTED: { label: "Rejected", tone: "bad" },
  PROPOSAL_STATUS_FAILED: { label: "Failed", tone: "bad" },
};
export const isActiveProposal = (proposal: Proposal) => ["PROPOSAL_STATUS_VOTING_PERIOD", "PROPOSAL_STATUS_DEPOSIT_PERIOD"].includes(proposal.status);
export function inProposalGroup(proposal: Proposal, group: ProposalGroup) {
  return group === "all" || (group === "active" ? isActiveProposal(proposal) : group === "passed" ? proposal.status === "PROPOSAL_STATUS_PASSED" : ["PROPOSAL_STATUS_REJECTED", "PROPOSAL_STATUS_FAILED"].includes(proposal.status));
}
export function proposalKind(proposal: Proposal) {
  const type = proposal.messages[0]?.split(".").at(-1) ?? "";
  if (proposal.upgrade || /SoftwareUpgrade/.test(type)) return "Software upgrade";
  if (/MachineWhitelist/.test(type)) return "Machine whitelist";
  if (/UpdateParams|ParameterChange/.test(type)) return "Parameters";
  if (/CircuitBreaker/.test(type)) return "Circuit breaker";
  if (/RecoverClient/.test(type)) return "IBC recovery";
  return type ? type.replace(/^Msg/, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "Text";
}
export function featuredProposals(proposals: Proposal[]) {
  return [...proposals].sort((a, b) => Number(isActiveProposal(b)) - Number(isActiveProposal(a)) || b.id - a.id).slice(0, 3);
}
export function filterProposals(proposals: Proposal[], query: string, group: ProposalGroup, kind: string, status: string, sort: string, now: number) {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const end = (proposal: Proposal) => {
    const time = Date.parse((proposal.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD" ? proposal.deposit_end_time : proposal.voting_end_time) ?? "");
    return isActiveProposal(proposal) && time > now ? time : Infinity;
  };
  return proposals.filter((proposal) => inProposalGroup(proposal, group) && (kind === "all" || proposalKind(proposal) === kind) && (status === "all" || proposal.status === status) &&
    (!q || [String(proposal.id), proposal.title, proposal.summary, proposal.proposer].some((value) => value?.toLowerCase().includes(q))))
    .sort((a, b) => sort === "oldest" ? a.id - b.id : sort === "ending" ? (end(a) - end(b) || b.id - a.id) : b.id - a.id);
}
const integer = (value: string | null | undefined) => value != null && /^\d+$/.test(value) ? BigInt(value) : null;
const ratio = (value: bigint, total: bigint) => total > 0n ? Number(value * 1_000_000n / total) / 10_000 : 0;
export function tallyShares(tally: Tally) {
  const values = { yes: integer(tally.yes), no: integer(tally.no), veto: integer(tally.veto), abstain: integer(tally.abstain) };
  const known = Object.values(values).every((value) => value !== null);
  const total = known ? Object.values(values).reduce<bigint>((sum, value) => sum + value!, 0n) : null;
  return { total, shares: { yes: total === null ? null : ratio(values.yes!, total), no: total === null ? null : ratio(values.no!, total), veto: total === null ? null : ratio(values.veto!, total), abstain: total === null ? null : ratio(values.abstain!, total) } };
}
export function proposalTurnout(proposal: Proposal, bonded: string | null) {
  const stake = integer(bonded), total = tallyShares(proposal.tally).total;
  return proposal.status === "PROPOSAL_STATUS_VOTING_PERIOD" && stake !== null && stake > 0n && total !== null ? ratio(total, stake) : null;
}
export function proposalDeposit(proposal: Proposal, params: GovParams) {
  const minimum = (proposal.expedited ? params.expedited_min_deposit : params.min_deposit)[0];
  if (!minimum) return null;
  const target = integer(minimum.amount);
  const deposits = proposal.total_deposit.filter((coin) => coin.denom === minimum.denom);
  const values = deposits.map((coin) => integer(coin.amount));
  if (target === null || target <= 0n || values.some((value) => value === null)) return null;
  const deposited = values.reduce<bigint>((sum, value) => sum + value!, 0n);
  return { minimum, deposited: { denom: minimum.denom, amount: String(deposited) }, percent: ratio(deposited, target) };
}
