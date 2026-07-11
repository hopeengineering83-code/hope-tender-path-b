"use client";

// Execute affordance for the FINALIZE_REQUIRED_PDF recovery action.
//
// The generation-readiness TENDER_REQUIRES_PDF warning previously rendered
// only a scroll link, so the advertised recovery (POST /finalize-pdf) was
// never executable from the panel. This button runs the same API action the
// Recovery Command Center exposes. Visibility is gated by the caller via
// canMutateTender — REVIEWER users must never see it.
//
// All displayed messages come from the route's safe structured responses
// (publicMessage/error fields) — never raw thrown text.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function FinalizeRequiredPdfButton({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "blocked">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (state === "running") return;
    setState("running");
    setMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/finalize-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok && data?.ok) {
        setMessage(
          typeof data?.nextStep === "string"
            ? data.nextStep
            : "Required PDF finalized. Validate and approve it before final export.",
        );
        setState("done");
        router.refresh();
      } else {
        const blockedEntry = Array.isArray(data?.blocked) && data.blocked[0] && typeof data.blocked[0].message === "string"
          ? data.blocked[0].message
          : null;
        const safeError = typeof data?.error === "string" ? data.error : null;
        setMessage(blockedEntry ?? safeError ?? "PDF finalization is blocked. Open the Recovery Command Center for details.");
        setState("blocked");
      }
    } catch {
      setMessage("PDF finalization request failed. Retry, or use the Recovery Command Center.");
      setState("blocked");
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state === "running" || state === "done"}
        className="rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
      >
        {state === "running" ? "Finalizing PDF…" : state === "done" ? "PDF finalized" : "Finalize Required PDF"}
      </button>
      {message && (
        <span className={`max-w-xs text-right text-[11px] ${state === "done" ? "text-green-700" : "text-amber-800"}`}>{message}</span>
      )}
    </span>
  );
}
