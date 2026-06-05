import { prisma } from "../prisma";
import { buildProposalSectionSpecs, type ProposalSectionId, buildSectionFallback } from "./proposal-sections";
import { generateWithFallback, type AIBidWriterInput } from "../ai";
import { writeSectionEvidence } from "./section-evidence-map";

export type SectionStatus = "PLANNED" | "GENERATING" | "GENERATED" | "FAILED" | "NEEDS_REVIEW" | "APPROVED" | "SUPERSEDED";

export interface SectionGenerationResult {
  sectionId: string;
  status: SectionStatus;
  content?: string;
  error?: string;
  aiProvider?: string;
}

/**
 * SectionedGenerationEngine (Phase 2)
 *
 * Manages the lifecycle of individual proposal sections.
 * Allows for resumable, multi-pass generation where failed sections can be retried
 * without regenerating the entire proposal.
 */
export class SectionedGenerationEngine {
  constructor(private tenderId: string, private proposalVersion: number = 1) {}

  /**
   * Initializes the generation plan by creating SectionEvidenceMap rows for each required section.
   */
  async initializePlan(input: AIBidWriterInput): Promise<void> {
    const specs = buildProposalSectionSpecs(input);
    for (const spec of specs) {
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
          status: "PLANNED",
        },
        create: {
          tenderId: this.tenderId,
          proposalVersion: this.proposalVersion,
          sectionId: spec.id,
          sectionTitle: spec.title,
          status: "PLANNED",
        },
      });
    }
  }

  /**
   * Generates a single section by its ID.
   */
  async generateSection(sectionId: ProposalSectionId, input: AIBidWriterInput, attemptId?: string): Promise<SectionGenerationResult> {
    const specs = buildProposalSectionSpecs(input);
    const spec = specs.find(s => s.id === sectionId);
    if (!spec) {
      throw new Error(`Section spec not found: ${sectionId}`);
    }

    // Update state to GENERATING
    await prisma.sectionEvidenceMap.update({
      where: {
        tenderId_proposalVersion_sectionId: {
          tenderId: this.tenderId,
          proposalVersion: this.proposalVersion,
          sectionId,
        },
      },
      data: {
        status: "GENERATING",
        generationAttemptId: attemptId,
      },
    });

    try {
      // Actually call the AI with fallback
      const content = await generateWithFallback(
        spec.userPrompt,
        {
          systemPrompt: spec.systemPrompt,
        }
      );

      if (!content || content.length < 100) {
        throw new Error("AI returned empty or insufficient content.");
      }

      // Update state to GENERATED
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

      // Update state to FAILED
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

  /**
   * Returns all sections for the current tender and version.
   */
  async getSections() {
    return prisma.sectionEvidenceMap.findMany({
      where: {
        tenderId: this.tenderId,
        proposalVersion: this.proposalVersion,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Resumes generation for any sections that are PLANNED or FAILED.
   */
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
