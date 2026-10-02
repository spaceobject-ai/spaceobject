import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// ~/.spaceobject/sun/config.json tracks which keychain account is active, so
// the CLI knows who is logged in without probing the keychain.
const CONFIG_DIR = path.join(os.homedir(), ".spaceobject", "sun");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const configSchema = z.object({
  activeAccount: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export async function readConfig(): Promise<Config> {
  return fs
    .readFile(CONFIG_PATH, "utf8")
    .then((raw) => configSchema.parse(JSON.parse(raw)))
    .catch(() => ({}));
}

export async function writeConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}
