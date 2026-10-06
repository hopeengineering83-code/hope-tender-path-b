/**
 * A lettered sub-section needs its section.
 *
 * The writer is asked for "# Section A: Company Profile" and "# Section B:
 * Relevant Experience" as two top-level headings. On 2026-10-06 a model wrote
 * "## B.1 Client References" and "## B.2 Project Portfolio" with no Section B
 * heading, so every later pass treated them as part of Section A: the
 * mobilisation plan and organogram were placed after the project portfolio,
 * and the delivered contents page had no Section B.
 *
 * When a sub-section numbered for a section (B.1, C.4 …) appears and the
 * document has no top-level heading for that section, the section's heading
 * is restored immediately before its first sub-section. Nothing is moved or
 * removed, and a document that has the heading is returned unchanged.
 */
const SECTION_TITLES: Record<string, string> = {
  A: "Company Profile",
  B: "Relevant Experience",
  C: "Technical Approach",
  D: "Additional Information",
};

export interface RestoredSectionHeadings {
  readonly markdown: string;
  readonly restored: readonly string[];
}

export function restoreMissingSectionHeadings(markdown: string): RestoredSectionHeadings {
  const lines = markdown.split("\n");
  const restored: string[] = [];
  for (const letter of Object.keys(SECTION_TITLES)) {
    const hasSection = lines.some((line) => new RegExp(`^#\\s+(?:section\\s+)?${letter}\\b[\\s:.—–-]`, "i").test(line));
    if (hasSection) continue;
    const first = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${letter}\\.\\d+\\b`).test(line));
    if (first < 0) continue;
    const heading = `# Section ${letter}: ${SECTION_TITLES[letter]}`;
    lines.splice(first, 0, heading, "");
    restored.push(heading.slice(2));
  }
  return { markdown: restored.length > 0 ? lines.join("\n") : markdown, restored };
}
