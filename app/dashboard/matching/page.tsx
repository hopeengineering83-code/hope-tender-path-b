import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export default async function MatchingPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
      projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Matching Engine</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review ranked experts and project references selected from the company knowledge base.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => (
          <div key={tender.id} className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                <p className="text-sm text-slate-500">{tender.expertMatches.length} expert matches · {tender.projectMatches.length} project matches</p>
              </div>
              <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm text-blue-600 hover:underline">Open workspace</Link>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Top experts</p>
                <div className="space-y-2">
                  {tender.expertMatches.slice(0, 3).map((match) => (
                    <div key={match.id} className="rounded-xl border px-4 py-3 text-sm">
                      <p className="font-medium text-slate-900">{match.expert?.fullName || "Unknown expert"}</p>
                      <p className="text-xs text-slate-500">Score {match.score.toFixed(2)} · {match.isSelected ? "Selected" : "Candidate"}</p>
                      <p className="mt-1 text-slate-600">{match.evidenceSummary || match.rationale || "No summary."}</p>
                    </div>
                  ))}
                  {tender.expertMatches.length === 0 && <p className="text-sm text-slate-400">No expert matches yet.</p>}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Top projects</p>
                <div className="space-y-2">
                  {tender.projectMatches.slice(0, 3).map((match) => (
                    <div key={match.id} className="rounded-xl border px-4 py-3 text-sm">
                      <p className="font-medium text-slate-900">{match.project?.name || "Unknown project"}</p>
                      <p className="text-xs text-slate-500">Score {match.score.toFixed(2)} · {match.isSelected ? "Selected" : "Candidate"}</p>
                      <p className="mt-1 text-slate-600">{match.evidenceSummary || match.rationale || "No summary."}</p>
                    </div>
                  ))}
                  {tender.projectMatches.length === 0 && <p className="text-sm text-slate-400">No project matches yet.</p>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
