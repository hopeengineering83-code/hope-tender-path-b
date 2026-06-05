import { prisma, prismaReady } from "../../../lib/prisma";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await prismaReady;

  const share = await prisma.tenderShare.findUnique({
    where: { token },
    include: {
      tender: {
        select: {
          title: true,
          clientName: true,
          country: true,
          deadline: true,
          status: true,
          analysisSummary: true,
          requirements: { select: { title: true, priority: true, category: true }, take: 30 },
          generatedDocuments: {
            where: { generationStatus: { not: "SUPERSEDED" } },
            select: { documentType: true, generationStatus: true, validationStatus: true },
          },
        },
      },
    },
  });

  if (!share) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full text-center p-8 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Link Not Found</h1>
          <p className="text-slate-500">This link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (share.expiresAt && share.expiresAt < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full text-center p-8 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="text-4xl mb-4">⏰</div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Link Expired</h1>
          <p className="text-slate-500">This link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const tender = share.tender;
  const summary = tender.analysisSummary
    ? tender.analysisSummary.length > 600
      ? tender.analysisSummary.slice(0, 600) + "…"
      : tender.analysisSummary
    : null;

  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const topRequirements = [...tender.requirements]
    .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))
    .slice(0, 20);

  const priorityColors: Record<string, string> = {
    HIGH: "bg-red-100 text-red-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    LOW: "bg-slate-100 text-slate-600",
  };

  const statusColors: Record<string, string> = {
    GENERATED: "bg-green-100 text-green-700",
    PLANNED: "bg-blue-100 text-blue-700",
    FAILED: "bg-red-100 text-red-700",
    PENDING: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Read-Only Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-700 font-medium">
        Shared Tender — Read Only
      </div>

      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        {/* Tender Header */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">{tender.title}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {tender.clientName && (
              <div>
                <span className="text-slate-500 font-medium">Client</span>
                <p className="text-slate-800">{tender.clientName}</p>
              </div>
            )}
            {tender.country && (
              <div>
                <span className="text-slate-500 font-medium">Country</span>
                <p className="text-slate-800">{tender.country}</p>
              </div>
            )}
            {tender.deadline && (
              <div>
                <span className="text-slate-500 font-medium">Deadline</span>
                <p className="text-slate-800">{new Date(tender.deadline).toLocaleDateString()}</p>
              </div>
            )}
            {tender.status && (
              <div>
                <span className="text-slate-500 font-medium">Status</span>
                <p className="text-slate-800">{tender.status}</p>
              </div>
            )}
          </div>
        </div>

        {/* AI Analysis Summary */}
        {summary && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">AI Analysis Summary</h2>
            <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{summary}</p>
          </div>
        )}

        {/* Requirements */}
        {topRequirements.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">
              Requirements
              <span className="ml-2 text-sm font-normal text-slate-400">
                (top {topRequirements.length})
              </span>
            </h2>
            <div className="divide-y divide-slate-100">
              {topRequirements.map((req, i) => (
                <div key={i} className="py-2 flex items-start gap-3">
                  <span
                    className={`mt-0.5 shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${priorityColors[req.priority] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {req.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{req.title}</p>
                    {req.category && (
                      <p className="text-xs text-slate-400 mt-0.5">{req.category}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generated Documents */}
        {tender.generatedDocuments.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">Generated Documents</h2>
            <div className="divide-y divide-slate-100">
              {tender.generatedDocuments.map((doc, i) => (
                <div key={i} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">{doc.documentType}</span>
                  <div className="flex gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[doc.generationStatus] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {doc.generationStatus}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[doc.validationStatus] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {doc.validationStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 pb-4">
          Powered by Hope Tender
        </div>
      </div>
    </div>
  );
}
