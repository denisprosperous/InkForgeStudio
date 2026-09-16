import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, parseJsonResponse } from "../src/json";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in a fenced code block", () => {
    const text = 'Here you go:\n```json\n{"title": "The Forge"}\n```\nHope that helps.';
    expect(extractJson(text)).toEqual({ title: "The Forge" });
  });

  it("parses JSON embedded in prose", () => {
    const text = 'Sure! The result is {"ok": true, "items": [1, 2]} as requested.';
    expect(extractJson(text)).toEqual({ ok: true, items: [1, 2] });
  });

  it("keeps braces inside string values balanced", () => {
    const text = '{"text": "a } brace", "n": 2}';
    expect(extractJson(text)).toEqual({ text: "a } brace", n: 2 });
  });

  it("parses top-level arrays", () => {
    expect(extractJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("throws when no payload exists", () => {
    expect(() => extractJson("no json here")).toThrow(/no parsable JSON/i);
  });
});

describe("parseJsonResponse", () => {
  const schema = z.object({
    chapters: z.array(z.object({ idx: z.number(), title: z.string() })).min(1),
  });

  it("validates a well-formed payload against the schema", () => {
    const parsed = parseJsonResponse(
      "openai",
      '```json\n{"chapters":[{"idx":0,"title":"The Call"}]}\n```',
      schema,
    );
    expect(parsed.chapters[0]?.title).toBe("The Call");
  });

  it("converts schema mismatches into a ProviderError with the failing path", () => {
    expect(() => parseJsonResponse("gemini", '{"chapters":[]}', schema)).toThrowError(/chapters/i);
  });

  it("converts unparsable output into a ProviderError", () => {
    expect(() => parseJsonResponse("deepseek", "the model rambled", schema)).toThrowError(
      /no parsable JSON/i,
    );
  });
});
