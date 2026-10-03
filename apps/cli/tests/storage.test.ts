import crypto from "node:crypto";
import { expect, test } from "vite-plus/test";
import {
  createStorageKey,
  decryptBytes,
  encryptBytes,
  parseStorageKey,
} from "../src/lib/storage.ts";

// 12-byte IV + 16-byte GCM tag around the ciphertext.
const FRAMING_OVERHEAD = 28;

test("encryption round-trips a file-sized buffer", () => {
  const key = parseStorageKey(createStorageKey());
  if (key === null) throw new Error("createStorageKey returned an unparseable key");

  const plaintext = crypto.randomBytes(1024 * 512);
  const stored = encryptBytes(plaintext, key);

  expect(stored.length).toBe(plaintext.length + FRAMING_OVERHEAD);
  expect(decryptBytes(stored, key)?.equals(plaintext)).toBe(true);
});

test("a tampered tag fails authentication and returns null", () => {
  const key = parseStorageKey(createStorageKey());
  if (key === null) throw new Error("createStorageKey returned an unparseable key");

  const stored = encryptBytes(Buffer.from("deliverable"), key);
  stored[stored.length - 1] ^= 0xff;

  expect(decryptBytes(stored, key)).toBeNull();
});

test("the wrong key returns null instead of throwing", () => {
  const stored = encryptBytes(Buffer.from("deliverable"), parseStorageKey(createStorageKey())!);

  expect(decryptBytes(stored, parseStorageKey(createStorageKey())!)).toBeNull();
});

test("buffers shorter than the framing overhead are not decryptable", () => {
  const key = parseStorageKey(createStorageKey());
  if (key === null) throw new Error("createStorageKey returned an unparseable key");

  expect(decryptBytes(Buffer.from("short"), key)).toBeNull();
});

test("parseStorageKey accepts only 32-byte 0x hex", () => {
  expect(parseStorageKey("0x1234")).toBeNull();
  expect(parseStorageKey("bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBeNull();
  expect(parseStorageKey(`0x${"ab".repeat(33)}`)).toBeNull();

  const parsed = parseStorageKey(`0x${"ab".repeat(32)}`);
  expect(parsed?.length).toBe(32);
});
