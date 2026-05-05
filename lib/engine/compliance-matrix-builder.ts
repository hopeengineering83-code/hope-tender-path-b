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

type RequirementLite = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  requirementType?: string | null;
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

function inferProposalLocation(req: RequirementLite): string {
  const text = `${req.title ?? ""} ${req.description ?? ""}`.toLowerCase();
  const type = (req.requirementType ?? "").toUpperCase();

  if (type === "EXPERT" || /expert|cv|curriculum vitae|key personnel|team composition|qualifications/.test(text))
    return "Section A.4 Proposed Project Team";
  if (type === "PROJECT_EXPERIENCE" || /project.*experience|similar.*project|portfolio|reference|testimony/.test(text))
    return "Section B.2 Project Portfolio";
  if (/methodology|technical approach|work plan|scope.*understanding/.test(text))
    return "Section C.2 Technical Methodology";
  if (/quality|qa|qc|review|audit|iso/.test(text))
    return "Section C.3 Quality Assurance";
  if (/risk|mitigation|contingency/.test(text))
    return "Section C.5 Risk Register";
  if (/schedule|timeline|deliverable|milestone|gantt/.test(text))
    return "Section C.6 Work Plan and Schedule";
  if (/value.*added|innovation|additional.*service/.test(text))
    return "Section D.2 Value-Added Services";
  if (/registration|license|tin|vat|business.*reg|company.*profile/.test(text))
    return "Section A.1 Company Background";
  if (/financial.*statement|audited.*account|turnover/.test(text))
    return "Appendix E (Audited Financial Statements)";
  if (/declaration|eligibility|conflict.*interest/.test(text))
    return "Section D.4 Declaration of Eligibility";
  if (/safeguard|esmp|environmental|social/.test(text))
    return "Section C.2 Methodology + C.5 Risk Register";
  if (/photo|drawing|floor plan/.test(text))
    return "Appendix D Project Photos and Drawings";
  return "Section A–D (cross-referenced in proposal annex)";
}

/**
 * Map ComplianceMatrix.supportLevel to user-facing FULLY/PARTIALLY/NOT MET.
 * supportLevel values produced by the intake stage are typically:
 *   FULL, PARTIAL, NONE, or arbitrary descriptive strings.
 * We collapse them to the three evaluator-facing buckets.
 */
function statusFromSupportLevel(supportLevel?: string | null): "FULLY MET" | "PARTIALLY MET" | "NOT MET" {
  const v = (supportLevel ?? "").toUpperCase().trim();
  if (v === "FULL" || v === "FULLY" || v === "FULL_SUPPORT" || v === "STRONG" || v === "FULLY MET") return "FULLY MET";
  if (v === "NONE" || v === "MISSING" || v === "GAP" || v === "WEAK" || v === "NOT MET") return "NOT MET";
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
export function buildComplianceMatrixSection(input: ComplianceMatrixBuilderInput): string | null {
  const reqs = input.requirements.filter((r) => (r.title ?? "").trim().length > 0 || (r.description ?? "").trim().length > 0);
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

  sorted.forEach((req, idx) => {
    const reqText = (req.title || (req.description ?? "").slice(0, 140)).trim();
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

    // Evidence cell — concatenate up to 2 evidence sources.
    const evidenceParts: string[] = [];
    for (const row of matchingRows.slice(0, 2)) {
      const piece = [row.evidenceType, row.evidenceSource, row.evidenceReference].filter(Boolean).join(" — ");
      if (piece) evidenceParts.push(piece);
    }
    let evidenceCell = evidenceParts.join("; ");
    // If NOT MET / PARTIALLY MET, append mitigation from gaps.
    if (status !== "FULLY MET") {
      const matchingGaps = (reqId && gapsByReqId.get(reqId)) || [];
      const mitigation = matchingGaps
        .map((g) => g.mitigationPlan || g.description)
        .filter((s): s is string => Boolean(s && s.trim()))
        .slice(0, 1)
        .join(" — ");
      if (mitigation) {
        evidenceCell = evidenceCell
          ? `${evidenceCell}. Mitigation: ${mitigation}`
          : `Mitigation: ${mitigation}`;
      }
      if (!evidenceCell) {
        evidenceCell = "Bid-Team Action: confirm evidence and attach supporting document before submission.";
      }
    }
    if (!evidenceCell) evidenceCell = "Cross-referenced in proposal narrative";

    if ((req.priority ?? "").toUpperCase() === "MANDATORY") {
      if (status === "FULLY MET") mandatoryFullyMet++;
      else if (status === "PARTIALLY MET") mandatoryPartiallyMet++;
      else mandatoryNotMet++;
    }

    rows.push(`| ${idx + 1} | ${escCell(reqText)} | ${escCell(proposalLocation)} | ${escCell(evidenceCell)} | ${status} |`);
  });

  if (rows.length === 0) return null;

  const totalMandatory = mandatoryFullyMet + mandatoryPartiallyMet + mandatoryNotMet;
  const summaryLine = totalMandatory > 0
    ? `**Mandatory requirements**: ${totalMandatory} total — ${mandatoryFullyMet} fully met, ${mandatoryPartiallyMet} partially met (mitigation listed), ${mandatoryNotMet} not met (mitigation listed).`
    : `**${rows.length} requirements** mapped to proposal sections with evidence anchors and compliance status.`;

  return [
    "## SECTION E: COMPLIANCE MATRIX",
    "",
    "Every mandatory and scored requirement detected during tender analysis is mapped below to the proposal section that addresses it, the supporting evidence anchor, and a compliance status. NOT MET and PARTIALLY MET rows include a mitigation plan in the evidence column.",
    "",
    summaryLine,
    "",
    "| # | Requirement (paraphrased from tender) | Where Addressed in This Proposal | Supporting Evidence / Mitigation | Compliance Status |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "_Compliance Status definitions: FULLY MET = evidence in the proposal directly satisfies the requirement; PARTIALLY MET = evidence partially satisfies the requirement and a mitigation plan is provided; NOT MET = the firm cannot meet the requirement as stated and a credible mitigation (subcontractor, joint venture, deferred delivery, or alternative approach) is proposed in the same row._",
  ].join("\n");
}
