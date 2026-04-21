import { TenderStatus, WorkflowStage } from "@prisma/client";
import { prisma } from "../prisma";
import { analyzeTender } from "./analysis";
import { buildCompliance } from "./compliance";
import { buildDocumentPlan } from "./documents";
import { buildMatches } from "./matching";

export async function runTenderEngine(tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: true },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: true,
      projects: true,
      documents: {
        select: {
          id: true,
          type: true,
          originalFileName: true,
          classification: true,
        },
      },
    },
  });

  if (!company) {
    throw new Error("Company profile required before engine run");
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenderExpertMatch.deleteMany({ where: { tenderId } });
    await tx.tenderProjectMatch.deleteMany({ where: { tenderId } });
    await tx.complianceMatrix.deleteMany({ where: { tenderId } });
    await tx.complianceGap.deleteMany({ where: { tenderId } });
    await tx.generatedDocument.deleteMany({ where: { tenderId } });
    await tx.tenderRequirement.deleteMany({ where: { tenderId } });

    const analysis = analyzeTender(tender);

    const createdRequirements = [] as Array<{ id: string; requirement: (typeof analysis.requirements)[number] }>;
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
    };

    const matching = buildMatches(analysis.requirements, knowledge);
    for (const match of matching.expertMatches) {
      await tx.tenderExpertMatch.create({
        data: {
          tenderId,
          expertId: match.expertId,
          score: match.score,
          rationale: match.rationale,
          evidenceSummary: match.evidenceSummary,
          isSelected: match.isSelected,
        },
      });
    }

    for (const match of matching.projectMatches) {
      await tx.tenderProjectMatch.create({
        data: {
          tenderId,
          projectId: match.projectId,
          score: match.score,
          rationale: match.rationale,
          evidenceSummary: match.evidenceSummary,
          isSelected: match.isSelected,
        },
      });
    }

    const compliance = buildCompliance(createdRequirements, knowledge, matching);
    for (const matrix of compliance.matrices) {
      await tx.complianceMatrix.create({
        data: {
          tenderId,
          requirementId: matrix.requirementId,
          supportStatus: matrix.supportStatus,
          supportStrength: matrix.supportStrength,
          evidenceSummary: matrix.evidenceSummary,
          notes: matrix.notes ?? null,
        },
      });
    }

    for (const gap of compliance.gaps) {
      await tx.complianceGap.create({
        data: {
          tenderId,
          requirementId: gap.requirementId ?? null,
          severity: gap.severity,
          title: gap.title,
          description: gap.description,
          mitigationPlan: gap.mitigationPlan ?? null,
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
          exactFileName: document.exactFileName,
          exactOrder: document.exactOrder,
          contentSummary: document.contentSummary,
        },
      });
    }

    const unresolvedMandatoryGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL" || gap.severity === "HIGH").length;

    await tx.tender.update({
      where: { id: tenderId },
      data: {
        analysisSummary: analysis.summary,
        exactFileNaming: analysis.exactFileNaming,
        exactFileOrder: analysis.exactFileOrder,
        lastEngineRunAt: new Date(),
        status: unresolvedMandatoryGaps > 0 ? TenderStatus.COMPLIANCE_REVIEW : TenderStatus.MATCHED,
        stage: unresolvedMandatoryGaps > 0 ? WorkflowStage.COMPLIANCE : WorkflowStage.MATCHING,
      },
    });
  });

  return prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      files: true,
      requirements: true,
      expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
      projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      generatedDocuments: { orderBy: { exactOrder: "asc" } },
    },
  });
}
