import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../../../../lib/vault-review-provenance";

// Raw trust labels are not runtime authority. The same durable source/review
// contract used by matching, generation, and export owns this summary.
function countTrust(records: ReviewRecordState[]) {
  return {
    verified: records.filter((record) => canUseVaultRecord(record, "GENERATION")).length,
    aiDraft: records.filter((record) => record.trustLevel === "AI_DRAFT").length,
    regexDraft: records.filter((record) => record.trustLevel === "REGEX_DRAFT" || !record.trustLevel).length,
    total: records.length,
  };
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await ensureCompanyForUser(prisma, userId);
  const [experts, projects, docs] = await Promise.all([
    prisma.expert.findMany({ where: { companyId: company.id, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT }),
    prisma.project.findMany({ where: { companyId: company.id, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT }),
    prisma.companyDocument.findMany({ where: { companyId: company.id }, select: { id: true, originalFileName: true, category: true, extractedText: true } }),
  ]);

  const expertCounts = countTrust(experts);
  const projectCounts = countTrust(projects);
  const extractedDocs = docs.filter((document) => (document.extractedText ?? "").length >= 100);
  const docsWithoutDrafts = extractedDocs.filter((document) => {
    const hasExpert = experts.some((expert) => expert.sourceDocumentId === document.id);
    const hasProject = projects.some((project) => project.sourceDocumentId === document.id);
    return !hasExpert && !hasProject;
  });
  const pendingVerification =
    expertCounts.aiDraft + expertCounts.regexDraft + projectCounts.aiDraft + projectCounts.regexDraft;

  return NextResponse.json({
    companyId: company.id,
    documents: {
      total: docs.length,
      extracted: extractedDocs.length,
      extractedWithoutDraftRecords: docsWithoutDrafts.length,
      extractedWithoutDraftRecordsList: docsWithoutDrafts.slice(0, 20).map((document) => ({
        id: document.id,
        fileName: document.originalFileName,
        category: document.category,
        extractedChars: document.extractedText?.length ?? 0,
      })),
    },
    experts: {
      ...expertCounts,
      // Compatibility alias for older clients. This count means durably usable
      // evidence, not mandatory human review.
      reviewed: expertCounts.verified,
    },
    projects: {
      ...projectCounts,
      reviewed: projectCounts.verified,
    },
    pendingVerification,
    // Deprecated compatibility alias. No human approval workflow is implied.
    pendingReview: pendingVerification,
    readyForFinalGeneration: expertCounts.verified > 0 && projectCounts.verified > 0,
    warnings: [
      expertCounts.verified === 0 ? "No source-verified expert evidence is available for generation yet." : null,
      projectCounts.verified === 0 ? "No source-verified project evidence is available for generation yet." : null,
      docsWithoutDrafts.length > 0 ? `${docsWithoutDrafts.length} extracted document(s) have no imported expert/project records.` : null,
      expertCounts.aiDraft + expertCounts.regexDraft > 0 ? `${expertCounts.aiDraft + expertCounts.regexDraft} expert record(s) are awaiting automatic source verification.` : null,
      projectCounts.aiDraft + projectCounts.regexDraft > 0 ? `${projectCounts.aiDraft + projectCounts.regexDraft} project record(s) are awaiting automatic source verification.` : null,
    ].filter(Boolean),
  });
}
