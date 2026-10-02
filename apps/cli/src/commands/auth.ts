import pc from "picocolors";
import { renderUnicodeCompact } from "uqr";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { openBrowser } from "../lib/browser.ts";
import {
  clearCredentials,
  getValidAccessToken,
  saveCredentials,
  toCredentials,
} from "../lib/credentials.ts";
import { decodeAccessTokenClaims } from "../lib/jwt.ts";
import {
  completeDeviceAuthorization,
  pollForTokens,
  requestDeviceAuthorization,
} from "../lib/privy.ts";
import { CliError } from "../utils/errors.ts";
import { err, fields, isJson, ok, success } from "../utils/result.ts";

const login = zodCommand({
  name: "login",
  description: "Authorize this machine through your browser",
  opts: {
    start: z
      .boolean()
      .prefault(false)
      .describe("Print the verification link, QR code and request id, then exit without waiting"),
    complete: z
      .string()
      .optional()
      .describe("Finish a login started with --start using its request id"),
  },
  action: async (_args, opts) => {
    const json = isJson(login);
    if (opts.start && opts.complete)
      return err(
        new CliError(
          "FLAG_CONFLICT",
          "--start and --complete cannot be used together.",
          "Run `sun auth login --start` first, then `sun auth login --complete <request_id>`.",
        ),
      )(json);

    if (opts.complete) {
      const tokens = await completeDeviceAuthorization(opts.complete).catch(
        (error: Error) => error,
      );
      if (tokens instanceof Error) return err(tokens)(json);

      const saveErr = await saveCredentials(toCredentials(tokens)).catch((error: Error) => error);
      if (saveErr instanceof Error) return err(saveErr)(json);
      return ok(success("Logged in"), { message: "Logged in" })(json);
    }

    const device = await requestDeviceAuthorization().catch((error: Error) => error);
    if (device instanceof Error) return err(device)(json);

    if (opts.start) {
      const stdout = [
        renderUnicodeCompact(device.verification_uri_complete),
        "",
        fields([
          ["Visit", pc.cyan(device.verification_uri_complete)],
          ["Code", pc.bold(device.user_code)],
        ]),
        "",
        pc.dim(
          `After approving, run: ${pc.bold(`sun auth login --complete ${device.device_code}`)}`,
        ),
        pc.dim(`Expires in ${Math.round(device.expires_in / 60)} minutes.`),
      ].join("\n");

      return ok(stdout, {
        verification_uri: device.verification_uri_complete,
        user_code: device.user_code,
        request_id: device.device_code,
        expires_in: device.expires_in,
      })(json);
    }

    // Keep stdout clean for JSON output; progress goes to stderr.
    const print = json ? console.error : console.log;
    print(
      fields([
        ["Visit", pc.cyan(device.verification_uri_complete)],
        ["Code", pc.bold(device.user_code)],
      ]),
    );
    print("");
    print(pc.dim("Waiting for authorization in the browser…"));
    openBrowser(device.verification_uri_complete);

    const tokens = await pollForTokens(device.device_code, device.interval).catch(
      (error: Error) => error,
    );
    if (tokens instanceof Error) return err(tokens)(json);

    const saveErr = await saveCredentials(toCredentials(tokens)).catch((error: Error) => error);
    if (saveErr instanceof Error) return err(saveErr)(json);
    ok(success("Logged in"), { message: "Logged in" })(json);
  },
});

const logout = zodCommand({
  name: "logout",
  description: "Remove stored credentials from this machine",
  action: async () => {
    await clearCredentials();
    ok(success("Logged out"), { message: "Logged out" })(isJson(logout));
  },
});

const whoami = zodCommand({
  name: "whoami",
  description: "Show the authenticated account",
  action: async () => {
    const json = isJson(whoami);

    const accessToken = await getValidAccessToken();
    if (!accessToken)
      return err(new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `sun auth login`."))(json);

    const claims = decodeAccessTokenClaims(accessToken);
    ok(fields([["User ID", pc.cyan(claims.sub)]]), { user_id: claims.sub })(json);
  },
});

export const auth = zodCommand({
  name: "auth",
  description: "Authenticate Space Object ACP",
})
  .addCommand(login)
  .addCommand(logout)
  .addCommand(whoami);
