import { recordTypeForDisplay } from "./vault-prose";
/**
 * Bid Compliance Mapping — for each detected tender requirement, name the
 * proposal section that addresses it. This is different from the existing
 * ComplianceMatrix (which maps requirements to evidence). Evaluators use
 * this table to navigate the proposal during scoring.
 *
 * Conditional: emitted only when no equivalent "Compliance Mapping" or
 * "Tender Requirements Mapping" heading is present.
 */

type TenderRequirementLite = {
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  requirementType?: string | null;
  sourcePageNumber?: number | null;
};

function escCell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim();
}

function inferProposalLocation(req: TenderRequirementLite): string {
  const text = `${req.title ?? ""} ${req.description ?? ""}`.toLowerCase();
  const type = (req.requirementType ?? "").toUpperCase();

  if (type === "EXPERT" || /expert|cv|curriculum vitae|key personnel|team composition|qualifications/.test(text)) {
    return "Section A.4 Proposed Project Team and A.4.1 Principal Qualifications";
  }
  if (type === "PROJECT_EXPERIENCE" || /project.*experience|similar.*project|portfolio|reference|testimony/.test(text)) {
    return "Section B.1 Client References and B.2 Project Portfolio";
  }
  if (/methodology|technical approach|work plan|scope.*understanding/.test(text)) {
    return "Section C.1 Understanding and C.2 Technical Methodology";
  }
  if (/quality|qa|qc|review|audit|iso/.test(text)) {
    return "Section C.3 Three-Stage Quality Review";
  }
  if (/risk|mitigation|contingency/.test(text)) {
    return "Section C.5 Risk Register and Mitigation Strategy";
  }
  if (/schedule|timeline|deliverable|milestone|gantt/.test(text)) {
    return "Section C.6 Work Plan and Schedule";
  }
  if (/value.*added|innovation|additional.*service/.test(text)) {
    return "Section D.1 Value Framework and D.2 Value-Added Services";
  }
  if (/registration|license|tin|vat|business.*reg|company.*profile/.test(text)) {
    return "Section A.1 Company Background and A.2 Corporate Information";
  }
  if (/financial.*statement|audited.*account|turnover/.test(text)) {
    return "Appendix E (Audited Financial Statements)";
  }
  if (/declaration|eligibility|conflict.*interest/.test(text)) {
    return "Section D.4 Declaration of Eligibility";
  }
  if (/compliance|safeguard|esmp|environmental|social/.test(text)) {
    return "Sections C.2 Methodology and C.5 Risk Register; Compliance Matrix in proposal annex";
  }
  // Default
  return "Compliance Matrix annex (cross-referenced to proposal sections)";
}

export function buildBidComplianceMapping(opts: { requirements: TenderRequirementLite[] }): string | null {
  const reqs = opts.requirements.filter((r) => (r.title ?? "").trim().length > 0);
  if (reqs.length === 0) return null;

  // Sort: MANDATORY first, then HIGH, then OTHER
  const priorityRank = (p?: string | null): number => {
    const v = (p ?? "").toUpperCase();
    if (v === "MANDATORY") return 0;
    if (v === "HIGH") return 1;
    if (v === "MEDIUM") return 2;
    return 3;
  };
  const sorted = [...reqs].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  const rows = sorted.slice(0, 30).map((req) => {
    const reqText = (req.title || (req.description ?? "").slice(0, 100)).trim();
    const pageRef = req.sourcePageNumber != null ? `p.${req.sourcePageNumber}` : "—";
    return `| ${escCell(req.priority || "—")} | ${escCell(recordTypeForDisplay(req.requirementType) || "General")} | ${escCell(reqText)} | ${pageRef} | ${escCell(inferProposalLocation(req))} |`;
  });

  return [
    "## E.1 Bid Compliance Mapping — Tender Requirements to Proposal Sections",
    "Every tender requirement detected during analysis is mapped below to the proposal section that addresses it. Evaluators can use this table to navigate the proposal during scoring.",
    "",
    "| Priority | Type | Tender Requirement | Source Page | Addressed In |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    `_${sorted.length} requirement${sorted.length === 1 ? "" : "s"} detected; ${rows.length} shown in this mapping. Full evidence-mapped Compliance Matrix is provided in the proposal annex._`,
  ].join("\n");
}
