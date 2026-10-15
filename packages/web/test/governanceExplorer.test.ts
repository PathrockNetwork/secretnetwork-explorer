import { describe, expect, it } from "vitest";
import type { GovParams, Proposal } from "../src/api";
import { featuredProposals, filterProposals, proposalDeposit, proposalKind, proposalTurnout, tallyShares } from "../src/governanceExplorer";

const proposal = (id: number, extra: Partial<Proposal> = {}): Proposal => ({ id, status: "PROPOSAL_STATUS_PASSED", title: "Software upgrade", summary: "Upgrade the network", submit_time: null, deposit_end_time: null, voting_start_time: null, voting_end_time: null, total_deposit: [], expedited: false, messages: ["/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade"], proposer: null, upgrade: null, tally: { yes: "75", no: "10", veto: "5", abstain: "10" }, ...extra });
const params = { min_deposit: [{ denom: "uscrt", amount: "5000000000" }], expedited_min_deposit: [{ denom: "uscrt", amount: "12500000000" }] } as GovParams;

describe("governance explorer", () => {
  it("features active proposals first without modifying recorded statuses or source order", () => {
    const proposals = [proposal(1, { status: "PROPOSAL_STATUS_VOTING_PERIOD" }), proposal(2), proposal(3), proposal(4)];
    expect(featuredProposals(proposals).map(p => p.id)).toEqual([1, 4, 3]);
    expect(featuredProposals(proposals.slice(1)).every(p => p.status === "PROPOSAL_STATUS_PASSED")).toBe(true);
    expect(proposals.map(p => p.id)).toEqual([1, 2, 3, 4]);
  });
  it("combines ID search, groups, message kinds and statuses, and sorts active deadlines first", () => {
    const proposals = [proposal(381), proposal(380, { status: "PROPOSAL_STATUS_REJECTED", messages: ["/secret.compute.v1beta1.MsgUpdateMachineWhitelistProposal"] }), proposal(379, { status: "PROPOSAL_STATUS_VOTING_PERIOD", voting_end_time: "2026-10-20T00:00:00Z" }), proposal(378, { status: "PROPOSAL_STATUS_DEPOSIT_PERIOD", deposit_end_time: "2026-10-18T00:00:00Z" })];
    const filter = (q = "", group: "all" | "active" | "rejected" = "all", kind = "all", status = "all", sort = "newest") => filterProposals(proposals, q, group, kind, status, sort, Date.parse("2026-10-14T00:00:00Z")).map(p => p.id);
    expect(filter(" #381 ")).toEqual([381]);
    expect(filter("", "rejected", "Machine whitelist", "PROPOSAL_STATUS_REJECTED")).toEqual([380]);
    expect(filter("", "active", "Machine whitelist")).toEqual([]);
    expect(filter("", "all", "all", "all", "ending")).toEqual([378, 379, 381, 380]);
    expect(filter("", "all", "all", "all", "oldest")).toEqual([378, 379, 380, 381]);
    expect(proposalKind(proposals[0])).toBe("Software upgrade");
  });
  it("preserves large weighted tallies and distinguishes missing data from zero votes", () => {
    const result = tallyShares({ yes: "9007199254740993000", no: "3002399751580331000", veto: "0", abstain: "0" });
    expect(result.total).toBe(12009599006321324000n);
    expect(result.shares.yes).toBe(75);
    expect(tallyShares({ yes: "0", no: "0", veto: "0", abstain: "0" })).toEqual({ total: 0n, shares: { yes: 0, no: 0, veto: 0, abstain: 0 } });
    expect(tallyShares({ yes: "invalid", no: "0", veto: "0", abstain: "0" }).total).toBeNull();
    expect(tallyShares({ yes: "-1", no: "0", veto: "0", abstain: "0" }).shares.yes).toBeNull();
  });
  it("uses current stake only for current voting participation", () => {
    expect(proposalTurnout(proposal(1), "200")).toBeNull();
    const active = proposal(2, { status: "PROPOSAL_STATUS_VOTING_PERIOD" });
    expect(proposalTurnout(active, "200")).toBe(50);
    expect(proposalTurnout(active, "0")).toBeNull();
    expect(proposalTurnout(active, null)).toBeNull();
  });
  it("uses the expedited minimum and only deposits in the matching denomination", () => {
    const p = proposal(1, { expedited: true, total_deposit: [{ denom: "uscrt", amount: "5000000000" }, { denom: "other", amount: "9999999999999" }] });
    expect(proposalDeposit(p, params)?.percent).toBe(40);
    expect(proposalDeposit({ ...p, expedited: false }, params)?.percent).toBe(100);
    expect(proposalDeposit({ ...p, total_deposit: [] }, params)?.percent).toBe(0);
    expect(proposalDeposit({ ...p, total_deposit: [{ denom: "uscrt", amount: "invalid" }] }, params)).toBeNull();
  });
});
