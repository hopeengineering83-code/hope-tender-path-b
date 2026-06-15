import { prisma } from "../prisma";
import { buildProposalSectionSpecs, type ProposalSectionId, buildSectionFallback } from "./proposal-sections";
import { generateWithFallback, type AIBidWriterInput } from "../ai";
import { inferSectionRequirementIds, writeSectionEvidence, type RequirementForEvidenceMap } from "../infrastructure/section-evidence-map";

export type SectionStatus = "PLANNED" | "GENERATING" | "GENERATED" | "FAILED" | "NEEDS_REVIEW" | "APPROVED" | "SUPERSEDED";

export interface SectionGenerationResult {
  sectionId: string;
  status: SectionStatus;
  content?: string;
  error?: string;
  aiProvider?: string;
}

async function loadEvidenceContext(tenderId: string, sectionId: string, sectionTitle: string, sectionText = "") {
  const [requirements, expertMatches, projectMatches] = await Promise.all([
    prisma.tenderRequirement.findMany({
      where: { tenderId },
      select: { id: true, title: true, description: true, requirementType: true, priority: true },
    }).catch(() => [] as RequirementForEvidenceMap[]),
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: true },
      select: { expertId: true },
    }).catch(() => [] as Array<{ expertId: string }>),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: true },
      select: { projectId: true },
    }).catch(() => [] as Array<{ projectId: string }>),
  ]);

  return {
    requirementIds: inferSectionRequirementIds({ sectionId, sectionTitle, sectionText, requirements }),
    expertIds: expertMatches.map((match) => match.expertId),
    projectIds: projectMatches.map((match) => match.projectId),
  };
}

export class SectionedGenerationEngine {
  constructor(private tenderId: string, private proposalVersion: number = 1) {}

  async initializePlan(input: AIBidWriterInput): Promise<void> {
    const specs = buildProposalSectionSpecs(input);
    for (const spec of specs) {
      const evidence = await loadEvidenceContext(this.tenderId, spec.id, spec.title, spec.userPrompt);
      await prisma.sectionEvidenceMap.upsert({
        where: {
          tenderId_proposalVersion_sectionId: {
            tenderId: this.tenderId,
            proposalVersion: this.proposalVersion,
            sectionId: spec.id,
          },
        },
        update: {
          sectionTitle: spec.title,
          requirementIds: evidence.requirementIds.join("|"),
          expertIds: evidence.expertIds.join("|"),
          projectIds: evidence.projectIds.join("|"),
          status: "PLANNED",
        },
        create: {
          tenderId: this.tenderId,
          proposalVersion: this.proposalVersion,
          sectionId: spec.id,
          sectionTitle: spec.title,
          requirementIds: evidence.requirementIds.join("|"),
          expertIds: evidence.expertIds.join("|"),
          projectIds: evidence.projectIds.join("|"),
          status: "PLANNED",
        },
      });
    }
  }

  async generateSection(sectionId: ProposalSectionId, input: AIBidWriterInput, attemptId?: string): Promise<SectionGenerationResult> {
    const specs = buildProposalSectionSpecs(input);
    const spec = specs.find(s => s.id === sectionId);
    if (!spec) {
      throw new Error(`Section spec not found: ${sectionId}`);
    }

    await prisma.sectionEvidenceMap.upsert({
      where: {
        tenderId_proposalVersion_sectionId: {
          tenderId: this.tenderId,
          proposalVersion: this.proposalVersion,
          sectionId,
        },
      },
      update: {
        status: "GENERATING",
        generationAttemptId: attemptId,
      },
      create: {
        tenderId: this.tenderId,
        proposalVersion: this.proposalVersion,
        sectionId,
        sectionTitle: spec.title,
        status: "GENERATING",
        generationAttemptId: attemptId,
      },
    });

    try {
      const content = await generateWithFallback(
        spec.userPrompt,
        {
          systemPrompt: spec.systemPrompt,
        }
      );

      if (!content || content.length < 100) {
        throw new Error("AI returned empty or insufficient content.");
      }

      const evidence = await loadEvidenceContext(this.tenderId, sectionId, spec.title, content);
      await writeSectionEvidence({
        tenderId: this.tenderId,
        proposalVersion: this.proposalVersion,
        sectionId,
        sectionTitle: spec.title,
        text: content,
        requirementIds: evidence.requirementIds,
        expertIds: evidence.expertIds,
        projectIds: evidence.projectIds,
      });

      await prisma.sectionEvidenceMap.update({
        where: {
          tenderId_proposalVersion_sectionId: {
            tenderId: this.tenderId,
            proposalVersion: this.proposalVersion,
            sectionId,
          },
        },
        data: {
          status: "GENERATED",
          content,
          lastGeneratedAt: new Date(),
          wordCount: content.split(/\s+/).filter(Boolean).length,
        },
      });

      return { sectionId, status: "GENERATED", content };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      await prisma.sectionEvidenceMap.update({
        where: {
          tenderId_proposalVersion_sectionId: {
            tenderId: this.tenderId,
            proposalVersion: this.proposalVersion,
            sectionId,
          },
        },
        data: {
          status: "FAILED",
          reviewerNote: `Generation failed: ${error}`,
        },
      });

      return { sectionId, status: "FAILED", error };
    }
  }

  async getSections() {
    return prisma.sectionEvidenceMap.findMany({
      where: {
        tenderId: this.tenderId,
        proposalVersion: this.proposalVersion,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async resumeGeneration(input: AIBidWriterInput, attemptId?: string): Promise<SectionGenerationResult[]> {
    const sections = await this.getSections();
    const toGenerate = sections.filter(s => s.status === "PLANNED" || s.status === "FAILED");

    const results: SectionGenerationResult[] = [];
    for (const section of toGenerate) {
      const result = await this.generateSection(section.sectionId as ProposalSectionId, input, attemptId);
      results.push(result);
    }

    return results;
  }
}
