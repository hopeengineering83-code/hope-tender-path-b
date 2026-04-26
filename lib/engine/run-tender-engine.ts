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

    const reviewedExperts = company.experts.filter((expert) => expert.trustLevel === "REVIEWED");
    const reviewedProjects = company.projects.filter((project) => project.trustLevel === "REVIEWED");
    const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;

    const knowledge = {
      companyId: company.id,
      // Final compliance/matching support uses reviewed knowledge only.
      experts: reviewedExperts,
      projects: reviewedProjects,
      documents: company.documents,
      legalRecords: company.legalRecords,
      financialRecords: company.financialRecords,
      complianceRecords: company.complianceRecords,
    };

    const knowledgeReadiness = {
      reviewedExperts: reviewedExperts.length,
      reviewedProjects: reviewedProjects.length,
      aiDraftExperts: aiDraftExpertCount,
      aiDraftProjects: aiDraftProjectCount,
      regexDraftExperts: regexDraftExpertCount,
      regexDraftProjects: regexDraftProjectCount,
      hasUsableExperts: reviewedExperts.length > 0,
      hasUsableProjects: reviewedProjects.length > 0,
      hasBlockingExperts: aiDraftExpertCount + regexDraftExpertCount > 0,
      hasBlockingProjects: aiDraftProjectCount + regexDraftProjectCount > 0,
    };

    console.log("[engine] Knowledge readiness:", JSON.stringify(knowledgeReadiness));

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

    const hasDraftKnowledge = aiDraftExpertCount + regexDraftExpertCount + aiDraftProjectCount + regexDraftProjectCount > 0;
    if (hasDraftKnowledge) {
      await tx.complianceGap.create({
        data: {
          tenderId,
          requirementId: null,
          severity: "HIGH",
          title: "Draft company knowledge requires review",
          description: `The company knowledge base contains ${aiDraftExpertCount} AI_DRAFT expert(s), ${regexDraftExpertCount} REGEX_DRAFT expert(s), ${aiDraftProjectCount} AI_DRAFT project(s), and ${regexDraftProjectCount} REGEX_DRAFT project(s). Draft records are not used as final submission evidence until marked REVIEWED.`,
          mitigationPlan: "Open Company Knowledge Review, verify source evidence, correct fields, and mark valid expert/project records as REVIEWED before final generation.",
        },
      });
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

    const unresolvedMandatoryGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL" || gap.severity === "HIGH").length + (hasDraftKnowledge ? 1 : 0);
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
        notes: [
          knowledgeReadiness.hasBlockingExperts
            ? `⚠ ${knowledgeReadiness.aiDraftExperts + knowledgeReadiness.regexDraftExperts} expert record(s) are draft and excluded from final evidence until REVIEWED.`
            : null,
          knowledgeReadiness.hasBlockingProjects
            ? `⚠ ${knowledgeReadiness.aiDraftProjects + knowledgeReadiness.regexDraftProjects} project record(s) are draft and excluded from final evidence until REVIEWED.`
            : null,
          !knowledgeReadiness.hasUsableExperts
            ? `⚠ No REVIEWED experts found — review extracted CV records before final generation.`
            : null,
          !knowledgeReadiness.hasUsableProjects
            ? `⚠ No REVIEWED projects found — review extracted project records before final generation.`
            : null,
          knowledgeReadiness.reviewedExperts > 0
            ? `✓ ${knowledgeReadiness.reviewedExperts} REVIEWED expert(s) available for final generation.`
            : null,
          knowledgeReadiness.reviewedProjects > 0
            ? `✓ ${knowledgeReadiness.reviewedProjects} REVIEWED project(s) available for final generation.`
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
