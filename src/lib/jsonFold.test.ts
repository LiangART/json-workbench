import { describe, expect, it } from "vitest";
import { getJsonFoldSummary } from "./jsonFold";

function getFoldRange(input: string, openingDelimiter: string, closingDelimiter: string) {
  return {
    from: input.indexOf(openingDelimiter) + openingDelimiter.length,
    to: input.lastIndexOf(closingDelimiter),
  };
}

describe("JSON fold summaries", () => {
  it("counts direct objects inside a folded array", () => {
    const input = '[\n  {"id": 1},\n  {"id": 2}\n]';
    const range = getFoldRange(input, "[", "]");

    expect(getJsonFoldSummary(input, range.from, range.to)).toEqual({ type: "array", count: 2 });
  });

  it("does not count primitive values, null or nested arrays as objects", () => {
    const input = '[{"id":1}, 2, null, [3]]';
    const range = getFoldRange(input, "[", "]");

    expect(getJsonFoldSummary(input, range.from, range.to)).toEqual({ type: "array", count: 1 });
  });

  it("keeps line counts for object folds and invalid arrays", () => {
    const objectInput = '{\n  "id": 1,\n  "name": "JSON"\n}';
    const objectRange = getFoldRange(objectInput, "{", "}");
    const invalidArray = '[\n  {"id": 1},\n  invalid\n]';
    const invalidRange = getFoldRange(invalidArray, "[", "]");

    expect(getJsonFoldSummary(objectInput, objectRange.from, objectRange.to)).toEqual({ type: "lines", count: 3 });
    expect(getJsonFoldSummary(invalidArray, invalidRange.from, invalidRange.to)).toEqual({ type: "lines", count: 3 });
  });
});
