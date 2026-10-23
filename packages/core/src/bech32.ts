/**
 * Minimal bech32 (BIP-173) codec for account addresses. Decoding also accepts
 * bech32m checksums, which some chains use for consensus pubkeys.
 */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

/** Decode a bech32/bech32m string to (hrp, 8-bit payload). Throws on bad data. */
export function bech32Decode(addr: string): { hrp: string; data: Uint8Array } {
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || pos + 7 > addr.length) throw new Error("invalid bech32 separator");
  const hrp = addr.slice(0, pos);
  const values: number[] = [];
  for (const c of addr.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`invalid bech32 character "${c}"`);
    values.push(v);
  }
  const chk = polymod([...hrpExpand(hrp), ...values]);
  if (chk !== 1 && chk !== BECH32M_CONST) throw new Error("bech32 checksum mismatch");

  const data5 = values.slice(0, -6);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of data5) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) throw new Error("invalid bech32 padding");
  return { hrp, data: Uint8Array.from(out) };
}

function hrpExpand(hrp: string): number[] {
  return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
}

/** Encode 8-bit `data` (e.g. a 20-byte account hash) as bech32 under `hrp`. */
export function bech32Encode(hrp: string, data: Uint8Array): string {
  const values: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of data) {
    acc = ((acc << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      values.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) values.push((acc << (5 - bits)) & 31);
  const chk = polymod([...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  for (let i = 0; i < 6; i++) values.push((chk >> (5 * (5 - i))) & 31);
  return `${hrp}1${values.map((v) => CHARSET[v]).join("")}`;
}
