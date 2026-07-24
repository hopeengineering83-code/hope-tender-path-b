import { prisma } from "./prisma";
import { buildReviewProvenance } from "./vault-review-provenance";

const EXPERT_SOURCE_CATEGORIES = new Set(["EXPERT_CV"]);
const PROJECT_SOURCE_CATEGORIES = new Set(["PROJECT_REFERENCE", "PROJECT_CONTRACT", "PORTFOLIO"]);
const SYSTEM_REVIEWER = "SYSTEM_AUTO_VERIFIED";

function presentFields(fields: Array<{ field: string; value: string | number | null | undefined }>) {
  return fields.filter((item) => item.value !== null && item.value !== undefined && String(item.value).trim().length > 0);
}

export async function autoVerifyCompanyKnowledge(companyId: string): Promise<{
  expertsVerified: number;
  projectsVerified: number;
  expertsBlocked: number;
  projectsBlocked: number;
}> {
  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({
      where: { companyId, trustLevel: "AI_DRAFT", sourceDocumentId: { not: null } },
      include: { sourceDocument: true },
    }),
    prisma.project.findMany({
      where: { companyId, trustLevel: "AI_DRAFT", sourceDocumentId: { not: null } },
      include: { sourceDocument: true },
    }),
  ]);

  let expertsVerified = 0;
  let projectsVerified = 0;
  let expertsBlocked = 0;
  let projectsBlocked = 0;

  for (const expert of experts) {
    const source = expert.sourceDocument;
    if (!source || source.companyId !== companyId || !EXPERT_SOURCE_CATEGORIES.has(source.category)) {
      expertsBlocked += 1;
      continue;
    }
    const reviewedAt = new Date();
    const provenance = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument: source,
      reviewerId: SYSTEM_REVIEWER,
      reviewedAt,
      fields: presentFields([
        { field: "fullName", value: expert.fullName },
        { field: "title", value: expert.title },
        { field: "yearsExperience", value: expert.yearsExperience },
      ]),
    });
    if (!provenance.ok) {
      expertsBlocked += 1;
      continue;
    }
    await prisma.expert.update({
      where: { id: expert.id },
      data: {
        trustLevel: "REVIEWED",
        reviewedBy: SYSTEM_REVIEWER,
        reviewedAt,
        reviewNotes: provenance.serialized,
      },
    });
    expertsVerified += 1;
  }

  for (const project of projects) {
    const source = project.sourceDocument;
    if (!source || source.companyId !== companyId || !PROJECT_SOURCE_CATEGORIES.has(source.category)) {
      projectsBlocked += 1;
      continue;
    }
    const reviewedAt = new Date();
    const provenance = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument: source,
      reviewerId: SYSTEM_REVIEWER,
      reviewedAt,
      fields: presentFields([
        { field: "name", value: project.name },
        { field: "clientName", value: project.clientName },
        { field: "country", value: project.country },
        { field: "sector", value: project.sector },
        { field: "contractValue", value: project.contractValue },
        { field: "currency", value: project.currency },
      ]),
    });
    if (!provenance.ok) {
      projectsBlocked += 1;
      continue;
    }
    await prisma.project.update({
      where: { id: project.id },
      data: {
        trustLevel: "REVIEWED",
        reviewedBy: SYSTEM_REVIEWER,
        reviewedAt,
        reviewNotes: provenance.serialized,
      },
    });
    projectsVerified += 1;
  }

  return { expertsVerified, projectsVerified, expertsBlocked, projectsBlocked };
}
