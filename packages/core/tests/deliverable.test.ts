import { expect, test } from "vite-plus/test";
import {
  cidFromDeliverableHash,
  deliverableHash,
  deliverableHashFromCid,
  parseDeliverableHash,
} from "../src/deliverable.ts";

test("hashes file bytes to a 0x-prefixed 32-byte sha2-256 hex", () => {
  const hash = deliverableHash(new TextEncoder().encode("hello world"));

  // SHA-256 of "hello world", as sha256sum would print it.
  expect(hash).toBe("0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("the same bytes hash identically across calls", () => {
  const bytes = new TextEncoder().encode("deliverable");
  expect(deliverableHash(bytes)).toBe(deliverableHash(bytes));
});

test("a single byte change produces a different hash", () => {
  expect(deliverableHash(new TextEncoder().encode("a"))).not.toBe(
    deliverableHash(new TextEncoder().encode("b")),
  );
});

test("parses a valid deliverable hash", () => {
  expect(parseDeliverableHash(deliverableHash(new Uint8Array([1, 2, 3])))).toBe(
    deliverableHash(new Uint8Array([1, 2, 3])),
  );
});

test("normalizes uppercase hex to lowercase", () => {
  expect(
    parseDeliverableHash(
      "0XB94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9".replace("0X", "0x"),
    ),
  ).toBe("0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("rejects values that are not 32-byte 0x hex", () => {
  expect(parseDeliverableHash("QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7")).toBeNull();
  expect(parseDeliverableHash("0x1234")).toBeNull();
  expect(parseDeliverableHash("deadbeef")).toBeNull();
  expect(parseDeliverableHash(`0x${"ab".repeat(33)}`)).toBeNull();
});

// Live-verified pair from this session: a real QuickNode pin.
// "chain deliverable test …" pinned as UnixFS dag-pb produced this CIDv0; the
// digest is the multihash inside the CID (the DAG-wrapper hash), which is
// deliberately different from sha256 of the file bytes — that difference is
// the Option A semantics.
test("CIDv0 round-trip: digest reconstructs the exact CID it came from", () => {
  const cid = "QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7";
  const digest = "0x0186cc98ff515166c6ebbd971a78dfd39f8670a53a9815a51e7d7479d05a2c8a";

  expect(deliverableHashFromCid(cid)).toBe(digest);
  expect(cidFromDeliverableHash(digest)).toBe(cid);
});

test("every digest maps back and forth through the codec", () => {
  const hash = deliverableHash(new TextEncoder().encode("roundtrip property"));
  expect(deliverableHashFromCid(cidFromDeliverableHash(hash))).toBe(hash);
});

test("reconstructed CIDs look like CIDv0 (Qm…)", () => {
  const cid = cidFromDeliverableHash(deliverableHash(new TextEncoder().encode("shape check")));

  expect(cid.startsWith("Qm")).toBe(true);
  expect(cid.length).toBe(46);
});

test("non-CIDv0 values are rejected by deliverableHashFromCid", () => {
  // CIDv1 forms and arbitrary strings carry no CIDv0 digest.
  expect(
    deliverableHashFromCid("bafkreicouv3sksjuzxb3rbb6rziy6duakk2aikegsmtqtz5rsuppjorxsa"),
  ).toBeNull();
  expect(deliverableHashFromCid("not-a-cid")).toBeNull();
  // Qm-prefixed but containing characters outside the base58 alphabet
  // (0, O, I, l): bs58.decode would throw, this must return null instead.
  expect(deliverableHashFromCid("Qm0OOIIll")).toBeNull();
  expect(deliverableHashFromCid("Qm invalid base58")).toBeNull();
  expect(deliverableHashFromCid("Qm1")).toBeNull();
});
