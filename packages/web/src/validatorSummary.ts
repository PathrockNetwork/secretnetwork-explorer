import type { Validator } from "./api";

export function validatorSummary(validators: Validator[]) {
  const counts = { active: 0, degraded: 0, inactive: 0 };
  for (const validator of validators) counts[validator.status]++;
  const proposers = validators
    .filter((v) => v.proposer_share_1000 !== null && Number.isFinite(v.proposer_share_1000))
    .slice()
    .sort((a, b) => b.proposer_share_1000! - a.proposer_share_1000! || a.address.localeCompare(b.address))
    .slice(0, 5);
  return { counts, proposers, total: validators.length };
}
