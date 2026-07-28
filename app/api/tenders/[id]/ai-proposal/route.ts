import { logger } from "../../../../../lib/observability";
import { verifiedIntegrityDataFromBase64 } from "../../../../../lib/engine/persisted-byte-integrity";
import { withTransactionalGenerationGate } from "../../../../../lib/engine/transactional-generation-gate";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateBenchmarkProposalWithAI, generateProposalSectionsParallel, isAIEnabled } from "../../../../../lib/ai";
import type { ProposalSectionId } from "../../../../../lib/engine/proposal-sections";
import { BENCHMARK_CONTEXT_LINES, buildProposalIntelligence, buildCriterionEvidenceMap, expertProofLine, projectProofLine, safeParseArr } from "../../../../../lib/engine/proposal-intelligence";
import { buildRubricPromptDirective } from "../../../../../lib/engine/rubric-driven-sections";
import { extractTenderLanguageEchoes, formatEchoesForPrompt } from "../../../../../lib/engine/tender-language-echoes";
import { extractTenderFacts, formatFactsForPrompt } from "../../../../../lib/engine/tender-facts-extractor";
import { buildProposalCacheKey, getCachedProposal, setCachedProposal } from "../../../../../lib/proposal-cache";
import { fallbackProposal, selectReviewedEvidenceForAIDraft } from "../../../../../lib/engine/ai-proposal-fallback";
import { assertAnalysisReadyForFinalGeneration } from "../../../../../lib/engine/analysis-source";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { logAction } from "../../../../../lib/audit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { extractRequestId } from "../../../../../lib/request-id";
import { loadDurableCompanySupportRecords } from "../../../../../lib/prisma-schema-compatibility";

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  const rl = await rateLimitPersistent(`ai-proposal:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please wait before generating again.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

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

  // ── Per-chunk checkpoint via AiJob ────────────────────────────────────────
  // Stores each completed chunk's markdown in AiJob.output so a resume call
  // can skip already-generated chunks instead of restarting from scratch.
  //
  // Request body:
  //   proposalJobId — ID of an existing AiJob to resume (optional).
  //                   Omit on the first chunk=1 call; include on retries.
  // Response always includes proposalJobId so the client can store it.

  const resumeJobId = typeof body.proposalJobId === "string" && body.proposalJobId.length > 0 && body.proposalJobId.length <= 128
    ? body.proposalJobId : null;

  // Chunk output stored as { chunks: { "1": "..md..", "2": "..md..", "3": "..md.." } }
  type ChunkOutput = { chunks: Record<string, string> };

  const tenderId = id as string;
  const uid = userId as string;

  async function loadChunkOutput(jobId: string): Promise<ChunkOutput> {
    const job = await prisma.aiJob.findFirst({ where: { id: jobId, tenderId, userId: uid }, select: { output: true } });
    if (!job?.output) return { chunks: {} };
    try { return JSON.parse(job.output) as ChunkOutput; } catch { return { chunks: {} }; }
  }

  async function saveChunkOutput(jobId: string, chunkKey: string, markdown: string) {
    const current = await loadChunkOutput(jobId);
    current.chunks[chunkKey] = markdown;
    await prisma.aiJob.update({ where: { id: jobId }, data: { output: JSON.stringify(current), updatedAt: new Date() } });
  }

  // Create or resume an AiJob for this proposal session.
  // Application-level tender ownership validation before job insertion: the
  // database trigger (migration 20260712193000) is the hard boundary, but we
  // verify ownership here first so a cross-tenant request gets a clean 404
  // instead of a 500 from the trigger exception.
  const tenderOwnership = await prisma.tender.findFirst({
    where: { id: tenderId, userId: uid },
    select: { id: true },
  });
  if (!tenderOwnership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const proposalJob = resumeJobId
    ? await prisma.aiJob.findFirst({ where: { id: resumeJobId, tenderId, userId: uid } })
    : null;

  const proposalJobId = proposalJob
    ? proposalJob.id
    : (await prisma.aiJob.create({
        data: { tenderId, userId: uid, jobType: "PROPOSAL_GENERATION", status: "RUNNING", startedAt: new Date(), input: JSON.stringify({ chunkNum: chunkNum ?? "full" }) },
      })).id;

  // If a chunk is already cached in the job, return it immediately.
  if (chunkNum !== undefined && proposalJob) {
    const cached = await loadChunkOutput(proposalJobId);
    const chunkKey = String(chunkNum);
    if (cached.chunks[chunkKey] && !forceRefresh) {
      return NextResponse.json({ success: true, proposal: cached.chunks[chunkKey], fallback: false, cached: true, proposalJobId });
    }
  }

  const [tender, companyBase] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId },
      include: {
        requirements: true,
        files: { select: { originalFileName: true, extractedText: true } },
        expertMatches: {
          where: { isSelected: true },
          include: { expert: { include: { sourceDocument: true } } },
          orderBy: { score: "desc" },
        },
        projectMatches: {
          where: { isSelected: true },
          include: { project: { include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 }, sourceDocument: true } } },
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
        // Vault fallback — mirrors generate-elite.ts: when selected
        // records are all unreviewed we substitute the firm's reviewed
        // vault so the AI proposal still has real names + evidence.
        // Prefilter to the two trust levels that can possibly be usable, then
        // let selectReviewedEvidenceForAIDraft apply the real authority
        // (canUseVaultRecord). Filtering to trustLevel:"REVIEWED" here dropped
        // every durably SOURCE_VERIFIED record before the resolver ever saw
        // it, so a company whose evidence comes only from its own uploaded
        // documents had an empty vault fallback and got a proposal with no
        // expert or project evidence at all.
        experts: {
          where: { trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] }, deletedAt: null },
          orderBy: [{ yearsExperience: "desc" }, { updatedAt: "desc" }],
          take: 12,
          include: { sourceDocument: true },
        },
        projects: {
          where: { trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] }, deletedAt: null },
          orderBy: [{ contractValue: "desc" }, { updatedAt: "desc" }],
          take: 8,
          include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 }, sourceDocument: true },
        },
      },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const supportRecords = companyBase
    ? await loadDurableCompanySupportRecords(prisma, companyBase.id, 12)
    : { legalRecords: [], financialRecords: [], complianceRecords: [], schemaCompatible: true };
  const company = companyBase ? { ...companyBase, ...supportRecords } : null;

  // ── Operation gate (DRAFT_GENERATION) — non-blocking observability ────
  // AI proposal generation is a DRAFT_GENERATION operation. The gate
  // surfaces metadata warnings without blocking; the central readiness
  // gate (called below for persist) is the real hard blocker.
  const aiPropOpGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: tender.requirements.map((r: any) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
    })),
    overrides: [],
    buildPlan: null,
    operation: "DRAFT_GENERATION",
  });
  if (aiPropOpGate.warnings.length > 0) {
    logger.info(`[ai-proposal] tender=${id} operation-gate warnings: ${aiPropOpGate.warnings.join("; ")}`);
  }
  if (aiPropOpGate.blockers.length > 0) {
    return NextResponse.json({
      error: `AI proposal blocked by operation gate: ${aiPropOpGate.blockers.join("; ")}`,
      code: "OPERATION_GATE_BLOCKED",
      blockers: aiPropOpGate.blockers,
    }, { status: 422 });
  }

  // ── Regex-fallback analysis gate (Part 4) ────────────────────────────────
  // Mirror the gate in /api/tenders/[id]/generate so the AI-proposal route
  // also refuses to produce final-quality output from an unapproved
  // regex-fallback analysis. Chunked drafts and the deterministic
  // fallbackProposal() path are NOT considered "final" here, so we only
  // block when this is not the explicit fallback flow.
  const analysisGate = await assertAnalysisReadyForFinalGeneration(prisma, id, tender);
  if (!analysisGate.ok && isAIEnabled() && company) {
    await logAction({
      userId,
      action: "GENERATION_BLOCKED_REGEX_FALLBACK",
      entityType: "Tender",
      entityId: id,
      description: "AI proposal generation blocked: analysis source is regex fallback. Human approval is audit-only and does NOT authorize generation.",
    });
    return NextResponse.json({
      error: analysisGate.message,
      code: analysisGate.code,
      nextAction: analysisGate.nextAction,
      details: "Re-run AI Analyze with healthy providers to obtain a genuine AI analysis. Approving the regex fallback records an audit-only review — it does NOT unblock generation.",
    }, { status: 409 });
  }

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

  // Vault fallback: if no selected match carries usable evidence, fall back to
  // the company's own usable vault records.
  // Eligibility is decided once, inside selectReviewedEvidenceForAIDraft, by
  // canUseVaultRecord(..., "GENERATION") — the same authority the rest of
  // generation uses. Draft records (and records whose provenance no longer
  // verifies) stay visible in dashboards but are excluded from factual
  // proposal evidence. Two naive raw-trustLevel prefilters used to run here
  // first; they were both wrong and, since their results were immediately
  // overwritten by the selection below, dead as well.
  const selectedExperts = tender.expertMatches.map((m) => m.expert);
  const selectedProjects = tender.projectMatches.map((m) => m.project);
  const vaultExperts = (company as unknown as { experts?: typeof selectedExperts }).experts ?? [];
  const vaultProjects = (company as unknown as { projects?: typeof selectedProjects }).projects ?? [];
  const expertSelection = selectReviewedEvidenceForAIDraft(selectedExperts, vaultExperts);
  const projectSelection = selectReviewedEvidenceForAIDraft(
    selectedProjects,
    vaultProjects as typeof selectedProjects,
  );
  const experts = expertSelection.evidence;
  const projects = projectSelection.evidence;
  if (expertSelection.usedReviewedVaultFallback) logger.warn(`[ai-proposal] No usable selected experts — using ${experts.length} usable vault expert(s).`);
  if (projectSelection.usedReviewedVaultFallback) logger.warn(`[ai-proposal] No usable selected projects — using ${projects.length} usable vault project(s).`);
  if (experts.length === 0 && tender.expertMatches.length > 0) logger.warn("[ai-proposal] No reviewed expert evidence available — expert claims will be omitted from AI draft evidence context.");
  if (projects.length === 0 && tender.projectMatches.length > 0) logger.warn("[ai-proposal] No reviewed project evidence available — project claims will be omitted from AI draft evidence context.");

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
    tender.title, tender.reference, tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined, tender.description,
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
      // Preserve the full SectionProvenance to check for fallback sections.
      let sectionProvenance: import("../../../../../lib/ai").SectionProvenance | null = null;
      if (useParallel || sectionFilter) {
        const result = await withProposalTimeout(
          generateProposalSectionsParallel(aiInputBase, sectionFilter),
          AI_PROPOSAL_TIMEOUT_MS,
        );
        sectionProvenance = result;
        proposal = result.markdown;
        // Block persistence if ANY section used deterministic fallback.
        // The interactive route is draft-only (no GeneratedDocument rows),
        // but we still mark the response so the client knows fallback was used.
        if (result.anyFallback) {
          return NextResponse.json({
            success: true,
            proposal,
            fallback: true,
            fallbackApplied: false,
            anyFallback: true,
            sectionProvenance: result.sections,
            code: "AI_SECTION_PARTIAL_FALLBACK",
            error: "One or more sections used deterministic fallback. The output is not fully AI-generated and cannot be persisted as a final proposal.",
            persistBlocked: true,
            persistBlockerCode: "LEGACY_AI_PROPOSAL_DRAFT_ONLY",
            nextAction: "Retry after all AI providers are healthy.",
            requestId,
          }, { status: 200 });
        }
      } else {
        proposal = await withProposalTimeout(
          generateBenchmarkProposalWithAI(aiInputBase),
          AI_PROPOSAL_TIMEOUT_MS,
        );
      }
    } catch (aiError) {
      const msg = sanitizeError(aiError);
      logger.error("Benchmark AI proposal failed in /ai-proposal route:", { detail: msg });

      // Rate limit: don't overwrite any existing proposal — ask user to retry
      if (msg.toLowerCase().includes("rate limit") || msg.includes("429")) {
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
        aiError: "AI provider unavailable; deterministic fallback used.",
      });
    }

    if (!fallback && !sectionFilter) setCachedProposal(cacheKey, proposal, false);

    // ── Checkpoint: save this chunk's result to the AiJob ─────────────────
    // Persists each successful chunk so a resume call can skip it.
    // Never saves fallback/deterministic output as a checkpoint — the user
    // should retry with real AI, not replay a degraded result.
    if (!fallback && chunkNum !== undefined) {
      void saveChunkOutput(proposalJobId, String(chunkNum), proposal).catch(() => {});
    }

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
    // Track whether the persist was blocked by the central gate so the
    // response can inform the client. Previously the route returned
    // { success: true } even when the persist was skipped, leaving the UI
    // with no indication that the proposal was NOT saved as a
    // GeneratedDocument. The audit called this a UX gap (G5).
    let persistBlocked = false;
    let persistBlockerCode: string | null = null;
    let persistBlockerDetail: string | null = null;
    if (!fallback && isSubstantial && (chunkNum === undefined || chunkNum === 3)) {
      const accumulated = typeof body.accumulatedProposal === "string" && body.accumulatedProposal.length > 200 && body.accumulatedProposal.length <= 500_000
        ? body.accumulatedProposal
        : null;
      const contentToSave = accumulated ? `${accumulated}\n\n${proposal}` : proposal;

      // ── Central generation readiness gate ──────────────────────────────
      // Persisting a GENERATED GeneratedDocument is a generation act and
      // Block on PARTIAL_EXTRACTION_AI_ANALYZED
      if (tender.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
        return NextResponse.json({ success: false, ok: false, error: "Cannot persist AI proposal: AI analysis ran on partial extraction. Re-extract and re-run AI Analyze.", code: "ANALYSIS_FROM_PARTIAL_EXTRACTION" }, { status: 422 });
      }

      // must pass the SAME central gate as /generate and the
      // PROPOSAL_GENERATION background handler. Without this, the
      // interactive AI-proposal path could create a GENERATED document
      // on a tender whose analysis is partial/failed/regex-fallback,
      // bypassing hash-binding, chunk-integrity, source-grounding, and
      // submission-plan checks. Fail-closed: a blocked gate creates
      // ZERO GeneratedDocument rows. We log but do NOT throw — the
      // proposal text is still returned to the UI so the user can see
      // the draft; it simply is not persisted as a GeneratedDocument
      // until the tender is genuinely ready.
      const centralGate = await assertTenderReadyForGenerationAndExport({
        prisma,
        tenderId: id,
        userId,
        purpose: "ai-proposal-persist",
      });
      if (!centralGate.ok) {
        persistBlocked = true;
        persistBlockerCode = centralGate.blockerCode ?? null;
        persistBlockerDetail = centralGate.blockerDetail ?? null;
        await logAction({
          userId,
          action: "AI_PROPOSAL_PERSIST_BLOCKED",
          entityType: "Tender",
          entityId: id,
          description: `Quick-draft persist blocked by central gate (${centralGate.blockerCode}): ${centralGate.blockerDetail}`,
        }).catch(() => {});
        // Skip the persist — the proposal is still returned to the UI above.
      } else {
      try {
        const quickDraftFileName = "AI-Proposal-Quick-Draft.md";
        const quickDraftFileContent = Buffer.from(contentToSave, "utf8").toString("base64");
        const quickDraftIntegrity = verifiedIntegrityDataFromBase64({
          fileContent: quickDraftFileContent,
          filename: quickDraftFileName,
          claimedMimeType: "text/markdown",
        });
        await prisma.$transaction(async (tx) =>
          withTransactionalGenerationGate({
            prisma,
            tx,
            tenderId: id,
            userId,
            purpose: "ai-proposal-persist",
            write: async (lockedTx) => {
              return lockedTx.generatedDocument.create({
          data: {
            tenderId: id,
            name: "AI Proposal (Quick Draft)",
            documentType: "QUICK_DRAFT",
            format: "MARKDOWN",
            exactFileName: quickDraftFileName,
            fileContent: quickDraftFileContent,
            ...quickDraftIntegrity,
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            reviewStatus: "NOT_EXPORTABLE",
            contentSummary: `Quick AI draft generated ${new Date().toLocaleString()}. Run Generate Docs for the full submission-ready package.`,
          },
        })
            },
          }),
        );;
      } catch (e) {
        // Non-blocking — draft already returned to UI — but log a warn so
        // side-effect persistence failures (e.g. AiJob state update didn't
        // land) are visible to operators. Previously bare `catch {}`.
        logger.warn("[ai-proposal] quick-draft persistence side-effect failed — draft already returned to UI", {
          detail: e,
          tenderId,
        });
      }
      } // end else (central gate passed)
    }

    // ── Update AiJob status ───────────────────────────────────────────────
    // Mark SUCCEEDED when the full proposal is done (chunk 3 or non-chunked).
    // For intermediate chunks leave status as RUNNING so resume calls know
    // generation is still in progress.
    if (chunkNum === undefined || chunkNum === 3) {
      void prisma.aiJob.update({
        where: { id: proposalJobId },
        data: { status: fallback ? "FAILED" : "SUCCEEDED", finishedAt: new Date(), updatedAt: new Date() },
      }).catch(() => {});
    }

    // PR T FIX — see note above; intakeSummary must NOT be overwritten
    // with generated-proposal text or every regeneration feeds the
    // previous one back as input to the next.
    return NextResponse.json({
      success: true,
      proposal,
      fallback,
      cached: false,
      proposalJobId,
      // Surface the persist-blocked state to the client so the UI can show
      // the user that their proposal was NOT saved as a GeneratedDocument.
      // The proposal text is still returned (above) so the user can see the
      // draft; this flag just makes it clear that they need to fix the
      // tender-level blockers (analysis, build plan, critical metadata, etc.)
      // before the draft will be persisted.
      ...(persistBlocked ? {
        persistBlocked: true,
        persistBlockerCode,
        persistBlockerDetail,
      } : {}),
    });
  } catch (error) {
    const safeError = sanitizeError(error).slice(0, 500);
    // Mark the AiJob as FAILED so the client knows to offer a retry
    void prisma.aiJob.update({
      where: { id: proposalJobId },
      data: { status: "FAILED", errorMessage: safeError, finishedAt: new Date(), updatedAt: new Date() },
    }).catch(() => {});
    logger.error("Proposal generation route error:", { detail: safeError });
    return NextResponse.json({ error: "Proposal generation failed. Retry or review server logs.", proposalJobId }, { status: 500 });
  }
}
