"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import type { CanonicalFieldState, CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { CANONICAL_FIELD_STATUS_BADGE as STATUS_BADGE } from "./canonical-field-status-badge";

// A manually entered deadline must be in an unambiguous format. Mirrors the
// server-side date guard so the user gets immediate feedback before saving.
function isAmbiguousDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false; // ISO is unambiguous
  const m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}$/);
  if (m) return parseInt(m[1], 10) <= 12 && parseInt(m[2], 10) <= 12;
  return false;
}

// Maps a server-permitted action token to the override fieldState the
// metadata-override API expects. The DISPLAY status is never computed here —
// it always comes from the canonical snapshot. These actions only WRITE intent.
//
// Authority model: the reason is now a PLACEHOLDER — the actual reason must
// be typed by the user in the AuditReasonModal. The server rejects boilerplate
// reasons for critical fields (isMeaningfulReason). These placeholders are only
// used when the user leaves the reason blank (which the server will reject for
// critical fields, showing a meaningful error).
const ACTION_FIELD_STATE: Record<string, { fieldState: string; reason: string }> = {
  confirm:        { fieldState: "USER_CONFIRMED",      reason: "" },
  not_applicable: { fieldState: "NOT_APPLICABLE",      reason: "" },
  not_stated:     { fieldState: "IGNORED_WITH_REASON", reason: "" },
};

// The confirmation bases the user can select in the AuditReasonModal.
// Must match CONFIRMATION_BASES in lib/engine/tender-fact-authority.ts.
const CONFIRMATION_BASIS_OPTIONS = [
  { value: "PROCUREMENT_NOTICE", label: "Procurement notice" },
  { value: "EMAIL_INVITATION", label: "Email invitation" },
  { value: "PORTAL_LISTING", label: "Portal listing" },
  { value: "PHONE_CALL_WITH_CLIENT", label: "Phone call with client" },
  { value: "CLIENT_INSTRUCTION", label: "Client instruction" },
  { value: "PRE_BID_MEETING", label: "Pre-bid meeting" },
  { value: "CLARIFICATION_DOCUMENT", label: "Clarification document" },
  { value: "PRIOR_KNOWLEDGE_OF_CLIENT", label: "Prior knowledge of client" },
  { value: "PUBLIC_REGISTRY", label: "Public registry" },
  { value: "OTHER_DOCUMENTED_SOURCE", label: "Other documented source" },
];

// Authority labels — must match authorityLabel() in lib/engine/tender-fact-authority.ts.
const AUTHORITY_LABELS: Record<string, string> = {
  SOURCE_GROUNDED: "Source-grounded confirmed",
  HUMAN_CONFIRMED_OPERATIONAL: "Human-confirmed operational value",
  NOT_STATED_IN_SOURCE: "Not stated in source",
  UNKNOWN: "Not detected",
  REJECTED_CANDIDATE: "Candidate needs review",
};

function FieldActionMenu({
  field,
  saving,
  onAction,
  canMutate = false,
}: {
  field: CanonicalFieldState;
  saving: boolean;
  onAction: (action: string) => void;
  canMutate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const canEdit = field.permittedActions.includes("edit");
  const canConfirm = field.permittedActions.includes("confirm");
  const canNotApplicable = field.permittedActions.includes("not_applicable");
  const canNotStated = field.permittedActions.includes("not_stated");
  const canReviewSource = field.permittedActions.includes("review_source");

  if (!canEdit && !canConfirm && !canNotApplicable && !canNotStated && !canReviewSource) {
    return null;
  }
  if (!canMutate) {
    return null;
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`More actions for ${field.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="min-h-[44px] min-w-[44px] rounded border border-slate-300 bg-white px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
          {canEdit && (
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("edit"); setOpen(false); }}
            >
              Edit value manually
            </button>
          )}
          {canConfirm && (
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("confirm"); setOpen(false); }}
            >
              Confirm value
            </button>
          )}
          {canNotApplicable && (
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("not_applicable"); setOpen(false); }}
            >
              Mark not applicable
            </button>
          )}
          {canNotStated && (
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("not_stated"); setOpen(false); }}
            >
              Record not found in tender
            </button>
          )}
          {canReviewSource && (
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 text-blue-700 hover:bg-blue-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("review_source"); setOpen(false); }}
            >
              View source page &amp; quote
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientSubmissionDetailsPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  // Authority model: audit modal state (reason + confirmationBasis for critical fields)
  const [pendingAction, setPendingAction] = useState<{ field: CanonicalFieldState; action: string; fieldState: string; overrideValue: string | null } | null>(null);
  const [auditReason, setAuditReason] = useState("");
  const [auditBasis, setAuditBasis] = useState("");

  async function load() {
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
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  // Writes the user's intent through the canonical override API, then re-reads
  // the snapshot so every panel shows the same server-resolved truth. The panel
  // never classifies the field itself — it only records intent and re-fetches.
  async function save(field: CanonicalFieldState, action: string, editedValue?: string) {
    if (action === "review_source") {
      setExpandedSource(expandedSource === field.fieldKey ? null : field.fieldKey);
      return;
    }

    let fieldState: string;
    let overrideValue: string | null = null;
    let reason: string;

    if (action === "edit") {
      const v = (editedValue ?? "").trim();
      if (!v) return;
      if (field.fieldKey === "deadline" && isAmbiguousDate(v)) {
        setError(
          `Deadline format is ambiguous — day and month order cannot be determined from "${v}". ` +
          `Enter an unambiguous date, e.g. "15 Dec 2026" or "2026-12-15".`,
        );
        return;
      }
      fieldState = "USER_EDITED";
      overrideValue = v;
      reason = "Manual value entered by user.";
    } else {
      const mapped = ACTION_FIELD_STATE[action];
      if (!mapped) return;
      fieldState = mapped.fieldState;
      reason = mapped.reason;
    }

    // ─── Authority model: critical fields require audit reason + confirmation basis ──
    // For submission-critical fields (clientName, title, deadline, submissionMethod,
    // submissionEmails, submissionAddress), the server requires a MEANINGFUL reason
    // (not boilerplate) + a confirmationBasis. We open a modal to collect these.
    //
    // For non-critical fields, we use the boilerplate reason and skip the modal.
    const isCriticalField = ["clientName", "title", "deadline", "submissionMethod", "submissionEmails", "submissionAddress"].includes(field.fieldKey);
    if (isCriticalField && (fieldState === "USER_EDITED" || fieldState === "USER_CONFIRMED")) {
      // Open the audit modal instead of saving immediately. The modal will
      // collect the reason + confirmationBasis and then call doSave.
      setPendingAction({ field, action, fieldState, overrideValue });
      return;
    }

    await doSave(field.fieldKey, fieldState, overrideValue, reason, null);
  }

  async function doSave(fieldName: string, fieldState: string, overrideValue: string | null, reason: string, confirmationBasis: string | null) {
    setSaving(fieldName);
    setError("");
    try {
      const body: Record<string, unknown> = { field: fieldName, fieldState, overrideValue, reason };
      if (confirmationBasis) body.confirmationBasis = confirmationBasis;
      const res = await fetch(`/api/tenders/${tenderId}/metadata-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "Failed to save");
      setEditing(null);
      setEditValue("");
      setPendingAction(null);
      setAuditReason("");
      setAuditBasis("");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="text-sm text-slate-500">Loading client details…</div>
      </section>
    );
  }

  if (error && !snapshot) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm sm:p-5">
        <div className="text-sm text-red-700">{error || "Failed to load client details"}</div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm sm:p-5">
        <div className="text-sm text-red-700">Failed to load client details</div>
      </section>
    );
  }

  const { metadata } = snapshot;

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
            Optional tender details used to improve draft output. Missing or ungrounded details do not block draft generation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {metadata.hasExportBlocker && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Tender details incomplete — optional information was omitted from draft output.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-1">
        {metadata.fields.map((field) => {
          const badge = STATUS_BADGE[field.status] ?? STATUS_BADGE.INVALID;
          const isCritical = field.requiredForFinal ?? (field.criticality === "always-critical");
          // Grounding is shown from the canonical isGrounded flag — the
          // resolver's single source of truth. A field counts as sourced
          // only when it has a real page AND a usable quote AND a valid
          // fileId pointing to an ACTIVE tender file. Recomputing this
          // client-side (e.g., page > 0 && quote.length > 5) would diverge
          // from the canonical status badge in the orphaned-fileId edge
          // case (page + quote present but fileId null or points to a
          // deleted file). Using field.isGrounded guarantees the chip and
          // the badge always agree.
          const hasSource = !!field.isGrounded;
          const isEditing = editing === field.fieldKey;
          const isExpanded = expandedSource === field.fieldKey;

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
                      <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                        Final-check item
                      </span>
                    )}
                    {hasSource && (
                      <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-medium text-emerald-600" title={`Page ${field.sourcePage}`}>
                        sourced
                      </span>
                    )}
                  </div>
                  {field.blockerReason && (
                    <p className="mt-0.5 text-[10px] text-red-600">{field.blockerReason}</p>
                  )}
                  {isEditing ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={field.fieldKey === "deadline" ? "e.g. 2026-12-15" : "Enter value"}
                        className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        disabled={saving === field.fieldKey}
                        onClick={() => void save(field, "edit", editValue)}
                        className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditing(null); setEditValue(""); }}
                        className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    field.effectiveValue && (
                      <p className="mt-0.5 text-[10px] text-slate-500 truncate" title={field.effectiveValue}>
                        {field.effectiveValue.length > 80 ? field.effectiveValue.slice(0, 80) + "…" : field.effectiveValue}
                      </p>
                    )
                  )}
                  {isExpanded && hasSource && (
                    <div className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                      <span className="font-semibold">Page {field.sourcePage}:</span> “{field.sourceQuote}”
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-[9px] whitespace-nowrap ${badge.classes}`}
                    title={field.blockerReason ?? undefined}
                  >
                    {badge.label}
                  </span>
                  <FieldActionMenu
                    field={field}
                    saving={saving === field.fieldKey}
                    onAction={(action) => {
                      if (action === "edit") {
                        setEditing(field.fieldKey);
                        setEditValue(field.effectiveValue ?? "");
                      } else {
                        void save(field, action);
                      }
                    }}
                    canMutate={canMutate}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Authority model: audit modal for critical-field manual entries ─── */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Confirm manual entry
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              You are manually entering a value for <strong>{pendingAction.field.label}</strong>,
              which is required for final submission. Please provide a meaningful reason and
              the source of this information so the audit trail is clear.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Value
                </label>
                <input
                  type="text"
                  value={pendingAction.overrideValue ?? ""}
                  readOnly
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reason (required, min 10 characters)
                </label>
                <textarea
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  placeholder="e.g. Client confirmed the deadline during the pre-bid meeting on 2026-07-05."
                  rows={3}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Confirmation basis (required)
                </label>
                <select
                  value={auditBasis}
                  onChange={(e) => setAuditBasis(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  <option value="">Select a source…</option>
                  {CONFIRMATION_BASIS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingAction(null);
                  setAuditReason("");
                  setAuditBasis("");
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={auditReason.trim().length < 10 || !auditBasis || saving !== null}
                onClick={() => {
                  if (!pendingAction) return;
                  void doSave(
                    pendingAction.field.fieldKey,
                    pendingAction.fieldState,
                    pendingAction.overrideValue,
                    auditReason.trim(),
                    auditBasis,
                  );
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Confirm & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
