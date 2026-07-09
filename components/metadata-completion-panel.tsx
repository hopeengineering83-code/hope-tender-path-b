"use client";

import React, { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { CANONICAL_FIELD_STATUS_BADGE as STATUS_BADGE } from "./canonical-field-status-badge";

export function TenderDetailsPanel({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenders/${tenderId}/workflow-center`);
        const json = (await res.json().catch(() => null)) as { snapshot?: TenderReleaseSnapshot } | null;
        if (res.ok && json?.snapshot) {
          setSnapshot(json.snapshot);
          setSnapshotRevision(json.snapshot.snapshotRevision);
        } else {
          setError("Failed to load snapshot");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load Tender Details");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tenderId]);

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading Tender Details…
      </section>
    );
  }

  if (error || !snapshot) {
    return (
      <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Could not load Tender Details: {error || "Unknown error"}
      </section>
    );
  }

  const { metadata } = snapshot;

  // Derive actions directly from snapshot fields: show only fields that need action
  // - Final-check items (final submission only)
  // - Required-for-final fields (source-driven + legacy criticality) that are missing/invalid
  const fieldsNeedingAction = metadata.fields.filter(f => {
    // Use the source-driven requiredForFinal field (tender-derived) — falls back
    // to legacy criticality for backward compat if the field is undefined.
    const isRequired = f.requiredForFinal ?? (f.criticality === "always-critical");
    const isBlocked = f.blockerReason != null;
    const isMissing = f.status === "INVALID" || f.status === "NOT_STATED";
    return isBlocked || (isRequired && isMissing);
  });

  // If no fields need action AND no generation blocker, show success
  // But if hasExportBlocker is true, ALWAYS show the panel with blockers
  if (fieldsNeedingAction.length === 0 && !metadata.hasExportBlocker) {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-700">
        All critical Tender Details are present and valid. No additional resolution required.
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="tender-details-panel">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Tender Details</h3>
            {snapshotRevision && (
              <span className="text-[10px] text-slate-400 font-mono ml-3">rev: {snapshotRevision.slice(0, 8)}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Final submission details to verify before official packaging.
          </p>
        </div>
      </div>

      {metadata.hasExportBlocker && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Tender details incomplete — optional information was omitted from draft output.
        </p>
      )}

      <div className="space-y-1">
        {fieldsNeedingAction.map((field) => {
          const badge = STATUS_BADGE[field.status] ?? STATUS_BADGE.INVALID;
          const isCritical = field.requiredForFinal ?? (field.criticality === "always-critical");

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
                <span
                  className={`rounded px-1.5 py-0.5 font-bold text-[9px] whitespace-nowrap ${badge.classes}`}
                  title={field.blockerReason ?? undefined}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Backward-compat alias — use TenderDetailsPanel in new code.
export const MetadataCompletionPanel = TenderDetailsPanel;
