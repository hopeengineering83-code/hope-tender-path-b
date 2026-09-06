/**
 * Post-generation enforcer of the benchmark "narrative throughline" rule:
 * the same 1–2 strongest project names MUST appear in the Cover Letter,
 * the Executive Summary, AND in Section B (Relevant Experience).
 *
 * Detection is forgiving — matches by normalised project name (lowercase,
 * non-alphanumerics collapsed), so that "G+6 Hospital" matches
 * "G+6 General Hospital" and "Hospital, G+6" indifferently.
 *
 * When a section is missing the throughline, the enforcer appends a single
 * compact "Comparable Reference Anchor" sentence at the end of the section
 * that names the missing project(s). It does NOT rewrite or remove existing
 * content — purely additive, idempotent.
 */

import type { ProjectRecord } from "./benchmark-tables";
import { inlineEvidenceValue } from "./proposal-intelligence";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function projectMentioned(text: string, project: ProjectRecord): boolean {
  const haystack = normalize(text);
  const needle = normalize(project.name);
  if (!needle || needle.length < 4) return false;
  // Match the full normalised name.
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(" ").filter((t) => t.length > 2);
  // Match leading 3 distinctive tokens as a phrase.
  if (tokens.length >= 3) {
    const distinctive = tokens.slice(0, 3).join(" ");
    if (haystack.includes(distinctive)) return true;
  }
  // Match by token set: any 2+ distinctive tokens present covers abbreviated mentions
  // (e.g., "Addis Water Scheme" matches "Addis Ababa Water Supply Scheme").
  if (tokens.length >= 2) {
    const matchCount = tokens.filter((t) => haystack.includes(t)).length;
    if (matchCount >= Math.min(2, tokens.length)) return true;
  }
  return false;
}

type SectionMatcher = { label: string; headingPatterns: RegExp[] };

const TARGET_SECTIONS: SectionMatcher[] = [
  { label: "Cover Letter", headingPatterns: [/^cover letter$/i, /^cover letter[\s:—\-]/i] },
  { label: "Executive Summary", headingPatterns: [/^executive summary$/i, /^executive summary[\s—:-]/i] },
  {
    label: "Section B / Relevant Experience",
    headingPatterns: [
      /^section b/i,
      /^b\.\s/i,
      /^b\d/i,
      /^relevant experience$/i,
      /^project portfolio$/i,
      /^client references$/i,
    ],
  },
];

type Section = { headingLine: number; nextHeadingLine: number; label: string; matcher: SectionMatcher };

function locateSections(lines: string[]): Section[] {
  const headingIdxs: Array<{ index: number; line: string }> = [];
  lines.forEach((line, idx) => {
    if (/^#{1,4}\s+/.test(line)) headingIdxs.push({ index: idx, line: line.replace(/^#+\s*/, "").trim() });
  });

  const found: Section[] = [];
  for (const matcher of TARGET_SECTIONS) {
    const hit = headingIdxs.find((h) => matcher.headingPatterns.some((p) => p.test(h.line)));
    if (!hit) continue;
    const after = headingIdxs.find((h) => h.index > hit.index);
    found.push({
      headingLine: hit.index,
      nextHeadingLine: after?.index ?? lines.length,
      label: matcher.label,
      matcher,
    });
  }
  return found;
}

export function enforceNarrativeThroughline(opts: {
  markdown: string;
  topProjects: ProjectRecord[];
}): { markdown: string; injected: { section: string; project: string }[] } {
  const top = opts.topProjects.slice(0, 3).filter((p) => p.name && p.name.trim().length >= 4);
  if (top.length === 0) return { markdown: opts.markdown, injected: [] };

  const lines = opts.markdown.split("\n");
  const sections = locateSections(lines);
  const injections: { sectionIdx: number; insertAfter: number; sentence: string; section: string; project: string }[] = [];

  for (const section of sections) {
    const sectionText = lines.slice(section.headingLine + 1, section.nextHeadingLine).join("\n");
    for (const project of top) {
      if (projectMentioned(sectionText, project)) continue;
      // Project not mentioned in this section — schedule an anchor sentence.
      // Vault values keep their own punctuation and must not be rewritten on
      // the record — they are hashed against their source provenance. Trim for
      // display only, so a client stored as "… Amhara Region," does not render
      // as "(… Amhara Region,)".
      const clientLabel = inlineEvidenceValue(project.clientName);
      const value = project.contractValue
        ? ` (${project.currency || "ETB"} ${Math.round(project.contractValue).toLocaleString("en-US")}${clientLabel ? `, ${clientLabel}` : ""})`
        : clientLabel ? ` (${clientLabel})` : "";
      const sentence = `_Relevant reference anchor:_ ${project.name}${value} is a reviewed project record whose applicable lessons inform this engagement.`;
      injections.push({
        sectionIdx: section.headingLine,
        insertAfter: section.nextHeadingLine - 1,
        sentence,
        section: section.label,
        project: project.name,
      });
    }
  }

  if (injections.length === 0) return { markdown: opts.markdown, injected: [] };

  // Insert in reverse order so earlier indices stay stable.
  injections.sort((a, b) => b.insertAfter - a.insertAfter);
  const out = [...lines];
  for (const inj of injections) {
    out.splice(inj.insertAfter + 1, 0, "", inj.sentence);
  }

  return {
    markdown: out.join("\n"),
    injected: injections.map((i) => ({ section: i.section, project: i.project })),
  };
}
