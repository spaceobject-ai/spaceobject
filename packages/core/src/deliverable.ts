import { createHash } from "node:crypto";
import { z } from "zod";

// The onchain ERC-8183 deliverable is a bytes32 commitment to the work, not a
// location. Space Object defines it as sha2-256 of the file's plaintext bytes,
// so any client can verify a fetched file with an ordinary SHA-256 tool. An
// IPFS CID digest would not do: it hashes the DAG root block, which only
// equals a plain file hash for raw-codec single-block files.
export function deliverableHash(bytes: Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

// Uppercase hex is accepted and normalized to lowercase here — the single
// boundary where a hash enters the system — because every downstream
// comparison (pin-name match, verify-before-save) is case-sensitive against
// deliverableHash's lowercase output.
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
