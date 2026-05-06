"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DocumentReviewPanel } from "../../../components/document-review-panel";
import { SkeletonTable } from "../../../components/skeleton";

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
};

type Tender = {
  id: string;
  title: string;
  status: string;
  generatedDocuments: GeneratedDocument[];
};

type CurrentUser = { id: string; email: string; role: string };

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
  NEEDS_REVISION: "bg-amber-100 text-amber-700",
  PENDING: "bg-slate-100 text-slate-400",
};

export default function DocumentsPage() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // Per-document review panel expansion state. Only one panel open at a
  // time keeps the list scannable; clicking the same row again collapses.
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [tendersRes, meRes] = await Promise.all([
          fetch("/api/documents"),
          fetch("/api/auth/me"),
        ]);
        if (tendersRes.ok) setTenders(await tendersRes.json());
        if (meRes.ok) {
          const me = await meRes.json();
          if (me?.user) setCurrentUser({ id: me.user.id, email: me.user.email, role: me.user.role });
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Reload tender list when a review action mutates document state.
  // The review panel calls onActionTaken after a successful action;
  // we re-fetch so the table's reviewStatus column updates.
  async function reloadDocs() {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) setTenders(await res.json());
    } catch {
      // Non-fatal; the panel itself shows the latest state.
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
          <h1 className="text-2xl font-bold text-slate-900">Generated Documents</h1>
          <p className="mt-1 text-sm text-slate-500">Loading documents…</p>
        </div>
        <SkeletonTable rows={5} columns={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Generated Documents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review planned submission outputs, validation status, review decisions, and download documents.
        </p>
      </div>

      {tenders.length === 0 && (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-400">No generated documents yet. Run the tender engine on a tender to create outputs.</p>
        </div>
      )}

      <div className="space-y-6">
        {tenders.map((tender) => {
          const generated = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
          const planned = tender.generatedDocuments.filter((d) => d.generationStatus === "PLANNED");
          const approved = generated.filter((d) => d.reviewStatus === "APPROVED").length;
          const needsRevision = generated.filter((d) => d.reviewStatus === "NEEDS_REVISION").length;

          return (
            <div key={tender.id} className="rounded-2xl border bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 p-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">
                    {generated.length} generated · {planned.length} planned
                    {approved > 0 && <span className="ml-2 text-green-600">{approved} approved</span>}
                    {needsRevision > 0 && <span className="ml-2 text-amber-600">{needsRevision} needs revision</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {generated.length > 0 && (
                    <button
                      onClick={() => downloadZip(tender.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                    >
                      ↓ ZIP Package
                    </button>
                  )}
                  <Link href={`/dashboard/tenders/${tender.id}`}
                    className="rounded border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    Open workspace
                  </Link>
                </div>
              </div>

              {tender.generatedDocuments.length === 0 ? (
                <div className="border-t px-6 pb-6 pt-4">
                  <p className="text-sm text-slate-400">No document plan yet. Run the tender engine first.</p>
                </div>
              ) : (
                /* PR #253 — table-scroll wrapper makes this dense table horizontally
                   scrollable on mobile, and aria-label gives screen-reader context. */
                <div className="border-t table-scroll">
                  <table className="w-full text-sm" role="table" aria-label="Generated documents">
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
                      {tender.generatedDocuments.map((doc) => (
                        <>
                          <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-3 text-slate-400">{doc.exactOrder ?? "—"}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{doc.exactFileName || doc.name}</p>
                              {doc.contentSummary && (
                                <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{doc.contentSummary}</p>
                              )}
                              {doc.reviewNotes && (
                                <p className="mt-0.5 text-xs text-slate-400 italic">&ldquo;{doc.reviewNotes}&rdquo;</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">{doc.documentType}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${GEN_COLORS[doc.generationStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {doc.generationStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${VAL_COLORS[doc.validationStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {doc.validationStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${REV_COLORS[doc.reviewStatus] ?? "bg-slate-100 text-slate-500"}`}>
                                {doc.reviewStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                {doc.generationStatus === "GENERATED" && (
                                  <button
                                    type="button"
                                    onClick={() => downloadDoc(tender.id, doc.id)}
                                    className="rounded border px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50"
                                    title="Download document"
                                    aria-label={`Download ${doc.exactFileName || doc.name}`}
                                  >
                                    <span aria-hidden="true">↓</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                                  className={`rounded border px-2.5 py-1 text-xs ${expandedDocId === doc.id ? "border-slate-900 bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                                  title="Review & comment"
                                  aria-label={`${expandedDocId === doc.id ? "Close" : "Open"} review and comments for ${doc.exactFileName || doc.name}`}
                                  aria-expanded={expandedDocId === doc.id}
                                >
                                  <span aria-hidden="true">💬</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expandedDocId === doc.id && (
                            <tr key={`${doc.id}-panel`} className="border-b last:border-0 bg-slate-50/60">
                              <td colSpan={7} className="px-4 py-4">
                                <DocumentReviewPanel
                                  tenderId={tender.id}
                                  docId={doc.id}
                                  docName={doc.exactFileName || doc.name}
                                  currentReviewStatus={doc.reviewStatus}
                                  currentUserRole={currentUser?.role ?? "VIEWER"}
                                  onActionTaken={() => void reloadDocs()}
                                />
                              </td>
                            </tr>
                          )}
                        </>
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
