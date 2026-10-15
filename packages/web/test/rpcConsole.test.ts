import { describe, expect, it } from "vitest";
import { compileParams, formFromRaw, methodList, normalizeEndpoint, RPC_METHODS } from "../src/rpcConsole";

const method = (path: string) => RPC_METHODS.find(m => m.path === path)!;
describe("RPC workbench", () => {
  it("exposes the complete read-only catalog and finds methods outside the popular group", () => {
    expect(methodList("All", "")).toHaveLength(17);
    expect(methodList("Popular", "")).toHaveLength(8);
    expect(methodList("Popular", "block_results").map(m => m.path)).toEqual(["/block_results"]);
    expect(methodList("Transactions", "").every(m => m.group === "Transactions")).toBe(true);
    expect(RPC_METHODS.some(m => m.path.includes("broadcast"))).toBe(false);
  });
  it("validates endpoint drafts without changing path case or accepting unsupported URL parts", () => {
    expect(normalizeEndpoint(" https://RPC.example/CaseSensitive/// ")).toEqual({ url: "https://rpc.example/CaseSensitive" });
    for (const input of ["", "javascript:alert(1)", "https://user:secret@rpc.example", "https://rpc.example?key=value", "https://rpc.example/#fragment"]) expect(normalizeEndpoint(input).error).toBeTruthy();
  });
  it("omits latest height, quotes query strings, and passes integers and booleans correctly", () => {
    expect(compileParams(method("/block"), { height: "latest" })).toEqual({ params: {} });
    expect(compileParams(method("/validators"), { height: "100", page: "1", per_page: "25" })).toEqual({ params: { height: "100", page: "1", per_page: "25" } });
    expect(compileParams(method("/tx_search"), { query: "tx.height=123", prove: "false" })).toEqual({ params: { query: '"tx.height=123"', prove: "false" } });
  });
  it("rejects malformed raw JSON, unknown fields, invalid pagination and reversed block ranges", () => {
    for (const raw of ["{", "null", "[]", '{"page": {}}', '{"unknown":1}', '{"page":0}', '{"per_page":101}', '{"height":9007199254740993}']) expect(compileParams(method("/validators"), {}, raw).error).toBeTruthy();
    expect(compileParams(method("/blockchain"), { minHeight: "20", maxHeight: "10" }).error).toBeTruthy();
    expect(compileParams(method("/tx_search"), { query: "" }).error).toBeTruthy();
    expect(compileParams(method("/tx_search"), { query: "tx.height=1", prove: "yes" }).error).toBeTruthy();
    expect(compileParams(method("/tx"), { hash: "oops" }).error).toBeTruthy();
  });
  it("round-trips raw parameters into editable fields without losing false values", () => {
    const spec = method("/tx_search"), raw = '{"query":"tx.height=1","prove":false,"page":2}';
    const fields = formFromRaw(spec, raw)!;
    expect(fields).toEqual({ query: "tx.height=1", prove: "false", page: "2" });
    expect(compileParams(spec, fields)).toEqual(compileParams(spec, {}, raw));
  });
});
