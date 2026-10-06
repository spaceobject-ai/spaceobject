import { createHash } from "node:crypto";
import { z } from "zod";

// The onchain ERC-8183 deliverable is a bytes32 commitment to the work, not a
// location. For chain-deliverable mode it is the multihash digest of the pin's
// CIDv0: QuickNode pins every upload as UnixFS dag-pb (Qm…), whose digest is
// 0x12 0x20 <32-byte sha2-256> — the "1220" prefix gets stripped to fit
// bytes32 and re-added to reconstruct the CID. Because the digest covers the
// UnixFS wrapper rather than the raw file bytes, verification goes through the
// CID: fetch, re-derive the CID from the fetched bytes, compare.
export function deliverableHash(bytes: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

// Uppercase hex is accepted and normalized to lowercase here — the single
// boundary where a hash enters the system — because every downstream
// comparison is case-sensitive against lowercase output.
export const deliverableHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 0x-prefixed 32-byte sha2-256 hash")
  .transform((value) => value.toLowerCase());

export type DeliverableHash = z.infer<typeof deliverableHashSchema>;

/** Parses a deliverable hash, or returns null when it is not 32-byte hex. */
export function parseDeliverableHash(value: string): `0x${string}` | null {
  const result = deliverableHashSchema.safeParse(value);
  return result.success ? (result.data as `0x${string}`) : null;
}

// CIDv0 is the base58btc encoding of the bare multihash 0x1220 <digest>.
const MULTIHASH_PREFIX = "1220";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  // Count leading zero bytes, each encoded as a literal "1".
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Base-256 to base-58 big-integer arithmetic.
  const digits: number[] = [];
  for (let index = zeros; index < bytes.length; index += 1) {
    let carry = bytes[index];
    for (let position = 0; position < digits.length; position += 1) {
      carry += digits[position] << 8;
      digits[position] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return (
    "1".repeat(zeros) +
    digits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit])
      .join("")
  );
}

function base58Decode(value: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;

    let carry = digit;
    for (let position = 0; position < bytes.length; position += 1) {
      carry += bytes[position] * 58;
      bytes[position] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading "1"s are leading zero bytes; the rest is reversed big-endian.
  const leading = value.length - value.replace(/^1+/, "").length;
  return Uint8Array.from([...Array(leading).fill(0), ...bytes.reverse()]);
}

/** Reconstructs the CIDv0 string (Qm…) from an onchain deliverable digest. */
export function cidFromDeliverableHash(hash: `0x${string}`): string {
  const digest = hash.startsWith("0x") ? hash.slice(2) : hash;
  const multihash = MULTIHASH_PREFIX + digest;
  const bytes = new Uint8Array(multihash.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(multihash.slice(index * 2, index * 2 + 2), 16);

  return base58Encode(bytes);
}

/** Extracts the 32-byte digest from a CIDv0 string (Qm…). */
export function deliverableHashFromCid(cid: string): `0x${string}` | null {
  if (!cid.startsWith("Qm")) return null;

  const bytes = base58Decode(cid);
  if (bytes === null || bytes.length !== 34) return null;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!hex.startsWith(MULTIHASH_PREFIX)) return null;

  return `0x${hex.slice(MULTIHASH_PREFIX.length)}`;
}
