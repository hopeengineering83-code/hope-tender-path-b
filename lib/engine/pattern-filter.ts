import { AI_TRACE_PATTERNS, DOCUMENT_PLACEHOLDER_PATTERNS } from "./detection-patterns";

/**
 * Filter lines to remove AI traces, placeholders, and typical noise.
 * Used by multiple generation and evaluation modules.
 */
export function filterCleanLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const isAiTrace = AI_TRACE_PATTERNS.some((rx) => rx.test(line));
    const isPlaceholder = DOCUMENT_PLACEHOLDER_PATTERNS.some((rx) => rx.test(line));
    const isNoise = /lorem ipsum|sample text|parsed text for page/i.test(line);
    return !isAiTrace && !isPlaceholder && !isNoise;
  });
}
