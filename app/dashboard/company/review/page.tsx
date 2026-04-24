"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompanyDoc = {
  id: string;
  originalFileName: string;
  category: string;
  extractedText?: string | null;
};

type Expert = {
  id: string;
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[];
  sectors?: string[];
  certifications?: string[];
  profile?: string | null;
};

type Project = {
  id: string;
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: string[];
  contractValue?: number | null;
  currency?: string | null;
  summary?: string | null;
};

type Company = {
  experts?: Expert[];
  projects?: Project[];
  expertCount?: number;
  projectCount?: number;
};

function sourceSnippet(value: string | null | undefined): string {
  if (!value) return "No source snippet saved yet.";
  const marker = "Source snippet:";
  const idx = value.indexOf(marker);
  const snippet = idx >= 0 ? value.slice(idx + marker.length) : value;
  return snippet.replace(/\s+/g, " ").trim().slice(0, 1600);
}

function isAutoImported(value: string | null | undefined): boolean {
  return Boolean(value?.includes("AUTO-IMPORTED"));
}

function arr(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values : [];
}

export default function KnowledgeReviewPage() {
  const [company, setCompany] = useState<Company>({ experts: [], projects: [] });
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [companyRes, docsRes] = await Promise.all([
        fetch("/api/company", { cache: "no-store" }),
        fetch("/api/company/documents", { cache: "no-store" }),
      ]);
      if (!companyRes.ok) throw new Error("Failed to load company knowledge");
      if (!docsRes.ok) throw new Error("Failed to load documents");
      const companyJson = await companyRes.json() as Company;
      const docsJson = await docsRes.json() as { documents?: CompanyDoc[] };
      setCompany(companyJson);
      setDocs(docsJson.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const experts = company.experts ?? [];
  const projects = company.projects ?? [];
  const autoExperts = experts.filter((expert) => isAutoImported(expert.profile));
  const autoProjects = projects.filter((project) => isAutoImported(project.summary));
  const reviewedExperts = experts.length - autoExperts.length;
  const reviewedProjects = projects.length - autoProjects.length;

  if (loading) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading review data from the company knowledge API…</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Knowledge Review</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Check extracted expert and project details</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            This page now uses the same company API as the Knowledge Vault, so the counts and records should match the main app.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Refresh review data
          </button>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Back to Knowledge Vault
          </Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Documents</p>
          <p className="mt-1 text-3xl font-bold text-blue-600">{docs.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Experts</p>
          <p className="mt-1 text-3xl font-bold text-purple-600">{company.expertCount ?? experts.length}</p>
          <p className="mt-1 text-xs text-slate-400">{reviewedExperts} reviewed · {autoExperts.length} draft</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Projects</p>
          <p className="mt-1 text-3xl font-bold text-green-600">{company.projectCount ?? projects.length}</p>
          <p className="mt-1 text-xs text-slate-400">{reviewedProjects} reviewed · {autoProjects.length} draft</p>
        </div>
        <div className="rounded-2xl border bg-amber-50 p-5 shadow-sm border-amber-200">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Tender Matching Rule</p>
          <p className="mt-2 text-sm text-amber-800">Correct draft records first. The matcher uses five scoring cycles and gives reviewed/manual records stronger confidence.</p>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Uploaded source documents</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {docs.map((doc) => (
            <div key={doc.id} className="rounded-xl border p-4">
              <p className="font-medium text-slate-900">{doc.originalFileName}</p>
              <p className="mt-1 text-xs text-slate-500">{doc.category} · {(doc.extractedText?.length ?? 0).toLocaleString()} extracted characters</p>
              <p className="mt-2 line-clamp-4 text-xs text-slate-500">{(doc.extractedText ?? "").slice(0, 500)}</p>
            </div>
          ))}
          {docs.length === 0 && <p className="text-sm text-slate-400">No documents found from the same API used by the vault.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Experts</h2>
          <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">{experts.length} records</span>
        </div>
        <div className="mt-4 space-y-3">
          {experts.map((expert) => {
            const draft = isAutoImported(expert.profile);
            return (
              <details key={expert.id} className="rounded-xl border p-4 open:bg-slate-50">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{expert.fullName}</p>
                      <p className="text-xs text-slate-500">{expert.title || "No reviewed title yet"}</p>
                    </div>
                    <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${draft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>
                      {draft ? "Review required" : "Reviewed / manual"}
                    </span>
                  </div>
                </summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-white p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structured fields</p>
                    <dl className="mt-2 space-y-1 text-xs text-slate-600">
                      <div><dt className="inline font-medium">Years:</dt> <dd className="inline">{expert.yearsExperience ?? "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Disciplines:</dt> <dd className="inline">{arr(expert.disciplines).join(", ") || "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Sectors:</dt> <dd className="inline">{arr(expert.sectors).join(", ") || "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Certifications:</dt> <dd className="inline">{arr(expert.certifications).join(", ") || "Not reviewed"}</dd></div>
                    </dl>
                  </div>
                  <div className="rounded-lg bg-white p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source evidence</p>
                    <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{sourceSnippet(expert.profile)}</p>
                  </div>
                </div>
              </details>
            );
          })}
          {experts.length === 0 && <p className="text-sm text-slate-400">No experts returned by `/api/company`.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">{projects.length} records</span>
        </div>
        <div className="mt-4 space-y-3">
          {projects.map((project) => {
            const draft = isAutoImported(project.summary);
            return (
              <details key={project.id} className="rounded-xl border p-4 open:bg-slate-50">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{project.name}</p>
                      <p className="text-xs text-slate-500">{project.clientName || "No reviewed client yet"}{project.sector ? ` · ${project.sector}` : ""}</p>
                    </div>
                    <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${draft ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>
                      {draft ? "Review required" : "Reviewed / manual"}
                    </span>
                  </div>
                </summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-white p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Structured fields</p>
                    <dl className="mt-2 space-y-1 text-xs text-slate-600">
                      <div><dt className="inline font-medium">Country:</dt> <dd className="inline">{project.country || "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Sector:</dt> <dd className="inline">{project.sector || "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Services:</dt> <dd className="inline">{arr(project.serviceAreas).join(", ") || "Not reviewed"}</dd></div>
                      <div><dt className="inline font-medium">Value:</dt> <dd className="inline">{project.contractValue ? `${project.currency ?? ""} ${project.contractValue.toLocaleString()}` : "Not reviewed"}</dd></div>
                    </dl>
                  </div>
                  <div className="rounded-lg bg-white p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source evidence</p>
                    <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{sourceSnippet(project.summary)}</p>
                  </div>
                </div>
              </details>
            );
          })}
          {projects.length === 0 && <p className="text-sm text-slate-400">No projects returned by `/api/company`.</p>}
        </div>
      </section>
    </div>
  );
}
