export type JsonFoldSummary =
  | { type: "array"; count: number }
  | { type: "lines"; count: number };

export type JsonFoldRange = { from: number; to: number };

type OpeningDelimiter = {
  character: "{" | "[";
  position: number;
  lineStart: number;
};

export function buildJsonFoldIndex(documentText: string): ReadonlyMap<number, JsonFoldRange> {
  const foldRanges = new Map<number, JsonFoldRange>();
  const openingDelimiters: OpeningDelimiter[] = [];
  let lineStart = 0;
  let insideString = false;
  let escaped = false;

  for (let position = 0; position < documentText.length; position += 1) {
    const character = documentText[position];

    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }

    if (character === '"') {
      insideString = true;
    } else if (character === "{" || character === "[") {
      openingDelimiters.push({ character, position, lineStart });
    } else if (character === "}" || character === "]") {
      const openingDelimiter = openingDelimiters[openingDelimiters.length - 1];
      const isMatchingPair = openingDelimiter
        && ((openingDelimiter.character === "{" && character === "}")
          || (openingDelimiter.character === "[" && character === "]"));

      if (openingDelimiter && isMatchingPair) {
        openingDelimiters.pop();
        if (openingDelimiter.lineStart < lineStart && !foldRanges.has(openingDelimiter.lineStart)) {
          foldRanges.set(openingDelimiter.lineStart, {
            from: openingDelimiter.position + 1,
            to: position,
          });
        }
      }
    }

    if (character === "\n") {
      lineStart = position + 1;
    }
  }

  return foldRanges;
}

function countHiddenLines(content: string) {
  return Math.max(1, content.split("\n").length - 1);
}

export function getJsonFoldSummary(documentText: string, from: number, to: number): JsonFoldSummary {
  const foldedContent = documentText.slice(from, to);
  const contentBeforeFold = documentText.slice(0, from).trimEnd();
  const contentAfterFold = documentText.slice(to).trimStart();
  const isArrayFold = contentBeforeFold.endsWith("[") && contentAfterFold.startsWith("]");

  if (isArrayFold) {
    try {
      const arrayValue: unknown = JSON.parse(`[${foldedContent}]`);
      if (Array.isArray(arrayValue)) {
        const objectCount = arrayValue.filter((item) => (
          typeof item === "object" && item !== null && !Array.isArray(item)
        )).length;
        return { type: "array", count: objectCount };
      }
    } catch {
      return { type: "lines", count: countHiddenLines(foldedContent) };
    }
  }

  return { type: "lines", count: countHiddenLines(foldedContent) };
}
