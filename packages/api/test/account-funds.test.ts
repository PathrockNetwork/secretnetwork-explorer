import { describe, expect, it } from "vitest";
import { accountFunds, txsForAddress, type Lcd } from "../src/lcd.js";

const A = "secret133ezxteaes7hjhcze04g0mj98saee6sc2wa56l";
const V = "secretvaloper1dyfats3mqaphz7wyj8r89lt3gze88eenwu7tmf";

function stubLcd(routes: Record<string, unknown>): Lcd {
  return {
    configured: true,
    get: async (path: string) => {
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected ${path}`);
      return routes[key];
    },
  } as unknown as Lcd;
}

describe("accountFunds", () => {
  it("collects balances, stake, rewards and unbonding in whole base units", async () => {
    const f = await accountFunds(
      stubLcd({
        "/cosmos/auth/": { account: { "@type": "/cosmos.auth.v1beta1.BaseAccount", account_number: "402148", sequence: "2" } },
        "/cosmos/bank/": { balances: [{ denom: "uscrt", amount: "995277" }] },
        "/cosmos/staking/v1beta1/delegations/": {
          delegation_responses: [{ delegation: { validator_address: V }, balance: { denom: "uscrt", amount: "120000000000" } }],
        },
        "/cosmos/distribution/": {
          rewards: [{ validator_address: V, reward: [{ denom: "uscrt", amount: "2936261649.38" }] }],
          total: [{ denom: "uscrt", amount: "2936261649.38" }],
        },
        "/cosmos/staking/v1beta1/delegators/": {
          unbonding_responses: [{ validator_address: V, entries: [{ balance: "5000000", completion_time: "2026-11-01T00:00:00Z" }] }],
        },
      }),
      A,
    );
    expect(f).toMatchObject({
      account_type: "BaseAccount",
      account_number: 402148,
      sequence: 2,
      balances: [{ denom: "uscrt", amount: "995277" }],
      delegations: [{ validator: V, amount: { denom: "uscrt", amount: "120000000000" } }],
      rewards_total: [{ denom: "uscrt", amount: "2936261649" }],
      unbonding: [{ validator: V, amount: "5000000", completion_time: "2026-11-01T00:00:00Z" }],
    });
  });

  it("reads the base account nested inside a vesting account", async () => {
    const f = await accountFunds(
      stubLcd({
        "/cosmos/auth/": {
          account: {
            "@type": "/cosmos.vesting.v1beta1.ContinuousVestingAccount",
            base_vesting_account: { base_account: { account_number: "7", sequence: "9" } },
          },
        },
        "/cosmos/bank/": { balances: [] },
        "/cosmos/staking/v1beta1/delegations/": {},
        "/cosmos/distribution/": {},
        "/cosmos/staking/v1beta1/delegators/": {},
      }),
      A,
    );
    expect(f).toMatchObject({ account_type: "ContinuousVestingAccount", account_number: 7, sequence: 9, delegations: [], unbonding: [] });
  });
});

describe("txsForAddress", () => {
  it("merges sender, recipient and contract matches below the ceiling, newest first", async () => {
    const seen: string[] = [];
    const tx = (hash: string, height: number) => ({ txhash: hash, height: String(height), code: 0, tx: { body: { messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend" }] } } });
    const lcd = {
      configured: true,
      get: async (path: string) => {
        const q = new URL(`http://x${path}`).searchParams.get("query")!;
        seen.push(q);
        if (q.startsWith("message.sender")) return { tx_responses: [tx("A", 10), tx("B", 5)] };
        if (q.startsWith("transfer.recipient")) return { tx_responses: [tx("B", 5), tx("C", 8)] };
        return { tx_responses: [] };
      },
    } as unknown as Lcd;
    const rows = await txsForAddress(lcd, A, 20, 10);
    expect(rows.map((r) => r.hash)).toEqual(["A", "C", "B"]);
    expect(seen.every((q) => q.endsWith("AND tx.height<20"))).toBe(true);
  });
});
