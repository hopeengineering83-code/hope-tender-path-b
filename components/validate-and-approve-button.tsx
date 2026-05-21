"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  tenderId: string;
  unvalidatedCount: number;
  unreviewedCount: number;
};

export function ValidateAndApproveButton({ tenderId, unvalidatedCount, unreviewedCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");

  const needsValidation = unvalidatedCount > 0;
  const needsReview = unreviewedCount > 0;
  if (!needsValidation && !needsReview) return null;

  async function run() {
    setRunning(true);
    setMessage(null);

    try {
      if (needsValidation) {
        const res = await fetch(`/api/tenders/${tenderId}/validate`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setKind("error");
          setMessage(data.error ?? `Validation failed (HTTP ${res.status}).`);
          return;
        }
        const report = (data as { report?: { passed?: boolean; issues?: Array<{ severity: string; message: string }> } }).report;
        if (report && !report.passed) {
          const blocks = (report.issues ?? []).filter((i) => i.severity === "BLOCK");
          setKind("error");
          setMessage(`Validation found ${blocks.length} blocking issue(s). Fix them before approving: ${blocks.slice(0, 3).map((i) => i.message).join("; ")}`);
          return;
        }
      }

      if (needsReview) {
        const res = await fetch(`/api/tenders/${tenderId}/documents/bulk-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewStatus: "READY_FOR_EXPORT", skipAlreadyAtTarget: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setKind("error");
          setMessage((data as { error?: string }).error ?? `Bulk review failed (HTTP ${res.status}).`);
          return;
        }
        const updated = (data as { updated?: number }).updated ?? 0;
        setKind("success");
        setMessage(`${needsValidation ? "Validated and marked " : "Marked "}${updated} document(s) READY_FOR_EXPORT.`);
      } else {
        setKind("success");
        setMessage("Documents validated successfully.");
      }

      startTransition(() => router.refresh());
    } catch (err) {
      setKind("error");
      setMessage(err instanceof Error ? err.message : "Action failed due to a network error.");
    } finally {
      setRunning(false);
    }
  }

  const label = needsValidation && needsReview
    ? `Validate & approve ${unvalidatedCount} document${unvalidatedCount === 1 ? "" : "s"}`
    : needsValidation
      ? `Validate ${unvalidatedCount} document${unvalidatedCount === 1 ? "" : "s"}`
      : `Approve ${unreviewedCount} document${unreviewedCount === 1 ? "" : "s"} for export`;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        onClick={() => void run()}
        disabled={running || isPending}
        className="self-start rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running || isPending ? "Working…" : label}
      </button>
      {message && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          {message}
        </div>
      )}
    </div>
  );
}
