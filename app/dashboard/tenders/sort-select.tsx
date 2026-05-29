"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const SORT_OPTIONS = [
  { value: "createdAt_desc", label: "Newest first" },
  { value: "createdAt_asc", label: "Oldest first" },
  { value: "deadline_asc", label: "Deadline (soonest)" },
  { value: "deadline_desc", label: "Deadline (latest)" },
  { value: "readinessScore_desc", label: "Readiness (high)" },
  { value: "readinessScore_asc", label: "Readiness (low)" },
  { value: "status_asc", label: "Status A–Z" },
] as const;

export function SortSelect({ currentSort }: { currentSort: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("sort", e.target.value);
      router.replace(`/dashboard/tenders?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Sort:</label>
      <select
        value={currentSort}
        onChange={handleChange}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-black cursor-pointer"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
