// Section-level proposal regeneration API.
//
// POST /api/tenders/[id]/regenerate-section
// Body: { sectionId: "cover-and-summary" | "company-and-experience" | "technical-approach" | "additional-and-declaration" }
//
// Regenerates a SINGLE section of a proposal using the same prompt builders,
// evidence context, and AI provider chain as the main parallel generation
// pipeline. This is much faster than regenerating the entire proposal
// (one 20-25s Claude call instead of four in parallel) and lets users
// target weak sections without losing strong ones.
//
// The route returns the raw section markdown. The caller (UI) is responsible
// for stitching it back into the full proposal display.

import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { isAIEnabled, type AIBidWriterInput } from "../../../../../lib/ai";
import { buildProposalIntelligence, buildCriterionEvidenceMap, expertProofLine, projectProofLine, safeParseArr } from "../../../../../lib/engine/proposal-intelligence";
import { buildProposalSectionSpecs, buildSectionFallback, type ProposalSectionId } from "../../../../../lib/engine/proposal-sections";

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
  const v = clean(text);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function buildCompanyEvidenceLines(company: Record<string, unknown>): string[] {
  const docs = (company.documents as { extractedText?: string | null; originalFileName?: string | null; category?: string | null }[] | undefined) ?? [];
  const legal = (company.legalRecords as { title?: string | null; recordType?: string | null; authority?: string | null; referenceNumber?: string | null; status?: string | null }[] | undefined) ?? [];
  const financial = (company.financialRecords as { recordType?: string | null; fiscalYear?: string | null; amount?: number | null; currency?: string | null; notes?: string | null }[] | undefined) ?? [];
  const compliance = (company.complianceRecords as { title?: string | null; complianceType?: string | null; status?: string | null; referenceNumber?: string | null; evidenceSummary?: string | null }[] | undefined) ?? [];

  return [
    ...docs.filter((d) => clean(d.extractedText).length > 20 || clean(d.originalFileName).length > 0).slice(0, 18)
      .map((d) => `Company document: ${d.originalFileName} | category: ${d.category} | evidence: ${shortText(d.extractedText, 850)}`),
    ...legal.slice(0, 8).map((r) => `Legal evidence: ${r.title} | type: ${r.recordType}${r.authority ? ` | authority: ${r.authority}` : ""}${r.referenceNumber ? ` | ref: ${r.referenceNumber}` : ""}${r.status ? ` | status: ${r.status}` : ""}`),
    ...financial.slice(0, 8).map((r) => `Financial evidence: ${r.recordType} ${r.fiscalYear}${r.amount ? ` | amount: ${r.currency ?? ""} ${r.amount}` : ""}${r.notes ? ` | notes: ${shortText(r.notes, 240)}` : ""}`),
    ...compliance.slice(0, 10).map((r) => `Compliance evidence: ${r.title} | type: ${r.complianceType}${r.status ? ` | status: ${r.status}` : ""}${r.referenceNumber ? ` | ref: ${r.referenceNumber}` : ""}${r.evidenceSummary ? ` | ${shortText(r.evidenceSummary, 360)}` : ""}`),
  ].filter(Boolean);
}

function buildProjectEvidenceLines(projects: { name?: string | null; evidences?: { title?: string | null; evidenceType?: string | null; fileName?: string | null; description?: string | null; extractedText?: string | null }[] }[]): string[] {
  return projects.flatMap((project) =>
    (project.evidences ?? []).slice(0, 5).map((e) =>
      `Project evidence for ${project.name}: ${e.title} | type: ${e.evidenceType}${e.fileName ? ` | file: ${e.fileName}` : ""}${e.description ? ` | ${shortText(e.description, 280)}` : ""}${e.extractedText ? ` | text: ${shortText(e.extractedText, 520)}` : ""}`
    )
  ).slice(0, 30);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sectionId = body.sectionId as string;

  if (!VALID_SECTION_IDS.includes(sectionId as ProposalSectionId)) {
    return NextResponse.json({
      error: `Invalid sectionId. Must be one of: ${VALID_SECTION_IDS.join(", ")}`,
    }, { status: 400 });
  }

  if (!isAIEnabled()) {
    return NextResponse.json({ error: "AI is not configured. Set ANTHROPIC_API_KEY to enable section regeneration." }, { status: 503 });
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
        legalRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
        financialRecords: { orderBy: { fiscalYear: "desc" }, take: 12 },
        complianceRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
      },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  const projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");

  const intelligence = buildProposalIntelligence({ tender, company, requirements: tender.requirements, experts, projects });

  const tenderText = [
    tender.title, tender.reference, tender.clientName, tender.description,
    tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology,
    ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`),
  ].filter(Boolean).join("\n\n");

  const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");

  const companyEvidenceLines = buildCompanyEvidenceLines(company as unknown as Record<string, unknown>);
  const projectEvidenceLines = buildProjectEvidenceLines(projects as Parameters<typeof buildProjectEvidenceLines>[0]);
  const expertLines = experts.map(expertProofLine);
  const projectLines = projects.map(projectProofLine);
  const requirementLines = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`);
  const evidenceContextLines = [...companyEvidenceLines, ...projectEvidenceLines];

  const complianceLines = [
    ...tender.complianceMatrix.map((m) => {
      const req = m.requirement?.title ?? m.requirement?.description ?? "Requirement";
      return `${m.supportLevel}: ${req} | ${m.evidenceType} from ${m.evidenceSource}${m.evidenceReference ? ` | ref: ${m.evidenceReference}` : ""}${m.notes ? ` — ${m.notes}` : ""}`;
    }),
    ...companyEvidenceLines.slice(0, 14).map((l) => `Company evidence: ${l}`),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
  ];

  type _CompanyFields = {
    legalName?: string | null; address?: string | null; phone?: string | null; email?: string | null;
    website?: string | null; country?: string | null; foundingYear?: number | null; headcount?: number | null;
    licenseGrade?: string | null; registrationNumber?: string | null; tin?: string | null; vat?: string | null;
    gmName?: string | null; gmTitle?: string | null; gmLicense?: string | null; description?: string | null;
    serviceLines?: string | null; sectors?: string | null;
    complianceRecords?: Array<{ title?: string | null; complianceType?: string | null; referenceNumber?: string | null; status?: string | null }>;
  };
  const c = company as typeof company & _CompanyFields;

  const aiInput: AIBidWriterInput = {
    tenderTitle: tender.title,
    clientName: intelligence.clientName,
    tenderText,
    analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
    evaluationMethodology: clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
    submissionNotes,
    requirements: requirementLines.join("\n"),
    companyProfile:
      `${company.name}\n${c.legalName ?? ""}\n${company.profileSummary ?? c.description ?? ""}\n` +
      `Services: ${safeParseArr(c.serviceLines).join(", ")}\n` +
      `Sectors: ${safeParseArr(c.sectors).join(", ")}\n\n` +
      `Company evidence:\n${evidenceContextLines.join("\n").slice(0, 9_000)}`,
    experts: expertLines.join("\n"),
    projects: [...projectLines, ...projectEvidenceLines].join("\n"),
    compliance: complianceLines.join("\n"),
    differentiators: intelligence.differentiators.join("\n"),
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
        .map((r) => [r.title, r.complianceType, r.referenceNumber ? `Ref: ${r.referenceNumber}` : "", r.status ? `Status: ${r.status}` : ""].filter(Boolean).join(" — "))
        .filter((s) => s.length > 0),
    },
    doNotUseAsClient: Array.from(new Set(
      (company as { projects?: Array<{ clientName?: string | null }> }).projects
        ?.map((p) => p.clientName)
        .filter((c): c is string => Boolean(c && c.trim().length >= 3)) ?? []
    )),
    criterionEvidenceMap: buildCriterionEvidenceMap(
      intelligence.evaluationWeights,
      intelligence.topProjects,
      intelligence.topExperts,
    ),
  };

  // Build just the spec for the requested section.
  const allSpecs = buildProposalSectionSpecs(aiInput);
  const spec = allSpecs.find((s) => s.id === sectionId);
  if (!spec) {
    return NextResponse.json({ error: `Section spec not found for: ${sectionId}` }, { status: 500 });
  }

  try {
    let sectionMarkdown: string | null = null;

    try {
      const { generateWithFallback } = await import("../../../../../lib/ai");
      sectionMarkdown = await generateWithFallback(spec.userPrompt, { systemPrompt: spec.systemPrompt });
    } catch (err) {
      console.warn(`[regenerate-section] AI generation failed for ${sectionId}:`, err);
    }

    if (!sectionMarkdown || sectionMarkdown.trim().length < 50) {
      const deterministic = buildSectionFallback(spec, aiInput);
      return NextResponse.json({
        success: true,
        sectionId,
        markdown: deterministic,
        fallback: true,
        message: "AI unavailable — returned deterministic section.",
      });
    }

    return NextResponse.json({
      success: true,
      sectionId,
      markdown: sectionMarkdown,
      fallback: false,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[regenerate-section] Fatal error for ${sectionId}:`, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
