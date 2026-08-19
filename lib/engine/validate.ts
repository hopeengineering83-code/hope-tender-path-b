import { logger } from "../observability";
import { prisma } from "../prisma";
import { exactSelectionLimit } from "./scope-policy";
import { buildDeterministicComprehension } from "./deterministic-prohibition-extractor";
import { validateConstraints } from "./constraint-validator";
import { filterFinalExportCandidateDocuments } from "./document-output-state";
import { documentHygieneIssues, extractDocxVisibleText } from "./export-readiness";
import { isDurablyReviewed, VAULT_REVIEW_CONSUMER_SELECT } from "../vault-review-provenance";

export interface ValidationIssue {
  code: string;
  severity: "BLOCK" | "WARN";
  message: string;
}

export interface ValidationReport {
  passed: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

const PLACEHOLDER_PATTERNS = [
  /\[insert [^\]]+\]/i,
  /\{[^}]+\}/,
  /\bTODO\b/,
  /\bXXX\b/,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\bplaceholder\b/i,
  /as an ai/i,
  /language model/i,
];

function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(text));
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function hardCriticalGap(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|signature prohibited|branding prohibited)/i.test(text);
}

function staffingShortfallMessage(type: "expert" | "project", required: number, selected: number): string {
  const label = type === "expert" ? "expert" : "project reference";
  const missing = Math.max(0, required - selected);
  return `Tender appears to require ${required} ${label}(s), while ${selected} are selected. This is a senior bid-review item, not an automatic validation failure: proceed with the reviewed evidence, include the compliance narrative in the proposal, and confirm/add ${missing} ${label}(s) before final submission if the tender evaluator treats the number as mandatory.`;
}

export async function validateTender(tenderId: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];

  // Bring requirement coverage up to date before judging it.
  //
  // The Engine computes coverage BEFORE generation, when every build-plan item
  // is still a promise and no artifact exists, and nothing recomputed it once
  // the documents were written. So the evidence this function reads was stale
  // by construction: a requirement answered by the proposal's own deliverable
  // stayed at PARTIAL for ever, mandatory-evidence blockers never cleared, and
  // the only way past it was for someone to know to POST
  // /api/tenders/{id}/requirement-coverage/auto-sync by hand — an step the
  // owner is never told about and the automation contract does not allow.
  //
  // Reconciling here rather than at each generation site covers every path
  // that reaches a verdict, since both POST /validate and POST /export come
  // through this function. The service is an idempotent desired-state sync
  // with its own retry, so calling it on an already-current tender is a no-op.
  //
  // A failure must not fail validation: coverage that could not be refreshed
  // is reported as a warning, and the gates below still judge what is stored.
  const owner = await prisma.tender.findUnique({ where: { id: tenderId }, select: { userId: true } });
  if (owner?.userId) {
    try {
      const { reconcileAutomaticRequirementCoverage } = await import("./reconcile-automatic-requirement-coverage");
      await reconcileAutomaticRequirementCoverage(prisma, tenderId, owner.userId);
    } catch (error) {
      logger.warn(`[validate] requirement-coverage reconcile failed; judging stored coverage: ${error instanceof Error ? error.message : String(error)}`);
      issues.push({
        code: "REQUIREMENT_COVERAGE_NOT_REFRESHED",
        severity: "WARN",
        message: "Requirement evidence could not be refreshed before validation, so the result reflects the last stored coverage.",
      });
    }
  }

  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: true,
      complianceGaps: true,
      generatedDocuments: true,
      expertMatches: { where: { isSelected: true } },
      projectMatches: { where: { isSelected: true } },
      complianceMatrix: { select: { requirementId: true, supportLevel: true } },
    },
  });

  if (!tender) return { passed: false, issues: [{ code: "TENDER_NOT_FOUND", severity: "BLOCK", message: "Tender not found." }], checkedAt: new Date().toISOString() };

  const selectedExpertIds = tender.expertMatches.map((m) => m.expertId);
  const selectedProjectIds = tender.projectMatches.map((m) => m.projectId);

  // Vault records are re-read scoped to the tender owner, not by bare ID.
  // These IDs arrive from TenderExpertMatch/TenderProjectMatch rows, and
  // matching is company-scoped, so a foreign ID should never reach here — but
  // "should never" is the tenant boundary being inherited from a caller two
  // levels up rather than enforced where the read happens. The messages below
  // interpolate fullName/name, so a single cross-tenant match row would leak
  // another company's expert and project names into a validation report.
  // Scoping the read makes the boundary local and self-evident.
  const ownedByTenant = { company: { userId: tender.userId } } as const;

  if (selectedExpertIds.length > 0) {
    const experts = await prisma.expert.findMany({ where: { id: { in: selectedExpertIds }, deletedAt: null, ...ownedByTenant }, select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT } });
    // isDurablyReviewed(), not a raw trustLevel==="REVIEWED" check — a stale
    // or never-durably-provenance-backed REVIEWED record must not pass this
    // check as if genuinely human-reviewed (it would otherwise produce a
    // false-positive "✓ All experts are REVIEWED" that contradicts the
    // Engine's and generation's own durable gate).
    const unreviewed = experts.filter((e) => !isDurablyReviewed(e));
    const regexDraft = experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT");
    const aiDraft = experts.filter((e) => e.trustLevel === "AI_DRAFT");
    if (regexDraft.length > 0) issues.push({ code: "REGEX_DRAFT_EXPERT_SELECTED", severity: "BLOCK", message: `${regexDraft.length} selected expert(s) are REGEX_DRAFT — pattern-extracted records with low reliability. Re-run AI extraction, then review and mark REVIEWED. Affected: ${regexDraft.map((e) => e.fullName).join(", ")}.` });
    if (aiDraft.length > 0) issues.push({ code: "AI_DRAFT_EXPERT_NOT_REVIEWED", severity: "BLOCK", message: `${aiDraft.length} selected expert(s) are AI_DRAFT but not yet reviewed. Verify each expert against source documents and mark REVIEWED before final validation. Affected: ${aiDraft.map((e) => e.fullName).join(", ")}.` });
    if (unreviewed.length === 0 && experts.length > 0) issues.push({ code: "EXPERTS_ALL_REVIEWED", severity: "WARN", message: `✓ All ${experts.length} selected expert(s) are REVIEWED.` });
  }

  if (selectedProjectIds.length > 0) {
    const projects = await prisma.project.findMany({ where: { id: { in: selectedProjectIds }, deletedAt: null, ...ownedByTenant }, select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT } });
    const regexDraft = projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT");
    const aiDraft = projects.filter((p) => p.trustLevel === "AI_DRAFT");
    if (regexDraft.length > 0) issues.push({ code: "REGEX_DRAFT_PROJECT_SELECTED", severity: "BLOCK", message: `${regexDraft.length} selected project(s) are REGEX_DRAFT — pattern-extracted records with low reliability. Re-run AI extraction, then review and mark REVIEWED. Affected: ${regexDraft.map((p) => p.name).join(", ")}.` });
    if (aiDraft.length > 0) issues.push({ code: "AI_DRAFT_PROJECT_NOT_REVIEWED", severity: "BLOCK", message: `${aiDraft.length} selected project(s) are AI_DRAFT but not yet reviewed. Verify each project against source documents and mark REVIEWED before final validation. Affected: ${aiDraft.map((p) => p.name).join(", ")}.` });
  }

  // Validate only final-export candidates. Internal control rows, original-replacement placeholders,
  // planned rows, superseded rows, quick drafts, and non-exportable records are handled by the
  // export gate and must not create false validation blockers.
  const allGenerated = filterFinalExportCandidateDocuments(tender.generatedDocuments as any[])
    .filter((d) => d.generationStatus === "GENERATED")
    .sort((a, b) => {
      const orderDiff = (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
    });
  // Deduplicate: when multiple GENERATED records share the same exactFileName (from repeated
  // generation runs that didn't supersede the old record), keep only the most-recently-updated
  // one. Without this, the same filename produces N identical blocking messages.
  const seenFileKeys = new Set<string>();
  const generatedDocs = allGenerated.filter((doc) => {
    const key = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
    if (seenFileKeys.has(key)) return false;
    seenFileKeys.add(key);
    return true;
  });

  const criticalGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
  const hardGaps = criticalGaps.filter(hardCriticalGap);
  const seniorReviewCriticals = criticalGaps.filter((g) => !hardCriticalGap(g));
  if (hardGaps.length > 0) issues.push({ code: "HARD_CRITICAL_GAPS", severity: "BLOCK", message: `${hardGaps.length} hard critical blocker(s) remain: ${hardGaps.map((g) => g.title).join("; ")}.` });
  if (seniorReviewCriticals.length > 0) issues.push({ code: "SENIOR_REVIEW_CRITICAL_GAPS", severity: "WARN", message: `${seniorReviewCriticals.length} critical evidence/review gap(s) remain. The proposal can be validated as draft-ready, but final bid review must resolve or accept these items.` });

  const highGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH");
  if (highGaps.length > 0) issues.push({ code: "UNRESOLVED_HIGH_GAPS", severity: "WARN", message: `${highGaps.length} HIGH severity compliance gap(s) are unresolved. Review before final export.` });

  if (generatedDocs.length === 0) issues.push({ code: "NO_GENERATED_DOCUMENTS", severity: "BLOCK", message: "No documents have been generated yet. Run document generation first." });

  for (const doc of generatedDocs) {
    // Check the DOCUMENT, not the metadata about it.
    //
    // Both checks below used to read doc.contentSummary. For a generated
    // proposal that field holds the generator's own diagnostic report, which
    // describes the document's problems in the document's own vocabulary — so
    // a summary reading 'Proposal still has 6 unresolved spot(s) reading "to be
    // confirmed by bid team"' tripped the placeholder block, and one reading
    // "Executive Summary lacks a specific project name or contract value"
    // tripped the pricing-leakage block. Both fired on proposals whose text
    // contained neither a placeholder nor a price: the report of a problem was
    // punished as the problem, and no edit to the document could clear it
    // because the document was never what was read.
    //
    // The comment here previously claimed these were "the same checks the
    // export-readiness gate runs". They now are — that gate extracts the
    // document's visible text, so this does too.
    const fileName = doc.exactFileName ?? doc.name ?? "";
    const isDocx = fileName.toLowerCase().endsWith(".docx");
    let documentText = "";
    if (typeof doc.fileContent === "string" && doc.fileContent.length > 0 && doc.fileContent.length < 2_000_000) {
      documentText = isDocx
        ? (await extractDocxVisibleText(doc.fileContent, fileName)) ?? ""
        : doc.fileContent;
    }

    // A DOCX that carries bytes but yields no readable text is not evidence of
    // cleanliness — say so rather than passing it silently. WARN, not BLOCK:
    // export-readiness owns the byte-level verdict and refuses it there.
    if (isDocx && documentText.trim().length === 0 && (doc.fileContent ?? "").length > 0) {
      issues.push({
        code: "DOCUMENT_TEXT_UNREADABLE",
        severity: "WARN",
        message: `Document "${doc.name}" has stored bytes but no readable text could be extracted, so placeholder and hygiene checks could not inspect it.`,
      });
    }

    if (hasPlaceholder(documentText)) issues.push({ code: "PLACEHOLDER_IN_DOCUMENT", severity: "BLOCK", message: `Document "${doc.name}" contains placeholder text that must be replaced.` });

    // Document hygiene: catch pricing leakage in technical envelopes, AI
    // disclosure phrases, and unresolved placeholder instructions. Surfacing
    // them at validation time means problems are caught one step earlier —
    // before the user tries to export.
    const hygieneIssues = documentHygieneIssues(documentText, {
      name: doc.name,
      exactFileName: doc.exactFileName ?? null,
      documentType: (doc as { documentType?: string | null }).documentType ?? null,
      format: (doc as { format?: string | null }).format ?? null,
    });
    for (const hygieneIssue of hygieneIssues) {
      issues.push({ code: "DOCUMENT_HYGIENE_FAILURE", severity: "BLOCK", message: `Document "${doc.name}": ${hygieneIssue}` });
    }
  }

  // ─── Deterministic prohibition check (PR #397) ─────────────────────
  // Scan the tender text for explicit prohibition language ("no JV",
  // "no subcontracting", "no advance payment", etc.) and then verify
  // the generated proposal markdown does not violate any. Runs WITHOUT
  // AI — pure regex on both sides — so every user gets prohibition
  // checking regardless of TENDER_DEEP_REASONING / Claude availability.
  // The semantic comprehension extractor catches subtler cases when
  // the flag is on; this deterministic path is the always-on baseline.
  try {
    const tenderText = [
      tender.intakeSummary ?? "",
      tender.description ?? "",
      tender.analysisSummary ?? "",
      tender.evaluationMethodology ?? "",
    ].filter(Boolean).join("\n\n");
    if (tenderText.trim().length > 0) {
      const comprehension = buildDeterministicComprehension(tenderText);
      if (comprehension && comprehension.prohibitions.length > 0) {
        const proposalText = generatedDocs.map((d) => d.contentSummary ?? "").filter(Boolean).join("\n\n");
        if (proposalText.trim().length > 0) {
          const constraintResult = validateConstraints(comprehension, proposalText);
          for (const violation of constraintResult.violations) {
            issues.push({
              code: violation.type === "prohibition" ? "PROHIBITION_VIOLATION" : "DISQUALIFIER_VIOLATION",
              severity: violation.severity === "CRITICAL" ? "BLOCK" : "WARN",
              message: `${violation.rule}. Evidence in proposal: "…${violation.evidence}…"${violation.location ? ` [in: ${violation.location}]` : ""}. Fix: ${violation.suggestion}`,
            });
          }
        }
      }
    }
  } catch (err) {
    // Never let the prohibition check block validation; it's a
    // best-effort safety net.
    logger.warn("[validate] Deterministic prohibition check failed (non-critical):", { detail: err instanceof Error ? err.message : err });
  }

  const requiredNames = safeParseArr(tender.exactFileNaming);
  if (requiredNames.length > 0) {
    const generatedNames = generatedDocs.map((d) => (d.exactFileName ?? d.name).trim().toLowerCase());
    const normalizedRequired = requiredNames.map((name) => name.trim().toLowerCase());
    const missing = normalizedRequired.filter((name) => !generatedNames.includes(name));
    const extras = generatedNames.filter((name) => !normalizedRequired.includes(name));
    if (missing.length > 0) issues.push({ code: "MISSING_REQUIRED_FILES", severity: "BLOCK", message: `The following tender-required file name(s) are missing from generated documents: ${missing.join(", ")}` });
    if (extras.length > 0) issues.push({ code: "EXTRA_GENERATED_FILES", severity: "WARN", message: `Generated package includes additional file(s) not detected in the tender naming rules: ${extras.join(", ")}. Remove them only if the tender strictly prohibits extra files.` });
    if (missing.length === 0 && generatedDocs.length < normalizedRequired.length) issues.push({ code: "FILE_COUNT_MISMATCH", severity: "BLOCK", message: `Tender requires at least ${normalizedRequired.length} named file(s), but only ${generatedDocs.length} generated file(s) are currently marked as generated.` });
  }

  const requiredOrder = safeParseArr(tender.exactFileOrder).map((name) => name.trim().toLowerCase());
  if (requiredOrder.length > 0) {
    const actualOrder = generatedDocs.map((d) => (d.exactFileName ?? d.name).trim().toLowerCase());
    const outOfOrder = requiredOrder.some((name, index) => actualOrder[index] !== name);
    if (outOfOrder) issues.push({ code: "FILE_ORDER_MISMATCH", severity: "WARN", message: `Generated document order may not match the tender-required order. Expected: ${requiredOrder.join(" -> ")}.` });
  }

  const coveredRequirementIds = new Set(
    tender.complianceMatrix
      .filter((m) => m.supportLevel && m.supportLevel !== "NONE" && m.supportLevel !== "NOT_COVERED")
      .map((m) => m.requirementId)
  );
  const unresolvedMandatory = tender.requirements.filter(
    (r) => r.priority === "MANDATORY" && !r.isResolved && !coveredRequirementIds.has(r.id)
  );
  if (unresolvedMandatory.length > 0) issues.push({ code: "UNRESOLVED_MANDATORY_REQUIREMENTS", severity: "WARN", message: `${unresolvedMandatory.length} mandatory requirement(s) not yet marked as resolved or covered by compliance evidence. Proposal is draft-ready; final submission should verify these items.` });

  const expertRequirementQty = exactSelectionLimit(tender.requirements, "EXPERT");
  if (expertRequirementQty > 0 && tender.expertMatches.length < expertRequirementQty) issues.push({ code: "EXPERT_QUANTITY_SHORTFALL", severity: "WARN", message: staffingShortfallMessage("expert", expertRequirementQty, tender.expertMatches.length) });

  const projectRequirementQty = exactSelectionLimit(tender.requirements, "PROJECT_EXPERIENCE");
  if (projectRequirementQty > 0 && tender.projectMatches.length < projectRequirementQty) issues.push({ code: "PROJECT_QUANTITY_SHORTFALL", severity: "WARN", message: staffingShortfallMessage("project", projectRequirementQty, tender.projectMatches.length) });

  const docsMissingFileNames = generatedDocs.filter((d) => !(d.exactFileName ?? "").trim());
  if (docsMissingFileNames.length > 0) issues.push({ code: "MISSING_EXACT_FILE_NAME", severity: "BLOCK", message: `${docsMissingFileNames.length} generated document(s) are missing exact file names required for export packaging.` });

  if (tender.deadline && new Date(tender.deadline) < new Date()) issues.push({ code: "DEADLINE_PASSED", severity: "WARN", message: "The tender deadline has already passed." });

  const blockCount = issues.filter((i) => i.severity === "BLOCK").length;
  const newStatus = blockCount === 0 ? "PASSED" : "FAILED";
  await prisma.generatedDocument.updateMany({ where: { id: { in: generatedDocs.map((d) => d.id) } }, data: { validationStatus: newStatus } });
  return { passed: blockCount === 0, issues, checkedAt: new Date().toISOString() };
}
