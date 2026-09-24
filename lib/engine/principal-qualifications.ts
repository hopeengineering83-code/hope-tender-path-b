/**
 * Principal Qualifications — rich per-expert mini-CV blocks for the top
 * proposed experts. Mirrors the benchmark's expert profile depth: name +
 * position + degree + university + year + license + sector experience +
 * proposed role.
 *
 * Used to satisfy the "every proposed expert must show their previous
 * comparable role" benchmark rule when the upstream output has not
 * already produced rich CV blocks (only a basic name list or a thin
 * Proposed Team table).
 *
 * Conditional: only emitted if the upstream output does not already
 * contain a "Principal Qualifications" or "Detailed CVs" heading, AND
 * if at least one reviewed expert exists.
 */

import type { ExpertRecord } from "./benchmark-tables";
import { withoutPersonalCvFields, withoutCvDocumentFurniture, truncateAtWordBoundary } from "./proposal-intelligence";
import { proseProfileOrEmpty } from "./vault-prose";
import { licencesNamedInCv, projectsNamedInCv, softwareNamedInCv } from "./cv-grounding";

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through to delimiter split
    }
  }
  return trimmed.split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean);
}

// The bio text reaches the client verbatim, so it is cut the same way every
// other evidence line is: at a word boundary, with an ellipsis marking the cut.
// A raw .slice() shipped "Name of Firm Hope Urban Planning Architectural and
// Engineering Consultan" in the Principal Qualifications bios of a real
// submitted proposal — the very defect truncateAtWordBoundary was written for,
// on a producer that never adopted it.
function clean(text: string | null | undefined, max = 320): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  return truncateAtWordBoundary(collapsed, max);
}

export function buildPrincipalQualificationsSection(opts: {
  experts: ExpertRecord[];
  topN?: number;
  projects?: Array<{ name?: string | null }>;
}): string | null {
  // Every proposed expert, not the first five: the tender scores the whole
  // team, and three of eight people had no bio at all.
  const top = opts.experts.slice(0, opts.topN ?? 12);
  if (top.length === 0) return null;

  const blocks: string[] = ["## A.4.1 Principal Qualifications — Detailed Bios"];
  // Not "attached as Appendix C": the package carries no CV annex.
  blocks.push("A short profile of each proposed expert, from their own CV. Full curricula vitae, educational certificates and professional licence copies can be provided on request.");

  for (const expert of top) {
    const position = expert.title?.trim() || "Specialist";
    // A stored profile that is the CV's letterhead rather than a biography is
    // not printed. A delivered proposal opened this bio with "HOPE URBAN
    // PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC ENG. AHMED KEBEDE
    // TEKAW General Manager & Practicing Professional Engineer … Languages
    // Amharic (Excellent), English…" — the firm's name twice, the person's name
    // twice, and a cut mid-list.
    const profile = clean(
      proseProfileOrEmpty(withoutCvDocumentFurniture(withoutPersonalCvFields(expert.profile ?? ""))),
      480,
    );

    blocks.push(`### ${expert.fullName} — ${position}`);
    // One paragraph per person. The facts in table form are the PER 02
    // profile cards; this section used to repeat them as a second table, plus
    // "Disciplines" and "Sector Experience" rows filled from firm-wide tags
    // (every CV of one firm carries "Architecture ... Healthcare, Commercial,
    // Hospitality"), which told the evaluator an electrical engineer covered
    // architecture and urban planning.
    blocks.push(`**Profile.** ${profile || composedProfile(expert, position, opts.projects ?? [])}`);
    blocks.push("");
  }

  return blocks.join("\n\n");
}

/**
 * A factual profile built from what the person's own record states: position,
 * years, professional registration, and the software and projects their CV
 * names. It stops when the record stops.
 */
function composedProfile(expert: ExpertRecord, position: string, projects: Array<{ name?: string | null }>): string {
  const stored = safeArr(expert.certifications).filter((c) => c.trim().length > 2 && !/^[-—–]+$/.test(c.trim()));
  const licences = stored.length > 0 ? stored : licencesNamedInCv(expert.profile);
  const software = softwareNamedInCv(expert.profile);
  const named = projectsNamedInCv(expert.profile, projects).map((p) => p.name ?? "").filter(Boolean);
  const sentences = [
    expert.yearsExperience
      ? `${expert.fullName} is proposed as ${position}, with ${expert.yearsExperience} years of professional practice.`
      : `${expert.fullName} is proposed as ${position}.`,
  ];
  if (licences.length > 0) sentences.push(`${stored.length > 0 ? "Qualifications and registration on file" : "Professional registration"}: ${licences.slice(0, 2).join("; ")}.`);
  if (named.length > 0) sentences.push(`Projects named in the CV include ${listPhrase(named.slice(0, 3))}.`);
  if (software.length > 0) sentences.push(`Design tools listed in the CV: ${software.slice(0, 6).join(", ")}.`);
  return sentences.join(" ");
}

function listPhrase(items: string[]): string {
  const shown = items.slice(0, 6);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}
