"use client";

import React, { useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

// This panel previously fetched /api/tenders/[id]/workflow-center and read
// `json.authority` — a key that route has never returned in its consolidated
// form, so the panel silently rendered nothing at all. It now consumes the
// dedicated /api/tenders/[id]/authority-review route, the same authority
// source the full AuthorityReviewPanel uses, so the two can never disagree.

type AuthorityTruth = {
  status: string;
  score: number | null;
  reason: string | null;
};

export function AuthorityReviewTruthPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<AuthorityTruth | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/authority-review`, { credentials: "include" })
      .then((res) => res.json())
      .then((json: { success?: boolean; authorityReview?: { status?: string; overallScore?: number }; primaryBlockerReason?: string | null }) => {
        if (!json?.success || !json.authorityReview?.status) return;
        setData({
          status: json.authorityReview.status,
          score: typeof json.authorityReview.overallScore === "number" ? json.authorityReview.overallScore : null,
          reason: json.primaryBlockerReason ?? null,
        });
      })
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  if (!data) return null;

  const ready = data.status === "AUTHORITY_READY";
  return (
    <div className={`mt-4 rounded-xl border p-4 ${ready ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"}`}>
      <h3 className={`text-sm font-bold ${ready ? "text-green-900" : "text-slate-900"}`}>
        Authority Review: {data.status.replace(/_/g, " ")}
      </h3>
      {data.reason && <p className="mt-1 text-xs text-slate-600">{data.reason}</p>}
      {ready && data.score !== null && (
          <p className="mt-2 text-[10px] font-bold text-green-700 uppercase">Score: {data.score}/100</p>
      )}
    </div>
  );
}
