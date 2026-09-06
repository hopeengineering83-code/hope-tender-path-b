"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { DocumentReviewPanel } from "../../../components/document-review-panel";
import { SkeletonTable } from "../../../components/skeleton";
import { ChatIcon, DownloadIcon } from "../../../components/icons";

type GeneratedDocument = {
  id: string;
  name: string;
  documentType: string;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  reviewNotes?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  contentSummary?: string | null;
  storagePath?: string | null;
  hasInlineFileContent?: boolean | null;
};

type Tender = {
  id: string;
  title: string;
  status: string;
  generatedDocuments: GeneratedDocument[];
  canonicalReady?: boolean;
  canonicalBlockerCodes?: string[];
};

type CurrentUser = { id: string; email: string; role: string };
type ReadinessBlocker = { code?: string; reason?: string };
type ExportReadinessResponse = { ok?: boolean; blockers?: ReadinessBlocker[] };

const READINESS_UNAVAILABLE = "READINESS_UNAVAILABLE";

const GEN_COLORS: Record<string, string> = {
  GENERATED: "bg-green-100 text-green-700",
  PLANNED: "bg-slate-100 text-slate-500",
  FAILED: "bg-red-100 text-red-600",
};

const VAL_COLORS: Record<string, string> = {
  PASSED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-600",
  PENDING: "bg-slate-100 text-slate-400",
};

const REV_COLORS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-600",
  NEEDS_REVISION: "bg-amber-100 text-amber-800",
  PENDING: "bg-slate-100 text-slate-400",
};

async function fetchDocumentsWithReadiness(): Promise<Tender[]> {
  const tendersRes = await fetch("/api/documents", { cache: "no-store" });
  if (!tendersRes.ok) {
    throw new Error(`Document workspace request failed with status ${tendersRes.status}`);
  }

  const payload = await tendersRes.json();
  const tenderList: Tender[] = Array.isArray(payload) ? payload : [];

  const readinessResults = await Promise.all(
    tenderList.map(async (tender) => {
      try {
        const response = await fetch(`/api/tenders/${tender.id}/export-readiness`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          return {
            tenderId: tender.id,
            canonicalReady: false,
            canonicalBlockerCodes: [READINESS_UNAVAILABLE],
          };
        }

        const body = await response.json() as ExportReadinessResponse;
        const blockers = Array.isArray(body.blockers)
          ? body.blockers
              .map((blocker) => blocker.code ?? blocker.reason ?? "UNKNOWN")
              .filter((code): code is string => Boolean(code))
          : [];

        return {
          tenderId: tender.id,
          canonicalReady: body.ok === true && blockers.length === 0,
          canonicalBlockerCodes: blockers,
        };
      } catch {
        return {
          tenderId: tender.id,
          canonicalReady: false,
          canonicalBlockerCodes: [READINESS_UNAVAILABLE],
        };
      }
    }),
  );

  const readinessMap = new Map(readinessResults.map((result) => [result.tenderId, result]));
  return tenderList.map((tender) => ({
    ...tender,
    canonicalReady: readinessMap.get(tender.id)?.canonicalReady ?? false,
    canonicalBlockerCodes: readinessMap.get(tender.id)?.canonicalBlockerCodes ?? [READINESS_UNAVAILABLE],
  }));
}

export default function DocumentsPage() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tenderList, meRes] = await Promise.all([
          fetchDocumentsWithReadiness(),
          fetch("/api/auth/me", { cache: "no-store" }),
        ]);

        if (cancelled) return;
        setTenders(tenderList);
        setLoadError(null);

        if (meRes.ok) {
          const me = await meRes.json();
          if (me?.user) {
            setCurrentUser({ id: me.user.id, email: me.user.email, role: me.user.role });
          }
        }
      } catch {
        if (!cancelled) {
          setLoadError("Proposal documents could not be loaded. Refresh the page before relying on document or export status.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadDocs() {
    try {
      const tenderList = await fetchDocumentsWithReadiness();
      setTenders(tenderList);
      setLoadError(null);
    } catch {
      setLoadError("The review action completed, but canonical document and export status could not be refreshed. Reload before downloading.");
    }
  }

  function downloadDoc(tenderId: string, docId: string) {
    window.open(`/api/tenders/${tenderId}/download?docId=${docId}`, "_blank");
  }

  function downloadZip(tenderId: string) {
    window.open(`/api/tenders/${tenderId}/download?type=zip`, "_blank");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proposal Documents</h1>
          <p className="mt-1 text-sm text-slate-500">Loading planned and generated documents…</p>
        </div>
        <SkeletonTable rows={5} columns={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Proposal Documents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review planned and generated submission outputs, validation status, review decisions, and canonical download readiness.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {!loadError && tenders.length === 0 && (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-400">No proposal documents yet. Build a submission plan and generate the required outputs from a tender workspace.</p>
        </div>
      )}

      <div className="space-y-6">
        {tenders.map((tender) => {
          const generated = tender.generatedDocuments.filter((document) => document.generationStatus === "GENERATED");
          const planned = tender.generatedDocuments.filter((document) => document.generationStatus === "PLANNED");
          const approved = generated.filter((document) => document.reviewStatus === "APPROVED").length;
          const needsRevision = generated.filter((document) => document.reviewStatus === "NEEDS_REVISION").length;
          const canonicalReady = tender.canonicalReady ?? false;
          const canonicalBlockerCodes = tender.canonicalBlockerCodes ?? [READINESS_UNAVAILABLE];
          const canZip = canonicalReady && generated.length > 0 && canonicalBlockerCodes.length === 0;

          return (
            <div key={tender.id} className="rounded-2xl border bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 p-6">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">
                    {generated.length} generated · {planned.length} planned
                    {approved > 0 && <span className="ml-2 text-green-600">{approved} approved</span>}
                    {needsRevision > 0 && <span className="ml-2 text-amber-600">{needsRevision} needs revision</span>}
                    {!canonicalReady && canonicalBlockerCodes.length > 0 && (
                      <span className="ml-2 text-amber-600">
                        ZIP locked ({canonicalBlockerCodes.length} canonical blocker{canonicalBlockerCodes.length !== 1 ? "s" : ""})
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canZip && (
                    <button
                      type="button"
                      onClick={() => downloadZip(tender.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                    >
                      <DownloadIcon /> ZIP Package
                    </button>
                  )}
                  {!canZip && generated.length > 0 && (
                    <span
                      aria-disabled="true"
                      className="cursor-not-allowed rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-400"
                      title={canonicalBlockerCodes.join(", ") || "Canonical readiness not met"}
                    >
                      ZIP locked
                    </span>
                  )}
                  <Link
                    href={`/dashboard/tenders/${tender.id}`}
                    className="rounded border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Open workspace
                  </Link>
                </div>
              </div>

              {tender.generatedDocuments.length === 0 ? (
                <div className="border-t px-6 pb-6 pt-4">
                  <p className="text-sm text-slate-400">No document plan yet. Build the submission plan in the tender workspace first.</p>
                </div>
              ) : (
                <div className="table-scroll border-t">
                  <table className="w-full text-sm" role="table" aria-label="Proposal documents">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                        <th className="px-4 py-2.5 font-medium">#</th>
                        <th className="px-4 py-2.5 font-medium">Document</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Generation</th>
                        <th className="px-4 py-2.5 font-medium">Validation</th>
                        <th className="px-4 py-2.5 font-medium">Review</th>
                        <th className="px-4 py-2.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tender.generatedDocuments.map((document) => (
                        <Fragment key={document.id}>
                          <tr className="border-b last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-3 text-slate-400">{document.exactOrder ?? "—"}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{document.exactFileName || document.name}</p>
                              {document.contentSummary && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{document.contentSummary}</p>
                              )}
                              {document.reviewNotes && (
                                <p className="mt-0.5 text-xs italic text-slate-400">&ldquo;{document.reviewNotes}&rdquo;</p>
                              )}
                              {document.hasInlineFileContent && !(document.storagePath ?? "").trim() && (
                                <p className="mt-0.5 text-xs font-medium text-emerald-700">Restored inline file available</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">{document.documentType}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${GEN_COLORS[document.generationStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {document.generationStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${VAL_COLORS[document.validationStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {document.validationStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${REV_COLORS[document.reviewStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {document.reviewStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                {document.generationStatus === "GENERATED" && canZip && (
                                  <button
                                    type="button"
                                    onClick={() => downloadDoc(tender.id, document.id)}
                                    className="rounded border px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50"
                                    title="Download document"
                                    aria-label={`Download ${document.exactFileName || document.name}`}
                                  >
                                    <DownloadIcon />
                                  </button>
                                )}
                                {document.generationStatus === "GENERATED" && !canZip && (
                                  <span
                                    aria-disabled="true"
                                    className="cursor-not-allowed rounded border px-2.5 py-1 text-xs text-slate-300"
                                    title={canonicalBlockerCodes.join(", ") || "Canonical readiness not met"}
                                  >
                                    <DownloadIcon />
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpandedDocId(expandedDocId === document.id ? null : document.id)}
                                  className={`rounded border px-2.5 py-1 text-xs ${expandedDocId === document.id ? "border-slate-900 bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                                  title="Review & comment"
                                  aria-label={`${expandedDocId === document.id ? "Close" : "Open"} review and comments for ${document.exactFileName || document.name}`}
                                  aria-expanded={expandedDocId === document.id}
                                >
                                  <ChatIcon />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expandedDocId === document.id && (
                            <tr className="border-b bg-slate-50/60 last:border-0">
                              <td colSpan={7} className="px-4 py-4">
                                <DocumentReviewPanel
                                  tenderId={tender.id}
                                  docId={document.id}
                                  docName={document.exactFileName || document.name}
                                  currentReviewStatus={document.reviewStatus}
                                  currentUserRole={currentUser?.role ?? "VIEWER"}
                                  onActionTaken={() => void reloadDocs()}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
