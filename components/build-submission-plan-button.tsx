"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircleIcon, ClockIcon, WarningIcon } from "./icons";

type BuildPlanItem = {
  canonicalId?: string;
  exactFileName?: string;
  exactOrder?: number;
  envelope?: string;
  format?: string;
  required?: boolean;
};

type BuildPlanStatus = {
  ok?: boolean;
  state?: "NOT_BUILT" | "DRAFT" | "CONFIRMED" | "STALE_CONFIRMED";
  revision?: number;
  items?: BuildPlanItem[];
  blocker?: string;
  blockers?: string[];
  authorizesGeneration?: boolean;
  automaticVerificationPending?: boolean;
  confirmationMode?: string;
  error?: string;
};

/**
 * Backward-compatible export name. This is intentionally status-only: Build
 * Plan creation is owned by automatic Engine continuation after canonical AI
 * analysis succeeds. It must never become a normal workflow button.
 */
export function BuildSubmissionPlanButton({ tenderId }: { tenderId: string }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<BuildPlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/build-plan`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({})) as BuildPlanStatus;
      if (!response.ok || data.ok === false) {
        setError(data.error ?? `Build Plan status failed (${response.status}).`);
        setPlan(data);
        return;
      }
      setPlan(data);
    } catch {
      setError("Build Plan status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const items = plan?.items ?? [];
  const verified = plan?.state === "CONFIRMED" && plan.authorizesGeneration === true;
  const stale = plan?.state === "STALE_CONFIRMED";

  return (
    <div className="flex max-w-2xl flex-col gap-2" aria-live="polite">
      {loading ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2 text-xs font-semibold text-slate-600">
          <ClockIcon /> Checking automatic Build Plan status…
        </p>
      ) : verified ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white p-2 text-xs font-semibold text-emerald-700">
          <CheckCircleIcon /> Build Plan revision {plan?.revision ?? "—"} automatically source-verified
        </p>
      ) : (
        <div className={`rounded-lg border p-3 text-xs ${stale || error ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <p className="inline-flex items-center gap-1.5 font-semibold">
            <WarningIcon /> {stale ? "Build Plan is stale" : "Build Plan is waiting for automatic Engine processing"}
          </p>
          <p className="mt-1">
            {error ?? plan?.blocker ?? "Matching and Build Plan verification continue automatically after canonical AI analysis succeeds. No separate Build Plan confirmation is required."}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-700">
          <p className="font-semibold text-slate-900">
            {verified ? `Verified revision ${plan?.revision ?? "—"}` : `Derived revision ${plan?.revision ?? "—"}`}
          </p>
          <p className="mt-1 text-slate-600">
            File names, order, formats, source requirements, and content hash are validated by the server worker.
          </p>
          <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
            {items.map((item, index) => (
              <li key={`${item.canonicalId ?? item.exactFileName ?? "item"}:${index}`} className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-slate-900">{item.exactOrder ?? index + 1}. {item.exactFileName ?? "Unnamed file"}</span>
                <span className="text-slate-500">{[item.envelope, item.format].filter(Boolean).join(" / ")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
