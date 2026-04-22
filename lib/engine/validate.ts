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

export async function validateTender(tenderId: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];

  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: true,
      complianceGaps: true,
      generatedDocuments: true,
    },
  });

  if (!tender) {
    return {
      passed: false,
      issues: [{ code: "TENDER_NOT_FOUND", severity: "BLOCK", message: "Tender not found." }],
      checkedAt: new Date().toISOString(),
    };
  }

  // 1. Check for unresolved blocking compliance gaps
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

  // 2. Check that at least one document has been generated
  const generatedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
  if (generatedDocs.length === 0) {
    issues.push({
      code: "NO_GENERATED_DOCUMENTS",
      severity: "BLOCK",
      message: "No documents have been generated yet. Run document generation first.",
    });
  }

  // 3. Check each generated document for placeholder text
  for (const doc of generatedDocs) {
    const textToCheck = [doc.contentSummary ?? "", doc.name].join(" ");
    if (hasPlaceholder(textToCheck)) {
      issues.push({
        code: "PLACEHOLDER_IN_DOCUMENT",
        severity: "BLOCK",
        message: `Document "${doc.name}" contains placeholder text that must be replaced.`,
      });
    }
  }

  // 4. Check file naming against tender requirements
  const safeParseArr = (v: unknown): string[] => {
    try { return JSON.parse(v as string) as string[]; } catch { return []; }
  };
  const requiredNames = safeParseArr(tender.exactFileNaming);
  if (requiredNames.length > 0) {
    const generatedNames = generatedDocs.map((d) => d.exactFileName ?? d.name);
    const missing = requiredNames.filter(
      (name) => !generatedNames.some((g) => g.toLowerCase().includes(name.toLowerCase())),
    );
    if (missing.length > 0) {
      issues.push({
        code: "MISSING_REQUIRED_FILES",
        severity: "WARN",
        message: `The following required file name(s) have no matching generated document: ${missing.join(", ")}`,
      });
    }
  }

  // 5. Check all mandatory requirements are addressed
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

  // 6. Check deadline is not in the past
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    issues.push({
      code: "DEADLINE_PASSED",
      severity: "WARN",
      message: "The tender deadline has already passed.",
    });
  }

  const blockCount = issues.filter((i) => i.severity === "BLOCK").length;

  // Update validation status on all generated documents
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
