import { unstable_noStore as noStore } from "next/cache";
import type { ReactNode } from "react";
import { prisma, prismaReady } from "../../../lib/prisma";
import { isValidTenderShareToken } from "../../../lib/tender-share-security";
import { LinkIcon, BanIcon, ClockIcon, WarningIcon } from "../../../components/icons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShareWithTender = Awaited<ReturnType<typeof loadShare>>;

async function loadShare(id: string) {
  return prisma.tenderShare.findUnique({
    where: { id },
    include: {
      tender: {
        select: {
          title: true,
          clientName: true,
          procuringEntityName: true,
          country: true,
          deadline: true,
          status: true,
          analysisSummary: true,
          requirements: { select: { title: true, priority: true, requirementType: true }, take: 30 },
          generatedDocuments: {
            where: { generationStatus: { not: "SUPERSEDED" } },
            select: { documentType: true, generationStatus: true, validationStatus: true },
          },
        },
      },
    },
  });
}

function MessagePage({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full text-center p-8 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="text-4xl mb-4">{icon}</div>
        <h1 className="text-xl font-semibold text-slate-800 mb-2">{title}</h1>
        <p className="text-slate-500">{message}</p>
      </div>
    </div>
  );
}

async function claimShareAccess(token: string): Promise<
  | { ok: true; share: NonNullable<ShareWithTender> }
  | { ok: false; reason: "not-found" | "revoked" | "expired" | "limit" }
> {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TenderShare"
    SET "downloadCount" = "downloadCount" + 1
    WHERE "token" = ${token}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")
    RETURNING "id"
  `;

  const claimedId = claimed[0]?.id;
  if (claimedId) {
    const share = await loadShare(claimedId);
    if (share && !share.revokedAt && (!share.expiresAt || share.expiresAt > new Date())) {
      return { ok: true, share };
    }
  }

  const status = await prisma.tenderShare.findUnique({
    where: { token },
    select: { revokedAt: true, expiresAt: true, maxDownloads: true, downloadCount: true },
  });
  if (!status) return { ok: false, reason: "not-found" };
  if (status.revokedAt) return { ok: false, reason: "revoked" };
  if (status.expiresAt && status.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (status.maxDownloads !== null && status.downloadCount >= status.maxDownloads) {
    return { ok: false, reason: "limit" };
  }
  return { ok: false, reason: "not-found" };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  noStore();
  const { token } = await params;
  if (!isValidTenderShareToken(token)) {
    return <MessagePage icon={<LinkIcon />} title="Link Not Found" message="This link is invalid or has expired." />;
  }

  await prismaReady;
  const result = await claimShareAccess(token);
  if (!result.ok) {
    if (result.reason === "revoked") {
      return <MessagePage icon={<BanIcon />} title="Link Revoked" message="This link has been revoked." />;
    }
    if (result.reason === "expired") {
      return <MessagePage icon={<ClockIcon />} title="Link Expired" message="This link has expired." />;
    }
    if (result.reason === "limit") {
      return <MessagePage icon={<WarningIcon />} title="Access Limit Reached" message="This link has reached its maximum access limit." />;
    }
    return <MessagePage icon={<LinkIcon />} title="Link Not Found" message="This link is invalid or has expired." />;
  }

  const tender = result.share.tender;
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
    MEDIUM: "bg-amber-100 text-amber-800",
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
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800 font-medium">
        Shared Tender — Read Only
      </div>

      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">{tender.title}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(tender.clientName || tender.procuringEntityName) && (
              <div>
                <span className="text-slate-500 font-medium">Client</span>
                <p className="text-slate-800">{tender.clientName || tender.procuringEntityName}</p>
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

        {summary && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">AI Analysis Summary</h2>
            <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{summary}</p>
          </div>
        )}

        {topRequirements.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">
              Requirements
              <span className="ml-2 text-sm font-normal text-slate-400">(top {topRequirements.length})</span>
            </h2>
            <div className="divide-y divide-slate-100">
              {topRequirements.map((req, index) => (
                <div key={`${req.title}-${index}`} className="py-2 flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${priorityColors[req.priority] ?? "bg-slate-100 text-slate-600"}`}>
                    {req.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{req.title}</p>
                    {req.requirementType && <p className="text-xs text-slate-400 mt-0.5">{req.requirementType}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tender.generatedDocuments.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-700 mb-3">Generated Documents</h2>
            <div className="divide-y divide-slate-100">
              {tender.generatedDocuments.map((doc, index) => (
                <div key={`${doc.documentType}-${index}`} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">{doc.documentType}</span>
                  <div className="flex gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[doc.generationStatus] ?? "bg-slate-100 text-slate-600"}`}>
                      {doc.generationStatus}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[doc.validationStatus] ?? "bg-slate-100 text-slate-600"}`}>
                      {doc.validationStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xs text-slate-400 pb-4">Powered by Hope Tender</div>
      </div>
    </div>
  );
}
