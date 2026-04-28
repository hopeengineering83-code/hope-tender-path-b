import { randomUUID } from "crypto";
import { prisma } from "../prisma";
import { analyzeTender, normalizeStrategicRequirements } from "./analysis";
import { analyzeWithAI, isAIEnabled } from "../ai";
import { buildCompliance } from "./compliance";
import { buildDocumentPlan } from "./documents";
import { buildMatches } from "./matching";

function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runTenderEngine(tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        select: { id: true, originalFileName: true, mimeType: true, classification: true, extractedText: true },
      },
    },
  });

  if (!tender) throw new Error("Tender not found");

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

  let analysis: ReturnType<typeof analyzeTender>;

  if (isAIEnabled()) {
    const tenderText = tender.files
      .map((f) => f.extractedText ?? "")
      .filter((t) => t.length > 100 && !/^\[/.test(t.trim()))
      .join("\n\n--- NEXT DOCUMENT ---\n\n")
      .slice(0, 80_000);

    if (tenderText.length > 500) {
      try {
        const aiResult = await analyzeWithAI(tenderText);
        const rawRequirements = aiResult.requirements.map((req, idx) => ({
          title: req.title,
          description: req.description,
          requirementType: req.requirementType,
          priority: req.priority,
          requiredQuantity: req.requiredQuantity ?? null,
          pageLimit: req.pageLimit ?? null,
          exactFileName: req.exactFileName ?? null,
          exactOrder: idx + 1,
          restrictions: req.restrictions ?? null,
          sectionReference: req.sectionReference ?? null,
        }));
        const strategicRequirements = normalizeStrategicRequirements(rawRequirements);
        analysis = {
          summary: `Senior consultant interpretation: consolidated ${rawRequirements.length} extracted instruction(s) into ${strategicRequirements.length} strategic requirement bundle(s). ${aiResult.summary}`,
          requirements: strategicRequirements,
          exactFileNaming: aiResult.exactFileNaming ?? [],
          exactFileOrder: aiResult.exactFileOrder ?? [],
        };
      } catch (err) {
        console.error("[engine] AI analysis failed — falling back to regex:", err);
        analysis = analyzeTender(tender);
      }
    } else {
      analysis = analyzeTender(tender);
    }
  } else {
    analysis = analyzeTender(tender);
  }

  const reviewedExperts = company.experts.filter((expert) => expert.trustLevel === "REVIEWED");
  const reviewedProjects = company.projects.filter((project) => project.trustLevel === "REVIEWED");
  const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
  const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
  const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
  const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;

  const knowledge = {
    companyId: company.id,
    experts: [...reviewedExperts, ...company.experts.filter((e) => e.trustLevel !== "REVIEWED")],
    projects: [...reviewedProjects, ...company.projects.filter((p) => p.trustLevel !== "REVIEWED")],
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

  const matching = buildMatches(analysis.requirements, knowledge, tender.category, tender.title);
  const createdRequirements = analysis.requirements.map((requirement) => ({ id: randomUUID(), requirement }));
  const requirementRows = createdRequirements.map(({ id, requirement }) => ({
    id,
    tenderId,
    title: requirement.title,
    description: requirement.description,
    requirementType: requirement.requirementType,
    priority: requirement.priority,
    requiredQuantity: requirement.requiredQuantity ?? null,
    pageLimit: requirement.pageLimit ?? null,
    exactFileName: requirement.exactFileName ?? null,
    exactOrder: requirement.exactOrder ?? null,
    restrictions: requirement.restrictions ?? null,
    sectionReference: requirement.sectionReference ?? null,
  }));

  const compliance = buildCompliance(createdRequirements, knowledge, matching);
  const hasDraftKnowledge = aiDraftExpertCount + regexDraftExpertCount + aiDraftProjectCount + regexDraftProjectCount > 0;
  const documentPlan = buildDocumentPlan(createdRequirements);
  const hardGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL").length;
  const reviewGaps = compliance.gaps.filter((gap) => gap.severity === "HIGH").length + (hasDraftKnowledge ? 1 : 0);
  const reviewNeeded = hardGaps > 0 || reviewGaps > 0;
  const supportedOrReviewableCount = compliance.matrices.filter((m) => ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(m.supportStatus)).length;
  const readinessScore = Math.max(0, Math.min(100, Math.round((supportedOrReviewableCount / Math.max(compliance.matrices.length, 1)) * 100)));

  await prisma.tenderExpertMatch.deleteMany({ where: { tenderId } });
  await prisma.tenderProjectMatch.deleteMany({ where: { tenderId } });
  await prisma.complianceGap.deleteMany({ where: { tenderId } });
  await prisma.complianceMatrix.deleteMany({ where: { tenderId } });
  await prisma.generatedDocument.deleteMany({ where: { tenderId } });
  await prisma.tenderRequirement.deleteMany({ where: { tenderId } });

  for (const batch of chunks(requirementRows, 100)) await prisma.tenderRequirement.createMany({ data: batch });

  const expertMatchRows = matching.expertMatches.map((match) => ({ tenderId, expertId: match.expertId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));
  for (const batch of chunks(expertMatchRows, 100)) await prisma.tenderExpertMatch.createMany({ data: batch, skipDuplicates: true });

  const projectMatchRows = matching.projectMatches.map((match) => ({ tenderId, projectId: match.projectId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));
  for (const batch of chunks(projectMatchRows, 100)) await prisma.tenderProjectMatch.createMany({ data: batch, skipDuplicates: true });

  const matrixRows = compliance.matrices.map((matrix) => ({
    tenderId,
    requirementId: matrix.requirementId,
    evidenceType: matrix.evidenceType,
    evidenceSource: matrix.evidenceSource,
    evidenceReference: matrix.evidenceReference ?? null,
    supportLevel: matrix.supportStatus,
    notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null,
  }));
  for (const batch of chunks(matrixRows, 100)) await prisma.complianceMatrix.createMany({ data: batch });

  const gapRows = compliance.gaps.map((gap) => ({
    tenderId,
    requirementId: gap.requirementId ?? null,
    severity: gap.severity,
    title: gap.title,
    description: gap.description,
    mitigationPlan: gap.mitigationPlan ?? null,
  }));
  if (hasDraftKnowledge) {
    gapRows.push({
      tenderId,
      requirementId: null,
      severity: "HIGH",
      title: "Draft company knowledge requires review",
      description: `The company knowledge base contains ${aiDraftExpertCount} AI_DRAFT expert(s), ${regexDraftExpertCount} REGEX_DRAFT expert(s), ${aiDraftProjectCount} AI_DRAFT project(s), and ${regexDraftProjectCount} REGEX_DRAFT project(s). Draft records are not used as final submission evidence until marked REVIEWED.`,
      mitigationPlan: "Open Company Knowledge Review, verify source evidence, correct fields, and mark valid expert/project records as REVIEWED before final generation.",
    });
  }
  for (const batch of chunks(gapRows, 100)) await prisma.complianceGap.createMany({ data: batch });

  const documentRows = documentPlan.documents.map((document) => ({
    tenderId,
    name: document.name,
    documentType: document.documentType,
    exactFileName: document.exactFileName ?? null,
    exactOrder: typeof document.exactOrder === "number" ? document.exactOrder : null,
    contentSummary: document.contentSummary,
  }));
  for (const batch of chunks(documentRows, 100)) await prisma.generatedDocument.createMany({ data: batch });

  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      analysisSummary: analysis.summary,
      exactFileNaming: JSON.stringify(analysis.exactFileNaming),
      exactFileOrder: JSON.stringify(analysis.exactFileOrder),
      readinessScore,
      status: reviewNeeded ? "COMPLIANCE_REVIEW" : "MATCHED",
      stage: reviewNeeded ? "COMPLIANCE" : "MATCHING",
      notes: [
        "Senior consultant mode: broad-fit matching uses capability families, sector/service equivalence, and professional judgment instead of exact wording only.",
        hardGaps > 0 ? `${hardGaps} hard evidence gap(s) remain.` : null,
        reviewGaps > 0 ? `${reviewGaps} senior review item(s) remain; these are not automatic fatal blockers.` : null,
        knowledgeReadiness.hasBlockingExperts ? `${knowledgeReadiness.aiDraftExperts + knowledgeReadiness.regexDraftExperts} expert record(s) are draft and excluded from final evidence until REVIEWED.` : null,
        knowledgeReadiness.hasBlockingProjects ? `${knowledgeReadiness.aiDraftProjects + knowledgeReadiness.regexDraftProjects} project record(s) are draft and excluded from final evidence until REVIEWED.` : null,
        !knowledgeReadiness.hasUsableExperts ? "No REVIEWED experts found — review extracted CV records before final generation." : null,
        !knowledgeReadiness.hasUsableProjects ? "No REVIEWED projects found — review extracted project records before final generation." : null,
        knowledgeReadiness.reviewedExperts > 0 ? `${knowledgeReadiness.reviewedExperts} REVIEWED expert(s) available for final generation.` : null,
        knowledgeReadiness.reviewedProjects > 0 ? `${knowledgeReadiness.reviewedProjects} REVIEWED project(s) available for final generation.` : null,
      ].filter(Boolean).join("\n") || null,
    },
  });

  return prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      files: { select: { id: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true } },
      requirements: true,
      expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
      projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      complianceMatrix: { orderBy: { createdAt: "asc" } },
      generatedDocuments: { orderBy: { exactOrder: "asc" }, select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true, contentSummary: true } },
    },
  });
}
