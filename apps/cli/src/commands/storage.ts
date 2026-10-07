import fs from "node:fs/promises";
import path from "node:path";
import {
  cidFromDeliverableHash,
  deliverableHashFromCid,
  deliverableHashSchema,
  parseDeliverableHash,
} from "@spaceobject/core";
import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { currentUserId, requireAccessToken, requireUserId } from "../lib/session.ts";
import {
  appendUploads,
  downloadBytes,
  findUploadByCid,
  readUploads,
  uploadBytes,
  uploadDeliverable,
  type UploadRecord,
} from "../lib/storage.ts";
import { CliError } from "../utils/errors.ts";
import { err, fields, isJson, ok, success } from "../utils/result.ts";

const upload = zodCommand({
  name: "upload",
  description: "Upload a file or directory to IPFS with the active account",
  args: {
    path: z.string().describe("File to upload, or a directory to upload every file inside"),
  },
  opts: {
    encrypt: z
      .boolean()
      .prefault(false)
      .describe("e;Encrypt with AES-256-GCM before upload, generating a fresh key per file"),
    api: z
      .string()
      .optional()
      .describe("Pin on a self-hosted kubo node at this RPC url (default: the Space Object API)"),
  },
  action: async (args, opts) => {
    const json = isJson(upload);

    const result = await uploadPath(args.path, opts, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    const blocks = result.records.map((record) =>
      fields([
        ["Name", record.name],
        ["CID", pc.cyan(record.cid)],
        ["Deliverable", pc.cyan(record.sha256)],
        ["Size", formatBytes(record.size)],
      ]),
    );

    ok(
      [
        success(`Uploaded ${result.records.length} file${result.records.length === 1 ? "" : "s"}`),
        "",
        blocks.join("\n\n"),
        "",
        pc.dim(
          "Next: submit the deliverable hash to escrow — sun agent job deliver <jobId> <hash>",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
      result,
    )(json);
  },
});

async function uploadPath(
  inputPath: string,
  opts: { encrypt: boolean; api?: string },
  json: boolean,
) {
  const userId = await requireUserId();
  const files = await collectFiles(inputPath);
  const root = path.dirname(path.resolve(inputPath));
  const records: UploadRecord[] = [];

  // Chain deliverables are pinned as plaintext UnixFS: an encrypted pin's CID
  // digest covers ciphertext, which a client could not reconcile with the
  // onchain value — so --encrypt is rejected for this flow.
  if (opts.encrypt)
    throw new CliError(
      "STORAGE_INPUT_INVALID",
      "Chain deliverables cannot be encrypted.",
      "An encrypted pin's CID covers ciphertext, so a client could not fetch it from the onchain digest. Deliver the key out-of-band instead, or upload the plaintext.",
    );

  // Sequential on purpose: each file's record is persisted before the next
  // upload starts, so a failure partway through loses nothing already indexed.
  for (const filePath of files) {
    const name = path.relative(root, filePath);
    progress(json, `Uploading ${name}…`);

    const bytes = await fs.readFile(filePath).catch(() => {
      throw new CliError("STORAGE_PATH_NOT_FOUND", `Could not read ${filePath}.`);
    });

    const cid = await pinStored(name, bytes, opts.api);
    // The onchain deliverable is the pin CID's multihash digest — the value a
    // client re-adds the 1220 prefix to and base58-encodes back into the CID.
    // For QuickNode's UnixFS pins this differs from sha256 of the file bytes
    // (the digest covers the DAG wrapper), so it is extracted from the CID,
    // never computed from the plaintext.
    const sha256 = deliverableHashFromCid(cid);
    if (sha256 === null)
      throw new CliError(
        "STORAGE_UPLOAD_FAILED",
        `The pin returned ${cid}, which is not a CIDv0 (Qm…), so it carries no onchain deliverable digest.`,
        "This backend changed its pin format; report it.",
      );

    const record: UploadRecord = {
      name,
      size: bytes.length,
      sha256,
      cid,
      uploadedAt: new Date().toISOString(),
    };

    await appendUploads(userId, [record]);

    records.push(record);
  }

  return { backend: opts.api ? "kubo" : "api", records };
}

// Uploads default to the Space Object API (QuickNode-backed, no node needed);
// --api pins on a self-hosted kubo node instead. Downloads never use the API:
// the gateway serves bytes by CID, public and content-addressed.
async function pinStored(name: string, stored: Buffer, api: string | undefined): Promise<string> {
  if (api !== undefined) return uploadBytes(name, stored, api);

  return uploadDeliverable(stored, await requireAccessToken());
}

async function collectFiles(inputPath: string): Promise<string[]> {
  const resolved = path.resolve(inputPath);
  const stats = await fs.stat(resolved).catch(() => null);
  if (!stats)
    throw new CliError("STORAGE_PATH_NOT_FOUND", `No such file or directory: ${inputPath}`);
  if (stats.isFile()) return [resolved];

  const entries = await fs
    .readdir(resolved, { recursive: true, withFileTypes: true })
    .catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  if (files.length === 0)
    throw new CliError("STORAGE_PATH_NOT_FOUND", `Directory is empty: ${inputPath}`);

  return files;
}

const download = zodCommand({
  name: "download",
  description:
    "Reconstruct the CID from an onchain deliverable hash and fetch the bytes from the public gateway",
  args: {
    value: z.string().min(1).describe("Onchain deliverable hash (0x…) or CIDv0 (Qm…)"),
  },
  opts: {
    output: z
      .string()
      .optional()
      .describe("o;Output path; defaults to the hash or CID in the current directory"),
    gateway: z
      .string()
      .optional()
      .describe("g;Fetch from this gateway url instead of the default public gateways"),
  },
  action: async (args, opts) => {
    const json = isJson(download);

    const result = await downloadFile(args.value, opts, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Deliverable", pc.cyan(result.hash)],
        ["CID", pc.cyan(result.cid)],
        ["Saved To", result.path],
        ["Size", formatBytes(result.size)],
      ]),
      result,
    )(json);
  },
});

// Either form works: the onchain hash (reconstructed into the CID) or the CID
// itself (hash extracted from it). Integrity rests on content addressing — the
// gateway serves the bytes for that CID — not on a local re-hash; the trust
// model is documented in docs/product/storage.mdx. No login is needed: the
// index lookup only names the file when a session happens to exist.
async function downloadFile(
  value: string,
  opts: { output?: string; gateway?: string },
  json: boolean,
) {
  const hash = parseDeliverableHash(value) ?? deliverableHashFromCid(value);
  if (hash === null)
    throw new CliError(
      "STORAGE_INPUT_INVALID",
      `${value} is neither a 0x-prefixed 32-byte hash nor a CIDv0 (Qm…).`,
    );

  const cid = value.startsWith("0x") ? cidFromDeliverableHash(hash) : value;
  const record = await findUploadBestEffort(cid);

  const outputPath = path.resolve(opts.output ?? value);
  progress(json, `Downloading ${record?.name ?? cid}…`);
  const stored = await downloadBytes(cid, opts.gateway);

  await fs.writeFile(outputPath, stored);
  return { hash, cid, path: outputPath, size: stored.length };
}

// Best-effort because the index is a convenience, not a dependency: downloads
// are account-free by design, and a missing login must not block them.
async function findUploadBestEffort(cid: string): Promise<UploadRecord | undefined> {
  const userId = await currentUserId().catch(() => null);
  if (userId === null) return undefined;

  return findUploadByCid(await readUploads(userId), cid);
}

const list = zodCommand({
  name: "list",
  description: "List files uploaded by the current account",
  action: async () => {
    const json = isJson(list);

    const result = await listUploads().catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.uploads.length === 0)
      return ok(pc.dim("No uploads yet. Run `sun storage upload <path>`."), result)(json);

    ok(
      result.uploads
        .map(
          (record) =>
            `${pc.cyan(record.sha256)}  ${record.name}  ${pc.dim(
              `${formatBytes(record.size)}, ${record.uploadedAt.slice(0, 10)}`,
            )}`,
        )
        .join("\n"),
      result,
    )(json);
  },
});

async function listUploads() {
  const userId = await requireUserId();
  return { userId, uploads: await readUploads(userId) };
}

const key = zodCommand({
  name: "key",
  description: "Deprecated: chain deliverables are pinned as plaintext, so no keys exist",
  args: {
    sha256: deliverableHashSchema.describe(
      "Deliverable hash of the encrypted file",
    ) as unknown as z.ZodType<`0x${string}`>,
  },
  action: async () => {
    err(
      new CliError(
        "STORAGE_INPUT_INVALID",
        "Encryption keys are no longer kept: chain deliverables are pinned as plaintext.",
      ),
    )(isJson(key));
  },
});

function progress(json: boolean, message: string) {
  // Progress goes to stderr so stdout stays parseable in both output modes.
  if (!json) process.stderr.write(pc.dim(`${message}\n`));
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(Math.floor(Math.log2(size) / 10), units.length);
  return `${(size / 2 ** (10 * exponent)).toFixed(1)} ${units[exponent - 1]}`;
}

export const storage = zodCommand({
  name: "storage",
  description: "Store and retrieve files on IPFS",
})
  .addCommand(upload)
  .addCommand(download)
  .addCommand(list)
  .addCommand(key);
