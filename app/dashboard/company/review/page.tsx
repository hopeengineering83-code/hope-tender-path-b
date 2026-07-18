"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompanyDoc = { id: string; originalFileName: string; category: string; aiExtractionStatus?: string | null };
type Expert = { id: string; fullName: string; title?: string | null; yearsExperience?: number | null; disciplines?: string[]; sectors?: string[]; certifications?: string[]; profile?: string | null; trustLevel?: string | null };
type Project = { id: string; name: string; clientName?: string | null; country?: string | null; sector?: string | null; serviceAreas?: string[]; contractValue?: number | null; currency?: string | null; summary?: string | null; trustLevel?: string | null };
type Company = { experts?: Expert[]; projects?: Project[]; expertCount?: number; projectCount?: number };
type Paginated<T> = { items?: T[]; total?: number; nextCursor?: string | null; hasMore?: boolean };
type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };
type Diagnostics = {
  importVersion: string;
  fingerprint: string;
  documents: Array<{ id: string; fileName: string; category: string; extractedChars: number; status: string; isExpertSource: boolean; isProjectSource: boolean; aiExtractionStatus?: string }>;
  totals: {
    documents: number; extractedDocuments: number; expertSourceDocuments: number; projectSourceDocuments: number;
    currentExperts: number; currentProjects: number; autoImportedExperts: number; autoImportedProjects: number;
    parsedExpertDrafts: number; parsedProjectDrafts: number; expectedExperts: number | null; expectedProjects: number | null;
    reviewedExperts?: number; reviewedProjects?: number; aiDraftExperts?: number; aiDraftProjects?: number; regexDraftExperts?: number; regexDraftProjects?: number; aiEnabled?: boolean;
  };
  gaps: Gap[];
};

type RepairResult = { expertsCreated: number; projectsCreated: number; expertsRebuilt?: boolean; projectsRebuilt?: boolean; diagnostics: Diagnostics };

function sourceSnippet(value: string | null | undefined): string {
  if (!value) return "No source snippet saved yet.";
  const marker = "Source snippet:";
  const idx = value.indexOf(marker);
  const snippet = idx >= 0 ? value.slice(idx + marker.length) : value;
  return snippet.replace(/\s+/g, " ").trim().slice(0, 1600);
}

function trustLevel(value: string | null | undefined): "REVIEWED" | "AI_DRAFT" | "REGEX_DRAFT" {
  if (value === "REVIEWED") return "REVIEWED";
  if (value === "AI_DRAFT") return "AI_DRAFT";
  return "REGEX_DRAFT";
}
function isDraftTrust(value: string | null | undefined): boolean { return trustLevel(value) !== "REVIEWED"; }
function trustBadge(value: string | null | undefined) {
  const level = trustLevel(value);
  if (level === "REVIEWED") return { label: "Reviewed", cls: "bg-green-100 text-green-700" };
  if (level === "AI_DRAFT") return { label: "AI draft — review required", cls: "bg-amber-100 text-amber-800" };
  return { label: "Regex draft — review required", cls: "bg-red-100 text-red-700" };
}
function arr(values: string[] | undefined): string[] { return Array.isArray(values) ? values : []; }
function severityClass(severity: Gap["severity"]) {
  if (severity === "CRITICAL") return "border-red-300 bg-red-50 text-red-800";
  if (severity === "HIGH") return "border-orange-300 bg-orange-50 text-orange-800";
  if (severity === "MEDIUM") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-blue-300 bg-blue-50 text-blue-800";
}

function sourceRole(doc: Diagnostics["documents"][number]): string {
  if (doc.isExpertSource && doc.isProjectSource) return "CV + project source";
  if (doc.isExpertSource) return "CV/expert source";
  if (doc.isProjectSource) return "Project reference source";
  return "Support document for tender evidence";
}

export default function KnowledgeReviewPage() {
  const [company, setCompany] = useState<Company>({ experts: [], projects: [] });
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedExperts, setSelectedExperts] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [batchingExperts, setBatchingExperts] = useState(false);
  const [batchingProjects, setBatchingProjects] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [summaryRes, docsRes, expertsRes, projectsRes, diagRes] = await Promise.all([
        fetch("/api/company/review-summary", { cache: "no-store" }),
        fetch("/api/company/documents?limit=50", { cache: "no-store" }),
        fetch("/api/company/experts?limit=50", { cache: "no-store" }),
        fetch("/api/company/projects?limit=50", { cache: "no-store" }),
        fetch("/api/company/knowledge/repair", { cache: "no-store" }),
      ]);
      if (!summaryRes.ok) throw new Error("Failed to load company knowledge summary");
      if (!docsRes.ok) throw new Error("Failed to load documents");
      if (!expertsRes.ok) throw new Error("Failed to load experts");
      if (!projectsRes.ok) throw new Error("Failed to load projects");
      if (!diagRes.ok) throw new Error("Failed to load diagnostics");
      const summaryJson = await summaryRes.json() as { experts?: { total?: number }; projects?: { total?: number } };
      const docsJson = await docsRes.json() as Paginated<CompanyDoc>;
      const expertsJson = await expertsRes.json() as Paginated<Expert>;
      const projectsJson = await projectsRes.json() as Paginated<Project>;
      const diagJson = await diagRes.json() as { diagnostics: Diagnostics };
      setCompany({
        experts: expertsJson.items ?? [],
        projects: projectsJson.items ?? [],
        expertCount: summaryJson.experts?.total ?? expertsJson.items?.length ?? 0,
        projectCount: summaryJson.projects?.total ?? projectsJson.items?.length ?? 0,
      });
      setDocs(docsJson.items ?? []);
      setDiagnostics(diagJson.diagnostics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review data");
    } finally {
      setLoading(false);
    }
  }

  async function runRepair() {
    setRepairing(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/company/knowledge/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error("Knowledge repair failed");
      const json = await res.json() as { result: RepairResult };
      setDiagnostics(json.result.diagnostics);
      setMessage(`Repair completed. Experts created: ${json.result.expertsCreated}. Projects created: ${json.result.projectsCreated}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Knowledge repair failed");
    } finally {
      setRepairing(false);
    }
  }

  async function batchReviewExperts() {
    if (selectedExperts.size === 0) return;
    setBatchingExperts(true);
    setError("");
    try {
      const res = await fetch("/api/company/experts/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedExperts], trustLevel: "REVIEWED" }),
      });
      if (!res.ok) throw new Error("Batch review failed");
      const json = await res.json() as { updated: number };
      setMessage(`Marked ${json.updated} expert(s) as Reviewed.`);
      setSelectedExperts(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch review failed");
    } finally {
      setBatchingExperts(false);
    }
  }

  async function batchReviewProjects() {
    if (selectedProjects.size === 0) return;
    setBatchingProjects(true);
    setError("");
    try {
      const res = await fetch("/api/company/projects/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedProjects], trustLevel: "REVIEWED" }),
      });
      if (!res.ok) throw new Error("Batch review failed");
      const json = await res.json() as { updated: number };
      setMessage(`Marked ${json.updated} project(s) as Reviewed.`);
      setSelectedProjects(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch review failed");
    } finally {
      setBatchingProjects(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const experts = company.experts ?? [];
  const projects = company.projects ?? [];
  const draftExperts = experts.filter((expert) => isDraftTrust(expert.trustLevel));
  const draftProjects = projects.filter((project) => isDraftTrust(project.trustLevel));
  const reviewedExperts = experts.length - draftExperts.length;
  const reviewedProjects = projects.length - draftProjects.length;
  const expertSourceDocs = diagnostics?.totals.expertSourceDocuments ?? 0;
  const projectSourceDocs = diagnostics?.totals.projectSourceDocuments ?? 0;
  const sourceStatus = expertSourceDocs + projectSourceDocs > 0
    ? `${expertSourceDocs} CV docs · ${projectSourceDocs} project docs`
    : reviewedExperts + reviewedProjects > 0
      ? "Reviewed records available; dedicated source docs optional"
      : "0 CV docs · 0 project docs";

  if (loading) return <div className="py-16 text-center text-sm text-slate-400">Loading review data and diagnostics…</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Knowledge Review</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Hard gap analysis and repair</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            This page separates support documents, CV/project source documents, parsed draft records, and reviewed knowledge. Support documents are still usable for tenders; they just do not create expert or project records.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
          <button onClick={() => void runRepair()} disabled={repairing} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {repairing ? "Repairing…" : "Run Knowledge Repair"}
          </button>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Back to Vault</Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold">Document meaning</p>
        <p className="mt-1">Your company profile, legal registration, financial statement, and manuals are usable tender support evidence. The source-document warnings only affect rebuilding expert/project records from uploaded CV or project-reference files; already reviewed expert/project records remain usable for matching and proposal generation.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Documents</p><p className="mt-1 text-3xl font-bold text-blue-600">{docs.length}</p><p className="mt-1 text-xs text-slate-400">{diagnostics?.totals.extractedDocuments ?? 0} extracted support/source docs</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Experts</p><p className="mt-1 text-3xl font-bold text-purple-600">{company.expertCount ?? experts.length}</p><p className="mt-1 text-xs text-slate-400">{reviewedExperts} reviewed · {draftExperts.length} draft</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Projects</p><p className="mt-1 text-3xl font-bold text-green-600">{company.projectCount ?? projects.length}</p><p className="mt-1 text-xs text-slate-400">{reviewedProjects} reviewed · {draftProjects.length} draft</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">CV/Project sources</p><p className="mt-2 text-sm text-slate-700">{diagnostics?.totals.aiEnabled ? "AI extraction enabled" : "AI extraction not enabled"}</p><p className="text-sm text-slate-700">{sourceStatus}</p></div>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Gap analysis</h2><p className="text-xs text-slate-400">Import version: {diagnostics?.importVersion ?? "unknown"}</p></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{diagnostics?.gaps.length ?? 0} gaps</span>
        </div>
        <div className="mt-4 space-y-3">
          {diagnostics?.gaps.length ? diagnostics.gaps.map((gap, index) => (
            <div key={`${gap.title}-${index}`} className={`rounded-xl border px-4 py-3 text-sm ${severityClass(gap.severity)}`}>
              <p className="font-semibold">{gap.severity}: {gap.title}</p>
              <p className="mt-1 text-xs opacity-90">{gap.detail}</p>
            </div>
          )) : <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">No critical knowledge ingestion gaps detected. Review draft records before using them in final submissions.</div>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Source document diagnostics</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(diagnostics?.documents ?? []).map((doc) => (
            <div key={doc.id} className="rounded-xl border p-4">
              <p className="font-medium text-slate-900">{doc.fileName}</p>
              <p className="mt-1 text-xs text-slate-500">{doc.category} · {doc.extractedChars.toLocaleString()} chars · {doc.status}{doc.aiExtractionStatus ? ` · AI: ${doc.aiExtractionStatus}` : ""}</p>
              <p className="mt-2 text-xs font-medium text-slate-700">{sourceRole(doc)}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 ${doc.isExpertSource ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{doc.isExpertSource ? "CV/expert source" : "Tender support doc"}</span>
                <span className={`rounded-full px-2 py-1 ${doc.isProjectSource ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{doc.isProjectSource ? "Project reference source" : "Not used to create project records"}</span>
              </div>
            </div>
          ))}
          {!diagnostics?.documents.length && <p className="text-sm text-slate-400">No documents found.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Experts</h2>
            <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">{experts.length} records</span>
          </div>
          {draftExperts.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedExperts(new Set(draftExperts.map((e) => e.id)))}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Select all drafts ({draftExperts.length})
              </button>
              <button
                onClick={() => void batchReviewExperts()}
                disabled={selectedExperts.size === 0 || batchingExperts}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-60"
              >
                {batchingExperts ? "Marking..." : `Mark ${selectedExperts.size} as Reviewed`}
              </button>
            </div>
          )}
        </div>
        <div className="mt-4 space-y-3">
          {experts.map((expert) => {
            const badge = trustBadge(expert.trustLevel);
            const isDraft = isDraftTrust(expert.trustLevel);
            return (
              <article key={expert.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{expert.fullName}</p>
                    <p className="text-sm text-slate-500">{expert.title ?? "No title"} · {expert.yearsExperience ?? "—"} yrs</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDraft && <input type="checkbox" checked={selectedExperts.has(expert.id)} onChange={(e) => {
                      const next = new Set(selectedExperts); if (e.target.checked) next.add(expert.id); else next.delete(expert.id); setSelectedExperts(next);
                    }} />}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {arr(expert.disciplines).slice(0, 6).map((value) => <span key={value} className="rounded-full bg-slate-100 px-2 py-1">{value}</span>)}
                </div>
                <p className="mt-2 text-xs text-slate-500">{sourceSnippet(expert.profile)}</p>
              </article>
            );
          })}
          {!experts.length && <p className="text-sm text-slate-400">No expert records found.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">{projects.length} records</span>
          </div>
          {draftProjects.length > 0 && (
            <div className="flex gap-2">
              <button onClick={() => setSelectedProjects(new Set(draftProjects.map((p) => p.id)))} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50">Select all drafts ({draftProjects.length})</button>
              <button onClick={() => void batchReviewProjects()} disabled={selectedProjects.size === 0 || batchingProjects} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-60">{batchingProjects ? "Marking..." : `Mark ${selectedProjects.size} as Reviewed`}</button>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {projects.map((project) => {
            const badge = trustBadge(project.trustLevel);
            const isDraft = isDraftTrust(project.trustLevel);
            return (
              <article key={project.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{project.name}</p>
                    <p className="text-sm text-slate-500">{project.clientName ?? "No client"} · {project.country ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDraft && <input type="checkbox" checked={selectedProjects.has(project.id)} onChange={(e) => {
                      const next = new Set(selectedProjects); if (e.target.checked) next.add(project.id); else next.delete(project.id); setSelectedProjects(next);
                    }} />}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {arr(project.serviceAreas).slice(0, 6).map((value) => <span key={value} className="rounded-full bg-slate-100 px-2 py-1">{value}</span>)}
                </div>
                <p className="mt-2 text-xs text-slate-500">{sourceSnippet(project.summary)}</p>
              </article>
            );
          })}
          {!projects.length && <p className="text-sm text-slate-400">No project records found.</p>}
        </div>
      </section>
    </div>
  );
}
