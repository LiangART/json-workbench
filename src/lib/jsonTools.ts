import { JSONPath } from "jsonpath-plus";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const jsonIndentSize = 4;

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { message: string; line?: number; column?: number } };

export function parseJson(input: string): JsonParseResult {
  if (!input.trim()) {
    return { ok: false, error: { message: "请输入 JSON" } };
  }

  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : "JSON 解析失败";
    const lineColumnMatch = originalMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    const positionMatch = originalMessage.match(/position\s+(\d+)/i);
    let line = lineColumnMatch ? Number(lineColumnMatch[1]) : undefined;
    let column = lineColumnMatch ? Number(lineColumnMatch[2]) : undefined;

    if (positionMatch && line === undefined) {
      const position = Number(positionMatch[1]);
      const prefix = input.slice(0, position);
      const lines = prefix.split("\n");
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }

    const location = line && column ? `第 ${line} 行，第 ${column} 列` : originalMessage;
    return { ok: false, error: { message: location, line, column } };
  }
}

function requireParsedJson(input: string): JsonValue {
  const parsed = parseJson(input);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value as JsonValue;
}

export function formatJson(input: string): string {
  return JSON.stringify(requireParsedJson(input), null, jsonIndentSize);
}

export function minifyJson(input: string): string {
  return JSON.stringify(requireParsedJson(input));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, childValue]) => [key, sortValue(childValue)]),
    );
  }
  return value;
}

export function sortJsonKeys(input: string): string {
  return JSON.stringify(sortValue(requireParsedJson(input)), null, jsonIndentSize);
}

export function queryJsonPath(input: string, path: string): unknown[] {
  if (!path.trim()) {
    throw new Error("请输入 JSONPath 表达式");
  }
  return JSONPath<unknown[]>({ path, json: requireParsedJson(input), wrap: true });
}

export function escapeJsonString(input: string): string {
  return JSON.stringify(input);
}

export function unescapeJsonString(input: string): string {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("请输入带双引号的有效 JSON 字符串");
  }
  if (typeof value !== "string") {
    throw new Error("输入内容不是 JSON 字符串");
  }
  return value;
}

export function minifyAndEscapeJson(input: string): string {
  return JSON.stringify(minifyJson(input));
}

export function unicodeEscape(input: string): string {
  return input.replace(/[^\x00-\x7f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function unicodeUnescape(input: string): string {
  return input.replace(/\\u([0-9a-f]{4})/gi, (_, hexadecimal: string) => String.fromCharCode(Number.parseInt(hexadecimal, 16)));
}

export function getJsonStats(input: string): { lines: number; characters: number; bytesLabel: string } {
  const bytes = new TextEncoder().encode(input).length;
  const bytesLabel = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return {
    lines: input ? input.split("\n").length : 0,
    characters: input.length,
    bytesLabel,
  };
}
