import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
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

function fallbackProposal(params: {
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

  return [
    params.aiError ? `> Draft generated by deterministic fallback because AI proposal generation failed: ${params.aiError}` : "> Draft generated by deterministic fallback because AI is not configured.",
    "",
    "## Executive Summary",
    `${params.companyName} submits this technical proposal for **${params.tenderTitle}**. This proposal has been structured to address each evaluation criterion with direct evidence from the company portfolio, reviewed expert team, and compliance records. ${params.projectLines.length > 0 ? `${params.projectLines.length} directly relevant project reference(s) are included in Relevant Experience.` : ""} ${params.expertLines.length > 0 ? `${params.expertLines.length} specialist expert(s) are proposed.` : ""}`.trim(),
    "",
    params.differentiators.length > 0 ? "## Key Differentiators\n" + params.differentiators.map((d) => `- ${d}`).join("\n") : null,
    "",
    "## Company Qualifications",
    params.companyProfile || `${params.companyName} maintains a comprehensive company knowledge vault with expert CVs, project references, registration evidence, financial documents, and policy/compliance records.`,
    params.serviceLines ? `\nService lines: ${params.serviceLines}` : "",
    "",
    "## Proposed Team",
    expertSection,
    "",
    "## Relevant Experience",
    projectSection,
    "",
    "## Technical Approach",
    "The technical delivery will follow a staged methodology: (1) inception and scope confirmation, (2) stakeholder consultation and site assessment, (3) technical analysis and gap identification, (4) concept and schematic design, (5) detailed design, specifications, BOQ and cost estimates, (6) quality review and client validation, and (7) final document submission. Each stage has defined deliverables, responsible experts, and approval checkpoints.",
    "",
    "## Extracted Requirements Checklist",
    reqText,
    "",
    params.submissionRules.length > 0 ? "## Submission Instructions\n" + params.submissionRules.map((r) => `- ${r}`).join("\n") : null,
    "",
    "## Next Actions Before Submission",
    "- Run the tender engine and confirm any gaps or missing evidence.",
    "- Review and approve all generated DOCX documents before export.",
    "- Validate all file names, submission order, and format requirements.",
    "- Attach company registration, expert CVs, project references, and compliance documents.",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  // REGEX_DRAFT), use the company's reviewed vault — matching the same
  // fallback logic as generate-elite.ts so the AI proposal always has
  // real evidence rather than an empty context.
  // Last-resort: if vault is also empty, include all selected matches
  // regardless of trust level (this is a draft proposal, imperfect
  // evidence beats no evidence).
  const vaultExperts = (company as unknown as { experts?: typeof experts }).experts ?? [];
  const vaultProjects = (company as unknown as { projects?: typeof projects }).projects ?? [];
  if (experts.length === 0) {
    if (vaultExperts.length > 0) {
      experts = vaultExperts;
      console.warn(`[ai-proposal] No REVIEWED selected experts — using ${experts.length} vault expert(s).`);
    } else {
      experts = tender.expertMatches.map((m) => m.expert);
      if (experts.length > 0) console.warn(`[ai-proposal] No REVIEWED experts in vault — using ${experts.length} unreviewed selected expert(s).`);
    }
  }
  if (projects.length === 0) {
    if (vaultProjects.length > 0) {
      projects = vaultProjects as typeof projects;
      console.warn(`[ai-proposal] No REVIEWED selected projects — using ${projects.length} vault project(s).`);
    } else {
      projects = tender.projectMatches.map((m) => m.project);
      if (projects.length > 0) console.warn(`[ai-proposal] No REVIEWED projects in vault — using ${projects.length} unreviewed selected project(s).`);
    }
  }

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

      const aiInput = {
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
        ),
      };
      // Chunked mode always uses parallel section generation (with a section
      // filter) so the correct per-chunk budgets in proposal-sections.ts apply.
      const generateFn = (useParallel || sectionFilter)
        ? generateProposalSectionsParallel(aiInput, sectionFilter)
        : generateBenchmarkProposalWithAI(aiInput);
      proposal = await withProposalTimeout(generateFn, AI_PROPOSAL_TIMEOUT_MS);
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error("Benchmark AI proposal failed in /ai-proposal route:", aiError);

      // Rate limit: don't overwrite any existing proposal — ask user to retry
      if (msg.includes("rate limit") || msg.includes("429")) {
        return NextResponse.json({
          error: "Gemini API rate limit reached. Please wait 30–60 seconds and try again.",
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
    // Minimum content guard: require at least 800 chars and two markdown headings
    // before saving as GENERATED — prevents thin AI responses (apologies, refusals,
    // timeouts that returned partial content) from being recorded as valid drafts.
    const isSubstantial = proposal.length >= 800 && (proposal.match(/^#{1,3}\s/m) ?? []).length >= 2;
    if (!fallback && isSubstantial && (chunkNum === undefined || chunkNum === 3)) {
      try {
        await prisma.generatedDocument.create({
          data: {
            tenderId: id,
            name: "AI Proposal (Quick Draft)",
            documentType: "PROPOSAL",
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            reviewStatus: "PENDING",
            contentSummary: `Quick AI draft generated ${new Date().toLocaleString()}. Run Generate Docs for the full submission-ready package.`,
            fileContent: Buffer.from(proposal).toString("base64"),
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
