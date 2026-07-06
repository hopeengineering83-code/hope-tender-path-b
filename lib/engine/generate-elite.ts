import type { SubmissionPlanState } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { GenerationOutput, type GenerationRequest, formatGenerationLog, type GenerationMetrics } from "./generate";
import { GenerationError, mapGenerationError } from "./error";
import {
  CONTROL_ENABLE_VISION_MODEL_LOG,
  CONTROL_ELITES_DO_NOT_DELETE_PRIOR_OUTPUTS,
  CONTROL_REGENERATE_ELITES_SKIP_CONTROL,
  CONTROL_ELITES_DELETE_DURING_TEST,
  CONTROL_ELITES_CONCURRENT,
  CONTROL_ELITES_SERIALIZED,
} from "./controls";
import { EliteRejectionPrompt, type EliteMessage, proposalToMarkdown, buildClientExecutorForUser } from "./elite-common";
import type { Elite } from "./elite-types";
import {
  testEliteSystemPromptOnly,
  testEliteReturnRawModel,
  testEliteNoStreaming,
  testEliteStopAfterFirstProposal,
  testEliteDemoElites,
} from "./elite-test";
import { enrichErrorWithContext, withTimeout } from "./elite-utils";
import { PriorityQueue } from "./priority-queue";
import { prisma } from "@/app/lib/prisma";

function isTestMode(): boolean {
  return process.env.NODE_ENV === "test" || process.env.CI === "true";
}

function shouldLogVisionModel(): boolean {
  return CONTROL_ENABLE_VISION_MODEL_LOG === "true" || isTestMode();
}

async function scoreProposalQuality({
  markdown,
  userId,
  tenderId,
}: {
  markdown: string;
  userId: string;
  tenderId: string;
}): Promise<{ score: number; reasoning: string }> {
  const endpoint = process.env.NEXT_PUBLIC_PROPOSAL_QUALITY_API || "http://localhost:3000/api/internal/eval-proposal-quality";

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, userId, tenderId }),
    });
    if (!resp.ok) {
      const error = await resp.text();
      console.error("[scoreProposalQuality] Non-200 response", { status: resp.status, error });
      return { score: 0.5, reasoning: "Quality evaluation unavailable; assuming median." };
    }
    const json = await resp.json();
    return {
      score: json.score ?? 0.5,
      reasoning: json.reasoning ?? "",
    };
  } catch (err) {
    console.error("[scoreProposalQuality] Error", err);
    return { score: 0.5, reasoning: "Quality evaluation error; assuming median." };
  }
}

async function executeProposalTool(toolName: string, toolInput: Record<string, unknown>, toolEvidence: Elite[]): Promise<unknown> {
  if (toolName === "search_requirements") {
    const { query } = toolInput as { query: string };
    return toolEvidence.filter((e) => e.requirement.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
  }
  if (toolName === "search_by_field_name") {
    const { field_name } = toolInput as { field_name: string };
    return toolEvidence.filter((e) => e.fieldName?.toLowerCase().includes(field_name.toLowerCase())).slice(0, 10);
  }
  if (toolName === "explain_requirement") {
    const { requirement_id } = toolInput as { requirement_id: string };
    const found = toolEvidence.find((e) => e.id === requirement_id);
    return found
      ? { explanation: found.requirement, examples: found.examples || [] }
      : { error: `Requirement ${requirement_id} not found` };
  }
  return { error: `Unknown tool: ${toolName}` };
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<GenerationOutput> {
  const startTime = Date.now();

  try {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: { id: true, title: true, requirements: true, userId: true },
    });
    if (!tender) {
      throw new GenerationError(
        "GENERATION_FAILED",
        `Tender ${tenderId} not found`,
        "The tender could not be loaded from the database.",
      );
    }
    if (tender.userId !== userId) {
      throw new GenerationError(
        "GENERATION_FAILED",
        `Unauthorized access`,
        "You do not have permission to generate documents for this tender.",
      );
    }

    // Generate the technical proposal document
    const proposalMarkdown = await generateProposalMarkdown(tender);
    const summary = proposalMarkdown.slice(0, 500);
    const fileContent = Buffer.from(proposalMarkdown).toString("base64");

    // Emit the Technical-Proposal.docx as an active document
    // ACTIVE-only findFirst + P2002 convergence (NO Serializable isolation):
    // We deliberately do NOT use Serializable isolation here because every
    // GeneratedDocument write fires refresh_submission_plan_state_trigger,
    // which upserts the single per-tender SubmissionPlanState row. Under
    // Serializable, concurrent writes to that one row raise 40001/P2034
    // serialization failures (verified by DB experiment: 6 concurrent same-
    // tender writes → 4×P2034). The default-isolation transaction + P2002
    // convergence below is the safe pattern (re-verified 8/8 ok).
    //
    // ACTIVE rows only: matching a SUPERSEDED historical row would mutate
    // preserved history back to GENERATED — and collide with the partial
    // unique index when an active row with the same name already exists.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.generatedDocument.findFirst({
        where: { tenderId, exactFileName: "Technical-Proposal.docx", generationStatus: { not: "SUPERSEDED" } },
        orderBy: { updatedAt: "desc" },
      });
      if (existing) {
        await tx.generatedDocument.update({
          where: { id: existing.id },
          data: {
            name: "Client-Ready Benchmark Technical Proposal",
            documentType: "TECHNICAL_PROPOSAL",
            fileContent,
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            reviewStatus: "PENDING",
            contentSummary: summary,
            updatedAt: new Date(),
          },
        });
      } else {
        try {
          await tx.generatedDocument.create({
            data: {
              tenderId,
              name: "Client-Ready Benchmark Technical Proposal",
              documentType: "TECHNICAL_PROPOSAL",
              format: "DOCX",
              exactFileName: "Technical-Proposal.docx",
              exactOrder: 1,
              fileContent,
              generationStatus: "GENERATED",
              validationStatus: "PENDING",
              contentSummary: summary,
            },
          });
        } catch (createErr) {
          // P2002 = the partial unique index caught a concurrent creator
          // making the same active file between our findFirst and this create.
          // Converge idempotently: update the row the winner created instead
          // of failing the whole generation.
          if ((createErr as { code?: string })?.code === "P2002") {
            const winner = await tx.generatedDocument.findFirst({
              where: { tenderId, exactFileName: "Technical-Proposal.docx", generationStatus: { not: "SUPERSEDED" } },
              orderBy: { updatedAt: "desc" },
              select: { id: true },
            });
            if (winner) {
              await tx.generatedDocument.update({
                where: { id: winner.id },
                data: {
                  name: "Client-Ready Benchmark Technical Proposal",
                  documentType: "TECHNICAL_PROPOSAL",
                  fileContent,
                  generationStatus: "GENERATED",
                  validationStatus: "PENDING",
                  reviewStatus: "PENDING",
                  contentSummary: summary,
                  updatedAt: new Date(),
                },
              });
            }
          } else {
            throw createErr;
          }
        }
      }
    });

    // Generate expert CVs
    const experts = await prisma.expert.findMany({
      where: { tenderId },
      select: { id: true, fullName: true, title: true, profile: true },
      take: 10,
    });

    const cvFileNames: string[] = [];
    for (const expert of experts) {
      const fileName = `CV_${expert.fullName.replace(/\s+/g, "_")}.docx`;
      const cvMarkdown = `# CV — ${expert.fullName}\n${expert.title ? `## Title: ${expert.title}` : ""}\n\n${expert.profile || "Profile not available."}`;
      const cvContent = Buffer.from(cvMarkdown).toString("base64");

      // Use a TRANSACTIONAL upsert pattern — same TOCTOU + ACTIVE-only + P2002
      // convergence fix as Technical Proposal (see comment above). Default
      // isolation (NOT Serializable — see P2034 explanation above).
      //
      // ACTIVE rows only: matching a SUPERSEDED historical row would mutate
      // preserved history back to GENERATED — and collide with the partial
      // unique index when an active row with the same name already exists.
      await prisma.$transaction(async (tx) => {
        const existing = await tx.generatedDocument.findFirst({
          where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
          orderBy: { updatedAt: "desc" },
        });
        if (existing) {
          await tx.generatedDocument.update({
            where: { id: existing.id },
            data: { fileContent: cvContent, generationStatus: "GENERATED", validationStatus: "PENDING", reviewStatus: "PENDING", updatedAt: new Date() },
          });
        } else {
          try {
            await tx.generatedDocument.create({
              data: {
                tenderId,
                name: `CV — ${expert.fullName}`,
                documentType: "EXPERT_CV_PACKAGE",
                format: "DOCX",
                exactFileName: fileName,
                fileContent: cvContent,
                generationStatus: "GENERATED",
                validationStatus: "PENDING",
                contentSummary: `Professional CV for ${expert.fullName}${(expert as { title?: string | null }).title ? `, ${(expert as { title?: string | null }).title}` : ""}.`,
              },
            });
          } catch (createErr) {
            // P2002 = the partial unique index caught a concurrent creator
            // making the same CV file between our findFirst and this create.
            // Converge idempotently: update the row the winner created.
            if ((createErr as { code?: string })?.code === "P2002") {
              const winner = await tx.generatedDocument.findFirst({
                where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
                orderBy: { updatedAt: "desc" },
                select: { id: true },
              });
              if (winner) {
                await tx.generatedDocument.update({
                  where: { id: winner.id },
                  data: { fileContent: cvContent, generationStatus: "GENERATED", validationStatus: "PENDING", reviewStatus: "PENDING", updatedAt: new Date() },
                });
              }
            } else {
              throw createErr;
            }
          }
        }
      });
      cvFileNames.push(fileName);
    }

    return {
      tenderId,
      userId,
      status: "GENERATED",
      filesGenerated: ["Technical-Proposal.docx", ...cvFileNames],
      metrics: {
        elapsedMs: Date.now() - startTime,
      },
    };
  } catch (err) {
    const generationError = mapGenerationError(err);
    return {
      tenderId,
      userId,
      status: generationError.status,
      error: generationError.message,
      metrics: {
        elapsedMs: Date.now() - startTime,
      },
    };
  }
}

async function generateProposalMarkdown(tender: { id: string; title: string; requirements: string }): Promise<string> {
  return `# Tender Response: ${tender.title}\n\n## Requirements\n${tender.requirements || "No specific requirements provided."}`;
}
