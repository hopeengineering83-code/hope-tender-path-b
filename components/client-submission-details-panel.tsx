"use client";

import { useState, useEffect } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";
import { CheckCircleIcon, AlertCircleIcon, ClockIcon } from "./icons";

/**
 * Client & Submission Details Panel
 *
 * Consumes the unified ReleaseSnapshot.
 * Rule 2 & 3: Critical metadata must be source-grounded.
 */
export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
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

  if (loading) return <div className="animate-pulse h-40 bg-slate-100 rounded-2xl" />;
  if (!snapshot) return null;

  const fields = snapshot.metadata.fields;

  return (
    <section className="space-y-4 p-5 border border-slate-200 rounded-2xl bg-white shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Client & Submission Details</h3>
      <p className="text-sm text-slate-600">
        Key fields for release eligibility. Critical fields require verified tender-source evidence.
      </p>

      <div className="space-y-3">
        {fields.map(field => (
          <div key={field.fieldKey} className="p-4 border rounded-xl bg-slate-50 flex items-start gap-4">
            <div className="mt-1">
              {field.isValid && field.isGrounded ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
              ) : field.criticality !== "non-critical" ? (
                <AlertCircleIcon className="w-5 h-5 text-red-500" />
              ) : (
                <ClockIcon className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{field.label}</span>
                {field.criticality !== "non-critical" && (
                  <span className="text-[10px] font-black uppercase text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">Critical</span>
                )}
              </div>
              <div className="mt-1 text-sm text-slate-800 break-words font-medium">
                {field.effectiveValue || <span className="text-slate-400 italic">Not detected</span>}
              </div>

              {field.blockerReason && (
                <div className="mt-2 text-xs text-red-700 bg-red-50/50 p-2 rounded-lg border border-red-100">
                  <strong>Blocker:</strong> {field.blockerReason}
                </div>
              )}

              {field.isGrounded && field.sourcePage && (
                <div className="mt-2 text-[10px] text-emerald-700 font-medium">
                  ✓ Grounded: Page {field.sourcePage} &middot; &quot;{field.sourceQuote?.slice(0, 40)}...&quot;
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
