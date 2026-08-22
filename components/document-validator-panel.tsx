// Document Validator Panel — server component.
//
// Per-document machine quality/blocker panel. For each CURRENT generated
// document it shows the Clean / Review / Blocked verdict, the concrete issues
// the machine checks found (placeholders, AI traces, pricing leakage into the
// technical envelope, empty body, missing sections, ...), the stored machine
// validation status, and the recommended fix.
//
// TRUTH SOURCE — do not reintroduce local checks here.
// This panel used to (a) select documents with `generationStatus != SUPERSEDED`
// and (b) run its own inline regex checks. Both differed from the export gate,
// so the panel could report "Technical Proposal.pdf — CLEAN, Warning 0,
// Blocked 0" for a tender whose Export Readiness said
// GENERATED_DOCUMENT_QUALITY_FAILED. Selection and assessment now both come
// from lib/engine/current-document-quality.ts, the same module
// lib/engine/final-submission-readiness.ts scores with, so the two surfaces
// cannot disagree.
//
// This panel reports MACHINE validation only. Human/legal/owner approval
// (reviewStatus) is displayed but never inferred, never granted, and never
// written here.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { CheckIcon, WarningIcon, CrossIcon } from "./icons";
import {
  selectCurrentDocuments,
  resolveCurrentDocumentVerdicts,
} from "../lib/engine/current-document-quality";

function validationBadge(status: string | null) {
  const s = (status ?? "").toUpperCase();
  if (s === "PASSED" || s === "VALIDATED") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Validated</span>;
  if (s === "FAILED") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Failed</span>;
  if (s === "NEEDS_REVALIDATION") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Needs revalidation</span>;
  if (s === "PENDING" || s === "") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Pending</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{status}</span>;
}

function scoreBadge(score: "GOOD" | "WARNING" | "BLOCKED") {
  if (score === "GOOD") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckIcon /> Clean</span>;
  if (score === "WARNING") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"><WarningIcon /> Review</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><CrossIcon /> Blocked</span>;
}

// Plain-language remediation for each issue the machine checks can raise.
// Non-coder friendly: says exactly what to fix and why.
const FIX_ADVICE: Record<string, string> = {
  EMPTY_BODY: "Click Generate to create this document from the tender requirements, or Attach to upload the real file.",
  TOO_SHORT: "Regenerate this document — the content is far below the length this document kind needs.",
  MISSING_REQUIRED_SECTION: "Add the missing sections, then regenerate or edit the document.",
  PLACEHOLDER: "Remove all placeholder text before export. These strings will be visible to evaluators.",
  BID_TEAM_TO_CONFIRM: "Confirm the underlying tender facts, then regenerate. Internal placeholders must never be submitted.",
  AI_TRACE: "Remove AI self-references. Regenerate the affected section with the current provider chain.",
  PRICING_LEAKAGE: "Move pricing content into the financial envelope. It must not appear in a technical document.",
  ENVELOPE_MISMATCH: "Move this content into the correct envelope before export.",
  INTERNAL_TRACEABILITY: "Strip internal traceability text (source ids, evidence ids, match scores) before submission.",
  GENERIC_FILLER: "Replace generic marketing language with tender-specific content.",
  UNSUPPORTED_CLAIM_RISK: "Verify the numeric claims against reviewed evidence, or remove them.",
  DUPLICATED_SECTIONS: "Deduplicate the repeated headings — the document was likely regenerated without dedupe.",
  MISSING_REQUIREMENT_COVERAGE: "Cover the tender's mandatory requirements explicitly in this document.",
  MISSING_EVIDENCE_REFERENCE: "Reference the selected experts/projects so the evaluator can trace the evidence.",
  MISSING_TITLE_OR_COVER: "Add the title/cover block the tender expects.",
  OFFICIAL_ORIGINAL_PLACEHOLDER_RISK: "This must be the tender-issued original — a generated stand-in cannot be submitted.",
  QUALITY_WARNING: "Review this document before export.",
};

function adviceFor(code: string): string | null {
  return FIX_ADVICE[code] ?? null;
}

export async function DocumentValidatorPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  // Verify ownership via the tender then load docs separately to keep the
  // query simple and avoid selecting fileContent on the tender row.
  const ownsTender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } }).catch(() => null);
  if (!ownsTender) return null;

  // Load broadly, then narrow with the SAME canonical current-document
  // selection the export gate uses. Superseded, replaced, stale, queued,
  // control and internal-draft rows stay auditable in the database but are
  // never counted as current outputs here.
  const allDocs = await prisma.generatedDocument.findMany({
    where: { tenderId },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      exactFileName: true,
      documentType: true,
      format: true,
      generationStatus: true,
      validationStatus: true,
      reviewStatus: true,
      fileContent: true,
      storagePath: true,
    },
  }).catch(() => [] as Array<{
    id: string; name: string; exactFileName: string | null;
    documentType: string; format: string | null; generationStatus: string; validationStatus: string;
    reviewStatus: string; fileContent: string | null; storagePath: string | null;
  }>);

  const docs = selectCurrentDocuments(allDocs);
  const supersededCount = allDocs.length - docs.length;

  if (docs.length === 0) return null;

  const requirements = await prisma.tenderRequirement.findMany({
    where: { tenderId },
    select: { title: true, description: true, priority: true },
  }).catch(() => [] as Array<{ title: string | null; description: string | null; priority: string | null }>);

  const rows = await resolveCurrentDocumentVerdicts(docs, requirements);

  const blockedCount = rows.filter((r) => r.score === "BLOCKED").length;
  const warningCount = rows.filter((r) => r.score === "WARNING").length;
  const goodCount = rows.filter((r) => r.score === "GOOD").length;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document Validator</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Per-document quality and placeholder check</h2>
          <p className="mt-1 text-sm text-slate-600">
            Runs the same machine quality checks Export Readiness uses, over the same current documents.
            Documents marked Blocked must be fixed before export. This is machine validation only — owner and
            legal approval are recorded separately.
          </p>
          {supersededCount > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {supersededCount} historical/superseded record(s) are kept for audit and are not counted here.
            </p>
          )}
        </div>
        <div className="flex gap-3 text-center">
          <div className="rounded-xl border bg-emerald-50 px-4 py-2">
            <p className="text-xs text-emerald-600">Clean</p>
            <p className="text-xl font-bold text-emerald-700">{goodCount}</p>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-2">
            <p className="text-xs text-amber-600">Warning</p>
            <p className="text-xl font-bold text-amber-800">{warningCount}</p>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-2">
            <p className="text-xs text-red-600">Blocked</p>
            <p className="text-xl font-bold text-red-700">{blockedCount}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map(({ doc, report, reasons, score }) => (
          <div
            key={doc.id}
            className={`rounded-xl border p-4 ${
              score === "BLOCKED" ? "border-red-200 bg-red-50" :
              score === "WARNING" ? "border-amber-200 bg-amber-50" :
              "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{doc.exactFileName ?? doc.name}</p>
                <p className="text-xs text-slate-500">
                  {doc.documentType ?? "—"} · {doc.generationStatus ?? "—"} · quality score {report.score}/100
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {scoreBadge(score)}
                {validationBadge(doc.validationStatus)}
              </div>
            </div>

            {reasons.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="text-xs">
                    <span className={reason.severity === "HIGH" ? "font-semibold text-red-700" : "font-semibold text-amber-800"}>
                      {reason.code.replace(/_/g, " ")}
                    </span>
                    <span className={reason.severity === "HIGH" ? " text-red-700" : " text-amber-800"}> — {reason.message}</span>
                    {adviceFor(reason.code) && (
                      <span className="block text-slate-600">{adviceFor(reason.code)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {report.notes.map((note: string) => (
              <p key={note} className="mt-1 text-xs text-slate-600">{note}</p>
            ))}

            {score === "GOOD" && reasons.length === 0 && (
              <p className="mt-1 text-xs text-emerald-700">
                Machine validation found no placeholder, AI-trace, envelope or completeness issue in this document.
              </p>
            )}
          </div>
        ))}
      </div>

      {blockedCount > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>{blockedCount} document(s) have blocking issues.</strong> These are the same documents Export Readiness
          counts as quality-failed, and they must be resolved before the Final Package Manifest will show them as
          export-ready. Use Regenerate Section or manually edit the document content.
        </div>
      )}
    </section>
  );
}
