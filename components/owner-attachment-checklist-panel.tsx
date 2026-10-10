"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";

type Item = {
  order: number;
  kind: string;
  document: string;
  source: { requirementTitle: string | null; page: number | null; quote: string | null };
  copyType: string;
  signatureRequired: boolean;
  stampRequired: boolean;
  copies: number | null;
  envelope: string;
  location: string;
  vault: { status: string; documents: string[] };
  status: "PACKAGED_AUTOMATICALLY" | "OWNER_TO_ATTACH";
  ownerAction: string;
};
type Checklist = { mode: "COMBINED_FILE" | "SEPARATE_ATTACHMENTS" | "NONE"; combinedFileName: string | null; items: Item[]; outstanding: number };

const STATUS_LABEL: Record<string, string> = {
  SUBMISSION_READY: "Submission ready",
  PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED: "PROPOSAL COMPLETE — OWNER ATTACHMENTS REQUIRED",
  IN_PROGRESS: "Proposal in progress",
};

const VAULT_LABEL: Record<string, string> = {
  VERIFIED_PDF_ORIGINAL: "In Vault (verified PDF)",
  HELD_NOT_VERIFIED_PDF: "In Vault, not as a verified PDF original",
  NOT_IN_VAULT: "Not in Vault",
  NOT_APPLICABLE: "Tender form",
};

export function OwnerAttachmentChecklistPanel({ tenderId }: { tenderId: string }) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [packageStatus, setPackageStatus] = useState<string | null>(null);
  const [strictTwoEnvelope, setStrictTwoEnvelope] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listRes, readyRes] = await Promise.all([
        fetch(`/api/tenders/${tenderId}/owner-attachments`, { cache: "no-store" }),
        fetch(`/api/tenders/${tenderId}/export-readiness`, { cache: "no-store" }),
      ]);
      const list = await listRes.json().catch(() => ({}));
      const ready = await readyRes.json().catch(() => ({}));
      if (!listRes.ok) throw new Error(list.error ?? "Failed to load the checklist");
      setChecklist(list.checklist);
      setPackageStatus(ready.packageStatus ?? null);
      setStrictTwoEnvelope(Boolean(ready.exportReadiness?.summary?.strictTwoEnvelope));
    } catch {
      setError("Failed to load the owner attachment checklist.");
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void load(); }), [load, tenderId]);

  if (!checklist) {
    return error ? <p className="text-sm text-rose-700" role="alert">{error}</p> : null;
  }
  if (checklist.mode === "NONE" && packageStatus !== "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED") return null;

  const proposalComplete = packageStatus === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED";
  const zipBase = `/api/tenders/${tenderId}/download?type=zip&scope=proposal`;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="owner-attachments-heading" data-testid="owner-attachment-checklist">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="owner-attachments-heading" className="text-base font-semibold text-slate-900">Owner Attachment Checklist</h3>
          <p className="text-xs text-slate-500">
            The originals the tender requires that the app does not produce. You do not need to upload them to the app;
            {checklist.mode === "COMBINED_FILE" ? ` insert them into "${checklist.combinedFileName}" in this order, or upload a verified PDF to the Company Vault and it is bound in automatically.` : " attach them to the submission in this order."}
          </p>
        </div>
        {packageStatus ? (
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${packageStatus === "SUBMISSION_READY" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : proposalComplete ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 bg-slate-50 text-slate-700"}`} data-testid="package-status">
            {STATUS_LABEL[packageStatus] ?? packageStatus}
          </span>
        ) : null}
      </div>

      {checklist.items.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {checklist.items.map((item) => (
            <li key={`${item.order}-${item.kind}`} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{item.order}. {item.kind}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${item.status === "PACKAGED_AUTOMATICALLY" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                  {item.status === "PACKAGED_AUTOMATICALLY" ? "Packaged" : "Owner to attach"}
                </span>
              </div>
              <div className="mt-1 text-slate-700">{item.document}</div>
              <dl className="mt-1 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
                <div><dt className="inline font-medium">Source:</dt> <dd className="inline">{item.source.requirementTitle ?? "Tender requirement"}{item.source.page ? `, page ${item.source.page}` : ""}</dd></div>
                <div><dt className="inline font-medium">Copy:</dt> <dd className="inline">{item.copyType.replace(/_/g, " ").toLowerCase()}{item.signatureRequired ? ", signed" : ""}{item.stampRequired ? ", stamped" : ""}{item.copies ? `, ${item.copies} copies` : ""}</dd></div>
                <div><dt className="inline font-medium">Goes:</dt> <dd className="inline">{item.location}</dd></div>
                <div><dt className="inline font-medium">Company Vault:</dt> <dd className="inline">{VAULT_LABEL[item.vault.status] ?? item.vault.status}{item.vault.documents.length ? ` (${item.vault.documents.join(", ")})` : ""}</dd></div>
              </dl>
              {item.source.quote ? <blockquote className="mt-1 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">{item.source.quote.slice(0, 280)}</blockquote> : null}
              <p className="mt-1 text-xs font-medium text-slate-800">{item.ownerAction}</p>
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-slate-600">The tender requires no original the app does not produce.</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a className="rounded border border-slate-300 px-3 py-1.5" href={`/api/tenders/${tenderId}/owner-attachments?format=text`}>Download checklist</a>
        {proposalComplete ? (
          strictTwoEnvelope ? (
            <>
              <a className="rounded bg-slate-900 px-3 py-1.5 text-white" href={`${zipBase}&envelope=technical`} data-testid="download-proposal-technical">Download proposal — technical envelope</a>
              <a className="rounded bg-slate-900 px-3 py-1.5 text-white" href={`${zipBase}&envelope=financial`} data-testid="download-proposal-financial">Download proposal — financial envelope</a>
            </>
          ) : (
            <a className="rounded bg-slate-900 px-3 py-1.5 text-white" href={zipBase} data-testid="download-proposal">Download proposal for assembly</a>
          )
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
