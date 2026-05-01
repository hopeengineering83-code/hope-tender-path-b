import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateProposal, isAIEnabled } from "../../../../../lib/ai";
import { buildQuickDraftBenchmarkPrompt, buildQuickDraftFallback } from "../../../../../lib/engine/quick-draft-benchmark";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId },
      include: { requirements: true },
    }),
    prisma.company.findUnique({ where: { userId } }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const requirementLines = tender.requirements.map((r) => `${r.title}: ${r.description}`);
  const companyName = company?.name ?? "Our Company";
  const companyProfile = company?.profileSummary ?? company?.description ?? "";
  const serviceLines = safeParseArr((company as { serviceLines?: unknown })?.serviceLines).join(", ");
  const quickDraftInput = {
    tenderTitle: tender.title,
    clientName: tender.clientName || "Client",
    tenderDescription: tender.description ?? tender.intakeSummary ?? "",
    requirementLines,
    companyName,
    companyProfile,
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
          requirements: requirementLines.map((r) => `- ${r}`).join("\n"),
          companyName,
          companyProfile,
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
