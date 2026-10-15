import { describe, expect, it, vi } from "vitest";
import { rpcCallRaw, rpcUrl } from "../src/nodeRpc";

describe("rpcUrl", () => {
  it("strips trailing slashes from the base", () => {
    expect(rpcUrl("https://node.example///", "/status")).toBe(
      "https://node.example/status",
    );
  });

  it("encodes path params", () => {
    expect(rpcUrl("https://node.example", "/validators", { height: 123, page: 2, per_page: 30 })).toBe(
      "https://node.example/validators?height=123&page=2&per_page=30",
    );
  });

  it("passes height=latest through as a string param", () => {
    expect(rpcUrl("https://node.example", "/block", { height: "latest" })).toBe(
      "https://node.example/block?height=latest",
    );
  });

  it("omits the query string when no params are given", () => {
    expect(rpcUrl("http://127.0.0.1:26657", "/net_info")).toBe(
      "http://127.0.0.1:26657/net_info",
    );
  });

  it("routes the bundled public preset through the same-origin bridge", () => {
    expect(rpcUrl("https://rpc.secret.mainnet.secret3.dev", "/health")).toBe(
      "/api/v1/rpc/proxy?endpoint=https%3A%2F%2Frpc.secret.mainnet.secret3.dev&path=%2Fhealth",
    );
  });

  it("preserves quoted CometBFT params through the preset bridge", () => {
    expect(rpcUrl("https://rpc.secret.mainnet.secret3.dev", "/block", { height: '"latest"' })).toBe(
      "/api/v1/rpc/proxy?endpoint=https%3A%2F%2Frpc.secret.mainnet.secret3.dev&path=%2Fblock&height=%22latest%22",
    );
  });
});

it("preserves the JSON-RPC error body and its detailed message", async () => {
  const body = { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params", data: "height unavailable" } };
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
  try {
    const response = await rpcCallRaw("https://node.example", "/block", { height: "1" });
    expect(response).toMatchObject({ state: "error", error: "Invalid params: height unavailable", data: body });
  } finally { fetch.mockRestore(); }
});
