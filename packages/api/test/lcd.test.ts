/**
 * The sealing rules in lcd.ts: Secret compute ciphertext must never be passed
 * through as if it were readable, and plain Cosmos messages must pass intact.
 * Shapes follow a real secret-4 MsgExecuteContract tx (height 27,551,228).
 */
import { describe, expect, it } from "vitest";
import { detailTx, summarizeTx, typeLabel } from "../src/lcd.js";

const CONTRACT = "secret1w500qy39wtwaghwn9e5qu5sx23k2xtjfkj20as";
const SENDER = "secret1p55wr2n6f63wyap8g9dckkxmf4wvq73ensxrw4";

const executeTx = {
  txhash: "34B4916579BF2DEF5936373304C0802214BCF7DD8C84674B3E1378314690E4B0",
  height: "27551228",
  code: 0,
  gas_used: "121266",
  gas_wanted: "500000",
  timestamp: "2026-10-10T16:45:36Z",
  data: "EiYKJC9zZWNyZXQuY29tcHV0ZS52MWJldGExLk1zZ0V4ZWN1dGVDb250cmFjdA==",
  events: [
    { type: "message", attributes: [{ key: "sender", value: SENDER }] },
    {
      type: "wasm",
      attributes: [
        { key: "contract_address", value: CONTRACT },
        { key: "q8VZ3k9m0Z1s", value: "c2VhbGVkIGF0dHJpYnV0ZQ==" },
      ],
    },
  ],
  tx: {
    body: {
      messages: [
        {
          "@type": "/secret.compute.v1beta1.MsgExecuteContract",
          sender: SENDER,
          contract: CONTRACT,
          msg: Buffer.alloc(444, 7).toString("base64"),
          sent_funds: [],
        },
      ],
      memo: "",
    },
    auth_info: { fee: { amount: [{ denom: "uscrt", amount: "50000" }] } },
  },
};

const sendTx = {
  txhash: "C5EB2EFFA9000000000000000000000000000000000000000000000000000000",
  height: "27551260",
  code: 0,
  data: "12260A24",
  tx: {
    body: {
      messages: [
        {
          "@type": "/cosmos.bank.v1beta1.MsgSend",
          from_address: "secret1ctpu5ssl0hys60ukglv9pwzmqtys3x9gzv99wc",
          to_address: "secret13ltwltwktgfp4y4yazf9eun2y5wnuz35ad36a5",
          amount: [{ denom: "uscrt", amount: "1613481588" }],
        },
      ],
    },
    auth_info: { fee: { amount: [{ denom: "uscrt", amount: "10000" }] } },
  },
};

describe("summarizeTx", () => {
  it("marks compute txs encrypted and keeps the public envelope", () => {
    const t = summarizeTx(executeTx)!;
    expect(t).toMatchObject({
      height: 27551228,
      ok: true,
      type: "Execute contract",
      signer: SENDER,
      contract: CONTRACT,
      encrypted: true,
      gas_used: 121266,
      fee: [{ denom: "uscrt", amount: "50000" }],
    });
  });

  it("leaves plain Cosmos txs unencrypted", () => {
    const t = summarizeTx(sendTx)!;
    expect(t.encrypted).toBe(false);
    expect(t.type).toBe("Send");
    expect(t.signer).toBe("secret1ctpu5ssl0hys60ukglv9pwzmqtys3x9gzv99wc");
  });

  it("returns null without a hash", () => {
    expect(summarizeTx({})).toBeNull();
  });
});

describe("detailTx sealing", () => {
  it("replaces the compute msg with its ciphertext size, never the bytes", () => {
    const d = detailTx(executeTx)!;
    expect(d.messages[0]!.fields.msg).toEqual({ sealed: true, bytes: 444 });
    expect(JSON.stringify(d)).not.toContain(executeTx.tx.body.messages[0]!.msg);
    // Envelope fields of the same message stay readable.
    expect(d.messages[0]!.fields.contract).toBe(CONTRACT);
  });

  it("seals response data and wasm attributes except contract_address", () => {
    const d = detailTx(executeTx)!;
    expect(d.data).toEqual({ sealed: true, bytes: 46 });
    const wasm = d.events.find((e) => e.type === "wasm")!;
    expect(wasm.attributes[0]).toEqual({ key: "contract_address", value: CONTRACT, sealed: false });
    expect(wasm.attributes[1]).toEqual({ key: null, value: null, sealed: true });
    // Non-wasm events are untouched.
    expect(d.events[0]!.attributes[0]).toEqual({ key: "sender", value: SENDER, sealed: false });
  });

  it("passes plain message fields and data through unchanged", () => {
    const d = detailTx(sendTx)!;
    expect(d.messages[0]!.fields.amount).toEqual([{ denom: "uscrt", amount: "1613481588" }]);
    expect(d.data).toBe("12260A24");
    expect(d.raw_log).toBeNull();
  });
});

describe("typeLabel", () => {
  it("names known and unknown message types", () => {
    expect(typeLabel("/cosmos.staking.v1beta1.MsgDelegate")).toBe("Delegate");
    expect(typeLabel("/ibc.applications.transfer.v1.MsgTransfer")).toBe("IBC transfer");
    expect(typeLabel("/secret.registration.v1beta1.MsgFooBar")).toBe("Foo Bar");
    expect(typeLabel(null)).toBe("Unknown");
  });
});
