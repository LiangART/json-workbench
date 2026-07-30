export type JsonFoldSummary =
  | { type: "array"; count: number }
  | { type: "lines"; count: number };

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
