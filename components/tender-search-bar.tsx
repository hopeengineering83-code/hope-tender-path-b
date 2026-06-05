"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
        <option value="EXPORTED">Exported</option>
        <option value="CLOSED">Closed</option>
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
