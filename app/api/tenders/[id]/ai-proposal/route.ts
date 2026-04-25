import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateProposal, isAIEnabled } from "../../../../../lib/ai";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAIEnabled()) {
    return NextResponse.json({ error: "AI not configured. Add GEMINI_API_KEY to Vercel environment variables." }, { status: 400 });
  }

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

  try {
    function safeParseArr(v: unknown): string[] {
      try { return JSON.parse(v as string) as string[]; } catch { return []; }
    }

    const proposal = await generateProposal({
      tenderTitle: tender.title,
      tenderDescription: tender.description ?? "",
      requirements: tender.requirements.map((r) => `- ${r.title}: ${r.description}`).join("\n"),
      companyName: company?.name ?? "Our Company",
      companyProfile: company?.profileSummary ?? company?.description ?? "",
      serviceLines: safeParseArr((company as { serviceLines?: unknown })?.serviceLines).join(", "),
    });

    await prisma.tender.update({
      where: { id },
      data: { intakeSummary: tender.intakeSummary, notes: tender.notes },
    });

    return NextResponse.json({ success: true, proposal });
  } catch (error) {
    console.error("Proposal generation error:", error);
    return NextResponse.json({ error: "Proposal generation failed" }, { status: 500 });
  }
}
