"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Single search + status-filter authority for /dashboard/tenders.
 *
 * Preserves q, status, AND sort together in the URL. Replaces the prior
 * duplicate controls (server GET form + status chips + this component).
 *
 * Issue #1134 recheck 10 item #2: "Keep one search authority and one
 * status-filter authority, preserving q, status, and sort together."
 */
export function TenderSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (q) params.set("q", q); else params.delete("q");
      router.push(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = searchParams.get("status") ?? "";
  function setStatus(val: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set("status", val); else params.delete("status");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasFilter = !!q || !!status;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tenders…"
        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 w-52"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <option value="">All statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="IN_PROGRESS">In Progress</option>
        <option value="GENERATED">Generated</option>
        <option value="IN_REVIEW">In Review</option>
        <option value="APPROVED">Approved</option>
        <option value="EXPORTED">Exported</option>
        <option value="CLOSED">Closed</option>
        <option value="REGEX_FALLBACK">Needs re-analysis</option>
      </select>
      {hasFilter && (
        <button
          onClick={() => { setQ(""); setStatus(""); }}
          className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 hover:bg-slate-50"
        >
          Clear ✕
        </button>
      )}
    </div>
  );
}
