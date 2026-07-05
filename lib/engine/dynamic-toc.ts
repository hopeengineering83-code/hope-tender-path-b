/**
 * Dynamic Table of Contents builder.
 *
 * After all enrichers and the section reorderer have run, the markdown
 * contains the final list of sections in canonical order. The hand-written
 * static TOC at the top of the fallback proposal lists a generic structure
 * that may not match what actually ended up in the document. This module
 * scans the assembled markdown and produces a TOC that reflects what's
 * actually present, then either replaces the existing TOC section or
 * inserts a new one after the Cover Page.
 *
 * Headings rendered: # (top-level) and ## (second-level). ### is omitted
 * from the TOC — too granular for a 30+ section proposal.
 *
 * The TOC entries deliberately do NOT carry page numbers — those depend
 * on DOCX rendering and are added by Word's TOC field at print time. The
 * markdown TOC is a navigational aid for the reader.
 */

type TocEntry = { level: number; title: string };

function extractEntries(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{1,2})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].replace(/\s+/g, " ").trim();
    // Exclude the Table of Contents itself.
    if (/^table of contents$/i.test(title)) continue;
    // Exclude trailing empty / artifact-only headings.
    if (title.length < 3) continue;
    entries.push({ level, title });
  }
  return entries;
}

function formatToc(entries: TocEntry[]): string {
  const lines = ["# Table of Contents"];
  let topIndex = 0;
  let lastLevel1: TocEntry | null = null;
  for (const entry of entries) {
    if (entry.level === 1) {
      topIndex++;
      lines.push(`${topIndex}. **${entry.title}**`);
      lastLevel1 = entry;
    } else if (entry.level === 2 && lastLevel1) {
      lines.push(`    - ${entry.title}`);
    }
  }
  return lines.join("\n");
}

/**
 * Replace the existing "# Table of Contents" section in the markdown with
 * one that reflects the actual sections present. Or, if no TOC heading
 * exists, insert one after the Cover Page (before Executive Summary).
 */
export function renderDynamicTableOfContents(markdown: string): string {
  const entries = extractEntries(markdown);
  if (entries.length === 0) return markdown;

  const newToc = formatToc(entries);

  // Try to replace an existing TOC block.
  const tocStart = markdown.search(/^#\s+Table of Contents$/im);
  if (tocStart >= 0) {
    // Find the end of this TOC section (start of next # or end of file).
    const after = markdown.slice(tocStart + 1);
    const nextHeadingMatch = after.match(/^#\s+/m);
    const tocEnd = nextHeadingMatch ? tocStart + 1 + (nextHeadingMatch.index ?? after.length) : markdown.length;
    return markdown.slice(0, tocStart) + newToc + "\n\n" + markdown.slice(tocEnd);
  }

  // No TOC — try to insert after the Cover Page (which on the fallback path
  // is the "# Technical Proposal" heading), or after Cover Letter if no
  // Cover Page heading exists.
  const coverPageMatch = markdown.match(/^#\s+Technical Proposal\s*$/im);
  if (coverPageMatch && coverPageMatch.index !== undefined) {
    // Find the end of this section.
    const cpStart = coverPageMatch.index;
    const after = markdown.slice(cpStart + (coverPageMatch[0]?.length ?? 0));
    const nextHeadingMatch = after.match(/^#\s+/m);
    const insertAt = nextHeadingMatch
      ? cpStart + (coverPageMatch[0]?.length ?? 0) + (nextHeadingMatch.index ?? 0)
      : markdown.length;
    return markdown.slice(0, insertAt) + newToc + "\n\n" + markdown.slice(insertAt);
  }

  // Last fallback: insert at the very top.
  return `${newToc}\n\n${markdown}`;
}
