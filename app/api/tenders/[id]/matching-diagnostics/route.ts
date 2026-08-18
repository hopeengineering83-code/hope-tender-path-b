import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

type MatchRow = {
  id: string;
  score: number;
  isSelected: boolean;
  rationale: string | null;
};

function summarize(rows: MatchRow[]) {
  const selected = rows.filter((row) => row.isSelected);
  const avg = selected.length > 0 ? selected.reduce((sum, row) => sum + row.score, 0) / selected.length : 0;
  const lowConfidence = selected.filter((row) => row.score < 0.6).map((row) => ({ id: row.id, score: row.score }));
  const lowCoverage = selected
    .filter((row) => /Required-family coverage:\s*0\//i.test(row.rationale ?? ""))
    .map((row) => ({ id: row.id, rationale: row.rationale }));
  const hardExcluded = rows
    .filter((row) => /hard-excluded/i.test(row.rationale ?? ""))
    .map((row) => ({ id: row.id }));
  return {
    total: rows.length,
    selected: selected.length,
    averageSelectedScore: Number(avg.toFixed(3)),
    lowConfidence,
    lowCoverage,
    hardExcluded,
    topSelected: selected
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((row) => ({ id: row.id, score: row.score, evidenceSummary: row.rationale ?? "" })),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [expertMatches, projectMatches] = await Promise.all([
    // NOTE: TenderExpertMatch/TenderProjectMatch have no `evidenceSummary`
    // column (see prisma/schema.prisma) — only the in-memory MatchingResult
    // type carries one. Selecting it made Prisma reject the query, so this
    // endpoint answered 500 for every tender and the match-review step could
    // not be inspected at all. `rationale` is the persisted evidence text.
    prisma.tenderExpertMatch.findMany({ where: { tenderId }, select: { id: true, score: true, isSelected: true, rationale: true } }),
    prisma.tenderProjectMatch.findMany({ where: { tenderId }, select: { id: true, score: true, isSelected: true, rationale: true } }),
  ]);

  return NextResponse.json({
    tenderId,
    experts: summarize(expertMatches),
    projects: summarize(projectMatches),
    generatedAt: new Date().toISOString(),
  });
}
