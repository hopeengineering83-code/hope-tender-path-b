"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { formatDate } from "../../../lib/tender-workflow";
import { StatusBadge } from "../../../components/status-badge";

type TenderResult = { id: string; title: string; clientName: string | null; status: string; deadline: string | null };
type ExpertResult = { id: string; fullName: string; title: string | null; disciplines: string };
type ProjectResult = { id: string; name: string; clientName: string | null; sector: string | null; country: string | null };

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [tenders, setTenders] = useState<TenderResult[]>([]);
  const [experts, setExperts] = useState<ExpertResult[]>([]);
  const [projects, setProjects] = useState<ProjectResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setTenders([]); setExperts([]); setProjects([]); setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json() as { tenders: TenderResult[]; experts: ExpertResult[]; projects: ProjectResult[] };
        setTenders(data.tenders);
        setExperts(data.experts);
        setProjects(data.projects);
        setSearched(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runSearch(q), 300);
  }

  const hasResults = tenders.length > 0 || experts.length > 0 || projects.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Search</h1>
        <p className="mt-0.5 text-slate-500">Search tenders, experts, and projects</p>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
        </svg>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={handleChange}
          placeholder="Search by title, client, reference, expert name, project…"
          className="w-full rounded-xl border bg-white pl-10 pr-4 py-3 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {loading && (
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>

      {searched && !hasResults && (
        <p className="text-center text-sm text-slate-400 py-8">No results found for &ldquo;{query}&rdquo;</p>
      )}

      {tenders.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Tenders ({tenders.length})</h2>
          <ul className="space-y-2">
            {tenders.map((t) => (
              <li key={t.id}>
                <Link href={`/dashboard/tenders/${t.id}`}
                  className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
                    {t.clientName && <p className="text-xs text-slate-400 mt-0.5">{t.clientName}</p>}
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-3">
                    {t.deadline && <span className="text-xs text-slate-400">{formatDate(t.deadline)}</span>}
                    <StatusBadge status={t.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {experts.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Experts ({experts.length})</h2>
          <ul className="space-y-2">
            {experts.map((e) => (
              <li key={e.id}>
                <Link href={`/dashboard/company#experts`}
                  className="flex items-start rounded-xl border bg-white px-4 py-3 shadow-sm hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{e.fullName}</p>
                    {e.title && <p className="text-xs text-slate-400 mt-0.5">{e.title}</p>}
                    {e.disciplines && <p className="mt-1 text-xs text-slate-500 truncate">{e.disciplines}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projects.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Projects ({projects.length})</h2>
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/dashboard/company#projects`}
                  className="flex items-start rounded-xl border bg-white px-4 py-3 shadow-sm hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {[p.clientName, p.sector, p.country].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
