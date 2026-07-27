import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../../../../lib/vault-review-provenance";

// A raw trustLevel === "REVIEWED" flag is not sufficient on its own — it can
// be stale or was never durably provenance-backed (missing
// sourceDocumentId/reviewedBy/reviewedAt, or a quote that no longer matches
// the source bytes). The same durable check the Engine's matching/generation
// gates use (canUseVaultRecord(..., "GENERATION"), which accepts a durably
// REVIEWED or durably SOURCE_VERIFIED record) must gate this summary too, or
// it can report a vault of only source-verified evidence as "not reviewed"
// and "not ready for final generation" when generation would actually
// succeed.
function countTrust(records: ReviewRecordState[]) {
  return {
    reviewed: records.filter((r) => canUseVaultRecord(r, "GENERATION")).length,
    aiDraft: records.filter((r) => r.trustLevel === "AI_DRAFT").length,
    regexDraft: records.filter((r) => r.trustLevel === "REGEX_DRAFT" || !r.trustLevel).length,
    total: records.length,
  };
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await ensureCompanyForUser(prisma, userId);
  const [experts, projects, docs] = await Promise.all([
    prisma.expert.findMany({ where: { companyId: company.id }, select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT }),
    prisma.project.findMany({ where: { companyId: company.id }, select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT }),
    prisma.companyDocument.findMany({ where: { companyId: company.id }, select: { id: true, originalFileName: true, category: true, extractedText: true } }),
  ]);

  const expertCounts = countTrust(experts);
  const projectCounts = countTrust(projects);
  const extractedDocs = docs.filter((d) => (d.extractedText ?? "").length >= 100);
  const docsWithoutDrafts = extractedDocs.filter((d) => {
    const hasExpert = experts.some((e) => e.sourceDocumentId === d.id);
    const hasProject = projects.some((p) => p.sourceDocumentId === d.id);
    return !hasExpert && !hasProject;
  });

  return NextResponse.json({
    companyId: company.id,
    documents: {
      total: docs.length,
      extracted: extractedDocs.length,
      extractedWithoutDraftRecords: docsWithoutDrafts.length,
      extractedWithoutDraftRecordsList: docsWithoutDrafts.slice(0, 20).map((d) => ({ id: d.id, fileName: d.originalFileName, category: d.category, extractedChars: d.extractedText?.length ?? 0 })),
    },
    experts: expertCounts,
    projects: projectCounts,
    pendingReview: expertCounts.aiDraft + expertCounts.regexDraft + projectCounts.aiDraft + projectCounts.regexDraft,
    readyForFinalGeneration: expertCounts.reviewed > 0 && projectCounts.reviewed > 0,
    warnings: [
      expertCounts.reviewed === 0 ? "No REVIEWED or SOURCE_VERIFIED experts are available for final generation." : null,
      projectCounts.reviewed === 0 ? "No REVIEWED or SOURCE_VERIFIED projects are available for final generation." : null,
      docsWithoutDrafts.length > 0 ? `${docsWithoutDrafts.length} extracted document(s) have no imported draft expert/project records.` : null,
      expertCounts.aiDraft + expertCounts.regexDraft > 0 ? `${expertCounts.aiDraft + expertCounts.regexDraft} expert record(s) still require review.` : null,
      projectCounts.aiDraft + projectCounts.regexDraft > 0 ? `${projectCounts.aiDraft + projectCounts.regexDraft} project record(s) still require review.` : null,
    ].filter(Boolean),
  });
}
