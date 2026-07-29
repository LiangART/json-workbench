import { describe, expect, it } from "vitest";
import {
  escapeJsonString,
  formatJson,
  getJsonStats,
  minifyAndEscapeJson,
  minifyJson,
  parseJson,
  queryJsonPath,
  sortJsonKeys,
  unescapeJsonString,
  unicodeEscape,
  unicodeUnescape,
} from "./jsonTools";

const input = '{"users":[{"name":"张三","age":20},{"name":"李四","age":30}],"active":true}';

describe("JSON formatting", () => {
  it("formats and minifies valid JSON", () => {
    expect(formatJson('{"name":"张三"}', 2)).toBe('{\n  "name": "张三"\n}');
    expect(minifyJson(' { "name": "张三" } ')).toBe('{"name":"张三"}');
  });

  it("reports invalid JSON", () => {
    const parsed = parseJson('{"name":}');
    expect(parsed.ok).toBe(false);
    expect(() => formatJson('{"name":}')).toThrow();
  });

  it("sorts object keys recursively while preserving arrays", () => {
    expect(sortJsonKeys('{"z":{"b":2,"a":1},"a":[{"d":4,"c":3}]}')).toBe(
      '{\n  "a": [\n    {\n      "c": 3,\n      "d": 4\n    }\n  ],\n  "z": {\n    "a": 1,\n    "b": 2\n  }\n}',
    );
  });
});

describe("JSONPath", () => {
  it("queries matching values", () => {
    expect(queryJsonPath(input, "$.users[*].name")).toEqual(["张三", "李四"]);
  });

  it("rejects an empty expression", () => {
    expect(() => queryJsonPath(input, " ")).toThrow("请输入 JSONPath 表达式");
  });
});

describe("escaping", () => {
  it("escapes and unescapes JSON strings", () => {
    const escaped = escapeJsonString('{"name":"张三"}');
    expect(escaped).toBe('"{\\"name\\":\\"张三\\"}"');
    expect(unescapeJsonString(escaped)).toBe('{"name":"张三"}');
  });

  it("minifies before escaping complete JSON", () => {
    expect(minifyAndEscapeJson('{\n  "name": "张三"\n}')).toBe('"{\\"name\\":\\"张三\\"}"');
  });

  it("escapes and unescapes Unicode code units", () => {
    expect(unicodeEscape("中文😀")).toBe("\\u4e2d\\u6587\\ud83d\\ude00");
    expect(unicodeUnescape("\\u4e2d\\u6587\\ud83d\\ude00")).toBe("中文😀");
  });
});

describe("statistics", () => {
  it("counts lines, characters and bytes", () => {
    expect(getJsonStats("中\na")).toEqual({ lines: 2, characters: 3, bytesLabel: "5 B" });
  });
});
