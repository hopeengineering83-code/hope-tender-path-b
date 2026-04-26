import { prisma } from "../prisma";
import { analyzeTender } from "./analysis";
import { analyzeWithAI, isAIEnabled } from "../ai";
import { buildCompliance } from "./compliance";
import { buildDocumentPlan } from "./documents";
import { buildMatches } from "./matching";

export async function runTenderEngine(tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      // Only fetch metadata + extractedText — never load fileContent (base64) into memory
      files: {
        select: { id: true, originalFileName: true, mimeType: true, classification: true, extractedText: true },
      },
    },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: true,
      projects: true,
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },
      legalRecords: true,
      financialRecords: true,
      complianceRecords: true,
    },
  });
  if (!company) throw new Error("Company profile required before engine run");

  await prisma.$transaction(async (tx) => {
    await tx.tenderExpertMatch.deleteMany({ where: { tenderId } });
    await tx.tenderProjectMatch.deleteMany({ where: { tenderId } });
    await tx.complianceGap.deleteMany({ where: { tenderId } });
    await tx.complianceMatrix.deleteMany({ where: { tenderId } });
    await tx.generatedDocument.deleteMany({ where: { tenderId } });
    await tx.tenderRequirement.deleteMany({ where: { tenderId } });

    const analysis = analyzeTender(tender);
    const createdRequirements: Array<{ id: string; requirement: (typeof analysis.requirements)[number] }> = [];

    for (const requirement of analysis.requirements) {
      const created = await tx.tenderRequirement.create({
        data: {
          tenderId,
          title: requirement.title,
          description: requirement.description,
          requirementType: requirement.requirementType,
          priority: requirement.priority,
          requiredQuantity: requirement.requiredQuantity ?? null,
          exactFileName: requirement.exactFileName ?? null,
          exactOrder: requirement.exactOrder ?? null,
          restrictions: requirement.restrictions ?? null,
          sectionReference: requirement.sectionReference ?? null,
        },
      });
      createdRequirements.push({ id: created.id, requirement });
    }

    const knowledge = {
      companyId: company.id,
      experts: company.experts,
      projects: company.projects,
      documents: company.documents,
      legalRecords: company.legalRecords,
      financialRecords: company.financialRecords,
      complianceRecords: company.complianceRecords,
    };

    // ── Knowledge readiness diagnostic ────────────────────────────────────────
    // Requirement 7: Matching uses reviewed knowledge first, draft as evidence second.
    // Surface the trust-level split so the UI can warn users before matching.
    const reviewedExpertCount = company.experts.filter((e) => e.trustLevel === "REVIEWED").length;
    const reviewedProjectCount = company.projects.filter((p) => p.trustLevel === "REVIEWED").length;
    const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;

    const knowledgeReadiness = {
      reviewedExperts: reviewedExpertCount,
      reviewedProjects: reviewedProjectCount,
      aiDraftExperts: aiDraftExpertCount,
      aiDraftProjects: aiDraftProjectCount,
      regexDraftExperts: regexDraftExpertCount,
      regexDraftProjects: regexDraftProjectCount,
      hasUsableExperts: reviewedExpertCount + aiDraftExpertCount > 0,
      hasUsableProjects: reviewedProjectCount + aiDraftProjectCount > 0,
      hasBlockingExperts: regexDraftExpertCount > 0,
      hasBlockingProjects: regexDraftProjectCount > 0,
    };

    console.log("[engine] Knowledge readiness:", JSON.stringify(knowledgeReadiness));
    // ── End knowledge readiness diagnostic ────────────────────────────────────

    const matching = buildMatches(analysis.requirements, knowledge, tender.category, tender.title);
    for (const match of matching.expertMatches) {
      await tx.tenderExpertMatch.create({ data: { tenderId, expertId: match.expertId, score: match.score, rationale: match.rationale, isSelected: match.isSelected } });
    }
    for (const match of matching.projectMatches) {
      await tx.tenderProjectMatch.create({ data: { tenderId, projectId: match.projectId, score: match.score, rationale: match.rationale, isSelected: match.isSelected } });
    }

    const compliance = buildCompliance(createdRequirements, knowledge, matching);
    for (const matrix of compliance.matrices) {
      await tx.complianceMatrix.create({
        data: {
          tenderId,
          requirementId: matrix.requirementId,
          evidenceType: matrix.evidenceType,
          evidenceSource: matrix.evidenceSource,
          evidenceReference: matrix.evidenceReference ?? null,
          supportLevel: matrix.supportStatus,
          notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null,
        },
      });
    }
    for (const gap of compliance.gaps) {
      await tx.complianceGap.create({ data: { tenderId, requirementId: gap.requirementId ?? null, severity: gap.severity, title: gap.title, description: gap.description, mitigationPlan: gap.mitigationPlan ?? null } });
    }

    const documentPlan = buildDocumentPlan(createdRequirements);
    for (const document of documentPlan.documents) {
      await tx.generatedDocument.create({
        data: {
          tenderId,
          name: document.name,
          documentType: document.documentType,
          exactFileName: document.exactFileName ?? null,
          exactOrder: typeof document.exactOrder === "number" ? document.exactOrder : null,
          contentSummary: document.contentSummary,
        },
      });
    }

    const unresolvedMandatoryGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL" || gap.severity === "HIGH").length;
    const supportedCount = compliance.matrices.filter((m) => m.supportStatus === "SUPPORTED").length;

    await tx.tender.update({
      where: { id: tenderId },
      data: {
        analysisSummary: analysis.summary,
        exactFileNaming: JSON.stringify(analysis.exactFileNaming),
        exactFileOrder: JSON.stringify(analysis.exactFileOrder),
        readinessScore: Math.max(0, Math.min(100, Math.round((supportedCount / Math.max(compliance.matrices.length, 1)) * 100))),
        status: unresolvedMandatoryGaps > 0 ? "COMPLIANCE_REVIEW" : "MATCHED",
        stage: unresolvedMandatoryGaps > 0 ? "COMPLIANCE" : "MATCHING",
        // Surface knowledge readiness in notes so the UI can warn the user
        notes: [
          knowledgeReadiness.hasBlockingExperts
            ? `⚠ ${knowledgeReadiness.regexDraftExperts} expert(s) are REGEX_DRAFT and will block generation — review them in Company Knowledge.`
            : null,
          knowledgeReadiness.hasBlockingProjects
            ? `⚠ ${knowledgeReadiness.regexDraftProjects} project(s) are REGEX_DRAFT and will block generation — review them in Company Knowledge.`
            : null,
          !knowledgeReadiness.hasUsableExperts
            ? `⚠ No REVIEWED or AI_DRAFT experts found — upload and extract CV documents first.`
            : null,
          !knowledgeReadiness.hasUsableProjects
            ? `⚠ No REVIEWED or AI_DRAFT projects found — upload and extract portfolio documents first.`
            : null,
          knowledgeReadiness.reviewedExperts > 0
            ? `✓ ${knowledgeReadiness.reviewedExperts} REVIEWED expert(s) ready for final generation.`
            : null,
          knowledgeReadiness.reviewedProjects > 0
            ? `✓ ${knowledgeReadiness.reviewedProjects} REVIEWED project(s) ready for final generation.`
            : null,
        ]
          .filter(Boolean)
          .join("\n") || null,
      },
    });
  });

  return prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      files: {
        select: { id: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true },
      },
      requirements: true,
      expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
      projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      complianceMatrix: { orderBy: { createdAt: "asc" } },
      generatedDocuments: {
        orderBy: { exactOrder: "asc" },
        select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true, contentSummary: true },
      },
    },
  });
}
