/**
 * Deep-reasoning readiness assessor.
 *
 * Before kicking off a deep-reasoning generation, the operator (and
 * the engine itself) benefit from a fast check that the firm has
 * enough data for deep reasoning to be productive. Running deep
 * reasoning against a near-empty knowledge vault burns AI budget
 * for output that would be "Bid-Team Action: confirm" notes from
 * top to bottom — the legacy path would be better.
 *
 * This module scores firm-data completeness on four dimensions and
 * returns:
 *   - overall `ready` boolean (every dimension passes)
 *   - per-dimension status + missing items
 *   - actionable suggestions for closing each gap
 *
 * Status: no production consumer yet. It is retained deliberately —
 * docs/audits/legacy-overlap-dependency-map.md marks it KEEP for the planned
 * deep-reasoning gate — but nothing under app/, lib/ or components/ imports
 * it today, so its output reaches no user and its thresholds gate nothing.
 * Do not cite it as the reason a generation was or was not allowed; the
 * authorities that actually decide are lib/company-ingestion-readiness.ts and
 * lib/canonical-tender-readiness.ts. Wiring this in means reconciling its
 * thresholds with those, not adding a third opinion alongside them.
 *
 * Pure function — no AI, no DB. Caller passes the loaded firm data.
 */

export type ReadinessDimension =
  | "company-profile"
  | "experts"
  | "projects"
  | "legal-records";

export type DimensionStatus = "ok" | "partial" | "missing";

export type ReadinessAssessment = {
  /** True when every dimension is `ok`. Some dimensions can be `partial` and still allow generation. */
  ready: boolean;
  /** True when at least the bare minimum is met (every dimension is `ok` OR `partial`). */
  minimallyViable: boolean;
  dimensions: Record<ReadinessDimension, {
    status: DimensionStatus;
    detail: string;
    suggestion: string | null;
  }>;
  /** Roll-up summary one-liner for logs and UI. */
  summary: string;
};

export type ReadinessInput = {
  company: {
    name?: string | null;
    legalName?: string | null;
    foundingYear?: number | null;
    headcount?: number | null;
    licenseGrade?: string | null;
    tin?: string | null;
    vat?: string | null;
    gmName?: string | null;
    profileSummary?: string | null;
  } | null;
  expertCount: number;
  reviewedExpertCount: number;
  projectCount: number;
  reviewedProjectCount: number;
  legalRecordCount: number;
};

/**
 * Inspect the firm's data and return a readiness assessment. Pure
 * function, deterministic, cheap to run.
 */
export function assessDeepReasoningReadiness(input: ReadinessInput): ReadinessAssessment {
  // ── Company profile ────────────────────────────────────────────
  const c = input.company;
  const companyFieldsPresent: number = c ? [
    c.name,
    c.legalName,
    c.foundingYear,
    c.headcount,
    c.licenseGrade,
    c.tin || c.vat,
    c.gmName,
    c.profileSummary,
  ].filter((v) => v !== null && v !== undefined && v !== "").length : 0;
  const companyStatus: DimensionStatus = !c ? "missing"
    : companyFieldsPresent >= 6 ? "ok"
    : companyFieldsPresent >= 3 ? "partial"
    : "missing";
  const companyMissing = !c ? "(no Company record loaded)" : (() => {
    const missing: string[] = [];
    if (!c.name) missing.push("name");
    if (!c.legalName) missing.push("legalName");
    if (c.foundingYear === null || c.foundingYear === undefined) missing.push("foundingYear");
    if (c.headcount === null || c.headcount === undefined) missing.push("headcount");
    if (!c.licenseGrade) missing.push("licenseGrade");
    if (!c.tin && !c.vat) missing.push("TIN or VAT");
    if (!c.gmName) missing.push("gmName");
    if (!c.profileSummary) missing.push("profileSummary");
    return missing.length > 0 ? `missing: ${missing.join(", ")}` : "all institutional fields present";
  })();

  // ── Experts ────────────────────────────────────────────────────
  // Deep reasoning's alignment + critique paths need source-verified experts;
  // draft records leak unverified facts into the proposal. Verification is
  // automatic — a record becomes usable when its values can be matched back to
  // owned, byte-checked source bytes — so a shortfall means the source
  // documents are missing or unreadable, never that someone forgot to click
  // approve.
  const expertStatus: DimensionStatus = input.reviewedExpertCount >= 3 ? "ok"
    : input.reviewedExpertCount >= 1 ? "partial"
    : "missing";
  const expertDetail = `${input.reviewedExpertCount} reviewed expert(s) of ${input.expertCount} total`;

  // ── Projects ───────────────────────────────────────────────────
  const projectStatus: DimensionStatus = input.reviewedProjectCount >= 3 ? "ok"
    : input.reviewedProjectCount >= 1 ? "partial"
    : "missing";
  const projectDetail = `${input.reviewedProjectCount} reviewed project(s) of ${input.projectCount} total`;

  // ── Legal records ──────────────────────────────────────────────
  // Optional but valuable — the lookup_legal_record tool can't return
  // anything when the firm has zero legal records on file.
  const legalStatus: DimensionStatus = input.legalRecordCount >= 3 ? "ok"
    : input.legalRecordCount >= 1 ? "partial"
    : "missing";
  const legalDetail = `${input.legalRecordCount} legal/regulatory record(s) on file`;

  const dimensions: ReadinessAssessment["dimensions"] = {
    "company-profile": {
      status: companyStatus,
      detail: companyDetailFor(c, companyMissing),
      suggestion: companyStatus === "ok" ? null : "Open /dashboard/company → company profile and fill the institutional metadata fields (legal name, founding year, headcount, license grade, TIN/VAT, GM name + license, profile summary). These are cited verbatim in Sections A.2 and D.4.",
    },
    experts: {
      status: expertStatus,
      detail: expertDetail,
      suggestion: expertStatus === "ok" ? null : "Upload CVs for more key experts under /dashboard/company. Run Engine source-verifies them automatically against the uploaded bytes; aim for at least 3 verified experts so the alignment call has enough candidates to score. If experts are already uploaded but not yet verified, their source document is missing or could not be read.",
    },
    projects: {
      status: projectStatus,
      detail: projectDetail,
      suggestion: projectStatus === "ok" ? null : "Upload project reference sheets under /dashboard/company. Run Engine source-verifies them automatically against the uploaded bytes; aim for at least 3 verified projects so the throughline enforcer and alignment have substantive evidence. If projects are already uploaded but not yet verified, their source document is missing or could not be read.",
    },
    "legal-records": {
      status: legalStatus,
      detail: legalDetail,
      suggestion: legalStatus === "ok" ? null : "Open /dashboard/company → legal records and upload the firm's current licenses, registrations, and ISO certifications. The lookup_legal_record tool returns these to Claude so certificate numbers and expiry dates are accurate.",
    },
  };

  const ready = Object.values(dimensions).every((d) => d.status === "ok");
  const minimallyViable = Object.values(dimensions).every((d) => d.status !== "missing");

  const okCount = Object.values(dimensions).filter((d) => d.status === "ok").length;
  const partialCount = Object.values(dimensions).filter((d) => d.status === "partial").length;
  const missingCount = Object.values(dimensions).filter((d) => d.status === "missing").length;
  const summary = ready
    ? `Deep-reasoning readiness: READY — all ${okCount} dimensions pass.`
    : minimallyViable
      ? `Deep-reasoning readiness: MINIMALLY VIABLE — ${okCount} ok, ${partialCount} partial. Acceptable but improving partial dimensions will lift output quality.`
      : `Deep-reasoning readiness: NOT READY — ${missingCount} dimension(s) missing. Deep reasoning will mostly emit "Bid-Team Action: confirm" notes against the proposal.`;

  return { ready, minimallyViable, dimensions, summary };
}

function companyDetailFor(c: ReadinessInput["company"], missingPhrase: string): string {
  if (!c) return missingPhrase;
  const have = [
    c.name && "name",
    c.legalName && "legalName",
    c.foundingYear && "foundingYear",
    c.headcount && "headcount",
    c.licenseGrade && "licenseGrade",
    (c.tin || c.vat) && "TIN/VAT",
    c.gmName && "gmName",
    c.profileSummary && "profileSummary",
  ].filter(Boolean);
  if (have.length === 8) return `all institutional fields present (${have.length}/8)`;
  return `${have.length}/8 institutional fields present; ${missingPhrase}`;
}
