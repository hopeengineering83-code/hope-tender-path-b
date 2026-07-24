"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ReviewTrust =
  | "REVIEWED"
  | "SOURCE_VERIFIED"
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
    reviewedExperts: number;
    reviewedProjects: number;
    unsupportedReviewedExperts: number;
    unsupportedReviewedProjects: number;
    aiEnabled?: boolean;
  };
  gaps: Gap[];
  records: {
    experts: RecordPage<ExpertRecord>;
    projects: RecordPage<ProjectRecord>;
  };
};
type ReimportResult = {
  docsReextracted?: number;
  docsFailed?: number;
  expertsCreated?: number;
  projectsCreated?: number;
  expertsUpdated?: number;
  projectsUpdated?: number;
  expertsSourceVerified?: number;
  projectsSourceVerified?: number;
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
          className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => props.onPage(props.page + 1)}
          disabled={props.page >= props.totalPages}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function ReviewInboxPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [expertPage, setExpertPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedExperts, setSelectedExperts] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [batchingExperts, setBatchingExperts] = useState(false);
  const [batchingProjects, setBatchingProjects] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        expertPage: String(expertPage),
        projectPage: String(projectPage),
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
  }, [expertPage, projectPage]);

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
      await load();
      setMessage(
        `Sources reprocessed. ${data.docsReextracted ?? 0} document(s) re-extracted; ` +
        `${data.expertsCreated ?? 0} expert and ${data.projectsCreated ?? 0} project record(s) created; ` +
        `${data.expertsUpdated ?? 0} expert and ${data.projectsUpdated ?? 0} project record(s) updated; ` +
        `${data.expertsSourceVerified ?? 0} expert and ${data.projectsSourceVerified ?? 0} project record(s) source-verified.` +
        ((data.docsFailed ?? 0) > 0 ? ` ${data.docsFailed} document(s) still need attention.` : ""),
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

  if (loading && !diagnostics) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading Review Inbox…</div>;
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
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedExperts(new Set(eligibleExperts.map((item) => item.id)))} disabled={eligibleExperts.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("experts")} disabled={selectedExperts.size === 0 || batchingExperts} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">
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
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedProjects(new Set(eligibleProjects.map((item) => item.id)))} disabled={eligibleProjects.length === 0} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Select eligible on page</button>
            <button type="button" onClick={() => void submitBatch("projects")} disabled={selectedProjects.size === 0 || batchingProjects} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">
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
    </div>
  );
}
