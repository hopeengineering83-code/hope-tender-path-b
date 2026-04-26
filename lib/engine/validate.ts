import { prisma } from "../prisma";

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

export async function validateTender(tenderId: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];

  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: true,
      complianceGaps: true,
      generatedDocuments: true,
      expertMatches: { where: { isSelected: true } },
      projectMatches: { where: { isSelected: true } },
    },
  });

  if (!tender) {
    return {
      passed: false,
      issues: [{ code: "TENDER_NOT_FOUND", severity: "BLOCK", message: "Tender not found." }],
      checkedAt: new Date().toISOString(),
    };
  }

  // ── Trust-level enforcement: ALL selected records must be REVIEWED ──────────
  // Rule 1: REGEX_DRAFT records are pattern-extracted and unreliable → BLOCK.
  // Rule 2: AI_DRAFT records are Gemini-extracted but unreviewed → BLOCK.
  //   Rationale: generate.ts hard-blocks ALL non-REVIEWED records.
  //   Reporting AI_DRAFT as a warning-only would lie to the user (validation
  //   says "ok", generation throws). Both must agree: REVIEWED = required.
  // Rule 3: Surface reviewed-record count so UI can guide the user.

  const selectedExpertIds = tender.expertMatches.map((m) => m.expertId);
  const selectedProjectIds = tender.projectMatches.map((m) => m.projectId);

  if (selectedExpertIds.length > 0) {
    const experts = await prisma.expert.findMany({
      where: { id: { in: selectedExpertIds } },
      select: { id: true, fullName: true, trustLevel: true },
    });
    const unreviewed = experts.filter((e) => e.trustLevel !== "REVIEWED");
    const regexDraft = experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT");
    const aiDraft = experts.filter((e) => e.trustLevel === "AI_DRAFT");

    if (regexDraft.length > 0) {
      issues.push({
        code: "REGEX_DRAFT_EXPERT_SELECTED",
        severity: "BLOCK",
        message:
          `${regexDraft.length} selected expert(s) are REGEX_DRAFT — pattern-extracted records with low reliability. ` +
          `Re-run AI extraction (Company Knowledge → Repair) to promote them to AI_DRAFT, then review and mark REVIEWED. ` +
          `Affected: ${regexDraft.map((e) => e.fullName).join(", ")}.`,
      });
    }

    if (aiDraft.length > 0) {
      issues.push({
        code: "AI_DRAFT_EXPERT_NOT_REVIEWED",
        severity: "BLOCK",
        message:
          `${aiDraft.length} selected expert(s) are AI_DRAFT (Gemini-extracted) but not yet reviewed. ` +
          `Open Company Knowledge → Review, verify each expert's details against source documents, ` +
          `and mark them REVIEWED before generating. ` +
          `Affected: ${aiDraft.map((e) => e.fullName).join(", ")}.`,
      });
    }

    if (unreviewed.length === 0 && experts.length > 0) {
      // All selected experts are REVIEWED — surface positive signal
      issues.push({
        code: "EXPERTS_ALL_REVIEWED",
        severity: "WARN",
        message: `✓ All ${experts.length} selected expert(s) are REVIEWED.`,
      });
    }
  }

  if (selectedProjectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { id: { in: selectedProjectIds } },
      select: { id: true, name: true, trustLevel: true },
    });
    const regexDraft = projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT");
    const aiDraft = projects.filter((p) => p.trustLevel === "AI_DRAFT");

    if (regexDraft.length > 0) {
      issues.push({
        code: "REGEX_DRAFT_PROJECT_SELECTED",
        severity: "BLOCK",
        message:
          `${regexDraft.length} selected project(s) are REGEX_DRAFT — pattern-extracted records with low reliability. ` +
          `Re-run AI extraction (Company Knowledge → Repair) to promote them to AI_DRAFT, then review and mark REVIEWED. ` +
          `Affected: ${regexDraft.map((p) => p.name).join(", ")}.`,
      });
    }

    if (aiDraft.length > 0) {
      issues.push({
        code: "AI_DRAFT_PROJECT_NOT_REVIEWED",
        severity: "BLOCK",
        message:
          `${aiDraft.length} selected project(s) are AI_DRAFT (Gemini-extracted) but not yet reviewed. ` +
          `Open Company Knowledge → Review, verify each project's details against source documents, ` +
          `and mark them REVIEWED before generating. ` +
          `Affected: ${aiDraft.map((p) => p.name).join(", ")}.`,
      });
    }
  }
  // ── End trust-level enforcement ────────────────────────────────────────────

  const generatedDocs = tender.generatedDocuments
    .filter((d) => d.generationStatus === "GENERATED")
    .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER));

  const blockingGaps = tender.complianceGaps.filter(
    (g) => !g.isResolved && ["CRITICAL", "HIGH"].includes(g.severity),
  );
  if (blockingGaps.length > 0) {
    issues.push({
      code: "UNRESOLVED_COMPLIANCE_GAPS",
      severity: "BLOCK",
      message: `${blockingGaps.length} unresolved critical/high compliance gap(s) must be addressed before export.`,
    });
  }

  if (generatedDocs.length === 0) {
    issues.push({
      code: "NO_GENERATED_DOCUMENTS",
      severity: "BLOCK",
      message: "No documents have been generated yet. Run document generation first.",
    });
  }

  for (const doc of generatedDocs) {
    const textToCheck = [doc.contentSummary ?? "", doc.name, doc.exactFileName ?? ""].join(" ");
    if (hasPlaceholder(textToCheck)) {
      issues.push({
        code: "PLACEHOLDER_IN_DOCUMENT",
        severity: "BLOCK",
        message: `Document "${doc.name}" contains placeholder text that must be replaced.`,
      });
    }
  }

  const requiredNames = safeParseArr(tender.exactFileNaming);
  if (requiredNames.length > 0) {
    const generatedNames = generatedDocs.map((d) => (d.exactFileName ?? d.name).trim().toLowerCase());
    const normalizedRequired = requiredNames.map((name) => name.trim().toLowerCase());
    const missing = normalizedRequired.filter((name) => !generatedNames.includes(name));
    const extras = generatedNames.filter((name) => !normalizedRequired.includes(name));

    if (missing.length > 0) {
      issues.push({
        code: "MISSING_REQUIRED_FILES",
        severity: "BLOCK",
        message: `The following tender-required file name(s) are missing from generated documents: ${missing.join(", ")}`,
      });
    }

    if (extras.length > 0) {
      issues.push({
        code: "EXTRA_GENERATED_FILES",
        severity: "BLOCK",
        message: `Generated package includes extra file(s) not present in the tender naming rules: ${extras.join(", ")}`,
      });
    }

    if (generatedDocs.length !== normalizedRequired.length) {
      issues.push({
        code: "FILE_COUNT_MISMATCH",
        severity: "BLOCK",
        message: `Tender requires exactly ${normalizedRequired.length} named file(s), but ${generatedDocs.length} generated file(s) are currently marked as generated.`,
      });
    }
  }

  const requiredOrder = safeParseArr(tender.exactFileOrder).map((name) => name.trim().toLowerCase());
  if (requiredOrder.length > 0) {
    const actualOrder = generatedDocs.map((d) => (d.exactFileName ?? d.name).trim().toLowerCase());
    const outOfOrder = requiredOrder.some((name, index) => actualOrder[index] !== name);
    if (outOfOrder) {
      issues.push({
        code: "FILE_ORDER_MISMATCH",
        severity: "BLOCK",
        message: `Generated document order does not match the tender-required order. Expected: ${requiredOrder.join(" -> ")}.`,
      });
    }
  }

  const unresolvedMandatory = tender.requirements.filter(
    (r) => r.priority === "MANDATORY" && !r.isResolved,
  );
  if (unresolvedMandatory.length > 0) {
    issues.push({
      code: "UNRESOLVED_MANDATORY_REQUIREMENTS",
      severity: "WARN",
      message: `${unresolvedMandatory.length} mandatory requirement(s) not yet marked as resolved.`,
    });
  }

  const expertRequirementQty = tender.requirements
    .filter((r) => r.requiredQuantity && r.requirementType === "EXPERT")
    .reduce((sum, r) => sum + (r.requiredQuantity ?? 0), 0);
  if (expertRequirementQty > 0 && tender.expertMatches.length < expertRequirementQty) {
    issues.push({
      code: "EXPERT_QUANTITY_MISMATCH",
      severity: "BLOCK",
      message: `Tender requires at least ${expertRequirementQty} expert selection(s), but only ${tender.expertMatches.length} are selected.`,
    });
  }

  const projectRequirementQty = tender.requirements
    .filter((r) => r.requiredQuantity && r.requirementType === "PROJECT_EXPERIENCE")
    .reduce((sum, r) => sum + (r.requiredQuantity ?? 0), 0);
  if (projectRequirementQty > 0 && tender.projectMatches.length < projectRequirementQty) {
    issues.push({
      code: "PROJECT_QUANTITY_MISMATCH",
      severity: "BLOCK",
      message: `Tender requires at least ${projectRequirementQty} project reference(s), but only ${tender.projectMatches.length} are selected.`,
    });
  }

  const docsMissingFileNames = generatedDocs.filter((d) => !(d.exactFileName ?? "").trim());
  if (docsMissingFileNames.length > 0) {
    issues.push({
      code: "MISSING_EXACT_FILE_NAME",
      severity: "BLOCK",
      message: `${docsMissingFileNames.length} generated document(s) are missing exact file names required for export packaging.`,
    });
  }

  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    issues.push({
      code: "DEADLINE_PASSED",
      severity: "WARN",
      message: "The tender deadline has already passed.",
    });
  }

  const blockCount = issues.filter((i) => i.severity === "BLOCK").length;
  const newStatus = blockCount === 0 ? "PASSED" : "FAILED";

  await prisma.generatedDocument.updateMany({
    where: { tenderId, generationStatus: "GENERATED" },
    data: { validationStatus: newStatus },
  });

  return {
    passed: blockCount === 0,
    issues,
    checkedAt: new Date().toISOString(),
  };
}
