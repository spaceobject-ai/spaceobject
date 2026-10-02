import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };

export function createProgram() {
  return (
    new Command()
      .name("sun")
      .description(pkg.description)
      .version(pkg.version)
      // Options after a subcommand belong to the subcommand: without this the
      // root --version would swallow `agent service add --version <version>`.
      .enablePositionalOptions()
  );
}
