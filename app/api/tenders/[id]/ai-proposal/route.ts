import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateBenchmarkProposalWithAI, generateProposalSectionsParallel, isAIEnabled } from "../../../../../lib/ai";
import type { ProposalSectionId } from "../../../../../lib/engine/proposal-sections";
import { BENCHMARK_CONTEXT_LINES, buildProposalIntelligence, buildCriterionEvidenceMap, expertProofLine, projectProofLine, safeParseArr } from "../../../../../lib/engine/proposal-intelligence";
import { buildRubricPromptDirective } from "../../../../../lib/engine/rubric-driven-sections";
import { extractTenderLanguageEchoes, formatEchoesForPrompt } from "../../../../../lib/engine/tender-language-echoes";
import { extractTenderFacts, formatFactsForPrompt } from "../../../../../lib/engine/tender-facts-extractor";
import { buildProposalCacheKey, getCachedProposal, setCachedProposal } from "../../../../../lib/proposal-cache";

// Vercel route timeout — Claude proposal generation needs >10s default.
// 60 = Hobby max; Pro applies its own plan limit when this is exceeded.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// In-route timeout for the Claude proposal call. Layered INSIDE the
// Vercel maxDuration window so the route can fail gracefully (return
// the deterministic fallback proposal) before Vercel kills the
// function with a 504. 50_000 leaves a 10-second buffer for response
// handling. Override via AI_PROPOSAL_TIMEOUT_MS for Vercel Pro tiers.
const AI_PROPOSAL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_PROPOSAL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  return 50_000;
})();

async function withProposalTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`AI proposal timed out after ${Math.round(ms / 1000)} seconds`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function _clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function _shortText(text?: string | null, max = 700): string {
  const v = _clean(text);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function _buildCompanyEvidenceLines(company: Record<string, unknown>): string[] {
  const docs = (company.documents as { extractedText?: string | null; originalFileName?: string | null; category?: string | null }[] | undefined) ?? [];
  const legal = (company.legalRecords as { title?: string | null; recordType?: string | null; authority?: string | null; referenceNumber?: string | null; status?: string | null }[] | undefined) ?? [];
  const financial = (company.financialRecords as { recordType?: string | null; fiscalYear?: string | null; amount?: number | null; currency?: string | null; notes?: string | null }[] | undefined) ?? [];
  const compliance = (company.complianceRecords as { title?: string | null; complianceType?: string | null; status?: string | null; referenceNumber?: string | null; evidenceSummary?: string | null }[] | undefined) ?? [];

  return [
    ...docs.filter((d) => _clean(d.extractedText).length > 20 || _clean(d.originalFileName).length > 0).slice(0, 18)
      .map((d) => `Company document: ${d.originalFileName} | category: ${d.category} | evidence: ${_shortText(d.extractedText, 850)}`),
    ...legal.slice(0, 8).map((r) => `Legal evidence: ${r.title} | type: ${r.recordType}${r.authority ? ` | authority: ${r.authority}` : ""}${r.referenceNumber ? ` | ref: ${r.referenceNumber}` : ""}${r.status ? ` | status: ${r.status}` : ""}`),
    ...financial.slice(0, 8).map((r) => `Financial evidence: ${r.recordType} ${r.fiscalYear}${r.amount ? ` | amount: ${r.currency ?? ""} ${r.amount}` : ""}${r.notes ? ` | notes: ${_shortText(r.notes, 240)}` : ""}`),
    ...compliance.slice(0, 10).map((r) => `Compliance evidence: ${r.title} | type: ${r.complianceType}${r.status ? ` | status: ${r.status}` : ""}${r.referenceNumber ? ` | ref: ${r.referenceNumber}` : ""}${r.evidenceSummary ? ` | ${_shortText(r.evidenceSummary, 360)}` : ""}`),
  ].filter(Boolean);
}

function _buildProjectEvidenceLines(projects: { name?: string | null; evidences?: { title?: string | null; evidenceType?: string | null; fileName?: string | null; description?: string | null; extractedText?: string | null }[] }[]): string[] {
  return projects.flatMap((project) =>
    (project.evidences ?? []).slice(0, 5).map((e) =>
      `Project evidence for ${project.name}: ${e.title} | type: ${e.evidenceType}${e.fileName ? ` | file: ${e.fileName}` : ""}${e.description ? ` | ${_shortText(e.description, 280)}` : ""}${e.extractedText ? ` | text: ${_shortText(e.extractedText, 520)}` : ""}`
    )
  ).slice(0, 30);
}

export function fallbackProposal(params: {
  tenderTitle: string;
  requirements: string[];
  companyName: string;
  companyProfile: string;
  serviceLines: string;
  expertLines: string[];
  projectLines: string[];
  differentiators: string[];
  submissionRules: string[];
  aiError?: string;
}) {
  const reqText = params.requirements.length
    ? params.requirements.map((r) => `- ${r}`).join("\n")
    : "- No detailed requirements have been extracted yet. Run analysis or add tender requirements before final submission.";

  const expertSection = params.expertLines.length
    ? params.expertLines.map((e) => `- ${e}`).join("\n")
    : "- Expert CVs and role assignments must be reviewed and confirmed before submission.";

  const projectSection = params.projectLines.length
    ? params.projectLines.map((p) => `- ${p}`).join("\n")
    : "- Project references must be reviewed and selected in the application before final submission.";

  const requiresTechnical = params.requirements.some((r) => /technical|methodology|approach/i.test(r));
  const requiresExperts = params.requirements.some((r) => /expert|cv|personnel|team leader|specialist/i.test(r));
  const requiresProjects = params.requirements.some((r) => /project experience|similar project|reference project/i.test(r));

  return [
    `# ${params.tenderTitle} — Tender-Aligned Draft`,
    "",
    params.companyProfile
      ? `Prepared using available reviewed company evidence for ${params.companyName}.`
      : null,
    params.aiError ? "Generation note: automated generation was unavailable in this run." : null,
    "",
    "## Extracted Tender Requirements",
    reqText,
    "",
    requiresExperts ? "## Proposed Team\n" + expertSection : null,
    "",
    requiresProjects ? "## Relevant Experience\n" + projectSection : null,
    "",
    requiresTechnical ? "## Technical Response\nThe technical response must be completed against the extracted tender requirements above, using only reviewed company evidence and approved tender scope." : null,
    "",
    params.submissionRules.length > 0 ? "## Submission Instructions\n" + params.submissionRules.map((r) => `- ${r}`).join("\n") : null,
    "",
    requiresTechnical && params.differentiators.length > 0
      ? "## Evidence-Backed Differentiators\n" + params.differentiators.map((d) => `- ${d}`).join("\n")
      : null,
  ].filter(Boolean).join("\n");
}

export function selectReviewedEvidenceForAIDraft<T extends { trustLevel?: string | null }>(
  selected: T[],
  reviewedVault: T[],
): { evidence: T[]; usedReviewedVaultFallback: boolean } {
  const reviewedSelected = selected.filter((row) => row.trustLevel === "REVIEWED");
  if (reviewedSelected.length > 0) return { evidence: reviewedSelected, usedReviewedVaultFallback: false };
  if (reviewedVault.length > 0) return { evidence: reviewedVault, usedReviewedVaultFallback: true };
  return { evidence: [], usedReviewedVaultFallback: false };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`ai-proposal:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please wait before generating again.", code: "RATE_LIMITED", resetAt: rl.resetAt }, { status: 429 });

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const forceRefresh = body.forceRefresh === true;

  // Chunked generation: browser sends chunk=1|2|3 to generate one section
  // group per call, each within the 60s Hobby function limit.
  //   1 → cover-and-summary + company-and-experience (parallel, ~27s)
  //   2 → technical-approach only (single call, ~38s with Tier-2 budget)
  //   3 → additional-and-declaration (single call, ~20s)
  const CHUNK_MAP: Record<number, ProposalSectionId[]> = {
    1: ["cover-and-summary", "company-and-experience"],
    2: ["technical-approach"],
    3: ["additional-and-declaration"],
  };
  const chunkNum = typeof body.chunk === "number" && body.chunk >= 1 && body.chunk <= 3 ? (body.chunk as 1 | 2 | 3) : undefined;
  const sectionFilter = chunkNum !== undefined ? CHUNK_MAP[chunkNum] : undefined;

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
        legalRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
        financialRecords: { orderBy: { fiscalYear: "desc" }, take: 12 },
        complianceRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
        // Vault fallback — mirrors generate-elite.ts: when selected
        // records are all unreviewed we substitute the firm's reviewed
        // vault so the AI proposal still has real names + evidence.
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

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const companyName = company?.name ?? "Our Company";
  const companyProfile = company?.profileSummary ?? (company as { description?: string | null } | null)?.description ?? "";
  const serviceLines = safeParseArr((company as { serviceLines?: string | null } | null)?.serviceLines).join(", ");

  if (!isAIEnabled() || !company) {
    const requirementLines = tender.requirements.map((r) => `${r.title}: ${r.description}`);
    const proposal = fallbackProposal({
      tenderTitle: tender.title,
      requirements: requirementLines,
      companyName,
      companyProfile,
      serviceLines,
      expertLines: [],
      projectLines: [],
      differentiators: [],
      submissionRules: [],
    });
    // PR T FIX — DO NOT overwrite tender.intakeSummary with the
    // generated proposal text. intakeSummary is the INITIAL intake
    // notes from tender extraction; storing the generated proposal
    // there created a feedback loop where each regeneration fed the
    // previous proposal back as input, polluting tender content with
    // stale references (e.g., a Path tender ended up containing Pharo
    // Ventures references because a prior generation had been written
    // back into intakeSummary). Generated proposals are returned in
    // the response and saved as TenderFile records elsewhere — we do
    // not store the output back in the tender's input fields.
    return NextResponse.json({ success: true, proposal, fallback: true });
  }

  let experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  let projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");

  // Vault fallback: if selected matches are all unreviewed (AI_DRAFT /
  // REGEX_DRAFT), use the company's reviewed vault.
  // Do NOT include unreviewed evidence in AI draft context. Unreviewed
  // records remain visible in dashboards but are excluded from factual
  // proposal evidence generation.
  const vaultExperts = (company as unknown as { experts?: typeof experts }).experts ?? [];
  const vaultProjects = (company as unknown as { projects?: typeof projects }).projects ?? [];
  const expertSelection = selectReviewedEvidenceForAIDraft(
    tender.expertMatches.map((m) => m.expert),
    vaultExperts,
  );
  const projectSelection = selectReviewedEvidenceForAIDraft(
    tender.projectMatches.map((m) => m.project),
    vaultProjects as typeof projects,
  );
  experts = expertSelection.evidence;
  projects = projectSelection.evidence;
  if (expertSelection.usedReviewedVaultFallback) console.warn(`[ai-proposal] No REVIEWED selected experts — using ${experts.length} reviewed vault expert(s).`);
  if (projectSelection.usedReviewedVaultFallback) console.warn(`[ai-proposal] No REVIEWED selected projects — using ${projects.length} reviewed vault project(s).`);
  if (experts.length === 0 && tender.expertMatches.length > 0) console.warn("[ai-proposal] No reviewed expert evidence available — expert claims will be omitted from AI draft evidence context.");
  if (projects.length === 0 && tender.projectMatches.length > 0) console.warn("[ai-proposal] No reviewed project evidence available — project claims will be omitted from AI draft evidence context.");

  const generationMode = (process.env.PROPOSAL_GENERATION_MODE || "parallel").toLowerCase();
  // Skip cache for chunked requests — each chunk returns a partial proposal
  // and should never serve a stale full-proposal cache entry.
  const cacheKey = buildProposalCacheKey(
    id,
    experts.map((e) => e.id),
    projects.map((p) => p.id),
    generationMode
  );
  if (!forceRefresh && !sectionFilter) {
    const cached = getCachedProposal(cacheKey);
    if (cached) return NextResponse.json({ success: true, proposal: cached.proposal, fallback: cached.fallback, cached: true });
  }

  const companyEvidenceLines = _buildCompanyEvidenceLines(company as unknown as Record<string, unknown>);
  const projectEvidenceLines = _buildProjectEvidenceLines(projects as Parameters<typeof _buildProjectEvidenceLines>[0]);
  const expertLines = experts.map(expertProofLine);
  const projectLines = projects.map(projectProofLine);
  const requirementLines = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`);

  const intelligence = buildProposalIntelligence({
    tender,
    company,
    requirements: tender.requirements,
    experts,
    projects,
  });

  const tenderText = [
    tender.title, tender.reference, tender.clientName, tender.description,
    tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology,
    ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`),
  ].filter(Boolean).join("\n\n");

  const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");
  const evidenceContextLines = [...companyEvidenceLines, ...projectEvidenceLines];

  const evaluationWeightLines = intelligence.evaluationWeights.map(
    (w) => `- ${w.criterion} — ${w.weight} (raw match: "${w.rawMatch}")`,
  );
  const tenderLanguageEchoes = extractTenderLanguageEchoes(intelligence.tenderText, 12);
  const tenderLanguageEchoBlock = formatEchoesForPrompt(tenderLanguageEchoes);
  const tenderFacts = extractTenderFacts(intelligence.tenderText);
  const tenderFactsPromptBlock = formatFactsForPrompt(tenderFacts);

  const complianceLines = [
    ...tender.complianceMatrix.map((m) => {
      const req = m.requirement?.title ?? m.requirement?.description ?? "Requirement evidence row";
      return `${m.supportLevel}: ${req} | ${m.evidenceType} from ${m.evidenceSource}${m.evidenceReference ? ` | ref: ${m.evidenceReference}` : ""}${m.notes ? ` — ${m.notes}` : ""}`;
    }),
    ...companyEvidenceLines.slice(0, 14).map((l) => `Company evidence available: ${l}`),
    ...projectEvidenceLines.slice(0, 10).map((l) => `Project evidence available: ${l}`),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
  ];

  try {
    let proposal: string;
    let fallback = false;

    try {
      const useParallel = generationMode === "parallel";
      // PR #257 — pull structured Company fields once so we can
      // populate companyVault. The "as { ... }" casts work around
      // partial Prisma type narrowing in this route's findUnique
      // include shape.
      type _CompanyFields = {
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
      const c = company as typeof company & _CompanyFields;

      const aiInputBase = {
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        tenderText: [BENCHMARK_CONTEXT_LINES.join("\n"), tenderText].join("\n\n"),
        analysisSummary: _clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: [
          _clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
          ...(evaluationWeightLines.length > 0 ? ["", "Numeric evaluation weights detected in tender (echo verbatim in the EVALUATION CRITERIA RESPONSE MIRROR table):", ...evaluationWeightLines] : []),
          tenderLanguageEchoBlock,
          tenderFactsPromptBlock,
          buildRubricPromptDirective(intelligence.evaluationWeights),
        ].filter(Boolean).join("\n"),
        submissionNotes: [BENCHMARK_CONTEXT_LINES.join("\n"), submissionNotes].filter(Boolean).join("\n"),
        requirements: [...BENCHMARK_CONTEXT_LINES, ...requirementLines].join("\n"),
        companyProfile:
          `${company.name}\n${c.legalName ?? ""}\n${company.profileSummary ?? c.description ?? ""}\n` +
          `Services: ${safeParseArr(c.serviceLines).join(", ")}\n` +
          `Sectors: ${safeParseArr(c.sectors).join(", ")}\n\n` +
          `Wider company evidence library:\n${evidenceContextLines.join("\n").slice(0, 9_000)}`,
        // Prepend a LEAD EXPERT directive so every section (across all 3 chunks
        // in chunked mode) consistently names the same lead expert as Team Lead /
        // Project Manager. Without this, Chunk 1 (cover letter) and Chunk 2
        // (Section C) may independently choose different "primary" experts.
        experts: [
          expertLines.length > 0
            ? `LEAD EXPERT (name as Team Lead / Project Manager in EVERY section): ${expertLines[0].split("|")[0].trim()}`
            : "",
          ...expertLines,
        ].filter(Boolean).join("\n"),
        projects: [...projectLines, ...projectEvidenceLines].join("\n"),
        compliance: [...BENCHMARK_CONTEXT_LINES, ...complianceLines].join("\n"),
        differentiators: [...BENCHMARK_CONTEXT_LINES, ...intelligence.differentiators, ...companyEvidenceLines.slice(0, 8)].join("\n"),
        // PR #257 — structured company-vault fields. See generate-elite.ts
        // for the full rationale.
        companyVault: {
          name: company.name,
          legalName: c.legalName,
          address: c.address,
          phone: c.phone,
          email: c.email,
          website: c.website,
          country: c.country,
          foundingYear: c.foundingYear,
          headcount: c.headcount,
          licenseGrade: c.licenseGrade,
          registrationNumber: c.registrationNumber,
          tin: c.tin,
          vat: c.vat,
          gmName: c.gmName,
          gmTitle: c.gmTitle,
          gmLicense: c.gmLicense,
          profileSummary: company.profileSummary ?? c.description,
          serviceLines: safeParseArr(c.serviceLines),
          sectors: safeParseArr(c.sectors),
          complianceLines: (c.complianceRecords ?? [])
            .map((r) => {
              const parts: string[] = [];
              if (r.title) parts.push(r.title);
              if (r.complianceType) parts.push(r.complianceType);
              if (r.referenceNumber) parts.push(`Ref: ${r.referenceNumber}`);
              if (r.status) parts.push(`Status: ${r.status}`);
              return parts.join(" — ");
            })
            .filter((s) => s.length > 0),
        },
        doNotUseAsClient: (() => {
          // Build the exclusion list from ALL project clients (vault + selected),
          // then remove the current tender client so repeat-client tenders don't
          // receive contradictory "never use X as client" instructions.
          const tenderClient = intelligence.clientName?.toLowerCase().trim() ?? "";
          return Array.from(new Set([
            ...vaultProjects.map((p) => (p as { clientName?: string | null }).clientName),
            ...projects.map((p) => p.clientName),
          ].filter((cn): cn is string => {
            if (!cn || cn.trim().length < 3) return false;
            return cn.toLowerCase().trim() !== tenderClient;
          })));
        })(),
        criterionEvidenceMap: buildCriterionEvidenceMap(
          intelligence.evaluationWeights,
          intelligence.topProjects,
          intelligence.topExperts,
          _clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("\n"),
        ),
      };
      // Chunked mode always uses parallel section generation (with a section
      // filter) so the correct per-chunk budgets in proposal-sections.ts apply.
      const generateFn = (useParallel || sectionFilter)
        ? generateProposalSectionsParallel(aiInputBase, sectionFilter)
        : generateBenchmarkProposalWithAI(aiInputBase);
      proposal = await withProposalTimeout(generateFn, AI_PROPOSAL_TIMEOUT_MS);
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error("Benchmark AI proposal failed in /ai-proposal route:", aiError);

      // Rate limit: don't overwrite any existing proposal — ask user to retry
      if (msg.includes("rate limit") || msg.includes("429")) {
        return NextResponse.json({
          error: "AI provider rate limit reached. Please wait 30–60 seconds and try again.",
          rateLimitRetry: true,
        }, { status: 429 });
      }

      fallback = true;
      proposal = fallbackProposal({
        tenderTitle: tender.title,
        requirements: requirementLines,
        companyName,
        companyProfile,
        serviceLines,
        expertLines,
        projectLines,
        differentiators: intelligence.differentiators,
        submissionRules: intelligence.submissionRules,
        aiError: msg.slice(0, 240),
      });
    }

    if (!fallback && !sectionFilter) setCachedProposal(cacheKey, proposal, false);

    // Persist the quick draft so users don't lose it on navigation.
    // Only save on the final chunk (chunk 3) or non-chunked calls — partial
    // chunk results are intermediate and should not be stored as documents.
    // Minimum content guard: prevents thin AI responses (apologies, refusals,
    // timeouts) from being stored as valid drafts. For chunked calls the final
    // chunk (chunk 3) covers only the additional-and-declaration section group,
    // which is legitimately short — use a lighter non-empty check so earlier
    // chunks' substantial content is not lost.
    //
    // Chunked-save merge: chunk 3 body may carry accumulatedProposal (chunks
    // 1+2 stitched client-side) so the DB record holds the full proposal,
    // not just Section D.
    const isSubstantial =
      chunkNum !== undefined
        ? proposal.length > 100
        : proposal.length >= 800 && (proposal.match(/^#{1,3}\s/gm) ?? []).length >= 2;
    if (!fallback && isSubstantial && (chunkNum === undefined || chunkNum === 3)) {
      const accumulated = typeof body.accumulatedProposal === "string" && body.accumulatedProposal.length > 200
        ? body.accumulatedProposal
        : null;
      const contentToSave = accumulated ? `${accumulated}\n\n${proposal}` : proposal;
      try {
        await prisma.generatedDocument.create({
          data: {
            tenderId: id,
            name: "AI Proposal (Quick Draft)",
            documentType: "QUICK_DRAFT",
            format: "MARKDOWN",
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            reviewStatus: "NOT_EXPORTABLE",
            contentSummary: `Quick AI draft generated ${new Date().toLocaleString()}. Run Generate Docs for the full submission-ready package.`,
            fileContent: Buffer.from(contentToSave).toString("base64"),
          },
        });
      } catch {
        // Non-blocking — draft already returned to UI
      }
    }

    // PR T FIX — see note above; intakeSummary must NOT be overwritten
    // with generated-proposal text or every regeneration feeds the
    // previous one back as input to the next.
    return NextResponse.json({ success: true, proposal, fallback, cached: false });
  } catch (error) {
    console.error("Proposal generation route error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Proposal generation failed" }, { status: 500 });
  }
}
