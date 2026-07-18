"use client";

import React, { useCallback, useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";

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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/authority-review`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => ({})) as {
        success?: boolean;
        authorityReview?: { status?: string; overallScore?: number };
        primaryBlockerReason?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? `authority-review ${response.status}`);
      if (!json.success || !json.authorityReview?.status) throw new Error("Authority review response was incomplete");
      setData({
        status: json.authorityReview.status,
        score: typeof json.authorityReview.overallScore === "number" ? json.authorityReview.overallScore : null,
        reason: json.primaryBlockerReason ?? null,
      });
    } catch (error) {
      setFailed(true);
      clientLogger.error(
        "authority review truth fetch failed",
        error instanceof Error ? { message: error.message } : { error: String(error) },
      );
    }
  }, [tenderId]);

  useEffect(() => {
    void load();
    return subscribeTenderWorkflowSync(tenderId, () => {
      void load();
    });
  }, [load, tenderId]);

  if (failed) {
    return (
      <div id="authority-review" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Authority review status could not be loaded.</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-xs font-medium text-red-700 underline">Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div id="authority-review" className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-busy="true">
        <p className="text-sm text-slate-500">Loading authority review status…</p>
      </div>
    );
  }

  const ready = data.status === "AUTHORITY_READY";
  return (
    <div id="authority-review" className={`mt-4 rounded-xl border p-4 ${ready ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"}`}>
      <h3 className={`text-sm font-bold ${ready ? "text-green-900" : "text-slate-900"}`}>
        Authority Review: {data.status.replace(/_/g, " ")}
      </h3>
      {data.reason && <p className="mt-1 text-xs text-slate-600">{data.reason}</p>}
      {data.score !== null && (
        <p className={`mt-2 text-[10px] font-bold uppercase ${ready ? "text-green-700" : "text-slate-600"}`}>Score: {data.score}/100</p>
      )}
    </div>
  );
}
