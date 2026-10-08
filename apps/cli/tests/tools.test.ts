import { expect, test } from "vite-plus/test";
import { displayUsd } from "../src/lib/tool.ts";

// The catalog's minimum: a run quoted under $0.01 is billed — and shown — at
// the floor.
test("prices under the $0.01 minimum are shown at the floor", () => {
  expect(displayUsd(0.003)).toBe("$0.01");
});

test("prices at or above the floor pass through unchanged", () => {
  expect(displayUsd(0.03)).toBe("$0.03");
});
