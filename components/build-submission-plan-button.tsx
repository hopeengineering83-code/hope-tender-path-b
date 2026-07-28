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
  const [reviewed, setReviewed] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/build-plan`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({})) as BuildPlanStatus;
      if (!res.ok || data.ok === false) {
        setOk(false);
        setMessage(data.error ?? `Build Plan status failed (${res.status}).`);
        return;
      }
      setPlan(data);
      setReviewed(false);
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

  async function buildDraft() {
    setRunning(true);
    setMessage(null);
    setOk(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/build-plan`, { method: "POST" });
      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await res.json() as BuildPlanStatus : {};
      if (!res.ok || data.error) {
        setOk(false);
        setMessage(typeof data.error === "string" ? data.error : "Failed to build submission plan. Check tender analysis and generation readiness first.");
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setPlan({
        ok: true,
        state: "DRAFT",
        revision: data.revision,
        items,
        authorizesGeneration: false,
      });
      setReviewed(false);
      setOk(true);
      setMessage(`Draft built with ${items.length} tender-controlled file${items.length === 1 ? "" : "s"}. Review every filename and order below before confirming.`);
    } catch {
      setOk(false);
      setMessage("Build Plan draft failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  async function confirmDraft() {
    if (!reviewed || plan?.state !== "DRAFT") return;
    setRunning(true);
    setMessage(null);
    setOk(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/build-plan/confirm`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as BuildPlanStatus;
      if (!res.ok || data.ok === false || data.authorizesGeneration !== true) {
        setOk(false);
        setMessage(data.error ?? (Array.isArray(data.blockers) ? data.blockers.join(" ") : `Build Plan confirmation failed (${res.status}).`));
        return;
      }
      setPlan((current) => ({
        ...current,
        state: "CONFIRMED",
        revision: data.revision ?? current?.revision,
        authorizesGeneration: true,
      }));
      setOk(true);
      setMessage("Build Plan confirmed. Generation and export gates will now evaluate this exact file scope.");
      emitTenderWorkflowSync({ tenderId, source: "build-plan-confirmed" });
      startTransition(() => router.refresh());
    } catch {
      setOk(false);
      setMessage("Build Plan confirmation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  const draftItems = plan?.state === "DRAFT" ? (plan.items ?? []) : [];
  const busy = running || isPending || loadingStatus;

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      {plan?.state !== "CONFIRMED" && (
        <button
          type="button"
          onClick={buildDraft}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingStatus ? <RefreshIcon /> : <DocumentIcon />}
          {loadingStatus ? "Checking plan…" : running ? "Building draft…" : plan?.state === "DRAFT" ? "Rebuild plan draft" : "Build plan draft"}
        </button>
      )}

      {plan?.state === "STALE_CONFIRMED" && (
        <p className="rounded-lg border border-red-200 bg-white p-2 text-xs text-red-700">
          {plan.blocker ?? "The confirmed Build Plan is stale. Rebuild and re-confirm it."}
        </p>
      )}

      {draftItems.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-white p-3 text-left text-xs text-slate-700">
          <p className="font-semibold text-amber-900">Draft revision {plan?.revision ?? "—"} — not yet authoritative</p>
          <p className="mt-1 text-slate-600">Confirm only after checking every tender-required filename, order, format, and envelope.</p>
          <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
            {draftItems.map((item, index) => (
              <li key={`${item.canonicalId ?? item.exactFileName ?? "item"}:${index}`} className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-slate-900">{item.exactOrder ?? index + 1}. {item.exactFileName ?? "Unnamed file"}</span>
                <span className="text-slate-500">{[item.envelope, item.format].filter(Boolean).join(" / ")}</span>
              </li>
            ))}
          </ol>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              disabled={running || isPending}
              className="mt-0.5"
            />
            <span>I reviewed the complete file list and confirm it matches the tender instructions.</span>
          </label>
          <button
            type="button"
            onClick={confirmDraft}
            disabled={!reviewed || running || isPending}
            title={!reviewed ? "Review the complete draft and check the confirmation box first" : "Confirm this exact Build Plan"}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircleIcon /> {running ? "Confirming…" : "Confirm reviewed Build Plan"}
          </button>
        </div>
      )}

      {plan?.state === "CONFIRMED" && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white p-2 text-xs font-semibold text-emerald-700">
          <CheckCircleIcon /> Build Plan confirmed
        </p>
      )}
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
    </div>
  );
}
