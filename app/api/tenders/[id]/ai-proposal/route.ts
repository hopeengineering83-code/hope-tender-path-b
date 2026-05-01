import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateProposal, isAIEnabled } from "../../../../../lib/ai";
import { buildQuickDraftBenchmarkPrompt, buildQuickDraftFallback } from "../../../../../lib/engine/quick-draft-benchmark";
import { buildQuickDraftEvidenceContext } from "../../../../../lib/engine/quick-draft-evidence-context";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function clean(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function short(value?: string | null, max = 360): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
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
        expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" }, take: 8 },
        projectMatches: {
          where: { isSelected: true },
          include: { project: { include: { evidences: { orderBy: { createdAt: "desc" }, take: 4 } } } },
          orderBy: { score: "desc" },
          take: 8,
        },
      },
    }),
    prisma.company.findUnique({
      where: { userId },
      include: { documents: { orderBy: { updatedAt: "desc" }, take: 8 }, legalRecords: { orderBy: { updatedAt: "desc" }, take: 4 }, complianceRecords: { orderBy: { updatedAt: "desc" }, take: 4 } },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const requirementLines = tender.requirements.map((r) => `${r.title}: ${r.description}`);
  const companyName = company?.name ?? "Our Company";
  const companyProfile = company?.profileSummary ?? company?.description ?? "";
  const serviceLines = safeParseArr((company as { serviceLines?: unknown })?.serviceLines).join(", ");
  const evidenceContext = buildQuickDraftEvidenceContext({
    experts: tender.expertMatches.map((match) => ({
      label: `${match.expert.fullName}${match.expert.title ? ` — ${match.expert.title}` : ""}`,
      detail: [match.expert.yearsExperience ? `${match.expert.yearsExperience}+ years` : null, short(match.expert.profile, 260)].filter(Boolean).join(" | "),
    })),
    projects: tender.projectMatches.map((match) => ({
      label: `${match.project.name}${match.project.clientName ? ` — ${match.project.clientName}` : ""}`,
      detail: [match.project.country, match.project.sector, match.project.contractValue ? `${match.project.currency ?? ""} ${match.project.contractValue}` : null, short(match.project.summary, 260)].filter(Boolean).join(" | "),
    })),
    projectEvidence: tender.projectMatches.flatMap((match) => match.project.evidences.map((evidence) => ({
      label: `${match.project.name}: ${evidence.title}`,
      detail: [evidence.evidenceType, evidence.fileName, short(evidence.description ?? evidence.extractedText, 260)].filter(Boolean).join(" | "),
    }))),
    companyEvidence: [
      ...(company?.documents ?? []).map((doc) => ({ label: `${doc.category}: ${doc.originalFileName}`, detail: short(doc.extractedText, 260) })),
      ...(company?.legalRecords ?? []).map((record) => ({ label: `Legal: ${record.title}`, detail: [record.recordType, record.authority, record.referenceNumber, record.status].filter(Boolean).join(" | ") })),
      ...(company?.complianceRecords ?? []).map((record) => ({ label: `Compliance: ${record.title}`, detail: [record.complianceType, record.status, record.referenceNumber, short(record.evidenceSummary, 220)].filter(Boolean).join(" | ") })),
    ],
  });
  const quickDraftInput = {
    tenderTitle: tender.title,
    clientName: tender.clientName || "Client",
    tenderDescription: [tender.description ?? tender.intakeSummary ?? "", evidenceContext].filter(Boolean).join("\n\n"),
    requirementLines,
    companyName,
    companyProfile: [companyProfile, evidenceContext].filter(Boolean).join("\n\n"),
    serviceLines,
  };

  try {
    let proposal: string;
    let fallback = false;

    if (isAIEnabled()) {
      try {
        proposal = await generateProposal({
          tenderTitle: tender.title,
          tenderDescription: buildQuickDraftBenchmarkPrompt(quickDraftInput),
          requirements: [requirementLines.map((r) => `- ${r}`).join("\n"), evidenceContext].filter(Boolean).join("\n\n"),
          companyName,
          companyProfile: [companyProfile, evidenceContext].filter(Boolean).join("\n\n"),
          serviceLines,
        });
      } catch (aiError) {
        console.error("AI proposal failed; deterministic fallback used:", aiError);
        fallback = true;
        proposal = buildQuickDraftFallback(quickDraftInput, "AI_UNAVAILABLE");
      }
    } else {
      fallback = true;
      proposal = buildQuickDraftFallback(quickDraftInput, "AI_DISABLED");
    }

    await prisma.tender.update({
      where: { id },
      data: {
        intakeSummary: proposal,
        notes: tender.notes,
      },
    });

    return NextResponse.json({ success: true, proposal, fallback });
  } catch (error) {
    console.error("Proposal generation route error:", error);
    return NextResponse.json({ error: "Proposal generation failed" }, { status: 500 });
  }
}
