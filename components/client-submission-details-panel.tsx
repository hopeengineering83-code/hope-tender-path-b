"use client";

import { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";

const STATUS_BADGE: Record<CanonicalFieldStatus, { label: string; classes: string }> = {
  EXTRACTED_AND_GROUNDED:              { label: "Extracted and grounded",             classes: "bg-emerald-100 text-emerald-700" },
  EXTRACTED_UNVERIFIED:                { label: "Extracted — review evidence",         classes: "bg-blue-100 text-blue-700" },
  MANUAL_OVERRIDE:                     { label: "Candidate value (non-critical)",      classes: "bg-indigo-100 text-indigo-700" },
  MANUAL_OVERRIDE_CONFIRMATION_REQUIRED: { label: "Candidate — blocked (critical)",   classes: "bg-orange-100 text-orange-700" },
  MANUAL_CONFIRMED:                    { label: "Confirmed — needs source",            classes: "bg-amber-100 text-amber-700" },
  NOT_STATED:                          { label: "Not stated in tender",                classes: "bg-slate-100 text-slate-600" },
  NOT_APPLICABLE:                      { label: "Not applicable",                      classes: "bg-slate-100 text-slate-500" },
  AMBIGUOUS_DATE:                      { label: "Date ambiguous — confirm",            classes: "bg-orange-100 text-orange-700" },
  GENERIC_FIELD_LABEL:                 { label: "Invalid extracted value",             classes: "bg-red-100 text-red-700" },
  INTERNAL_PLACEHOLDER:                { label: "Placeholder detected",                classes: "bg-red-100 text-red-700" },
  PORTAL_CONTAMINATION:                { label: "Contaminated — review",               classes: "bg-red-100 text-red-700" },
  INVALID_FORMAT:                      { label: "Invalid format",                      classes: "bg-red-100 text-red-700" },
  SOURCE_CONFLICT:                     { label: "Source conflict — resolve",            classes: "bg-red-100 text-red-700" },
  INVALID:                             { label: "Not detected",                        classes: "bg-slate-100 text-slate-500" },
  BLOCKED:                             { label: "Blocked",                             classes: "bg-red-200 text-red-800" },
};

export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/tenders/${tenderId}/workflow-center`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { snapshot?: TenderReleaseSnapshot } | null;
        if (!res.ok || !json?.snapshot) {
          throw new Error("Failed to load snapshot");
        }
        setSnapshot(json.snapshot);
        setSnapshotRevision(json.snapshot.snapshotRevision);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load client details");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tenderId]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="text-sm text-slate-500">Loading client details…</div>
      </section>
    );
  }

  if (error || !snapshot) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm sm:p-5">
        <div className="text-sm text-red-700">{error || "Failed to load client details"}</div>
      </section>
    );
  }

  const { metadata } = snapshot;
  const criticalFields = metadata.fields.filter(f => f.criticality === "always-critical");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Client &amp; Submission Details</h2>
            {snapshotRevision && (
              <span className="text-[10px] text-slate-400 font-mono ml-3">rev: {snapshotRevision.slice(0, 8)}</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Key fields extracted from the tender document. Critical fields must be resolved before final packaging.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {metadata.hasGenerationBlocker && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          Critical fields are blocked. Resolve these before proceeding.
        </div>
      )}

      <div className="space-y-1">
        {metadata.fields.map((field) => {
          const badge = STATUS_BADGE[field.status] ?? STATUS_BADGE.INVALID;
          const isCritical = field.criticality === "always-critical";

          return (
            <div
              key={field.fieldKey}
              className="border-b border-slate-50 py-2 last:border-0"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">{field.label}</span>
                    {isCritical && (
                      <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700">
                        Critical
                      </span>
                    )}
                  </div>
                  {field.blockerReason && (
                    <p className="mt-0.5 text-[10px] text-red-600">{field.blockerReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {field.effectiveValue && (
                    <span className="text-slate-400 truncate max-w-[160px] text-[10px]" title={field.effectiveValue}>
                      {field.effectiveValue.length > 50 ? field.effectiveValue.slice(0, 50) + "…" : field.effectiveValue}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-[9px] whitespace-nowrap ${badge.classes}`}
                    title={field.blockerReason ?? undefined}
                  >
                    {badge.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
