import { expect, test } from "vite-plus/test";
import pkg from "../package.json" with { type: "json" };
import { createProgram } from "../src/index.ts";

async function runProgram(args: string[]) {
  let output = "";
  const program = createProgram().exitOverride();
  program.configureOutput({
    writeOut: (text) => {
      output += text;
    },
  });
  const error = await program.parseAsync(args, { from: "user" }).catch((cause: Error) => cause);
  return { output, error };
}

test("prints the package version", async () => {
  const result = await runProgram(["--version"]);
  expect(result.output.trim()).toBe(pkg.version);
});

test("prints usage in help", async () => {
  const result = await runProgram(["--help"]);
  expect(result.output).toContain("Usage: sun");
  expect(result.output).toContain(pkg.description.slice(0, 20));
});
