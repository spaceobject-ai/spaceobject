import { zodCommand } from "zod-commander";
import { CliError } from "../utils/errors.ts";
import { err, isJson } from "../utils/result.ts";

// Registered but unimplemented: 0G Storage was removed and no replacement file
// store is wired up yet. Keeping the command means `sun storage` still resolves
// and shows up in help rather than failing as an unknown command.
export const storage = zodCommand({
  name: "storage",
  description: "Store and retrieve files",
  action: () => {
    const result = new CliError(
      "NOT_IMPLEMENTED",
      "File storage is not implemented yet.",
      "Host the deliverable anywhere reachable and pass its 32-byte hash to `sun agent job deliver`.",
    );
    err(result)(isJson(storage));
  },
});
