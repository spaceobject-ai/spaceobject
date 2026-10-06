import { expect, test } from "vite-plus/test";
import { deliverableHash, parseDeliverableHash } from "../src/deliverable.ts";

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
    parseDeliverableHash("0xB94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9"),
  ).toBe("0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("rejects values that are not 32-byte 0x hex", () => {
  expect(
    parseDeliverableHash("bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"),
  ).toBeNull();
  expect(parseDeliverableHash("0x1234")).toBeNull();
  expect(parseDeliverableHash("deadbeef")).toBeNull();
  expect(parseDeliverableHash(`0x${"ab".repeat(33)}`)).toBeNull();
});
