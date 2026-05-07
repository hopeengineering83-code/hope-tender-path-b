import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateBenchmarkProposalWithAI, generateProposalSectionsParallel, isAIEnabled } from "../../../../../lib/ai";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "../../../../../lib/engine/proposal-intelligence";

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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

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

  const experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  const projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");

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
      // PROPOSAL_GENERATION_MODE — same env-flag as generate-elite.ts.
      // Default "parallel" runs four concurrent Claude calls (one per
      // section cluster) and stitches them; "single" reverts to the
      // legacy monolithic call. The parallel path was added to fit
      // proposal generation inside Vercel Hobby's 60s function cap.
      const generationMode = (process.env.PROPOSAL_GENERATION_MODE || "parallel").toLowerCase();
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
        tenderText,
        analysisSummary: _clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: _clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
        submissionNotes,
        requirements: requirementLines.join("\n"),
        companyProfile:
          `${company.name}\n${c.legalName ?? ""}\n${company.profileSummary ?? c.description ?? ""}\n` +
          `Services: ${safeParseArr(c.serviceLines).join(", ")}\n` +
          `Sectors: ${safeParseArr(c.sectors).join(", ")}\n\n` +
          `Wider company evidence library:\n${evidenceContextLines.join("\n").slice(0, 9_000)}`,
        experts: expertLines.join("\n"),
        projects: [...projectLines, ...projectEvidenceLines].join("\n"),
        compliance: complianceLines.join("\n"),
        differentiators: intelligence.differentiators.join("\n"),
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
      };
      proposal = await withProposalTimeout(
        useParallel ? generateProposalSectionsParallel(aiInput) : generateBenchmarkProposalWithAI(aiInput),
        AI_PROPOSAL_TIMEOUT_MS,
      );
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

    // PR T FIX — see note above; intakeSummary must NOT be overwritten
    // with generated-proposal text or every regeneration feeds the
    // previous one back as input to the next.
    return NextResponse.json({ success: true, proposal, fallback });
  } catch (error) {
    console.error("Proposal generation route error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Proposal generation failed" }, { status: 500 });
  }
}
