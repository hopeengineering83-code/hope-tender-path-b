"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompanyDoc = { id: string; originalFileName: string; category: string; extractedText?: string | null };
type Expert = { id: string; fullName: string; title?: string | null; yearsExperience?: number | null; disciplines?: string[]; sectors?: string[]; certifications?: string[]; profile?: string | null };
type Project = { id: string; name: string; clientName?: string | null; country?: string | null; sector?: string | null; serviceAreas?: string[]; contractValue?: number | null; currency?: string | null; summary?: string | null };
type Company = { experts?: Expert[]; projects?: Project[]; expertCount?: number; projectCount?: number };
type Gap = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string };
type Diagnostics = {
  importVersion: string;
  fingerprint: string;
  documents: Array<{ id: string; fileName: string; category: string; extractedChars: number; status: string; isExpertSource: boolean; isProjectSource: boolean }>;
  totals: {
    documents: number; extractedDocuments: number; expertSourceDocuments: number; projectSourceDocuments: number;
    currentExperts: number; currentProjects: number; autoImportedExperts: number; autoImportedProjects: number;
    parsedExpertDrafts: number; parsedProjectDrafts: number; expectedExperts: number | null; expectedProjects: number | null;
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

function isAutoImported(value: string | null | undefined): boolean { return Boolean(value?.includes("AUTO-IMPORTED")); }
function arr(values: string[] | undefined): string[] { return Array.isArray(values) ? values : []; }
function severityClass(severity: Gap["severity"]) {
  if (severity === "CRITICAL") return "border-red-300 bg-red-50 text-red-800";
  if (severity === "HIGH") return "border-orange-300 bg-orange-50 text-orange-800";
  if (severity === "MEDIUM") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-blue-300 bg-blue-50 text-blue-800";
}

export default function KnowledgeReviewPage() {
  const [company, setCompany] = useState<Company>({ experts: [], projects: [] });
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [companyRes, docsRes, diagRes] = await Promise.all([
        fetch("/api/company", { cache: "no-store" }),
        fetch("/api/company/documents", { cache: "no-store" }),
        fetch("/api/company/knowledge/repair", { cache: "no-store" }),
      ]);
      if (!companyRes.ok) throw new Error("Failed to load company knowledge");
      if (!docsRes.ok) throw new Error("Failed to load documents");
      if (!diagRes.ok) throw new Error("Failed to load diagnostics");
      const companyJson = await companyRes.json() as Company;
      const docsJson = await docsRes.json() as { documents?: CompanyDoc[] };
      const diagJson = await diagRes.json() as { diagnostics: Diagnostics };
      setCompany(companyJson);
      setDocs(docsJson.documents ?? []);
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

  useEffect(() => { void load(); }, []);

  const experts = company.experts ?? [];
  const projects = company.projects ?? [];
  const autoExperts = experts.filter((expert) => isAutoImported(expert.profile));
  const autoProjects = projects.filter((project) => isAutoImported(project.summary));
  const reviewedExperts = experts.length - autoExperts.length;
  const reviewedProjects = projects.length - autoProjects.length;

  if (loading) return <div className="py-16 text-center text-sm text-slate-400">Loading review data and diagnostics…</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Knowledge Review</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Hard gap analysis and repair</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            This page separates raw extraction, parsed draft records, and reviewed knowledge. Use diagnostics before trusting matching results.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
          <button onClick={() => void runRepair()} disabled={repairing} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {repairing ? "Repairing…" : "Run Knowledge Repair"}
          </button>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Back to Vault</Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Documents</p><p className="mt-1 text-3xl font-bold text-blue-600">{docs.length}</p><p className="mt-1 text-xs text-slate-400">{diagnostics?.totals.extractedDocuments ?? 0} usable extracted</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Experts</p><p className="mt-1 text-3xl font-bold text-purple-600">{company.expertCount ?? experts.length}</p><p className="mt-1 text-xs text-slate-400">{reviewedExperts} reviewed · {autoExperts.length} draft · {diagnostics?.totals.parsedExpertDrafts ?? 0} parsed</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Projects</p><p className="mt-1 text-3xl font-bold text-green-600">{company.projectCount ?? projects.length}</p><p className="mt-1 text-xs text-slate-400">{reviewedProjects} reviewed · {autoProjects.length} draft · {diagnostics?.totals.parsedProjectDrafts ?? 0} parsed</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Source split</p><p className="mt-2 text-sm text-slate-700">{diagnostics?.totals.expertSourceDocuments ?? 0} expert docs</p><p className="text-sm text-slate-700">{diagnostics?.totals.projectSourceDocuments ?? 0} project docs</p></div>
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
              <p className="mt-1 text-xs text-slate-500">{doc.category} · {doc.extractedChars.toLocaleString()} chars · {doc.status}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 ${doc.isExpertSource ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{doc.isExpertSource ? "Expert source" : "Not expert source"}</span>
                <span className={`rounded-full px-2 py-1 ${doc.isProjectSource ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{doc.isProjectSource ? "Project source" : "Not project source"}</span>
              </div>
            </div>
          ))}
          {!diagnostics?.documents.length && <p className="text-sm text-slate-400">No documents found.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-900">Experts</h2><span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">{experts.length} records</span></div>
        <div className="mt-4 space-y-3">
          {experts.map((expert) => {
            const draft = isAutoImported(expert.profile);
            return (
              <details key={expert.id} className="rounded-xl border p-4 open:bg-slate-50">
                <summary className="cursor-pointer list-none"><div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><p className="font-semibold text-slate-900">{expert.fullName}</p><p className="text-xs text-slate-500">{expert.title || "No reviewed title yet"}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${draft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>{draft ? "Review required" : "Reviewed / manual"}</span></div></summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structured fields</p><dl className="mt-2 space-y-1 text-xs text-slate-600"><div><dt className="inline font-medium">Years:</dt> <dd className="inline">{expert.yearsExperience ?? "Not reviewed"}</dd></div><div><dt className="inline font-medium">Disciplines:</dt> <dd className="inline">{arr(expert.disciplines).join(", ") || "Not reviewed"}</dd></div><div><dt className="inline font-medium">Sectors:</dt> <dd className="inline">{arr(expert.sectors).join(", ") || "Not reviewed"}</dd></div><div><dt className="inline font-medium">Certifications:</dt> <dd className="inline">{arr(expert.certifications).join(", ") || "Not reviewed"}</dd></div></dl></div><div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source evidence</p><p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{sourceSnippet(expert.profile)}</p></div></div>
              </details>
            );
          })}
          {experts.length === 0 && <p className="text-sm text-slate-400">No experts returned by `/api/company`.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-900">Projects</h2><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">{projects.length} records</span></div>
        <div className="mt-4 space-y-3">
          {projects.map((project) => {
            const draft = isAutoImported(project.summary);
            return (
              <details key={project.id} className="rounded-xl border p-4 open:bg-slate-50">
                <summary className="cursor-pointer list-none"><div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><p className="font-semibold text-slate-900">{project.name}</p><p className="text-xs text-slate-500">{project.clientName || "No reviewed client yet"}{project.sector ? ` · ${project.sector}` : ""}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${draft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>{draft ? "Review required" : "Reviewed / manual"}</span></div></summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structured fields</p><dl className="mt-2 space-y-1 text-xs text-slate-600"><div><dt className="inline font-medium">Country:</dt> <dd className="inline">{project.country || "Not reviewed"}</dd></div><div><dt className="inline font-medium">Sector:</dt> <dd className="inline">{project.sector || "Not reviewed"}</dd></div><div><dt className="inline font-medium">Services:</dt> <dd className="inline">{arr(project.serviceAreas).join(", ") || "Not reviewed"}</dd></div><div><dt className="inline font-medium">Value:</dt> <dd className="inline">{project.contractValue ? `${project.currency ?? ""} ${project.contractValue.toLocaleString()}` : "Not reviewed"}</dd></div></dl></div><div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source evidence</p><p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{sourceSnippet(project.summary)}</p></div></div>
              </details>
            );
          })}
          {projects.length === 0 && <p className="text-sm text-slate-400">No projects returned by `/api/company`.</p>}
        </div>
      </section>
    </div>
  );
}
