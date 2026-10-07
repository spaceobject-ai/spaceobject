import { createHash } from "node:crypto";
import bs58 from "bs58";
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

/** Reconstructs the CIDv0 string (Qm…) from an onchain deliverable digest. */
export function cidFromDeliverableHash(hash: `0x${string}`): string {
  const digest = hash.startsWith("0x") ? hash.slice(2) : hash;

  return bs58.encode(Buffer.from(MULTIHASH_PREFIX + digest, "hex"));
}

/** Extracts the 32-byte digest from a CIDv0 string (Qm…). */
export function deliverableHashFromCid(cid: string): `0x${string}` | null {
  if (!cid.startsWith("Qm")) return null;

  const bytes = bs58.decode(cid);
  if (bytes.length !== 34) return null;

  const hex = Buffer.from(bytes).toString("hex");
  if (!hex.startsWith(MULTIHASH_PREFIX)) return null;

  return `0x${hex.slice(MULTIHASH_PREFIX.length)}`;
}
