"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  TENDER_STATUSES,
  TENDER_STATUS_LABELS,
  parseTenderStatus,
} from "../lib/tender-workflow";
import { CrossIcon } from "./icons";

/**
 * Single search + status-filter authority for /dashboard/tenders.
 *
 * Preserves q, status, AND sort together in the URL. The status control is
 * generated from the canonical workflow status registry so every valid URL
 * filter is represented by a matching visible option.
 */
export function TenderSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const currentQuery = searchParams.get("q") ?? "";
  const rawStatus = (searchParams.get("status") ?? "").toUpperCase();
  const status =
    rawStatus === "REGEX_FALLBACK"
      ? rawStatus
      : parseTenderStatus(rawStatus) ?? "";
  const [q, setQ] = useState(currentQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function navigate(params: URLSearchParams) {
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  // Browser back/forward navigation and external links remain authoritative.
  useEffect(() => {
    setQ(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    if (q === currentQuery) return;

    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams(searchParamString);
      if (q) params.set("q", q);
      else params.delete("q");
      navigate(params);
    }, 300);

    return () => clearTimeout(debounce.current);
    // navigate is intentionally local: pathname/router/searchParamString are
    // listed directly so URL state remains the only external authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, currentQuery, pathname, router, searchParamString]);

  function setStatus(value: string) {
    const params = new URLSearchParams(searchParamString);
    if (value) params.set("status", value);
    else params.delete("status");
    navigate(params);
  }

  function clearFilters() {
    clearTimeout(debounce.current);
    setQ("");
    const params = new URLSearchParams(searchParamString);
    params.delete("q");
    params.delete("status");
    navigate(params);
  }

  const hasFilter = Boolean(currentQuery || status);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search tenders…"
        aria-label="Search tenders"
        className="h-8 w-52 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        aria-label="Filter tenders by status"
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <option value="">All statuses</option>
        {TENDER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {TENDER_STATUS_LABELS[value]}
          </option>
        ))}
        <option value="REGEX_FALLBACK">Needs re-analysis</option>
      </select>
      {hasFilter && (
        <button
          type="button"
          onClick={clearFilters}
          className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 hover:bg-slate-50"
        >
          Clear <CrossIcon />
        </button>
      )}
    </div>
  );
}
