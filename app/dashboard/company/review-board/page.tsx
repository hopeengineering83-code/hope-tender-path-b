"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReviewBoardReadinessPresentation, type ReviewSummary } from "./readiness-presentation";

type Expert = {
  id: string;
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[];
  sectors?: string[];
  certifications?: string[];
  profile?: string | null;
  trustLevel?: string | null;
  reviewedAt?: string | null;
};

type Project = {
  id: string;
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: string[];
  summary?: string | null;
  trustLevel?: string | null;
  reviewedAt?: string | null;
};

type Company = {
  experts?: Expert[];
  projects?: Project[];
};

function level(value?: string | null) {
  if (value === "REVIEWED") return "REVIEWED";
  if (value === "AI_DRAFT") return "AI_DRAFT";
  return "REGEX_DRAFT";
}

function isDraft(value?: string | null) {
  return level(value) !== "REVIEWED";
}

function badge(value?: string | null) {
  const trust = level(value);
  if (trust === "REVIEWED") return "border-green-200 bg-green-100 text-green-700";
  if (trust === "AI_DRAFT") return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-red-200 bg-red-100 text-red-700";
}

function snippet(value?: string | null) {
  if (!value) return "No source snippet saved.";
  return value
    .replace(/^\[(AI_DRAFT|REGEX_DRAFT).*?\]\s*/i, "")
    .replace(/Source snippet:/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function list(values?: string[]) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "Not set";
}

export default function KnowledgeReviewBoardPage() {
  const [company, setCompany] = useState<Company>({ experts: [], projects: [] });
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const experts = useMemo(() => company.experts ?? [], [company.experts]);
  const projects = useMemo(() => company.projects ?? [], [company.projects]);
  const draftExperts = useMemo(() => experts.filter((record) => isDraft(record.trustLevel)), [experts]);
  const draftProjects = useMemo(() => projects.filter((record) => isDraft(record.trustLevel)), [projects]);
  const reviewedExperts = useMemo(() => experts.filter((record) => !isDraft(record.trustLevel)), [experts]);
  const reviewedProjects = useMemo(() => projects.filter((record) => !isDraft(record.trustLevel)), [projects]);
  const readinessPresentation = getReviewBoardReadinessPresentation(summary);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [companyRes, summaryRes] = await Promise.all([
        fetch("/api/company", { cache: "no-store" }),
        fetch("/api/company/review-summary", { cache: "no-store" }),
      ]);
      if (!companyRes.ok) throw new Error("Failed to load company records");
      if (!summaryRes.ok) throw new Error("Failed to load review summary");
      setCompany(await companyRes.json());
      setSummary(await summaryRes.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review board");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchRecord(kind: "expert" | "project", id: string, action: "approve" | "reject") {
    setWorkingId(id);
    setError("");
    setMessage("");
    try {
      const endpoint = kind === "expert" ? `/api/company/experts/${id}` : `/api/company/projects/${id}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notes: action === "approve"
            ? "Approved from Knowledge Review Board after checking source evidence."
            : "Rejected from Knowledge Review Board.",
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `${action} failed`);
      }
      setMessage(action === "approve" ? "Record marked REVIEWED." : "Record kept as draft for correction.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Review action failed");
    } finally {
      setWorkingId(null);
    }
  }

  async function approveVisibleDrafts() {
    const total = draftExperts.length + draftProjects.length;
    if (total === 0) return;
    if (!confirm(`Approve ${total} draft record(s) as REVIEWED? Only do this after checking the source evidence.`)) return;
    setError("");
    setMessage("");
    try {
      for (const expert of draftExperts) await patchRecord("expert", expert.id, "approve");
      for (const project of draftProjects) await patchRecord("project", project.id, "approve");
      setMessage(`Approved ${total} draft record(s).`);
      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Bulk approval failed");
    } finally {
      setWorkingId(null);
    }
  }

  if (loading) return <div role="status" className="py-16 text-center text-sm text-slate-400">Loading knowledge review board…</div>;

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next-level knowledge control</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Knowledge Review Board</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Approve only records whose source evidence you have checked. Final tender generation uses REVIEWED records only.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Refresh</button>
          <button type="button" onClick={() => void approveVisibleDrafts()} disabled={draftExperts.length + draftProjects.length === 0 || Boolean(workingId)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-60">Approve all visible drafts</button>
          <Link href="/dashboard/company/review" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Diagnostics</Link>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Vault</Link>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      {summary?.warnings?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Readiness warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs uppercase tracking-wide text-slate-400">Documents</p><p className="mt-1 text-3xl font-bold text-blue-600">{summary?.documents.total ?? 0}</p><p className="text-xs text-slate-400">{summary?.documents.extracted ?? 0} extracted</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs uppercase tracking-wide text-slate-400">Experts</p><p className="mt-1 text-3xl font-bold text-purple-600">{experts.length}</p><p className="text-xs text-slate-400">{reviewedExperts.length} reviewed · {draftExperts.length} draft</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs uppercase tracking-wide text-slate-400">Projects</p><p className="mt-1 text-3xl font-bold text-green-600">{projects.length}</p><p className="text-xs text-slate-400">{reviewedProjects.length} reviewed · {draftProjects.length} draft</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm" aria-label={`Final generation readiness: ${readinessPresentation.label}`}>
          <p className="text-xs uppercase tracking-wide text-slate-400">Final generation</p>
          <p className={`mt-2 text-sm font-semibold ${readinessPresentation.textClass}`}>{readinessPresentation.label}</p>
          <p className="mt-1 text-xs text-slate-500">{readinessPresentation.detail}</p>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">Draft experts requiring review</h2><span className="rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-700">{draftExperts.length}</span></div>
        <div className="mt-4 space-y-3">
          {draftExperts.map((expert) => (
            <div key={expert.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold text-slate-900">{expert.fullName}</p><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge(expert.trustLevel)}`}>{level(expert.trustLevel)}</span></div>
                  <p className="mt-1 text-xs text-slate-500">{expert.title || "No title"} · {expert.yearsExperience ? `${expert.yearsExperience} years` : "years not set"}</p>
                  <p className="mt-2 break-words text-xs text-slate-500">Disciplines: {list(expert.disciplines)}</p>
                  <p className="mt-3 max-h-28 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{snippet(expert.profile)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void patchRecord("expert", expert.id, "approve")} disabled={workingId === expert.id} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60">Approve</button>
                  <button type="button" onClick={() => void patchRecord("expert", expert.id, "reject")} disabled={workingId === expert.id} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">Keep draft</button>
                </div>
              </div>
            </div>
          ))}
          {draftExperts.length === 0 && <p className="py-5 text-center text-sm text-slate-400">No draft experts pending review.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">Draft projects requiring review</h2><span className="rounded-full bg-green-50 px-3 py-1 text-xs text-green-700">{draftProjects.length}</span></div>
        <div className="mt-4 space-y-3">
          {draftProjects.map((project) => (
            <div key={project.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold text-slate-900">{project.name}</p><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge(project.trustLevel)}`}>{level(project.trustLevel)}</span></div>
                  <p className="mt-1 break-words text-xs text-slate-500">{project.clientName || "No client"} · {project.country || "country not set"} · {project.sector || "sector not set"}</p>
                  <p className="mt-2 break-words text-xs text-slate-500">Services: {list(project.serviceAreas)}</p>
                  <p className="mt-3 max-h-28 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{snippet(project.summary)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void patchRecord("project", project.id, "approve")} disabled={workingId === project.id} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60">Approve</button>
                  <button type="button" onClick={() => void patchRecord("project", project.id, "reject")} disabled={workingId === project.id} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">Keep draft</button>
                </div>
              </div>
            </div>
          ))}
          {draftProjects.length === 0 && <p className="py-5 text-center text-sm text-slate-400">No draft projects pending review.</p>}
        </div>
      </section>

      {summary?.documents.extractedWithoutDraftRecordsList?.length ? (
        <section className="rounded-2xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-orange-900">Extracted documents without parsed records</h2>
          <p className="mt-1 text-sm text-orange-800">Run Knowledge Repair from Diagnostics or re-upload these files with the correct category if needed.</p>
          <div className="mt-4 space-y-2">
            {summary.documents.extractedWithoutDraftRecordsList.map((document) => (
              <div key={document.id} className="break-words rounded-lg bg-white px-3 py-2 text-xs text-orange-900">
                {document.fileName} · {document.category} · {document.extractedChars.toLocaleString()} chars
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
