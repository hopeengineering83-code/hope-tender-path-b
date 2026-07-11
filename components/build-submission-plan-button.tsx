"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function BuildSubmissionPlanButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [contentPageWarnings, setContentPageWarnings] = useState<string[]>([]);

  async function run() {
    setRunning(true);
    setMessage(null);
    setOk(null);
    setContentPageWarnings([]);
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
      if (Array.isArray(data.contentPageWarnings) && data.contentPageWarnings.length > 0) {
        setContentPageWarnings(data.contentPageWarnings as string[]);
      }
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
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running || isPending ? "Building plan…" : "Build submission plan"}
      </button>
      {message && <p className={`text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
      {contentPageWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
          <p className="font-semibold mb-1">Extraction content warnings — review before proceeding:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {contentPageWarnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
