function normalizeHeading(line: string): string | null {
  const match = line.match(/^#{1,6}\s+(.+)$/);
  if (!match) return null;
  return match[1].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

export function removeEmptyDuplicateHeadings(markdown: string): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const output: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeHeading(line.trim());
    if (!normalized) {
      output.push(line);
      continue;
    }

    const nextMeaningful = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0);
    const duplicate = seen.has(normalized);
    const emptyOrImmediateHeading = !nextMeaningful || isHeading(nextMeaningful);

    if (duplicate && emptyOrImmediateHeading) continue;

    seen.add(normalized);
    output.push(line);
  }

  return output.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
