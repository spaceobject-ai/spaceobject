import { deletePassword, getPassword, setPassword } from "cross-keychain";
import { z } from "zod";
import { readConfig, writeConfig } from "./config.ts";
import { decodeAccessTokenClaims } from "./jwt.ts";
import { refreshTokens, type Tokens } from "./privy.ts";

// cross-keychain picks the best backend automatically: native OS keychain
// first, encrypted file as a fallback. Entries are keyed per authenticated
// Privy user as `account-{userId}`; the active one lives in
// ~/.spaceobject/sun/config.json.
const SERVICE = "spaceobject-sun";

const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export function toCredentials(tokens: Tokens): Credentials {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  const account = `account-${decodeAccessTokenClaims(credentials.accessToken).sub}`;
  await setPassword(SERVICE, account, JSON.stringify(credentials));
  await writeConfig({ ...(await readConfig()), activeAccount: account });
}

export async function loadCredentials(): Promise<Credentials | null> {
  const config = await readConfig();
  if (!config.activeAccount) return null;

  const raw = await getPassword(SERVICE, config.activeAccount).catch(() => null);
  if (!raw) return null;

  return Promise.resolve(raw)
    .then((value) => credentialsSchema.parse(JSON.parse(value)))
    .catch(() => null);
}

export async function clearCredentials(): Promise<void> {
  const config = await readConfig();
  if (!config.activeAccount) return;

  await deletePassword(SERVICE, config.activeAccount).catch(() => {});
  await writeConfig({ ...config, activeAccount: undefined });
}

// Refresh tokens rotate on every use, so the refreshed pair must be saved
// before the access token is handed out.
export async function getValidAccessToken(): Promise<string | null> {
  const credentials = await loadCredentials();
  if (!credentials) return null;
  if (Date.now() < credentials.expiresAt - 60_000) return credentials.accessToken;

  const tokens = await refreshTokens(credentials.refreshToken).catch(() => null);
  if (!tokens) return null;

  const next = toCredentials(tokens);
  await saveCredentials(next);
  return next.accessToken;
}
