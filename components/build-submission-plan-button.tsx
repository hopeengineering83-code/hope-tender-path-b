"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, DocumentIcon, RefreshIcon } from "./icons";
import { emitTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

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

export function BuildSubmissionPlanButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<BuildPlanStatus | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/build-plan`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({})) as BuildPlanStatus;
      if (!response.ok || data.ok === false) {
        setOk(false);
        setMessage(data.error ?? `Build Plan status failed (${response.status}).`);
        return;
      }
      setPlan(data);
    } catch {
      setOk(false);
      setMessage("Build Plan status could not be loaded.");
    } finally {
      setLoadingStatus(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function buildAndVerify() {
    setRunning(true);
    setMessage(null);
    setOk(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/build-plan`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({})) as BuildPlanStatus;
      if (!response.ok || data.ok === false || data.authorizesGeneration !== true) {
        setOk(false);
        setMessage(
          data.error ??
          (Array.isArray(data.blockers)
            ? data.blockers.join(" ")
            : "Automatic Build Plan verification is blocked. Repair the cited tender source evidence and retry."),
        );
        setPlan(data);
        return;
      }
      setPlan({
        ...data,
        state: "CONFIRMED",
        automaticVerificationPending: false,
        authorizesGeneration: true,
      });
      setOk(true);
      setMessage(`Build Plan revision ${data.revision ?? "—"} was automatically derived and source-verified.`);
      emitTenderWorkflowSync({ tenderId, source: "build-plan-automatically-verified" });
      startTransition(() => router.refresh());
    } catch {
      setOk(false);
      setMessage("Automatic Build Plan verification failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  const items = plan?.items ?? [];
  const busy = running || isPending || loadingStatus;
  const verified = plan?.state === "CONFIRMED" && plan.authorizesGeneration === true;

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      {!verified && (
        <button
          type="button"
          onClick={buildAndVerify}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingStatus || running ? <RefreshIcon /> : <DocumentIcon />}
          {loadingStatus
            ? "Checking plan…"
            : running
              ? "Building and verifying…"
              : plan?.state === "STALE_CONFIRMED" || plan?.state === "DRAFT"
                ? "Rebuild and verify plan"
                : "Build and verify plan"}
        </button>
      )}

      {plan?.state === "STALE_CONFIRMED" && (
        <p className="rounded-lg border border-red-200 bg-white p-2 text-xs text-red-700">
          {plan.blocker ?? "The Build Plan is stale. Rebuild it so the current scope can be source-verified automatically."}
        </p>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-700">
          <p className="font-semibold text-slate-900">
            {verified ? `Verified revision ${plan?.revision ?? "—"}` : `Derived revision ${plan?.revision ?? "—"}`}
          </p>
          <p className="mt-1 text-slate-600">
            File names, order, formats, source requirements, and the current content hash are validated by the server. No manual confirmation is required.
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

      {verified && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white p-2 text-xs font-semibold text-emerald-700">
          <CheckCircleIcon /> Build Plan automatically source-verified
        </p>
      )}
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
    </div>
  );
}
