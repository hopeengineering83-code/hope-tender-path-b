// Document Validator Panel — server component.
//
// Per-document quality/blocker panel. Shows for each generated document:
//   - quality score (from proposal-quality-scorer when markdown content exists)
//   - placeholder detection (MISSING_SOURCE, Bid-Team, [TBD], etc.)
//   - AI-trace language detection
//   - empty/shallow section detection
//   - envelope mismatch detection
//   - validation status + recommended fix
//
// Renders as a table of documents with inline blocker detail.
// Non-coder friendly: tells users exactly what to fix and why.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { CheckIcon, WarningIcon, CrossIcon } from "./icons";
// Inline document-level pattern checks (superset of metadata patterns).
// Kept here rather than importing from validate.ts to avoid pulling in
// the full DB-coupled validateTender function.
const PLACEHOLDER_RE = [
  /\[insert [^\]]+\]/i,
  /\{[^}]+\}/,
  /\bTODO\b/,
  /\bXXX\b/,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\bplaceholder\b/i,
  /Bid-Team\s+to\s+confirm/i,
  /Bid-Team\s+Action/i,
  /Not\s+extracted\s*[—–-]\s*confirm\s+manually/i,
  /MISSING_SOURCE/,
  /\[CLIENT(?:\s+TO\s+BE\s+CONFIRMED)?\]/i,
];

const AI_TRACE_RE = [
  /as an ai/i,
  /language model/i,
  /\bi cannot\b/i,
  /\bas a large language\b/i,
  /I don'?t have access/i,
  /I'?m sorry,? I/i,
];

const EMPTY_SECTION_RE = /^#+\s+.+\n+(?:\n|$)/m;
const FINANCIAL_IN_TECHNICAL_RE = /unit price|rate card|price schedule|BOQ|bill of quantities|tax.*rate|vat.*\d/i;
const TECHNICAL_IN_FINANCIAL_RE = /methodology|work plan|staffing plan|technical approach/i;

function checkDocument(doc: {
  name: string;
  exactFileName: string | null;
  documentType: string | null;
  fileContent: string | null;
  storagePath: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  generationStatus: string | null;
}): {
  hasContent: boolean;
  placeholders: string[];
  aiTrace: string[];
  envelopeMismatch: string | null;
  isEmpty: boolean;
  qualityWarnings: string[];
  score: "GOOD" | "WARNING" | "BLOCKED";
} {
  const hasContent = Boolean(
    (doc.fileContent ?? "").trim().length > 0 || (doc.storagePath ?? "").trim().length > 0,
  );

  // Can only inspect text content — base64 DOCX/PDF content is opaque
  // at this layer. If content looks like base64, skip pattern checks.
  const isBase64Like = /^[A-Za-z0-9+/]{40,}={0,2}$/.test((doc.fileContent ?? "").slice(0, 100));
  const text = isBase64Like ? "" : (doc.fileContent ?? "");

  const placeholders = hasContent && text
    ? PLACEHOLDER_RE.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const aiTrace = hasContent && text
    ? AI_TRACE_RE.filter((re) => re.test(text)).map((re) => re.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 40))
    : [];

  const dtype = (doc.documentType ?? "").toUpperCase();
  let envelopeMismatch: string | null = null;
  if (text && dtype === "TECHNICAL" && FINANCIAL_IN_TECHNICAL_RE.test(text)) {
    envelopeMismatch = "Financial pricing content detected in a TECHNICAL document";
  } else if (text && dtype === "FINANCIAL" && TECHNICAL_IN_FINANCIAL_RE.test(text)) {
    envelopeMismatch = "Technical methodology content detected in a FINANCIAL document";
  }

  const isEmpty = !hasContent || (text.length > 0 && text.trim().length < 50);
  const qualityWarnings: string[] = [];
  if (text && EMPTY_SECTION_RE.test(text)) qualityWarnings.push("Empty section headings detected");
  if (text && text.length > 0 && text.length < 200) qualityWarnings.push("Document content is very short — may be incomplete");

  const blocked = placeholders.length > 0 || aiTrace.length > 0 || isEmpty || envelopeMismatch != null;
  const warned = qualityWarnings.length > 0;
  const score = blocked ? "BLOCKED" : warned ? "WARNING" : "GOOD";

  return { hasContent, placeholders, aiTrace, envelopeMismatch, isEmpty, qualityWarnings, score };
}

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

export async function DocumentValidatorPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  // Verify ownership via the tender then load docs separately to keep the
  // query simple and avoid selecting fileContent on the tender row.
  const ownsTender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } }).catch(() => null);
  if (!ownsTender) return null;

  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      exactFileName: true,
      documentType: true,
      generationStatus: true,
      validationStatus: true,
      reviewStatus: true,
      fileContent: true,
      storagePath: true,
    },
  }).catch(() => [] as Array<{
    id: string; name: string; exactFileName: string | null;
    documentType: string; generationStatus: string; validationStatus: string;
    reviewStatus: string; fileContent: string | null; storagePath: string | null;
  }>);

  if (docs.length === 0) return null;

  const rows = docs.map((doc) => ({
    doc,
    check: checkDocument(doc),
  }));

  const blockedCount = rows.filter((r) => r.check.score === "BLOCKED").length;
  const warningCount = rows.filter((r) => r.check.score === "WARNING").length;
  const goodCount = rows.filter((r) => r.check.score === "GOOD").length;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document Validator</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Per-document quality and placeholder check</h2>
          <p className="mt-1 text-sm text-slate-600">
            Checks each generated document for placeholders, AI-trace language, empty sections, and envelope mismatches.
            Documents marked BLOCKED must be fixed before export.
          </p>
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
        {rows.map(({ doc, check }) => (
          <div
            key={doc.id}
            className={`rounded-xl border p-4 ${
              check.score === "BLOCKED" ? "border-red-200 bg-red-50" :
              check.score === "WARNING" ? "border-amber-200 bg-amber-50" :
              "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{doc.exactFileName ?? doc.name}</p>
                <p className="text-xs text-slate-500">{doc.documentType ?? "—"} · {doc.generationStatus ?? "—"}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {scoreBadge(check.score)}
                {validationBadge(doc.validationStatus)}
              </div>
            </div>

            {!check.hasContent && (
              <p className="mt-2 inline-flex items-start gap-1 text-xs text-red-700 font-medium"><WarningIcon className="mt-0.5 shrink-0" /> <span>This document has no content yet. Click &ldquo;Generate&rdquo; to create it from the tender requirements, or &ldquo;Attach&rdquo; to upload an existing file.</span></p>
            )}

            {check.placeholders.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-red-700">Placeholder text detected</p>
                <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-red-700">
                  {check.placeholders.map((p) => <li key={p}>Pattern: <code>{p}</code></li>)}
                </ul>
                <p className="mt-1 text-xs text-red-600">Remove all placeholder text before export. These strings will be visible to evaluators.</p>
              </div>
            )}

            {check.aiTrace.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-red-700">AI-trace language detected</p>
                <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-red-700">
                  {check.aiTrace.map((p) => <li key={p}>Pattern: <code>{p}</code></li>)}
                </ul>
                <p className="mt-1 text-xs text-red-600">Remove AI self-references. Regenerate the affected section with the current provider chain.</p>
              </div>
            )}

            {check.envelopeMismatch && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-amber-800">Envelope mismatch</p>
                <p className="text-xs text-amber-800 mt-0.5">{check.envelopeMismatch}. Move this content to the correct envelope before export.</p>
              </div>
            )}

            {check.qualityWarnings.map((w) => (
              <p key={w} className="mt-1 inline-flex items-start gap-1 text-xs text-amber-800"><WarningIcon className="mt-0.5 shrink-0" /> <span>{w}</span></p>
            ))}

            {check.score === "GOOD" && check.hasContent && (
              <p className="mt-1 text-xs text-emerald-700">No placeholder, AI-trace, or envelope issues detected in inspectable content.</p>
            )}
          </div>
        ))}
      </div>

      {blockedCount > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>{blockedCount} document(s) have blocking issues.</strong> These must be resolved before the Final Package Manifest will show them as export-ready. Use Regenerate Section or manually edit the document content.
        </div>
      )}
    </section>
  );
}
