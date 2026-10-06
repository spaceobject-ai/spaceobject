import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SPACE_OBJECT_API_URL } from "@spaceobject/core";
import { getPassword, setPassword } from "cross-keychain";
import { z } from "zod";
import { CliError } from "../utils/errors.ts";

// Kubo RPC API endpoint for self-hosted uploads (--api); the default path goes
// through the Space Object API instead. The public gateways below serve
// downloads for the --gateway path.
// The Space Object gateway is public and content-addressed: downloads fetch
// bytes by CID with no account, no token, and no API involvement. The CLI
// verifies the sha256 locally, so the gateway is not trusted — any gateway
// serving the same CID works, and --gateway can point at a self-hosted one.
export const GATEWAYS = [
  "https://spaceobject.quicknode-ipfs.com",
  "https://ipfs.io",
  "https://dweb.link",
];

const STORAGE_DIR = path.join(os.homedir(), ".spaceobject", "sun", "storage");

// The sha256 is the onchain deliverable commitment (hash of the plaintext);
// the cid points at the bytes actually stored, which are ciphertext when the
// file was uploaded with --encrypt. The two diverge exactly when encrypted.
const uploadRecordSchema = z.object({
  name: z.string(),
  size: z.number(),
  sha256: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  cid: z.string().min(1),
  uploadedAt: z.string(),
  encrypted: z.boolean().optional(),
});

export type UploadRecord = z.infer<typeof uploadRecordSchema>;

const indexSchema = z.array(uploadRecordSchema);

// Uploads are indexed per user at ~/.spaceobject/sun/storage/<user_id>.json so
// `storage list` and `storage download` work without a third-party account;
// the network itself only knows CIDs.
function indexPath(userId: string) {
  return path.join(STORAGE_DIR, `${userId}.json`);
}

export async function readUploads(userId: string): Promise<UploadRecord[]> {
  return fs
    .readFile(indexPath(userId), "utf8")
    .then((raw) => indexSchema.parse(JSON.parse(raw)))
    .catch(() => []);
}

export async function appendUploads(userId: string, records: UploadRecord[]): Promise<void> {
  const existing = await readUploads(userId);
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(indexPath(userId), `${JSON.stringify([...existing, ...records], null, 2)}\n`);
}

export function findUpload(uploads: UploadRecord[], sha256: string): UploadRecord | undefined {
  return [...uploads].reverse().find((record) => record.sha256 === sha256);
}

export function findUploadByCid(uploads: UploadRecord[], cid: string): UploadRecord | undefined {
  return [...uploads].reverse().find((record) => record.cid === cid);
}

// AES keys are irrecoverable (only ciphertext ever reaches the network), so
// they stay out of the plain-JSON index and live in the OS keychain instead:
// one entry per user holding a sha256 → key map, mirroring how credentials.ts
// stores tokens under the same service.
const KEYCHAIN_SERVICE = "spaceobject-sun";

const storageKeysSchema = z.record(z.string(), z.string());

export async function readStorageKeys(userId: string): Promise<Record<string, string>> {
  const raw = await getPassword(KEYCHAIN_SERVICE, `storage-keys-${userId}`).catch(() => null);
  if (!raw) return {};

  return Promise.resolve(raw)
    .then((value) => storageKeysSchema.parse(JSON.parse(value)))
    .catch(() => ({}));
}

export async function saveStorageKeys(
  userId: string,
  entries: Record<string, string>,
): Promise<void> {
  const merged = { ...(await readStorageKeys(userId)), ...entries };
  await setPassword(KEYCHAIN_SERVICE, `storage-keys-${userId}`, JSON.stringify(merged));
}

// AES-256-GCM framing: [12-byte IV | ciphertext | 16-byte tag]. GCM's tag is
// the only tamper check, so decryptBytes returns null on any mismatch rather
// than throwing, and callers decide whether that is fatal.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function createStorageKey(): string {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

export function parseStorageKey(value: string): Buffer | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return null;

  return Buffer.from(value.slice(2), "hex");
}

export function encryptBytes(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

export function decryptBytes(stored: Buffer, key: Buffer): Buffer | null {
  if (stored.length < IV_LENGTH + TAG_LENGTH) return null;

  const iv = stored.subarray(0, IV_LENGTH);
  const tag = stored.subarray(stored.length - TAG_LENGTH);
  const ciphertext = stored.subarray(IV_LENGTH, stored.length - TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

// Uploads go through a Kubo node's RPC API (`/api/v0/add`) with raw leaves, so
// small files keep a CID whose digest is the plain sha2-256 of their bytes.
// Node 22 ships the globals this needs (fetch, FormData, Blob).
export async function uploadBytes(name: string, bytes: Buffer, apiUrl: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), name);

  // Trim trailing slashes so `${apiUrl}/api/v0/add` cannot become `//api/v0/add`.
  const response = await fetch(
    `${apiUrl.replace(/\/+$/, "")}/api/v0/add?cid-version=1&raw-leaves=true&pin=true&quiet=true`,
    {
      method: "POST",
      body: form,
    },
  ).catch(() => null);
  if (response === null || !response.ok)
    throw new CliError(
      "STORAGE_UPLOAD_FAILED",
      `Could not reach the IPFS node at ${apiUrl}.`,
      "Start a local node (`ipfs daemon`), or pass --api <url> for a reachable one.",
    );

  const result = await response
    .json()
    .then((value) => z.object({ Hash: z.string().min(1) }).safeParse(value))
    .catch(() => ({ success: false as const }));
  if (!result.success)
    throw new CliError(
      "STORAGE_UPLOAD_FAILED",
      `The IPFS node at ${apiUrl} returned an unreadable response.`,
    );

  return result.data.Hash;
}

// Downloads try each gateway in turn; content addressing means any of
// them serves the same bytes for a CID, so the first hit wins.
export async function downloadBytes(cid: string, gatewayOverride?: string): Promise<Buffer> {
  const gateways = gatewayOverride ? [gatewayOverride] : GATEWAYS;
  const bytes = await Promise.all(
    gateways.map((gateway) =>
      fetch(`${gateway.replace(/\/+$/, "")}/ipfs/${cid}`)
        .then(async (response) => (response.ok ? Buffer.from(await response.arrayBuffer()) : null))
        .catch(() => null),
    ),
  ).then((results) => results.find((candidate) => candidate !== null));

  if (bytes === undefined)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      `Could not fetch ${cid} from any gateway.`,
      "The node that pinned it may be offline, or the upload never finalized.",
    );

  return bytes;
}

// The Space Object API wraps QuickNode for uploads only: bytes pin under a
// fresh UUID pin name, so re-uploads (including --encrypt re-uploads with new
// ciphertext) never collide with existing pins. The QuickNode credentials
// never reach the CLI — only the Privy token every command already carries.
// Downloads do not use the API: the gateway serves bytes by CID, public and
// content-addressed, and the CLI verifies the sha256 locally.
export async function uploadDeliverable(
  bytes: Buffer,
  accessToken: string | null,
  baseUrl: string = SPACE_OBJECT_API_URL,
): Promise<string> {
  if (accessToken === null)
    throw new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `sun auth login`.");

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/v1/storage?name=${crypto.randomUUID()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(bytes),
    },
  ).catch(() => null);
  if (response === null || !response.ok)
    throw new CliError(
      "STORAGE_UPLOAD_FAILED",
      `The Space Object API rejected the upload${response ? `: HTTP ${response.status}` : "."}`,
      response?.status === 401
        ? "Run `sun auth login` and try again."
        : "Check your connection, then retry.",
    );

  const result = await response
    .json()
    .then((value) => z.object({ cid: z.string().min(1) }).safeParse(value))
    .catch(() => ({ success: false as const }));
  if (!result.success)
    throw new CliError(
      "STORAGE_UPLOAD_FAILED",
      "The Space Object API returned an unreadable response.",
    );

  return result.data.cid;
}
