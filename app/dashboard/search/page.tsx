"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDate } from "../../../lib/tender-workflow";
import { StatusBadge } from "../../../components/status-badge";

type TenderResult = { id: string; title: string; clientName: string | null; status: string; deadline: string | null };
type ExpertResult = { id: string; fullName: string; title: string | null; disciplines: string };
type ProjectResult = { id: string; name: string; clientName: string | null; sector: string | null; country: string | null };
type SearchResponse = {
  tenders?: TenderResult[];
  experts?: ExpertResult[];
  projects?: ProjectResult[];
  error?: string;
};

function SearchClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [tenders, setTenders] = useState<TenderResult[]>([]);
  const [experts, setExperts] = useState<ExpertResult[]>([]);
  const [projects, setProjects] = useState<ProjectResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (rawQuery: string) => {
    const normalized = rawQuery.trim();
    requestRef.current?.abort();

    if (normalized.length < 2) {
      setTenders([]);
      setExperts([]);
      setProjects([]);
      setSearched(false);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as SearchResponse;
      if (!response.ok) throw new Error(data.error ?? `Search failed (HTTP ${response.status}).`);
      if (controller.signal.aborted) return;
      setTenders(data.tenders ?? []);
      setExperts(data.experts ?? []);
      setProjects(data.projects ?? []);
      setSearched(true);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setTenders([]);
      setExperts([]);
      setProjects([]);
      setSearched(false);
      setError(reason instanceof Error ? reason.message : "Search failed.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // The URL is the single query authority. Updating it schedules exactly one
  // debounced request; there is no second request path in the input handler.
  useEffect(() => {
    setQuery(urlQuery);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(urlQuery), urlQuery.trim().length >= 2 ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [urlQuery, runSearch]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    setError(null);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextQuery.trim()) nextParams.set("q", nextQuery);
    else nextParams.delete("q");
    const suffix = nextParams.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  }

  const hasResults = tenders.length > 0 || experts.length > 0 || projects.length > 0;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Search</h1>
        <p className="mt-1 text-sm text-slate-500">One search across tenders, experts, and projects. The query remains in the URL.</p>
      </div>

      <div className="relative min-w-0">
        <svg aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
        </svg>
        <label htmlFor="global-search" className="sr-only">Search tenders, experts, and projects</label>
        <input
          id="global-search"
          autoFocus
          type="search"
          value={query}
          onChange={handleChange}
          placeholder="Search by title, client, reference, expert name, or project"
          aria-describedby="search-help"
          aria-busy={loading}
          className="min-h-12 w-full rounded-xl border bg-white py-3 pl-10 pr-10 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {loading && (
          <svg aria-label="Searching" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>
      <p id="search-help" className="text-xs text-slate-500">Enter at least two characters. A newer query cancels any older request.</p>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <p role="status" aria-live="polite" className="text-sm text-slate-500">Searching…</p>}
      {searched && !hasResults && !loading && (
        <p role="status" className="py-8 text-center text-sm text-slate-500">No results found for “{query.trim()}”.</p>
      )}

      {tenders.length > 0 && (
        <section aria-labelledby="tender-results-heading">
          <h2 id="tender-results-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Tenders ({tenders.length})</h2>
          <ul className="space-y-2">
            {tenders.map((tender) => (
              <li key={tender.id}>
                <Link href={`/dashboard/tenders/${tender.id}`} className="flex min-h-14 min-w-0 flex-col gap-2 rounded-xl border bg-white px-4 py-3 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-slate-900">{tender.title}</span>
                    {tender.clientName && <span className="mt-0.5 block break-words text-xs text-slate-500">{tender.clientName}</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                    {tender.deadline && <span className="text-xs text-slate-500">{formatDate(tender.deadline)}</span>}
                    <StatusBadge status={tender.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {experts.length > 0 && (
        <section aria-labelledby="expert-results-heading">
          <h2 id="expert-results-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Experts ({experts.length})</h2>
          <ul className="space-y-2">
            {experts.map((expert) => (
              <li key={expert.id}>
                <Link href="/dashboard/company" className="block min-h-14 min-w-0 rounded-xl border bg-white px-4 py-3 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50">
                  <span className="block break-words text-sm font-medium text-slate-900">{expert.fullName}</span>
                  {expert.title && <span className="mt-0.5 block break-words text-xs text-slate-500">{expert.title}</span>}
                  {expert.disciplines && <span className="mt-1 block break-words text-xs text-slate-600">{expert.disciplines}</span>}
                  <span className="mt-1 block text-xs font-medium text-blue-700">Open Knowledge Vault</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projects.length > 0 && (
        <section aria-labelledby="project-results-heading">
          <h2 id="project-results-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Projects ({projects.length})</h2>
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href="/dashboard/company" className="block min-h-14 min-w-0 rounded-xl border bg-white px-4 py-3 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50">
                  <span className="block break-words text-sm font-medium text-slate-900">{project.name}</span>
                  <span className="mt-0.5 block break-words text-xs text-slate-500">{[project.clientName, project.sector, project.country].filter(Boolean).join(" · ")}</span>
                  <span className="mt-1 block text-xs font-medium text-blue-700">Open Knowledge Vault</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p role="status" className="py-12 text-center text-slate-500">Loading search…</p>}>
      <SearchClient />
    </Suspense>
  );
}
