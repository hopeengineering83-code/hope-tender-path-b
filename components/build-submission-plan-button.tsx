"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function BuildSubmissionPlanButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    setOk(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/submission-plan/build`, { method: "POST" });
      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await res.json() as Record<string, unknown> : {};
      if (!res.ok || data.error) {
        setOk(false);
        setMessage(typeof data.error === "string" ? data.error : "Failed to build submission plan. Check tender analysis and generation readiness first.");
        return;
      }
      const created = typeof data.created === "number" ? data.created : 0;
      setOk(true);
      setMessage(`Submission plan built — ${created} planned document record${created === 1 ? "" : "s"} created.`);
      startTransition(() => router.refresh());
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error ? `Build failed: ${error.message}` : "Build failed — network or runtime error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={run}
        disabled={running || isPending}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running || isPending ? "Building plan…" : "Build submission plan"}
      </button>
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
    </div>
  );
}
