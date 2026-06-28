"use client";

import { useState, useEffect } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";
import { AlertCircleIcon, CheckCircleIcon, ClockIcon } from "./icons";

/**
 * Metadata Completion Panel
 *
 * Consumes the unified ReleaseSnapshot to display critical fields
 * and their provenance/grounding status.
 */
export function MetadataCompletionPanel({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSnapshot() {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/release-snapshot`);
        const data = await res.json();
        if (data.ok) setSnapshot(data.snapshot);
      } catch (err) {
        console.error("Failed to fetch snapshot:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSnapshot();
  }, [tenderId]);

  if (loading) return <div className="animate-pulse h-32 bg-slate-100 rounded-xl" />;
  if (!snapshot) return null;

  const criticalFields = snapshot.metadata.fields.filter(f => f.criticality !== "non-critical");

  return (
    <section className="space-y-4 p-5 border border-slate-200 rounded-2xl bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Submission-Critical Metadata</h3>
        <span className="text-sm text-slate-500">Revision: {snapshot.revision.slice(0, 8)}</span>
      </div>

      <p className="text-sm text-slate-600">
        Record a candidate value or resolve from a tender source. Critical fields remain blocked until source-grounded.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {criticalFields.map(field => (
          <div key={field.fieldKey} className="p-3 border rounded-xl bg-slate-50 flex items-start gap-3">
            <div className="mt-0.5">
              {field.isValid && field.isGrounded ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
              ) : field.status === "BLOCKED" || field.blockerReason ? (
                <AlertCircleIcon className="w-5 h-5 text-red-500" />
              ) : (
                <ClockIcon className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{field.label}</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                {field.effectiveValue || "Missing"}
              </div>
              {field.blockerReason && (
                <div className="mt-1 text-xs text-red-600 leading-relaxed font-medium">
                  {field.blockerReason}
                </div>
              )}
              {!field.isGrounded && field.isValid && (
                <div className="mt-1 text-xs text-amber-600 font-medium">
                  Ungrounded candidate. Link to tender source to unblock.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
