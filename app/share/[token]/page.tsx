import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { prisma, prismaReady } from "../../../lib/prisma";
import { isValidTenderShareToken, hashTenderShareToken } from "../../../lib/tender-share-security";
import { LinkIcon, BanIcon, ClockIcon, WarningIcon } from "../../../components/icons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Shared Tender | Hope Tender",
};

type ShareWithTender = Awaited<ReturnType<typeof loadShare>>;
type ShareFailureReason = "not-found" | "revoked" | "expired" | "limit";

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

const RECOVERY_GUIDANCE: Record<ShareFailureReason, string> = {
  "not-found": "Check that the complete link was copied. If it still does not open, ask the sender to create a new shared link.",
  revoked: "The sender disabled this link. Ask them to create and send a new shared link if access is still required.",
  expired: "The access period ended. Ask the sender to create a new shared link with a suitable expiry date.",
  limit: "The permitted number of views has been used. Ask the sender to create a new link or increase the access limit.",
};

function MessagePage({
  icon,
  title,
  message,
  reason,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  reason: ShareFailureReason;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8" aria-labelledby="share-message-title">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Hope Tender</p>
        <div className="mx-auto mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-3xl text-slate-700" aria-hidden="true">
          {icon}
        </div>
        <h1 id="share-message-title" className="mt-4 text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
          <h2 className="text-sm font-semibold text-amber-900">How to regain access</h2>
          <p className="mt-1 text-sm leading-6 text-amber-800">{RECOVERY_GUIDANCE[reason]}</p>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            Sign in to Hope Tender
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
          >
            Return to home page
          </Link>
        </div>

        <p className="mt-5 text-xs leading-5 text-slate-400">
          Shared tender links are read-only. Signing in does not restore this link, but it lets authorized users access their own Hope Tender workspace.
        </p>
      </section>
    </main>
  );
}

async function claimShareAccess(token: string): Promise<
  | { ok: true; share: NonNullable<ShareWithTender> }
  | { ok: false; reason: ShareFailureReason }
> {
  // SECURITY (audit C-4): look up by SHA-256 hash first (new-style shares),
  // then fall back to plaintext token match (legacy shares created before
  // this fix). The hash lookup is O(1) via the unique index on tokenHash.
  // The plaintext fallback will be removed once all legacy shares have
  // expired (max lifetime = 365 days from creation).
  const tokenHash = hashTenderShareToken(token);

  // Try the hash-based claim first (new-style shares).
  let claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TenderShare"
    SET "downloadCount" = "downloadCount" + 1
    WHERE "tokenHash" = ${tokenHash}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")
    RETURNING "id"
  `;

  // Fallback: legacy plaintext token (shares created before audit C-4 fix).
  if (claimed.length === 0) {
    claimed = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "TenderShare"
      SET "downloadCount" = "downloadCount" + 1
      WHERE "token" = ${token}
        AND "tokenHash" IS NULL
        AND "revokedAt" IS NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
        AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")
      RETURNING "id"
    `;
  }

  const claimedId = claimed[0]?.id;
  if (claimedId) {
    const share = await loadShare(claimedId);
    if (share && !share.revokedAt && (!share.expiresAt || share.expiresAt > new Date())) {
      return { ok: true, share };
    }
  }

  // Determine the failure reason. Try hash lookup first, then legacy token.
  let status = await prisma.tenderShare.findUnique({
    where: { tokenHash },
    select: { revokedAt: true, expiresAt: true, maxDownloads: true, downloadCount: true },
  });
  if (!status) {
    // Try legacy plaintext token lookup.
    status = await prisma.tenderShare.findUnique({
      where: { token },
      select: { revokedAt: true, expiresAt: true, maxDownloads: true, downloadCount: true },
    });
  }
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
    return (
      <MessagePage
        icon={<LinkIcon />}
        title="Shared Link Unavailable"
        message="This shared tender link is incomplete, invalid, or no longer available."
        reason="not-found"
      />
    );
  }

  await prismaReady;
  const result = await claimShareAccess(token);
  if (!result.ok) {
    if (result.reason === "revoked") {
      return <MessagePage icon={<BanIcon />} title="Shared Link Revoked" message="The sender has disabled access through this link." reason="revoked" />;
    }
    if (result.reason === "expired") {
      return <MessagePage icon={<ClockIcon />} title="Shared Link Expired" message="The access period for this shared tender link has ended." reason="expired" />;
    }
    if (result.reason === "limit") {
      return <MessagePage icon={<WarningIcon />} title="Shared Link Access Limit Reached" message="This link has reached its permitted number of views." reason="limit" />;
    }
    return (
      <MessagePage
        icon={<LinkIcon />}
        title="Shared Link Unavailable"
        message="This shared tender link is incomplete, invalid, or no longer available."
        reason="not-found"
      />
    );
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
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800">
        Shared Tender — Read Only
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-2xl font-bold text-slate-800">{tender.title}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(tender.clientName || tender.procuringEntityName) && (
              <div>
                <span className="font-medium text-slate-500">Client</span>
                <p className="text-slate-800">{tender.clientName || tender.procuringEntityName}</p>
              </div>
            )}
            {tender.country && (
              <div>
                <span className="font-medium text-slate-500">Country</span>
                <p className="text-slate-800">{tender.country}</p>
              </div>
            )}
            {tender.deadline && (
              <div>
                <span className="font-medium text-slate-500">Deadline</span>
                <p className="text-slate-800">{new Date(tender.deadline).toLocaleDateString()}</p>
              </div>
            )}
            {tender.status && (
              <div>
                <span className="font-medium text-slate-500">Status</span>
                <p className="text-slate-800">{tender.status}</p>
              </div>
            )}
          </div>
        </div>

        {summary && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">AI Analysis Summary</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{summary}</p>
          </div>
        )}

        {topRequirements.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">
              Requirements
              <span className="ml-2 text-sm font-normal text-slate-400">(top {topRequirements.length})</span>
            </h2>
            <div className="divide-y divide-slate-100">
              {topRequirements.map((req, index) => (
                <div key={`${req.title}-${index}`} className="flex items-start gap-3 py-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityColors[req.priority] ?? "bg-slate-100 text-slate-600"}`}>
                    {req.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{req.title}</p>
                    {req.requirementType && <p className="mt-0.5 text-xs text-slate-400">{req.requirementType}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tender.generatedDocuments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">Generated Documents</h2>
            <div className="divide-y divide-slate-100">
              {tender.generatedDocuments.map((doc, index) => (
                <div key={`${doc.documentType}-${index}`} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-slate-700">{doc.documentType}</span>
                  <div className="flex gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[doc.generationStatus] ?? "bg-slate-100 text-slate-600"}`}>
                      {doc.generationStatus}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[doc.validationStatus] ?? "bg-slate-100 text-slate-600"}`}>
                      {doc.validationStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pb-4 text-center text-xs text-slate-400">Powered by Hope Tender</div>
      </div>
    </div>
  );
}
