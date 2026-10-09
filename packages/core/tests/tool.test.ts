import { expect, test } from "vite-plus/test";
import { toolCallResultSchema, toolSchema } from "../src/tool.ts";

test("a tool call result discriminates on success", () => {
  const settled = toolCallResultSchema.parse({ success: true, data: { tweets: [] } });
  const refused = toolCallResultSchema.parse({
    success: false,
    error: "The provider answered HTTP 429.",
  });

  expect(settled.success).toBe(true);
  expect(refused.success).toBe(false);
});

test("a result without the success discriminant is rejected", () => {
  expect(toolCallResultSchema.safeParse({ data: "orphan payload" }).success).toBe(false);
  expect(toolCallResultSchema.safeParse({ success: "maybe" }).success).toBe(false);
});

test("tools carry a plain per-call USD price", () => {
  const listed = toolSchema.safeParse({
    id: "pdl/person/enrich",
    description: "Enrich a person by email",
    score: 0.9,
    price: 0.01,
    input: null,
  });

  expect(listed.success).toBe(true);
  expect(
    toolSchema.safeParse({
      id: "pdl/person/enrich",
      description: "Enrich a person by email",
      score: 0.9,
      price: { type: "PER_CALL", amount: { value: 0.01, currency: "USD" } },
      input: null,
    }).success,
  ).toBe(false);
});
