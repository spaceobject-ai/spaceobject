import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { API_URL } from "./api.ts";
import { CliError } from "../utils/errors.ts";

// The Space Object gateway is public and content-addressed: downloads fetch
// bytes by CID with no account, no token, and no API involvement. Integrity
// rests on content addressing (see docs/product/storage.mdx for the trust
// model); --gateway can point at any other gateway or a self-hosted one.
export const GATEWAYS = [
  "https://spaceobject.quicknode-ipfs.com",
  "https://ipfs.io",
  "https://dweb.link",
];

const STORAGE_DIR = path.join(os.homedir(), ".spaceobject", "sun", "storage");

// The sha256 is the onchain deliverable value — the pin CID's digest — and the
// cid is the pin it came from; deliverableHashFromCid extracts one from the
// other, so both are recorded for convenience.
const uploadRecordSchema = z.object({
  name: z.string(),
  size: z.number(),
  sha256: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  cid: z.string().min(1),
  uploadedAt: z.string(),
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

export function findUploadByCid(uploads: UploadRecord[], cid: string): UploadRecord | undefined {
  return [...uploads].reverse().find((record) => record.cid === cid);
}

// Uploads go through a Kubo node's RPC API (`/api/v0/add`) with default
// settings, so the pin is CIDv0 dag-pb — the same shape QuickNode produces,
// which is what the onchain deliverable digest is extracted from. Node 22
// ships the globals this needs (fetch, FormData, Blob).
export async function uploadBytes(name: string, bytes: Buffer, apiUrl: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), name);

  // Trim trailing slashes so `${apiUrl}/api/v0/add` cannot become `//api/v0/add`.
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v0/add?pin=true&quiet=true`, {
    method: "POST",
    body: form,
  }).catch(() => null);
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

// The Space Object API wraps QuickNode for uploads only: the Worker names
// every pin with a server-generated UUID, so re-uploads never collide and the
// client controls nothing QuickNode-side. The QuickNode credentials never
// reach the CLI — only the Privy token every command already carries.
// Downloads do not use the API: the gateway serves bytes by CID, public and
// content-addressed.
export async function uploadDeliverable(
  bytes: Buffer,
  accessToken: string | null,
  baseUrl: string = API_URL,
): Promise<string> {
  if (accessToken === null)
    throw new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `sun auth login`.");

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/storage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  }).catch(() => null);
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
