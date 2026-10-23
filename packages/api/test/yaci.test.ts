/**
 * yaci → LCD shape normalisation. The fixture is a real secret-4
 * MsgExecuteContract as yaci stored it from gRPC (height 27,630,0xx): compute
 * sender/contract arrive as base64 address bytes and keys are camelCase.
 */
import { describe, expect, it } from "vitest";
import { bech32Decode, bech32Encode } from "@sealed/core";
import { detailTx } from "../src/lcd.js";
import { addressFromBytes, addressToBytes, toRawTxResponse } from "../src/yaci.js";

// The same account appears as `spender` (bech32) in this tx's coin_spent event.
const SENDER_BYTES = "DSjhqnpOouJ0J0Fbi1jbTVzAejk=";
const SENDER = "secret1p55wr2n6f63wyap8g9dckkxmf4wvq73ensxrw4";

const stored = {
  tx: {
    body: {
      messages: [
        {
          "@type": "/secret.compute.v1beta1.MsgExecuteContract",
          msg: Buffer.alloc(300, 9).toString("base64"),
          sender: SENDER_BYTES,
          contract: "dR7wEiVy3dRd0y5oDlIGVGyjLkk=",
          sentFunds: [],
        },
      ],
      memo: "",
    },
    authInfo: { fee: { amount: [{ denom: "uscrt", amount: "50000" }], gasLimit: "500000" } },
  },
  txResponse: {
    txhash: "AB".repeat(32),
    height: "27630042",
    gasUsed: "121266",
    gasWanted: "500000",
    timestamp: "2026-10-16T09:00:00Z",
    data: "12340A322F736563726574",
    events: [{ type: "coin_spent", attributes: [{ key: "spender", value: SENDER, index: true }] }],
  },
};

describe("bech32", () => {
  it("round-trips account bytes", () => {
    const bytes = Buffer.from(SENDER_BYTES, "base64");
    expect(bech32Encode("secret", bytes)).toBe(SENDER);
    expect(Buffer.from(bech32Decode(SENDER).data)).toEqual(bytes);
  });
});

describe("yaci normalisation", () => {
  it("converts compute address bytes to bech32 and back", () => {
    expect(addressFromBytes(SENDER_BYTES, "secret")).toBe(SENDER);
    expect(addressToBytes(SENDER)).toBe(SENDER_BYTES);
    expect(addressFromBytes("not base64!", "secret")).toBe("not base64!");
    expect(addressToBytes("nonsense")).toBeNull();
  });

  it("yields the LCD shape, so sealing rules still apply", () => {
    const tx = detailTx(toRawTxResponse(stored, "secret"))!;
    expect(tx.hash).toBe("AB".repeat(32));
    expect(tx.height).toBe(27630042);
    expect(tx.ok).toBe(true);
    expect(tx.gas_used).toBe(121266);
    expect(tx.fee).toEqual([{ denom: "uscrt", amount: "50000" }]);
    expect(tx.signer).toBe(SENDER);
    expect(tx.contract).toMatch(/^secret1/);
    expect(tx.encrypted).toBe(true);
    expect(tx.messages[0]!.fields.msg).toEqual({ sealed: true, bytes: 300 });
    expect(tx.messages[0]!.fields).toHaveProperty("sent_funds");
    expect(tx.data).toEqual({ sealed: true, bytes: 11 });
  });

  it("keeps a failed tx's code", () => {
    const failed = { ...stored, txResponse: { ...stored.txResponse, code: 5, codespace: "sdk", rawLog: "out of gas" } };
    const tx = detailTx(toRawTxResponse(failed, "secret"))!;
    expect(tx.ok).toBe(false);
    expect(tx.code).toBe(5);
    expect(tx.raw_log).toBe("out of gas");
  });
});
