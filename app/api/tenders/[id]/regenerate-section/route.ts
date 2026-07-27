import { logger } from "../../../../../lib/observability";
// Section-level proposal regeneration API.
//
// POST /api/tenders/[id]/regenerate-section
// Body: { sectionId: "cover-and-summary" | "company-and-experience" | "technical-approach" | "additional-and-declaration" }
//
// Regenerates a SINGLE section of a proposal using the same prompt builders,
// evidence context, and AI provider chain as the main parallel generation
// pipeline. The route returns AI-generated section markdown only after the
// canonical generation gate passes and only REVIEWED Company Vault evidence
// is admitted to the prompt.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { isAIEnabled, type AIBidWriterInput } from "../../../../../lib/ai";
import { BENCHMARK_CONTEXT_LINES, buildProposalIntelligence, buildCriterionEvidenceMap, expertProofLine, projectProofLine, safeParseArr } from "../../../../../lib/engine/proposal-intelligence";
import { buildRubricPromptDirective } from "../../../../../lib/engine/rubric-driven-sections";
import { extractTenderLanguageEchoes, formatEchoesForPrompt } from "../../../../../lib/engine/tender-language-echoes";
import { extractTenderFacts, formatFactsForPrompt } from "../../../../../lib/engine/tender-facts-extractor";
import { buildProposalSectionSpecs, type ProposalSectionId } from "../../../../../lib/engine/proposal-sections";
import { recordAiUsage } from "../../../../../lib/ai-usage-tracker";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { resolveReviewedSectionEvidence, sectionEvidenceBlocker } from "../../../../../lib/engine/regenerate-section-evidence";
import { extractRequestId } from "../../../../../lib/request-id";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VALID_SECTION_IDS: ProposalSectionId[] = [
  "cover-and-summary",
  "company-and-experience",
  "technical-approach",
  "additional-and-declaration",
];

function clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function shortText(text?: string | null, max = 700): string {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function buildCompanyEvidenceLines(company: Record<string, unknown>): string[] {
  const docs = (company.documents as { extractedText?: string | null; originalFileName?: string | null; category?: string | null }[] | undefined) ?? [];
  const legal = (company.legalRecords as { title?: string | null; recordType?: string | null; authority?: string | null; referenceNumber?: string | null; status?: string | null }[] | undefined) ?? [];
  const financial = (company.financialRecords as { recordType?: string | null; fiscalYear?: string | null; amount?: number | null; currency?: string | null; notes?: string | null }[] | undefined) ?? [];
  const compliance = (company.complianceRecords as { title?: string | null; complianceType?: string | null; status?: string | null; referenceNumber?: string | null; evidenceSummary?: string | null }[] | undefined) ?? [];

  return [
    ...docs.filter((doc) => clean(doc.extractedText).length > 20 || clean(doc.originalFileName).length > 0).slice(0, 18)
      .map((doc) => `Company document: ${doc.originalFileName} | category: ${doc.category} | evidence: ${shortText(doc.extractedText, 850)}`),
    ...legal.slice(0, 8).map((record) => `Legal evidence: ${record.title} | type: ${record.recordType}${record.authority ? ` | authority: ${record.authority}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.status ? ` | status: ${record.status}` : ""}`),
    ...financial.slice(0, 8).map((record) => `Financial evidence: ${record.recordType} ${record.fiscalYear}${record.amount ? ` | amount: ${record.currency ?? ""} ${record.amount}` : ""}${record.notes ? ` | notes: ${shortText(record.notes, 240)}` : ""}`),
    ...compliance.slice(0, 10).map((record) => `Compliance evidence: ${record.title} | type: ${record.complianceType}${record.status ? ` | status: ${record.status}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.evidenceSummary ? ` | ${shortText(record.evidenceSummary, 360)}` : ""}`),
  ].filter(Boolean);
}

function buildProjectEvidenceLines(projects: { name?: string | null; evidences?: { title?: string | null; evidenceType?: string | null; fileName?: string | null; description?: string | null; extractedText?: string | null }[] }[]): string[] {
  return projects.flatMap((project) =>
    (project.evidences ?? []).slice(0, 5).map((evidence) =>
      `Project evidence for ${project.name}: ${evidence.title} | type: ${evidence.evidenceType}${evidence.fileName ? ` | file: ${evidence.fileName}` : ""}${evidence.description ? ` | ${shortText(evidence.description, 280)}` : ""}${evidence.extractedText ? ` | text: ${shortText(evidence.extractedText, 520)}` : ""}`
    )
  ).slice(0, 30);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  const rl = await rateLimitPersistent(`regen-section:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { success: false, error: "Too many requests. Please wait before regenerating again.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const { id } = await params;
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const sectionId = body.sectionId as string;

    if (!VALID_SECTION_IDS.includes(sectionId as ProposalSectionId)) {
      return NextResponse.json({
        success: false,
        error: `Invalid sectionId. Must be one of: ${VALID_SECTION_IDS.join(", ")}`,
        code: "INVALID_SECTION_ID",
      }, { status: 400 });
    }

    if (!isAIEnabled()) {
      return NextResponse.json({
        success: false,
        error: "AI section regeneration is unavailable.",
        code: "AI_NOT_CONFIGURED",
        requestId,
      }, { status: 503 });
    }

    const readiness = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId,
      purpose: "regenerate-section",
    });
    if (!readiness.ok) {
      const notFound = readiness.blockerCode === "OWNERSHIP_TENDER_NOT_FOUND";
      return NextResponse.json({
        success: false,
        ok: false,
        code: notFound ? "TENDER_NOT_FOUND" : readiness.blockerCode,
        error: notFound ? "Tender not found" : readiness.blockerDetail,
        nextAction: notFound ? undefined : "Resolve the canonical generation-readiness blocker before regenerating a section.",
      }, { status: notFound ? 404 : 422 });
    }

    const [tender, company] = await Promise.all([
      prisma.tender.findFirst({
        where: { id, userId },
        include: {
          requirements: true,
          files: { select: { originalFileName: true, extractedText: true } },
          expertMatches: {
            where: { isSelected: true },
            include: { expert: true },
            orderBy: { score: "desc" },
          },
          projectMatches: {
            where: { isSelected: true },
            include: { project: { include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 } } } },
            orderBy: { score: "desc" },
          },
          complianceMatrix: { include: { requirement: { select: { title: true, description: true } } } },
          complianceGaps: { where: { isResolved: false }, orderBy: { severity: "asc" } },
        },
      }),
      prisma.company.findUnique({
        where: { userId },
        include: {
          documents: { orderBy: { updatedAt: "desc" }, take: 24 },
          // trustLevel REVIEWED is evidence-gated at write time (see
          // lib/vault-review-provenance.ts) — mirrors the experts/projects
          // filters just below so unreviewed legal/financial/compliance
          // drafts never reach the section-regeneration prompt.
          legalRecords: {
            where: { trustLevel: "REVIEWED", OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] },
            orderBy: { updatedAt: "desc" },
            take: 12,
          },
          financialRecords: { where: { trustLevel: "REVIEWED" }, orderBy: { fiscalYear: "desc" }, take: 12 },
          complianceRecords: {
            where: { trustLevel: "REVIEWED", OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] },
            orderBy: { updatedAt: "desc" },
            take: 12,
          },
          experts: {
            where: { trustLevel: "REVIEWED", deletedAt: null },
            orderBy: [{ yearsExperience: "desc" }, { updatedAt: "desc" }],
            take: 12,
          },
          projects: {
            where: { trustLevel: "REVIEWED", deletedAt: null },
            orderBy: [{ contractValue: "desc" }, { updatedAt: "desc" }],
            take: 8,
            include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 } },
          },
        },
      }),
    ]);

    if (!tender) return NextResponse.json({ success: false, error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
    if (!company) return NextResponse.json({ success: false, error: "Company not found", code: "COMPANY_NOT_FOUND" }, { status: 404 });

    const evidence = resolveReviewedSectionEvidence({
      selectedExperts: tender.expertMatches.map((match) => match.expert),
      selectedProjects: tender.projectMatches.map((match) => match.project),
      vaultExperts: company.experts,
      vaultProjects: company.projects,
    });
    const evidenceBlocker = sectionEvidenceBlocker({
      sectionId,
      expertCount: evidence.experts.length,
      projectCount: evidence.projects.length,
    });
    if (evidenceBlocker) {
      return NextResponse.json({
        success: false,
        ok: false,
        code: evidenceBlocker.code,
        error: evidenceBlocker.message,
        nextAction: "Review and approve the required Company Vault evidence before regenerating this section.",
      }, { status: 422 });
    }

    const experts = evidence.experts;
    const projects = evidence.projects;
    logger.info("[regenerate-section] reviewed evidence resolved", {
      requestId,
      sectionId,
      expertSource: evidence.expertSource,
      projectSource: evidence.projectSource,
      expertCount: experts.length,
      projectCount: projects.length,
    });

    const intelligence = buildProposalIntelligence({ tender, company, requirements: tender.requirements, experts, projects });
    const tenderText = [
      tender.title,
      tender.reference,
      tender.clientName || tender.procuringEntityName,
      tender.description,
      tender.intakeSummary,
      tender.analysisSummary,
      tender.evaluationMethodology,
      ...tender.files.map((file) => `${file.originalFileName}\n${file.extractedText ?? ""}`),
    ].filter(Boolean).join("\n\n");

    const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");
    const evaluationWeightLines = intelligence.evaluationWeights.map(
      (weight) => `- ${weight.criterion} — ${weight.weight} (raw match: "${weight.rawMatch}")`,
    );
    const tenderLanguageEchoes = extractTenderLanguageEchoes(intelligence.tenderText, 12);
    const tenderLanguageEchoBlock = formatEchoesForPrompt(tenderLanguageEchoes);
    const tenderFacts = extractTenderFacts(intelligence.tenderText);
    const tenderFactsPromptBlock = formatFactsForPrompt(tenderFacts);

    const companyEvidenceLines = buildCompanyEvidenceLines(company as unknown as Record<string, unknown>);
    const projectEvidenceLines = buildProjectEvidenceLines(projects as Parameters<typeof buildProjectEvidenceLines>[0]);
    const expertLines = experts.map(expertProofLine);
    const projectLines = projects.map(projectProofLine);
    const requirementLines = tender.requirements.map((requirement) => `${requirement.priority} ${requirement.requirementType}: ${requirement.title} — ${requirement.description}`);
    const evidenceContextLines = [...companyEvidenceLines, ...projectEvidenceLines];
    const complianceLines = [
      ...tender.complianceMatrix.map((matrix) => {
        const requirement = matrix.requirement?.title ?? matrix.requirement?.description ?? "Requirement";
        return `${matrix.supportLevel}: ${requirement} | ${matrix.evidenceType} from ${matrix.evidenceSource}${matrix.evidenceReference ? ` | ref: ${matrix.evidenceReference}` : ""}${matrix.notes ? ` — ${matrix.notes}` : ""}`;
      }),
      ...companyEvidenceLines.slice(0, 14).map((line) => `Company evidence: ${line}`),
      ...tender.complianceGaps.map((gap) => `${gap.severity}: ${gap.title} — ${gap.mitigationPlan || gap.description}`),
    ];

    type CompanyFields = {
      legalName?: string | null;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
      country?: string | null;
      foundingYear?: number | null;
      headcount?: number | null;
      licenseGrade?: string | null;
      registrationNumber?: string | null;
      tin?: string | null;
      vat?: string | null;
      gmName?: string | null;
      gmTitle?: string | null;
      gmLicense?: string | null;
      description?: string | null;
      serviceLines?: string | null;
      sectors?: string | null;
      complianceRecords?: Array<{ title?: string | null; complianceType?: string | null; referenceNumber?: string | null; status?: string | null }>;
    };
    const companyFields = company as typeof company & CompanyFields;

    const aiInput: AIBidWriterInput = {
      tenderTitle: tender.title,
      clientName: intelligence.clientName,
      clientContactName: tender.clientContactName ?? null,
      tenderText: [BENCHMARK_CONTEXT_LINES.join("\n"), tenderText].join("\n\n"),
      analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
      evaluationMethodology: [
        clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
        ...(evaluationWeightLines.length > 0 ? ["", "Numeric evaluation weights detected in tender (echo verbatim in the EVALUATION CRITERIA RESPONSE MIRROR table):", ...evaluationWeightLines] : []),
        tenderLanguageEchoBlock,
        tenderFactsPromptBlock,
        buildRubricPromptDirective(intelligence.evaluationWeights),
      ].filter(Boolean).join("\n"),
      submissionNotes: [BENCHMARK_CONTEXT_LINES.join("\n"), submissionNotes].filter(Boolean).join("\n"),
      requirements: [...BENCHMARK_CONTEXT_LINES, ...requirementLines].join("\n"),
      companyProfile:
        `${company.name}\n${companyFields.legalName ?? ""}\n${company.profileSummary ?? companyFields.description ?? ""}\n` +
        `Services: ${safeParseArr(companyFields.serviceLines).join(", ")}\n` +
        `Sectors: ${safeParseArr(companyFields.sectors).join(", ")}\n\n` +
        `Company evidence:\n${evidenceContextLines.join("\n").slice(0, 9_000)}`,
      experts: expertLines.join("\n"),
      projects: [...projectLines, ...projectEvidenceLines].join("\n"),
      compliance: [...BENCHMARK_CONTEXT_LINES, ...complianceLines].join("\n"),
      differentiators: [...BENCHMARK_CONTEXT_LINES, ...intelligence.differentiators, ...companyEvidenceLines.slice(0, 8)].join("\n"),
      companyVault: {
        name: company.name,
        legalName: companyFields.legalName,
        address: companyFields.address,
        phone: companyFields.phone,
        email: companyFields.email,
        website: companyFields.website,
        country: companyFields.country,
        foundingYear: companyFields.foundingYear,
        headcount: companyFields.headcount,
        licenseGrade: companyFields.licenseGrade,
        registrationNumber: companyFields.registrationNumber,
        tin: companyFields.tin,
        vat: companyFields.vat,
        gmName: companyFields.gmName,
        gmTitle: companyFields.gmTitle,
        gmLicense: companyFields.gmLicense,
        profileSummary: company.profileSummary ?? companyFields.description,
        serviceLines: safeParseArr(companyFields.serviceLines),
        sectors: safeParseArr(companyFields.sectors),
        complianceLines: (companyFields.complianceRecords ?? [])
          .map((record) => [record.title, record.complianceType, record.referenceNumber ? `Ref: ${record.referenceNumber}` : "", record.status ? `Status: ${record.status}` : ""].filter(Boolean).join(" — "))
          .filter((line) => line.length > 0),
      },
      doNotUseAsClient: (() => {
        const tenderClient = intelligence.clientName?.toLowerCase().trim() ?? "";
        return Array.from(new Set(projects.map((project) => project.clientName).filter((clientName): clientName is string => {
          if (!clientName || clientName.trim().length < 3) return false;
          return clientName.toLowerCase().trim() !== tenderClient;
        })));
      })(),
      criterionEvidenceMap: buildCriterionEvidenceMap(
        intelligence.evaluationWeights,
        intelligence.topProjects,
        intelligence.topExperts,
        tender.evaluationMethodology ?? intelligence.evaluationCriteria.join("\n"),
      ),
    };

    const spec = buildProposalSectionSpecs(aiInput).find((candidate) => candidate.id === sectionId);
    if (!spec) {
      return NextResponse.json({
        success: false,
        error: "Requested section specification is unavailable.",
        code: "SECTION_SPEC_NOT_FOUND",
        requestId,
      }, { status: 500 });
    }

    let sectionMarkdown: string | null = null;
    try {
      const { generateWithFallback } = await import("../../../../../lib/ai");
      sectionMarkdown = await generateWithFallback(spec.userPrompt, {
        systemPrompt: spec.systemPrompt,
        onProviderAttempt: (provider, success, latencyMs, failureCategory) => {
          void recordAiUsage({
            userId,
            tenderId: id,
            provider,
            useCase: "proposal",
            latencyMs,
            success,
            failureCategory: failureCategory ?? null,
          });
        },
      });
    } catch (error) {
      logger.warn("[regenerate-section] AI provider chain failed", {
        requestId,
        sectionId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }

    if (!sectionMarkdown || sectionMarkdown.trim().length < 50) {
      return NextResponse.json({
        success: false,
        ok: false,
        sectionId,
        fallback: true,
        fallbackApplied: false,
        code: "AI_SECTION_REGENERATION_UNAVAILABLE",
        error: "AI section regeneration did not complete. No deterministic fallback was applied.",
        nextAction: "Retry after an AI provider is healthy. Do not apply fallback text as generated proposal content.",
        requestId,
      }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      sectionId,
      markdown: sectionMarkdown,
      fallback: false,
      aiGenerated: true,
      evidence: {
        expertSource: evidence.expertSource,
        projectSource: evidence.projectSource,
      },
    });
  } catch (error) {
    logger.error("[regenerate-section] fatal route error", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({
      success: false,
      error: "Section regeneration failed. Retry or contact support with the request ID.",
      code: "SECTION_REGENERATION_RUNTIME_ERROR",
      requestId,
    }, { status: 500 });
  }
}
