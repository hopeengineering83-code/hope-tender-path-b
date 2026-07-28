"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ReviewTrust =
  | "REVIEWED"
  | "SOURCE_VERIFIED"
  | "MANUAL_DRAFT"
  | "AI_DRAFT"
  | "REGEX_DRAFT"
  | "PROVENANCE_REQUIRED"
  | "SOURCE_VERIFICATION_REQUIRED";
type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };
type ReviewRecord = {
  id: string;
  trustLevel: ReviewTrust;
  canReview: boolean;
  missingEvidenceFields: string[];
  tags: string[];
};
type ExpertRecord = ReviewRecord & { fullName: string; secondary: string };
type ProjectRecord = ReviewRecord & { name: string; secondary: string };
type SupportReviewKind = "LEGAL" | "FINANCIAL" | "COMPLIANCE";
type SupportRecord = ReviewRecord & {
  kind: SupportReviewKind;
  title: string;
  secondary: string;
};
type RecordPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
type Diagnostics = {
  importVersion: string;
  fingerprint: string;
  documents: Array<{
    id: string;
    fileName: string;
    category: string;
    extractedChars: number;
    status: string;
    isExpertSource: boolean;
    isProjectSource: boolean;
    aiExtractionStatus?: string;
  }>;
  totals: {
    documents: number;
    extractedDocuments: number;
    expertSourceDocuments: number;
    projectSourceDocuments: number;
    currentExperts: number;
    currentProjects: number;
    currentLegalRecords: number;
    currentFinancialRecords: number;
    currentComplianceRecords: number;
    reviewedExperts: number;
    reviewedProjects: number;
    reviewedLegalRecords: number;
    reviewedFinancialRecords: number;
    reviewedComplianceRecords: number;
    unsupportedReviewedExperts: number;
    unsupportedReviewedProjects: number;
    aiEnabled?: boolean;
  };
  gaps: Gap[];
  records: {
    experts: RecordPage<ExpertRecord>;
    projects: RecordPage<ProjectRecord>;
    legal: RecordPage<SupportRecord>;
    financial: RecordPage<SupportRecord>;
    compliance: RecordPage<SupportRecord>;
  };
};
type ReimportResult = {
  status?: string;
  jobId?: string;
  error?: string;
  requestId?: string;
};
type BatchResult = {
  updated: number;
  accepted: Array<{ id: string; status: "REVIEWED" }>;
  rejected: Array<{ id: string; code: string; missingEvidenceFields?: string[] }>;
  requestId?: string;
};

function severityClass(severity: Gap["severity"]) {
  if (severity === "CRITICAL") return "border-red-300 bg-red-50 text-red-800";
  if (severity === "HIGH") return "border-orange-300 bg-orange-50 text-orange-800";
  if (severity === "MEDIUM") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-blue-300 bg-blue-50 text-blue-800";
}

function trustBadge(value: ReviewTrust) {
  if (value === "REVIEWED") return { label: "Human reviewed", cls: "bg-green-100 text-green-700" };
  if (value === "SOURCE_VERIFIED") return { label: "Source verified", cls: "bg-blue-100 text-blue-700" };
  if (value === "MANUAL_DRAFT") return { label: "Manual draft", cls: "bg-slate-100 text-slate-700" };
  if (value === "PROVENANCE_REQUIRED") return { label: "Human review invalidated", cls: "bg-red-100 text-red-700" };
  if (value === "SOURCE_VERIFICATION_REQUIRED") return { label: "Source verification invalidated", cls: "bg-red-100 text-red-700" };
  if (value === "AI_DRAFT") return { label: "AI draft", cls: "bg-amber-100 text-amber-800" };
  return { label: "Deterministic draft", cls: "bg-slate-100 text-slate-700" };
}

function sourceRole(doc: Diagnostics["documents"][number]): string {
  if (doc.isExpertSource && doc.isProjectSource) return "Mixed expert and project evidence";
  if (doc.isExpertSource) return "Expert evidence source";
  if (doc.isProjectSource) return "Project evidence source";
  return "Company support evidence";
}

function evidenceStatus(record: ReviewRecord): string {
  if (record.trustLevel === "REVIEWED") {
    return "A real reviewer identity, review timestamp, current source bytes, extraction revision, exact fields, and source spans are bound together.";
  }
  if (record.trustLevel === "SOURCE_VERIFIED") {
    return "The current owned source bytes, extraction revision, exact fields, and source spans were machine-verified. This may support matching and draft generation, but it is not human review and cannot satisfy final approval.";
  }
  if (record.canReview) {
    return "Owned source text supports the displayed fields. Human review can approve the record for final-package eligibility.";
  }
  return `Blocked until evidence is available${record.missingEvidenceFields.length ? ` for: ${record.missingEvidenceFields.join(", ")}` : ""}.`;
}

function PaginationControls(props: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>{props.total} total records · page {props.page} of {props.totalPages}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => props.onPage(props.page - 1)}
          disabled={props.page <= 1}
          className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Previous page"
          title={props.page <= 1 ? "You are on the first page." : "Go to the previous page."}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => props.onPage(props.page + 1)}
          disabled={props.page >= props.totalPages}
          className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Next page"
          title={props.page >= props.totalPages ? "You are on the last page." : "Go to the next page."}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SupportReviewSection(props: {
  kind: SupportReviewKind;
  heading: string;
  description: string;
  page: RecordPage<SupportRecord>;
  reviewingRecord: string | null;
  onPage: (page: number) => void;
  onAction: (kind: SupportReviewKind, record: SupportRecord) => void;
}) {
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{props.heading}</h2>
        <p className="text-xs text-slate-500">{props.description}</p>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {props.page.items.map((record) => {
          const badge = trustBadge(record.trustLevel);
          const isReviewed = record.trustLevel === "REVIEWED";
          const disabled = props.reviewingRecord === `${props.kind}:${record.id}` ||
            (!isReviewed && !record.canReview);
          return (
            <article key={record.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{record.title}</p>
                  <p className="text-sm text-slate-500">{record.secondary}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {record.tags.map((tag, index) => (
                  <span key={`${tag}-${index}`} className="rounded-full bg-slate-100 px-2 py-1">{tag}</span>
                ))}
              </div>
              <details className="mt-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium">Evidence status</summary>
                <p className="mt-2">{evidenceStatus(record)}</p>
              </details>
              <button
                type="button"
                onClick={() => props.onAction(props.kind, record)}
                disabled={disabled}
                className={`mt-4 rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  isReviewed ? "border border-slate-300 text-slate-700" : "bg-green-600 text-white"
                }`}
                title={!isReviewed && !record.canReview ? "Durable owned source evidence is required before human review." : undefined}
              >
                {props.reviewingRecord === `${props.kind}:${record.id}`
                  ? "Saving…"
                  : isReviewed
                    ? "Return to draft"
                    : "Human-review record"}
              </button>
            </article>
          );
        })}
        {!props.page.items.length && <p className="text-sm text-slate-400">No {props.heading.toLowerCase()} found.</p>}
      </div>
      <div className="mt-4">
        <PaginationControls {...props.page} onPage={props.onPage} />
      </div>
    </section>
  );
}

export default function ReviewInboxPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [expertPage, setExpertPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const [legalPage, setLegalPage] = useState(1);
  const [financialPage, setFinancialPage] = useState(1);
  const [compliancePage, setCompliancePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedExperts, setSelectedExperts] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [batchingExperts, setBatchingExperts] = useState(false);
  const [batchingProjects, setBatchingProjects] = useState(false);
  const [reviewingRecord, setReviewingRecord] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        expertPage: String(expertPage),
        projectPage: String(projectPage),
        legalPage: String(legalPage),
        financialPage: String(financialPage),
        compliancePage: String(compliancePage),
      });
      const response = await fetch(`/api/company/knowledge/repair?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load privacy-safe review data");
      const data = await response.json() as { diagnostics: Diagnostics };
      setDiagnostics(data.diagnostics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review data");
    } finally {
      setLoading(false);
    }
  }, [expertPage, projectPage, legalPage, financialPage, compliancePage]);

  useEffect(() => {
    void load();
  }, [load]);

  const expertItems = diagnostics?.records.experts.items ?? [];
  const projectItems = diagnostics?.records.projects.items ?? [];
  const eligibleExperts = expertItems.filter((record) => record.canReview && record.trustLevel !== "REVIEWED");
  const eligibleProjects = projectItems.filter((record) => record.canReview && record.trustLevel !== "REVIEWED");

  async function reprocessSources() {
    setRepairing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/company/reimport", { method: "POST" });
      const data = await response.json().catch(() => ({})) as ReimportResult;
      if (!response.ok) {
        throw new Error(data.error || `Company Vault reprocessing failed${data.requestId ? ` (request ${data.requestId})` : ""}`);
      }
      // Re-extraction + re-ingestion now run in a background job (large
      // document sets can exceed a request's time budget) — nudge the
      // worker to start immediately, then let the user refresh to see
      // results rather than blocking this request on the outcome.
      void fetch("/api/ai-jobs/run-next?jobType=VAULT_INGEST", { method: "POST" }).catch(() => {});
      setMessage(
        "Source reprocessing queued — large document sets can take a few minutes. Refresh this page shortly to see updated records.",
      );
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : "Company Vault reprocessing failed");
    } finally {
      setRepairing(false);
    }
  }

  async function submitBatch(kind: "experts" | "projects") {
    const selected = kind === "experts" ? selectedExperts : selectedProjects;
    if (selected.size === 0) return;
    if (kind === "experts") setBatchingExperts(true);
    else setBatchingProjects(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/company/${kind}/batch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], trustLevel: "REVIEWED" }),
      });
      const data = await response.json() as BatchResult & { error?: string };
      if (!response.ok && !Array.isArray(data.rejected)) {
        throw new Error(data.error || "Batch review failed");
      }

      if (kind === "experts") setSelectedExperts(new Set());
      else setSelectedProjects(new Set());
      await load();

      const blocked = data.rejected?.length ?? 0;
      if (data.updated > 0) {
        setMessage(`${data.updated} ${kind} human-reviewed with durable source evidence.${blocked ? ` ${blocked} blocked for missing or unowned evidence.` : ""}`);
      } else {
        const missing = (data.rejected ?? []).flatMap((item) => item.missingEvidenceFields ?? []).slice(0, 4);
        setError(`No ${kind} were reviewed. Durable source evidence is required${missing.length ? ` for: ${missing.join(", ")}` : ""}.`);
      }
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "Batch review failed");
    } finally {
      if (kind === "experts") setBatchingExperts(false);
      else setBatchingProjects(false);
    }
  }

  async function submitSupportReview(kind: SupportReviewKind, record: SupportRecord) {
    const route = kind === "LEGAL"
      ? "legal-records"
      : kind === "FINANCIAL"
        ? "financial-records"
        : "compliance-records";
    const action = record.trustLevel === "REVIEWED" ? "reject" : "approve";
    setReviewingRecord(`${kind}:${record.id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/company/${route}/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "reject" ? { notes: "Returned to draft from Company Vault Review Inbox." } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        requestId?: string;
        missingEvidenceFields?: string[];
      };
      if (!response.ok) {
        const missing = data.missingEvidenceFields?.slice(0, 4).join(", ");
        throw new Error(
          `${data.error || "Record review failed"}${missing ? ` Missing evidence: ${missing}.` : ""}${
            data.requestId ? ` Request ${data.requestId}.` : ""
          }`,
        );
      }
      await load();
      setMessage(
        action === "approve"
          ? `${record.title} was human-reviewed with durable source evidence.`
          : `${record.title} was returned to draft.`,
      );
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Record review failed");
    } finally {
      setReviewingRecord(null);
    }
  }

  if (loading && !diagnostics) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        {/* Spinner + darker text for WCAG AA contrast (was text-slate-400 on
            white — too low contrast per live VLM audit). */}
        <svg className="h-8 w-8 animate-spin text-slate-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm font-medium text-slate-700">Loading Review Inbox…</p>
      </div>
    );
  }

  const totals = diagnostics?.totals;
  const sourceStatus = (totals?.expertSourceDocuments ?? 0) + (totals?.projectSourceDocuments ?? 0) > 0
    ? `${totals?.expertSourceDocuments ?? 0} expert source(s) · ${totals?.projectSourceDocuments ?? 0} project source(s)`
    : "No dedicated expert or project sources";

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Vault</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Review Inbox</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Uncertain evidence is preserved here. Source verification is automatic and machine-owned; REVIEWED is created only by a real authenticated reviewer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
          <button type="button" onClick={() => void reprocessSources()} disabled={repairing} className="rounded-lg border border-slate-900 px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 disabled:opacity-60">
            {repairing ? "Reprocessing…" : "Reprocess sources"}
          </button>
          <Link href="/dashboard/company" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">Back to Vault</Link>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold">Trust rule</p>
        <p className="mt-1">Exact claims in dedicated or mixed documents may become SOURCE_VERIFIED and support matching or draft generation. Final approval and final-package export still require genuine human REVIEWED evidence.</p>
      </div>

      {totals && totals.documents > 0 && totals.expertSourceDocuments === 0 && totals.projectSourceDocuments === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">No dedicated CV or project-reference sources are available</p>
          <p className="mt-1">Exact claims from mixed documents remain eligible for source verification. Dedicated CV, project-reference, contract, and portfolio files remain the strongest authority and should be uploaded when available.</p>
          <Link href="/dashboard/company" className="mt-3 inline-flex rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white no-underline hover:bg-slate-800">
            Upload stronger source files
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Documents</p><p className="mt-1 text-3xl font-bold text-blue-600">{totals?.documents ?? 0}</p><p className="mt-1 text-xs text-slate-400">{totals?.extractedDocuments ?? 0} extracted</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Experts</p><p className="mt-1 text-3xl font-bold text-purple-600">{totals?.currentExperts ?? 0}</p><p className="mt-1 text-xs text-slate-400">{totals?.reviewedExperts ?? 0} human reviewed</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Projects</p><p className="mt-1 text-3xl font-bold text-green-600">{totals?.currentProjects ?? 0}</p><p className="mt-1 text-xs text-slate-400">{totals?.reviewedProjects ?? 0} human reviewed</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Sources</p><p className="mt-2 text-sm text-slate-700">{sourceStatus}</p><p className="mt-1 text-xs text-slate-400">{totals?.aiEnabled ? "AI extraction enabled" : "Deterministic extraction active"}</p></div>
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Actionable evidence gaps</h2><p className="text-xs text-slate-400">Policy: {diagnostics?.importVersion ?? "unknown"}</p></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{diagnostics?.gaps.length ?? 0} gaps</span>
        </div>
        <div className="mt-4 space-y-3">
          {diagnostics?.gaps.length ? diagnostics.gaps.map((gap, index) => (
            <div key={`${gap.title}-${index}`} className={`rounded-xl border px-4 py-3 text-sm ${severityClass(gap.severity)}`}>
              <p className="font-semibold">{gap.severity}: {gap.title}</p>
              <p className="mt-1 text-xs opacity-90">{gap.detail}</p>
            </div>
          )) : <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">No provenance or privacy gaps detected.</div>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Source diagnostics</h2>
        <p className="mt-1 text-xs text-slate-500">Only bounded, privacy-safe source labels are displayed.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(diagnostics?.documents ?? []).map((doc) => (
            <article key={doc.id} className="rounded-xl border p-4">
              <p className="font-medium text-slate-900">{doc.fileName}</p>
              <p className="mt-1 text-xs text-slate-500">{doc.category} · {doc.status}{doc.aiExtractionStatus ? ` · AI: ${doc.aiExtractionStatus}` : ""}</p>
              <p className="mt-2 text-xs font-medium text-slate-700">{sourceRole(doc)}</p>
            </article>
          ))}
          {!diagnostics?.documents.length && <p className="text-sm text-slate-400">No documents found.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Experts</h2><p className="text-xs text-slate-500">Source-verified records may be selected for genuine human review.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {eligibleExperts.length === 0 && (
              <span className="text-[11px] font-medium text-amber-800">
                {expertItems.length === 0
                  ? "No expert records are available. Upload Company Vault sources; ingestion and source verification run automatically."
                  : "No experts on this page are eligible for human review. Open Evidence status for the exact source blocker."}
              </span>
            )}
            <button type="button" onClick={() => setSelectedExperts(new Set(eligibleExperts.map((item) => item.id)))} disabled={eligibleExperts.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50" title={eligibleExperts.length === 0 ? "No source-verified experts on this page are eligible for human review." : "Select every eligible expert on this page."}>Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("experts")} disabled={selectedExperts.size === 0 || batchingExperts} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50" title={selectedExperts.size === 0 ? "Select at least one source-verified expert." : "Human-review the selected experts against their durable source evidence."}>
              {batchingExperts ? "Reviewing…" : `Human-review selected (${selectedExperts.size})`}
            </button>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {expertItems.map((expert) => {
            const badge = trustBadge(expert.trustLevel);
            const selectable = expert.canReview && expert.trustLevel !== "REVIEWED";
            return (
              <article key={expert.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-slate-900">{expert.fullName}</p><p className="text-sm text-slate-500">{expert.secondary}</p></div>
                  <div className="flex items-center gap-2">
                    {selectable && <input aria-label={`Select ${expert.fullName} for review`} type="checkbox" checked={selectedExperts.has(expert.id)} onChange={(event) => {
                      const next = new Set(selectedExperts);
                      event.target.checked ? next.add(expert.id) : next.delete(expert.id);
                      setSelectedExperts(next);
                    }} />}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">{expert.tags.map((tag, index) => <span key={`${tag}-${index}`} className="rounded-full bg-slate-100 px-2 py-1">{tag}</span>)}</div>
                <details className="mt-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium">Evidence status</summary>
                  <p className="mt-2">{evidenceStatus(expert)}</p>
                </details>
              </article>
            );
          })}
          {!expertItems.length && <p className="text-sm text-slate-400">No expert records found.</p>}
        </div>
        {diagnostics && <div className="mt-4"><PaginationControls {...diagnostics.records.experts} onPage={(page) => { setSelectedExperts(new Set()); setExpertPage(page); }} /></div>}
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Projects</h2><p className="text-xs text-slate-500">Source-verified records may be selected for genuine human review.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {eligibleProjects.length === 0 && (
              <span className="text-[11px] font-medium text-amber-800">
                {projectItems.length === 0
                  ? "No project records are available. Upload Company Vault sources; ingestion and source verification run automatically."
                  : "No projects on this page are eligible for human review. Open Evidence status for the exact source blocker."}
              </span>
            )}
            <button type="button" onClick={() => setSelectedProjects(new Set(eligibleProjects.map((item) => item.id)))} disabled={eligibleProjects.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50" title={eligibleProjects.length === 0 ? "No source-verified projects on this page are eligible for human review." : "Select every eligible project on this page."}>Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("projects")} disabled={selectedProjects.size === 0 || batchingProjects} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50" title={selectedProjects.size === 0 ? "Select at least one source-verified project." : "Human-review the selected projects against their durable source evidence."}>
              {batchingProjects ? "Reviewing…" : `Human-review selected (${selectedProjects.size})`}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {projectItems.map((project) => {
            const badge = trustBadge(project.trustLevel);
            const selectable = project.canReview && project.trustLevel !== "REVIEWED";
            return (
              <article key={project.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-slate-900">{project.name}</p><p className="text-sm text-slate-500">{project.secondary}</p></div>
                  <div className="flex items-center gap-2">
                    {selectable && <input aria-label={`Select ${project.name} for review`} type="checkbox" checked={selectedProjects.has(project.id)} onChange={(event) => {
                      const next = new Set(selectedProjects);
                      event.target.checked ? next.add(project.id) : next.delete(project.id);
                      setSelectedProjects(next);
                    }} />}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">{project.tags.map((tag, index) => <span key={`${tag}-${index}`} className="rounded-full bg-slate-100 px-2 py-1">{tag}</span>)}</div>
                <details className="mt-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium">Evidence status</summary>
                  <p className="mt-2">{evidenceStatus(project)}</p>
                </details>
              </article>
            );
          })}
          {!projectItems.length && <p className="text-sm text-slate-400">No project records found.</p>}
        </div>
        {diagnostics && <div className="mt-4"><PaginationControls {...diagnostics.records.projects} onPage={(page) => { setSelectedProjects(new Set()); setProjectPage(page); }} /></div>}
      </section>

      {diagnostics && (
        <>
          <SupportReviewSection kind="LEGAL" heading="Legal records" description="Licenses and registrations require current, source-backed human review." page={diagnostics.records.legal} reviewingRecord={reviewingRecord} onPage={setLegalPage} onAction={(kind, record) => void submitSupportReview(kind, record)} />
          <SupportReviewSection kind="FINANCIAL" heading="Financial records" description="Financial claims require current, source-backed human review." page={diagnostics.records.financial} reviewingRecord={reviewingRecord} onPage={setFinancialPage} onAction={(kind, record) => void submitSupportReview(kind, record)} />
          <SupportReviewSection kind="COMPLIANCE" heading="Compliance records" description="Certificates and compliance claims require current, source-backed human review." page={diagnostics.records.compliance} reviewingRecord={reviewingRecord} onPage={setCompliancePage} onAction={(kind, record) => void submitSupportReview(kind, record)} />
        </>
      )}
    </div>
  );
}
