import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { deliverableHash, deliverableHashSchema } from "@spaceobject/core";
import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { requireAccessToken, requireUserId } from "../lib/session.ts";
import {
  appendUploads,
  decryptBytes,
  downloadBytes,
  downloadDeliverable,
  encryptBytes,
  findUpload,
  parseStorageKey,
  readStorageKeys,
  readUploads,
  saveStorageKeys,
  type UploadRecord,
  uploadBytes,
  uploadDeliverable,
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
        ["SHA-256", pc.cyan(record.sha256)],
        ["CID", pc.cyan(record.cid)],
        ["Size", formatBytes(record.size)],
      ]),
    );
    // The key is deliberately not shown: it lives in the OS keychain, and
    // printing it would leak an irrecoverable secret into scrollback and logs.
    const keyNote = opts.encrypt
      ? `\n\n${pc.yellow(`Keys are saved to this machine's keychain; downloads by this account decrypt automatically. To share a file, run \`sun storage key <sha256>\`.`)}`
      : "";

    ok(
      [
        success(`Uploaded ${result.records.length} file${result.records.length === 1 ? "" : "s"}`),
        "",
        blocks.join("\n\n"),
        keyNote,
        "",
        pc.dim("Next: pass the hash to escrow — sun agent job deliver <jobId> <sha256>"),
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

  // Sequential on purpose: each file's record and key are persisted before the
  // next upload starts, so a failure partway through cannot lose earlier keys —
  // a key is the only way to ever decrypt its file.
  for (const filePath of files) {
    const name = path.relative(root, filePath);
    progress(json, `Uploading ${name}…`);

    const bytes = await fs.readFile(filePath).catch(() => {
      throw new CliError("STORAGE_PATH_NOT_FOUND", `Could not read ${filePath}.`);
    });
    const sha256 = deliverableHash(bytes);
    const key = opts.encrypt ? crypto.randomBytes(32) : undefined;
    const stored = key ? encryptBytes(bytes, key) : bytes;

    // Re-uploading the same file is rejected by the backend when the hash was
    // already pinned (QuickNode disallows duplicate pin names), so this is the
    // last chance to say why before the pin attempt fails.
    const previous = findUpload(await readUploads(userId), sha256);
    if (previous !== undefined)
      process.stderr.write(
        pc.yellow(
          `${name} was uploaded before; the same bytes hash to the same pin, and a re-upload is rejected as a duplicate.\n`,
        ),
      );

    const cid = await pinStored(name, stored, sha256, opts.api);

    // The key is saved before the index entry claims it exists: dying between
    // the two would otherwise leave "encrypted: true" pointing at a key that
    // was never stored, and the index is the weaker claim to abandon.
    if (key) await saveStorageKeys(userId, { [sha256]: `0x${key.toString("hex")}` });
    const record: UploadRecord = {
      name,
      size: bytes.length,
      sha256,
      cid,
      uploadedAt: new Date().toISOString(),
      ...(key && { encrypted: true }),
    };

    await appendUploads(userId, [record]);

    records.push(record);
  }

  return { backend: opts.api ? "kubo" : "api", records };
}

// Uploads default to the Space Object API (QuickNode-backed, no node needed);
// --api pins on a self-hosted kubo node instead. The pin name is the deliverable
// hash either way, so downloads resolve by hash on both paths.
async function pinStored(
  name: string,
  stored: Buffer,
  sha256: string,
  api: string | undefined,
): Promise<string> {
  if (api !== undefined) return uploadBytes(name, stored, api);

  return uploadDeliverable(stored, sha256, await requireAccessToken());
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
  description: "Fetch a deliverable from IPFS by its sha2-256 hash, verify it, and decrypt it",
  args: {
    sha256: deliverableHashSchema.describe(
      "Deliverable hash `sun storage upload` printed",
    ) as unknown as z.ZodType<`0x${string}`>,
  },
  opts: {
    output: z
      .string()
      .optional()
      .describe("o;Output path; defaults to the hash in the current directory"),
    key: z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Expected a 32-byte hex AES-256 key")
      .optional()
      .describe("k;AES-256-GCM key to decrypt with; defaults to a key saved by this account"),
    raw: z
      .boolean()
      .prefault(false)
      .describe("r;Save the file exactly as stored on IPFS, skipping decryption and verification"),
    gateway: z
      .string()
      .optional()
      .describe("g;Fetch by CID from a self-hosted gateway url instead of the Space Object API"),
  },
  action: async (args, opts) => {
    const json = isJson(download);

    const result = await downloadFile(args.sha256, opts, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["SHA-256", pc.cyan(result.sha256)],
        ["CID", pc.cyan(result.cid ?? "unresolved")],
        ["Saved To", result.path],
        ["Size", formatBytes(result.size)],
        ["Verified", result.verified ? "yes" : "no"],
        ["Decrypted", result.decrypted ? "yes" : "no"],
      ]),
      result,
    )(json);
  },
});

async function downloadFile(
  sha256: string,
  opts: { output?: string; key?: string; raw: boolean; gateway?: string },
  json: boolean,
) {
  if (opts.key && opts.raw)
    throw new CliError("FLAG_CONFLICT", "--key and --raw cannot be combined.");

  const userId = await requireUserId();
  // Optional: the local record names the file and carries the CID for the
  // --gateway path, but the API path resolves by hash alone.
  const record = findUpload(await readUploads(userId), sha256);

  // --gateway fetches by CID from a self-hosted node, which only this machine's
  // index can supply; the default path asks the Space Object API, which works
  // from any logged-in machine.
  const outputPath = path.resolve(opts.output ?? sha256);
  progress(json, `Downloading ${record?.name ?? sha256}…`);
  const fetched = opts.gateway
    ? await requireGatewayRecord(record, sha256, opts.gateway)
    : await downloadDeliverable(sha256, record?.cid, await requireAccessToken());
  const { stored, cid } = fetched;

  // --raw hands over the bytes exactly as pinned: no decryption, no plaintext
  // hash to check, so the result reports both as false.
  if (opts.raw) {
    await fs.writeFile(outputPath, stored);
    return {
      sha256,
      cid,
      path: outputPath,
      size: stored.length,
      verified: false,
      decrypted: false,
    };
  }

  // The protocol's whole point: the onchain hash commits to the work, so the
  // fetched bytes are checked against it before the file is trusted.
  if (deliverableHash(stored) === sha256) {
    await fs.writeFile(outputPath, stored);
    return { sha256, cid, path: outputPath, size: stored.length, verified: true, decrypted: false };
  }

  // A mismatch means the file is encrypted (hash covers the plaintext) or the
  // bytes are wrong; a key settles which.
  const key = opts.key ? parseStorageKey(normalizeKey(opts.key)) : null;
  if (opts.key && key === null)
    throw new CliError("STORAGE_INPUT_INVALID", `${opts.key} is not a 32-byte AES-256 key.`);

  const saved = key ?? parseStorageKey((await readStorageKeys(userId))[sha256] ?? "");
  if (saved === null)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      "The fetched bytes do not match the deliverable hash and no decryption key is available.",
      "If the provider encrypted the file, get the key (`sun storage key <sha256>` on their machine) and re-run with --key. Otherwise the bytes do not match their onchain commitment.",
    );

  const plaintext = decryptBytes(stored, saved);
  if (plaintext === null)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      "Decryption failed: the key does not match this file.",
      "Check the key with `sun storage key <sha256>`.",
    );
  if (deliverableHash(plaintext) !== sha256)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      "The decrypted bytes do not match the deliverable hash.",
    );

  await fs.writeFile(outputPath, plaintext);
  return { sha256, cid, path: outputPath, size: plaintext.length, verified: true, decrypted: true };
}

async function requireGatewayRecord(
  record: UploadRecord | undefined,
  sha256: string,
  gateway: string,
) {
  if (record === undefined)
    throw new CliError(
      "STORAGE_NOT_FOUND",
      `No local record for ${sha256}.`,
      "The --gateway path needs the CID from this machine's index; drop --gateway to fetch through the Space Object API.",
    );

  return { stored: await downloadBytes(record.cid, gateway), cid: record.cid };
}

function normalizeKey(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
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
              `${formatBytes(record.size)}, ${record.uploadedAt.slice(0, 10)}${record.encrypted ? ", encrypted" : ""}`,
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
  description: "Show the saved encryption key for a file uploaded with --encrypt",
  args: {
    sha256: deliverableHashSchema.describe(
      "Deliverable hash of the encrypted file",
    ) as unknown as z.ZodType<`0x${string}`>,
  },
  action: async (args) => {
    const json = isJson(key);

    const result = await readKey(args.sha256).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        fields([
          ["SHA-256", pc.cyan(result.sha256)],
          ["Key", pc.cyan(result.key)],
        ]),
        "",
        pc.dim(
          "This key is the only way to decrypt the file. Hand it to someone to share; lose it and the file stays unreadable.",
        ),
      ].join("\n"),
      result,
    )(json);
  },
});

async function readKey(sha256: string) {
  const userId = await requireUserId();
  const saved = (await readStorageKeys(userId))[sha256];
  if (!saved)
    throw new CliError(
      "STORAGE_KEY_NOT_FOUND",
      "No encryption key saved for this hash.",
      "Keys are machine-local: only files uploaded with --encrypt by this account on this machine have one.",
    );

  return { sha256, key: saved };
}

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
