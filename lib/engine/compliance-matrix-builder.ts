/**
 * Deterministic Compliance Matrix builder (Section E).
 *
 * The AI prompt (PR #228) asks Claude to produce a Section E Compliance
 * Matrix as a Markdown table mapping every mandatory and scored
 * requirement to:
 *   - the proposal section that addresses it,
 *   - the supporting evidence anchor,
 *   - a compliance status (FULLY MET / PARTIALLY MET / NOT MET),
 *   - and a mitigation plan when NOT MET.
 *
 * This module is the deterministic builder for that table. It runs as a
 * post-AI enricher: if the AI did not produce a Section E Compliance
 * Matrix heading, we append one built from the actual database state —
 * tender.requirements + tender.complianceMatrix + tender.complianceGaps.
 *
 * Why a deterministic builder?
 *   1. The AI may omit Section E when its output token budget is tight.
 *   2. The Compliance Matrix is the single most-evaluated section on
 *      most regulated tenders. Missing it costs points across every
 *      criterion.
 *   3. The data needed to build it (requirements + evidence + gaps) is
 *      already in the database from the intake stage.
 *   4. A deterministic builder runs even when the AI provider is
 *      unavailable, so the deterministic-fallback proposal has the
 *      most-evaluated section too.
 *
 * The builder is idempotent: when the AI already produced a Section E,
 * we return null and the existing AI-built matrix is kept. The
 * post-generation orchestrator calls hasComplianceMatrixHeading() to
 * decide whether to append.
 */

import { tenderAnnexPolicy } from "./annex-policy";
import { isStrongSupportLevel, normalizeSupportLevel } from "./requirement-evidence-profile";
import { clientSafeComplianceEvidence } from "./automatic-requirement-coverage";
type RequirementLite = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  requirementType?: string | null;
  sourcePageNumber?: number | null;
};

type ComplianceMatrixRowLite = {
  requirementId?: string | null;
  evidenceType?: string | null;
  evidenceSource?: string | null;
  evidenceReference?: string | null;
  supportLevel?: string | null;
  notes?: string | null;
  requirement?: { id?: string | null; title?: string | null; description?: string | null } | null;
};

type ComplianceGapLite = {
  requirementId?: string | null;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  mitigationPlan?: string | null;
};

export type ComplianceMatrixBuilderInput = {
  requirements: RequirementLite[];
  matrixRows: ComplianceMatrixRowLite[];
  gaps: ComplianceGapLite[];
};

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

function priorityRank(p?: string | null): number {
  const v = (p ?? "").toUpperCase();
  if (v === "MANDATORY") return 0;
  if (v === "SCORED") return 1;
  if (v === "HIGH") return 2;
  if (v === "MEDIUM") return 3;
  return 4;
}

/**
 * One phrase per kind of evidence. Two evidence rows of the same kind printed
 * "from company document; from company document" and "from project reference
 * (A, B); from project reference (A)" in a delivered matrix (2026-10-05).
 */
export function mergeEvidencePieces(pieces: readonly string[]): string {
  const byKind = new Map<string, string[]>();
  for (const piece of pieces) {
    const m = piece.trim().match(/^(.*?)(?:\s*\((.*)\))?$/);
    const kind = (m?.[1] ?? piece).trim();
    if (!kind) continue;
    const refs = byKind.get(kind) ?? [];
    for (const ref of (m?.[2] ?? "").split(/,\s*/).map((r) => r.trim()).filter(Boolean)) {
      if (!refs.includes(ref)) refs.push(ref);
    }
    byKind.set(kind, refs);
  }
  return [...byKind].map(([kind, refs]) => (refs.length > 0 ? `${kind} (${refs.join(", ")})` : kind)).join("; ");
}

export function inferProposalLocation(req: RequirementLite): string {
  const type = (req.requirementType ?? "").toUpperCase();
  const title = (req.title ?? "").toLowerCase();
  // A requirement about HOW the proposal is submitted is answered by the
  // submission itself, which the Cover Letter states. Read from the
  // description first, "Technical Proposal Submission — … demonstrating
  // project experience …" was sent to the Project Portfolio (2026-09-28).
  if (/\b(?:submission|submit(?:ted)?|file\s+name|pdf|format|envelope|deadline)\b/.test(title)
    && !/\b(?:experience|portfolio|reference|expert|cv|team)\b/.test(title)) {
    return "Cover Letter";
  }
  // A requirement to attach documents is answered by the Annexes list the
  // proposal carries when the tender asks for attachments (annex-policy.ts),
  // not by the section that mentions the same kind of record. "Attach
  // supporting documents such as … CVs, licenses" was placed under the team
  // table (2026-10-05).
  if (/\b(?:annex(?:es)?|appendi(?:x|ces)|attachments?|supporting\s+documents?)\b/.test(title)
    && tenderAnnexPolicy([`${req.title ?? ""} — ${req.description ?? ""}`]).required) {
    return "Annexes";
  }
  // The title says what the requirement IS; the description only elaborates.
  // A keyword in the description decides only when the title matches nothing.
  return locationFromText(title, type)
    ?? locationFromText(`${title} ${(req.description ?? "").toLowerCase()}`, type)
    // The requirement's type, when no keyword placed it: a METHODOLOGY
    // requirement worded "Outline the approach to infection prevention and
    // patient flow" is answered in Section C, not "Sections A–D" (2026-09-28).
    ?? locationFromType(type)
    // No annex: the proposal has none, and the column promised one to every
    // requirement the keyword map could not place (2026-09-27).
    ?? "Sections A–D";
}

function locationFromType(type: string): string | null {
  if (type === "METHODOLOGY" || type === "TECHNICAL") return "Section C.2 Technical Methodology";
  if (type === "SCHEDULE") return "Section C.6 Work Plan and Schedule";
  if (type === "COMPANY_PROFILE" || type === "ELIGIBILITY") return "Section A.1 Company Background";
  if (type === "FORMAT" || type === "SUBMISSION_RULE") return "Cover Letter";
  if (type === "DECLARATION") return "Declaration";
  return null;
}

function locationFromText(text: string, type: string): string | null {

  if (/^\s*(?:a\s+)?cover(?:ing)?\s+letter\b/.test(text))
    return "Cover Letter";
  if (type === "EXPERT" || /expert|cv|curriculum vitae|key personnel|team composition|qualifications/.test(text))
    return "Section A.4 Proposed Project Team";
  if (type === "PROJECT_EXPERIENCE" || /project.*experience|similar.*project|portfolio|reference|testimony/.test(text))
    return "Section B.2 Project Portfolio";
  if (/methodology|technical approach|work plan|scope.*understanding/.test(text))
    return "Section C.2 Technical Methodology";
  // Before the quality pattern, whose bare "audit" claimed "Audited Financial
  // Statements" for Quality Assurance; and no "Appendix E", which no proposal
  // contains. The statements are listed with the firm's records in Section D.
  if (/financial.*statement|audited.*(?:account|financial|report)|turnover/.test(text))
    return "Section D Professional Certifications and Affiliations";
  if (/quality|\bqa\b|\bqc\b|review|\baudit\b|\biso\b/.test(text))
    return "Section C.3 Quality Assurance";
  if (/risk|mitigation|contingency/.test(text))
    return "Section C.5 Risk Register";
  if (/schedule|timeline|deliverable|milestone|gantt/.test(text))
    return "Section C.6 Work Plan and Schedule";
  if (/value.*added|innovation|additional.*service/.test(text))
    return "Section D.2 Value-Added Services";
  if (/registration|licen[cs]e|certificat|\btin\b|\bvat\b|business.*reg|company.*profile/.test(text))
    return "Section A.1 Company Background";
  if (/declaration|eligibility|conflict.*interest/.test(text))
    return "Declaration";
  if (/safeguard|esmp|environmental|social/.test(text))
    return "Section C.2 Methodology + C.5 Risk Register";
  if (/photo|drawing|floor plan/.test(text))
    return "Section B.2 Project Portfolio";
  return null;
}

/**
 * Removes every Compliance Matrix section (heading through the next heading of
 * the same or higher level). Section E is a table of the app's own data —
 * requirements, their support levels, where each is answered — so the
 * canonical builder writes it on every path, as buildSelfScoreSection does for
 * Section H. On the model path the evaluator appendix planted the last-resort
 * repair matrix first, and the canonical builder saw the heading and stood
 * down: accept run 36462108495 shipped "Cover Letter — PARTIALLY MET —
 * Technical Methodology and Work Plan — evidence: Tax Clearance", and
 * "partially evidenced" beside FULLY MET.
 */
export function stripComplianceMatrixSections(markdown: string): string {
  const headingRe = /^\s*(#{1,4})\s*(?:section\s*[E:.\-\s]*)?\s*compliance\s+matrix\b/i;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(headingRe);
    if (match) {
      const level = match[1].length;
      i += 1;
      while (i < lines.length) {
        const next = lines[i].match(/^\s*(#+)\s/);
        if (next && next[1].length <= level) break;
        i += 1;
      }
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

/**
 * Map ComplianceMatrix.supportLevel to user-facing FULLY/PARTIALLY/NOT MET.
 * supportLevel values produced by the intake stage are typically:
 *   FULL, PARTIAL, NONE, or arbitrary descriptive strings.
 * We collapse them to the three evaluator-facing buckets.
 */
function statusFromSupportLevel(supportLevel?: string | null): "FULLY MET" | "PARTIALLY MET" | "NOT MET" {
  const v = (supportLevel ?? "").toUpperCase().trim();
  // One definition of "met": the engine's. SUBSTANTIAL is strong support
  // everywhere else (export readiness, the readiness model's FULLY_MET), and
  // printing it here as PARTIALLY MET told the evaluator that 5 of the 7
  // requirements the app itself rated met were only partly answered
  // (2026-09-27, accept run 36339908536).
  if (isStrongSupportLevel(normalizeSupportLevel(v))) return "FULLY MET";
  if (v.includes("FULL") || v.includes("STRONG") || v === "YES" || v === "MET") return "FULLY MET";
  if (v.includes("NONE") || v.includes("MISSING") || v.includes("GAP") || v.includes("WEAK") || v.includes("NO ") || v === "NO" || v === "NOT") return "NOT MET";
  // Default to PARTIALLY MET for PARTIAL / unspecified — the intake's default
  // supportLevel is "PARTIAL" so this is the expected case for most rows.
  return "PARTIALLY MET";
}

/**
 * Detect whether the existing markdown already contains a Section E
 * Compliance Matrix. We match the heading pattern AND a status cell —
 * a heading alone (e.g., "## Compliance Matrix" with no rows) is not
 * sufficient and should be replaced.
 */
export function hasComplianceMatrixHeading(markdown: string): boolean {
  const headingRe = /(^|\n)\s*#{1,4}\s*(?:section\s*[E:.\-\s]*)?\s*compliance\s+matrix\b/i;
  if (!headingRe.test(markdown)) return false;
  // Require at least one status cell — otherwise the heading is hollow.
  const statusRe = /\b(FULLY MET|PARTIALLY MET|NOT MET)\b/i;
  return statusRe.test(markdown);
}

/**
 * Build the deterministic Section E Compliance Matrix as a Markdown
 * fragment. Returns null when there are no requirements to map.
 */
const DECLARATION_TITLE = /\b(?:declarations?|undertakings?|disclosures?|affidavits?|attestations?)\b/i;

function isBidderDeclaration(req: RequirementLite): boolean {
  if (String(req.requirementType ?? "").toUpperCase() === "DECLARATION") return true;
  return DECLARATION_TITLE.test(String(req.title ?? ""));
}

export function buildComplianceMatrixSection(input: ComplianceMatrixBuilderInput): string | null {
  const rawReqs = input.requirements.filter((r) => (r.title ?? "").trim().length > 0 || (r.description ?? "").trim().length > 0);
  // Deduplicate by normalized title to prevent duplicate rows when the same
  // requirement appears in both the requirements array and the tender text parse.
  const seen = new Set<string>();
  const reqs = rawReqs.filter((r) => {
    const key = (r.title ?? r.description ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (reqs.length === 0) return null;

  // Index matrix rows + gaps by requirementId for fast lookup.
  const rowsByReqId = new Map<string, ComplianceMatrixRowLite[]>();
  for (const row of input.matrixRows) {
    const key = row.requirementId ?? row.requirement?.id ?? "";
    if (!key) continue;
    if (!rowsByReqId.has(key)) rowsByReqId.set(key, []);
    rowsByReqId.get(key)!.push(row);
  }
  const gapsByReqId = new Map<string, ComplianceGapLite[]>();
  for (const gap of input.gaps) {
    const key = gap.requirementId ?? "";
    if (!key) continue;
    if (!gapsByReqId.has(key)) gapsByReqId.set(key, []);
    gapsByReqId.get(key)!.push(gap);
  }

  const sorted = [...reqs].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  const rows: string[] = [];
  let mandatoryFullyMet = 0;
  let mandatoryPartiallyMet = 0;
  let mandatoryNotMet = 0;
  let rowsWithoutMitigation = 0;

  sorted.forEach((req, idx) => {
    const baseReqText = (req.title || (req.description ?? "").slice(0, 220)).trim();
    const reqText = req.sourcePageNumber != null ? `${baseReqText} [p.${req.sourcePageNumber}]` : baseReqText;
    const proposalLocation = inferProposalLocation(req);

    // Choose the strongest matrix row for the status (FULLY > PARTIALLY > NOT MET).
    const reqId = req.id ?? "";
    const matchingRows = (reqId && rowsByReqId.get(reqId)) || [];
    const statuses = matchingRows.map((r) => statusFromSupportLevel(r.supportLevel));
    let status: "FULLY MET" | "PARTIALLY MET" | "NOT MET";
    if (statuses.length === 0) {
      // No evidence rows — check gaps. If there is a gap, NOT MET. Else PARTIALLY.
      const matchingGaps = (reqId && gapsByReqId.get(reqId)) || [];
      status = matchingGaps.length > 0 ? "NOT MET" : "PARTIALLY MET";
    } else if (statuses.includes("FULLY MET")) {
      status = "FULLY MET";
    } else if (statuses.includes("PARTIALLY MET")) {
      status = "PARTIALLY MET";
    } else {
      status = "NOT MET";
    }
    // A row whose evidence is the proposal's own narrative was rated before the
    // proposal existed (the engine marks it "pending until generated"). Section
    // E is read inside that proposal, where the response now stands at a named
    // section, and the final readiness links the validated proposal to it at
    // FULL. Printing PARTIALLY MET beside "Cover Letter" in the proposal's own
    // matrix contradicted both (2026-09-28, accept run 36456526332). Only rows
    // answered by the proposal alone, at a concrete destination, with no gap.
    const answeredByThisProposal = matchingRows.length > 0
      && matchingRows.every((r) => String(r.evidenceType ?? "").toUpperCase() === "PROPOSAL_RESPONSE");
    if (status === "PARTIALLY MET" && answeredByThisProposal && proposalLocation !== "Sections A–D"
      && ((reqId && gapsByReqId.get(reqId)) || []).length === 0) {
      status = "FULLY MET";
    }

    // Evidence cell — concatenate up to 2 evidence sources.
    const evidenceParts: string[] = [];
    for (const row of matchingRows.slice(0, 2)) {
      // Rendered through the client-safe form. The raw fields are the
      // engine's own: run 36071201669 printed "PROPOSALRESPONSE — ... CV
      // evidence available for drafting — Expert CVS.pdf.txt; GENERATEDDOCUMENT
      // — AUTOGENERATEDARTIFACT" in the submitted compliance matrix. The
      // status column already states coverage, so it is not repeated here.
      const piece = clientSafeComplianceEvidence({ evidenceType: row.evidenceType, evidenceReference: row.evidenceReference });
      if (piece) evidenceParts.push(piece);
    }
    let evidenceCell = mergeEvidencePieces(evidenceParts);
    // A bidder declaration is met by the firm's own signed statement, not by a
    // vault document. 2026-09-30, a telecom-tower EOI: "Litigation History
    // Disclosure" printed an audit firm's name as its evidence at FULLY MET.
    // The package cannot complete without the signed original (the declaration
    // row waits as REPLACE_WITH_ORIGINAL), so the matrix names that document
    // as its evidence. The status is left as the engine rated it.
    if (isBidderDeclaration(req)) {
      evidenceCell = "The company's signed declaration, submitted as a separate document in this package";
    }
    // No gap mitigation in the client's matrix. Every mitigation the engine
    // writes is an instruction to the owner — "Upload evidence, review
    // matching candidates, or confirm manual proposal coverage before export",
    // "Review candidate evidence and mark final records as selected/reviewed"
    // — and on 2026-10-05 that text sat in a delivered row until the
    // client-language sweep deleted the whole row, leaving rows numbered 1, 3,
    // 4 under a summary that still counted the deleted one. The status column
    // states the coverage; the owner sees the gap in the app.
    if (status !== "FULLY MET") rowsWithoutMitigation += 1;
    if (!evidenceCell) evidenceCell = "Cross-referenced in proposal narrative";

    if ((req.priority ?? "").toUpperCase() === "MANDATORY") {
      if (status === "FULLY MET") mandatoryFullyMet++;
      else if (status === "PARTIALLY MET") mandatoryPartiallyMet++;
      else mandatoryNotMet++;
    }

    // No "Package Reference" column. It pointed each row at an annex letter
    // of the engine's own ("Annex F — Eligibility Documents", "Annex A — CV &
    // Qualifications") in a package that, in run 36074770709, was one PDF
    // with no annexes; nothing in the proposal defines those letters.
    rows.push(`| ${idx + 1} | ${escCell(reqText)} | ${escCell(proposalLocation)} | ${escCell(evidenceCell)} | ${status} |`);
  });

  if (rows.length === 0) return null;

  const totalMandatory = mandatoryFullyMet + mandatoryPartiallyMet + mandatoryNotMet;
  const mitigationNote = rowsWithoutMitigation === 0 ? " (mitigation stated in the row)" : "";
  const summaryLine = totalMandatory > 0
    ? `**Mandatory requirements**: ${totalMandatory} total — ${mandatoryFullyMet} fully met${mandatoryPartiallyMet > 0 ? `, ${mandatoryPartiallyMet} partially met${mitigationNote}` : ""}${mandatoryNotMet > 0 ? `, ${mandatoryNotMet} not met${mitigationNote}` : ""}.`
    : `**${rows.length} requirements** mapped to proposal sections with evidence anchors and compliance status.`;

  return [
    "# SECTION E: COMPLIANCE MATRIX",
    "",
    `Every mandatory and scored requirement detected during tender analysis is mapped below to the proposal section that addresses it, the supporting evidence anchor, and a compliance status.${rowsWithoutMitigation === 0 && (mandatoryPartiallyMet + mandatoryNotMet) > 0 ? " NOT MET and PARTIALLY MET rows include a mitigation plan in the evidence column." : ""}`,
    "",
    summaryLine,
    "",
    "| # | Requirement (paraphrased from tender) | Where Addressed in This Proposal | Supporting Evidence / Mitigation | Compliance Status |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "_Compliance Status: FULLY MET = the evidence satisfies the requirement; PARTIALLY MET = the evidence satisfies it in part; NOT MET = cannot be met as stated._",
  ].join("\n");
}
