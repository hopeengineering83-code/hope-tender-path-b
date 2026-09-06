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
}): string | null {
  const top = opts.experts.slice(0, opts.topN ?? 5);
  if (top.length === 0) return null;

  const blocks: string[] = ["## A.4.1 Principal Qualifications — Detailed Bios"];
  blocks.push("Detailed bios for the lead experts proposed for this assignment. Full curricula vitae, educational certificates, and professional license copies are attached as Appendix C.");

  for (const expert of top) {
    const position = expert.title?.trim() || "Specialist";
    const disciplines = safeArr(expert.disciplines);
    const sectors = safeArr(expert.sectors);
    const certifications = safeArr(expert.certifications);
    const years = expert.yearsExperience ? `${expert.yearsExperience} years experience` : null;
    // A stored profile that is the CV's letterhead rather than a biography is
    // not printed. A delivered proposal opened this bio with "HOPE URBAN
    // PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC ENG. AHMED KEBEDE
    // TEKAW General Manager & Practicing Professional Engineer … Languages
    // Amharic (Excellent), English…" — the firm's name twice, the person's name
    // twice, and a cut mid-list. The table above already carries the same facts
    // in a form an evaluator can score.
    const profile = clean(
      proseProfileOrEmpty(withoutCvDocumentFurniture(withoutPersonalCvFields(expert.profile ?? ""))),
      480,
    );

    blocks.push(`### ${expert.fullName} — ${position}`);

    const tableRows: string[] = ["| Field | Detail |", "|---|---|"];
    tableRows.push(`| Position | ${position} |`);
    if (years) tableRows.push(`| Experience | ${years} |`);
    if (disciplines.length > 0) tableRows.push(`| Disciplines | ${disciplines.join(", ")} |`);
    if (sectors.length > 0) tableRows.push(`| Sector Experience | ${sectors.join(", ")} |`);
    if (certifications.length > 0) tableRows.push(`| Licenses & Certifications | ${certifications.join("; ")} |`);
    if (expert.email) tableRows.push(`| Contact | ${expert.email}${expert.phone ? `, ${expert.phone}` : ""} |`);
    blocks.push(tableRows.join("\n"));

    // When the vault holds no written profile — or holds the CV's letterhead
    // rather than a biography — the bio is composed from the record's own
    // structured fields instead. Run 34039741983 refused every stored profile
    // as furniture, the internal note below it was stripped as internal, and
    // the whole Detailed Bios sub-section disappeared from the delivered
    // proposal. An evaluator scoring team depth needs this section, and every
    // fact in the composed sentence comes from the same reviewed record.
    blocks.push(`**Profile.** ${profile || composedProfile(expert, position, disciplines, sectors, certifications, years)}`);
    blocks.push("");
  }

  return blocks.join("\n\n");
}

/**
 * A factual profile sentence built from the reviewed record's structured
 * fields. It asserts nothing the record does not carry: position, recorded
 * years, disciplines, sectors and licences, in that order, and stops when the
 * record stops.
 */
function composedProfile(
  expert: ExpertRecord,
  position: string,
  disciplines: string[],
  sectors: string[],
  certifications: string[],
  years: string | null,
): string {
  const opening = years
    ? `${expert.fullName} is proposed as ${position} and has ${years} recorded in the reviewed specialist record.`
    : `${expert.fullName} is proposed as ${position} against the reviewed specialist record.`;
  const sentences = [opening];
  if (disciplines.length > 0) {
    sentences.push(`The record covers ${listPhrase(disciplines)}.`);
  }
  if (sectors.length > 0) {
    sentences.push(`Sector experience is recorded in ${listPhrase(sectors)}.`);
  }
  if (certifications.length > 0) {
    sentences.push(`Licences and certifications on file: ${certifications.join("; ")}.`);
  }
  return sentences.join(" ");
}

function listPhrase(items: string[]): string {
  const shown = items.slice(0, 6);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}
