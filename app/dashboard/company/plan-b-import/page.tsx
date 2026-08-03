"use client";

import { useState } from "react";
import Link from "next/link";

type ImportResult = {
  success: boolean;
  schemaVersion?: string | null;
  trustLevel?: string;
  requireRawText?: boolean;
  experts?: { received: number; created: number; updated: number; skipped: number };
  projects?: { received: number; created: number; updated: number; skipped: number };
  expectedCounts?: { experts?: number | null; projects?: number | null };
  completeness?: {
    experts?: { expected: number; imported: number; missing: number; excess: number; matched: boolean } | null;
    projects?: { expected: number; imported: number; missing: number; excess: number; matched: boolean } | null;
  };
  warnings?: string[];
  importedCounts?: { experts?: number; projects?: number };
  preflightInvalid?: { experts?: number; projects?: number };
  missingCounts?: { experts?: number | null; projects?: number | null };
  validationIssues?: Array<{ path?: string; message?: string; code?: string }>;
  // Defect 5: structured fields the route already returns — surface them in
  // the UI so import and verification results are shown separately.
  requestedTrust?: string;
  persistedTrustRange?: string[];
  evidenceDowngraded?: number;
  documents?: { received: number; created: number; updated: number; skipped: number };
  legalRecords?: { received: number; created: number; updated: number; skipped: number };
  financialRecords?: { received: number; created: number; updated: number; skipped: number };
  complianceRecords?: { received: number; created: number; updated: number; skipped: number };
  companyProfileUpdated?: boolean;
  enforceExpectedCounts?: boolean;
};

const exampleJson = `{
  "schemaVersion": "hope-plan-b-v1",
  "importPolicy": {
    "trustLevel": "REVIEWED",
    "requireRawText": true,
    "reviewNotes": "Exact Plan B import from uploaded PDF source text."
  },
  "completenessPolicy": { "enforceExpectedCounts": true },
  "sourceDocuments": [
    { "fileName": "Expert CVS.pdf", "type": "Expert CV library", "parsedExperts": 25 },
    { "fileName": "Projects Reference.pdf", "type": "Project portfolio", "parsedProjects": 114 }
  ],
  "expectedCounts": { "experts": 25, "projects": 114 },
  "experts": [
    {
      "fullName": "Exact expert name from PDF",
      "title": "Exact title from CV",
      "yearsExperience": 20,
      "disciplines": ["Architecture", "Urban Planning"],
      "sectors": ["Healthcare", "Commercial"],
      "certifications": [],
      "rawText": "FULL RAW CV TEXT BLOCK COPIED FROM THE PDF — not a summary.",
      "sourceDocument": "Expert CVS.pdf",
      "sourcePages": { "start": 1, "end": 9 }
    }
  ],
  "projects": [
    {
      "name": "Exact project name from PDF",
      "clientName": "Exact client from PDF",
      "country": "Ethiopia",
      "sector": "Healthcare",
      "serviceAreas": ["Design", "Supervision"],
      "rawText": "FULL RAW PROJECT RECORD TEXT COPIED FROM THE PDF — not a summary.",
      "sourceDocument": "Projects Reference.pdf",
      "sourceNo": 1
    }
  ]
}`;

// Defect 5: split the warnings array into import-level and verification-level
// buckets so the UI can show them as two distinct lists.
function splitWarnings(warnings: string[] | undefined): {
  importWarnings: string[];
  verificationWarnings: string[];
} {
  if (!warnings || warnings.length === 0) return { importWarnings: [], verificationWarnings: [] };
  const importWarnings: string[] = [];
  const verificationWarnings: string[] = [];
  // Verification warnings are strings that mention a specific record type
  // and the phrase "could not be source-verified" (the downgraded-to-AI_DRAFT
  // message the route emits when decidePlanBTrust returns ok=false).
  const verificationPattern = /^(Expert|Project|Legal record|Financial record|Compliance record)\b.*could not be source-verified/i;
  for (const w of warnings) {
    if (verificationPattern.test(w)) {
      verificationWarnings.push(w);
    } else {
      importWarnings.push(w);
    }
  }
  return { importWarnings, verificationWarnings };
}

function CountRow({ label, counts }: { label: string; counts?: { received: number; created: number; updated: number; skipped: number } }) {
  if (!counts) return null;
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 pr-4 text-sm text-slate-700">{label}</td>
      <td className="py-2 px-2 text-right text-sm tabular-nums text-slate-600">{counts.received}</td>
      <td className="py-2 px-2 text-right text-sm tabular-nums text-emerald-700">{counts.created}</td>
      <td className="py-2 px-2 text-right text-sm tabular-nums text-blue-700">{counts.updated}</td>
      <td className="py-2 pl-2 text-right text-sm tabular-nums text-amber-700">{counts.skipped}</td>
    </tr>
  );
}

export default function PlanBImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit() {
    setLoading(true);
    setError("");
    setErrorDetails(null);
    setResult(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/company/plan-b-import", { method: "POST", body: form });
      } else {
        if (!text.trim()) throw new Error("Upload a JSON file or paste JSON first.");
        JSON.parse(text);
        res = await fetch("/api/company/plan-b-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorDetails(data);
        throw new Error(data.error || "Plan B import failed");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan B import failed");
    } finally {
      setLoading(false);
    }
  }

  const { importWarnings, verificationWarnings } = splitWarnings(result?.warnings);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan B exact extraction</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Exact JSON Knowledge Import</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Use this when the app PDF parser fails or misses details. Upload a structured JSON file produced from exact PDF text blocks. The raw text becomes the factual source; structured fields are only an index.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/company/review" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Automatic Verification</Link>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Knowledge Vault</Link>
        </div>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h2 className="font-semibold">Strict Plan B rules</h2>
        <ul className="mt-2 list-disc space-y-1 break-words pl-5">
          <li>Do not upload summaries as the source of truth.</li>
          <li>Each CV must include the full raw CV text block in <code>rawText</code>.</li>
          <li>Each project must include the full raw project record text in <code>rawText</code>.</li>
          <li>The import rejects records without enough raw text unless <code>requireRawText</code> is set to false.</li>
          <li>Imported records can be marked REVIEWED only because the exact raw source text is preserved in the record.</li>
          <li>Set <code>completenessPolicy.enforceExpectedCounts=true</code> to block imports when expected and imported counts do not match.</li>
          <li>When strict enforcement is enabled, provide <code>expectedCounts.experts</code> and/or <code>expectedCounts.projects</code>.</li>
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Upload exact extracted JSON</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label htmlFor="plan-b-import-json-file" className="block text-sm font-medium text-slate-700">JSON file</label>
            <input
              id="plan-b-import-json-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-xl border bg-white px-3 py-3 text-sm"
            />
            {file && <p className="text-xs text-slate-500">Selected: {file.name}</p>}
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Or paste JSON</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste exact Plan B JSON here..."
              className="h-40 w-full rounded-xl border px-3 py-3 text-sm font-mono"
            />
          </div>
        </div>
        <button
          onClick={() => void submit()}
          disabled={loading}
          className="mt-5 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? "Importing exact knowledge…" : "Import Plan B Knowledge"}
        </button>
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">{error}</p>
            {errorDetails?.expectedCounts ? (
              <p className="mt-2">
                Expected — experts: {errorDetails.expectedCounts.experts ?? "n/a"}, projects: {errorDetails.expectedCounts.projects ?? "n/a"}.
                Imported — experts: {errorDetails.importedCounts?.experts ?? "n/a"}, projects: {errorDetails.importedCounts?.projects ?? "n/a"}.
                Missing — experts: {errorDetails.missingCounts?.experts ?? "n/a"}, projects: {errorDetails.missingCounts?.projects ?? "n/a"}.
                Invalid preflight records — experts: {errorDetails.preflightInvalid?.experts ?? "n/a"}, projects: {errorDetails.preflightInvalid?.projects ?? "n/a"}.
              </p>
            ) : null}
            {errorDetails?.validationIssues?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {errorDetails.validationIssues.slice(0, 8).map((issue, idx) => (
                  <li key={`${issue.path ?? "root"}-${idx}`}>
                    <span className="font-semibold">{issue.path || "payload"}:</span> {issue.message || issue.code || "Invalid value"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {result && (
          <div className="mt-6 space-y-5">
            {/* Defect 5: separate Import results and Verification results panels. */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <h3 className="font-semibold">Import results</h3>
              <p className="mt-1 text-emerald-800">
                {result.companyProfileUpdated ? "Company profile updated. " : ""}
                Requested trust: <span className="font-mono">{result.requestedTrust ?? "—"}</span>.
                Persisted trust range: <span className="font-mono">{result.persistedTrustRange?.join(" / ") ?? "—"}</span>.
              </p>
              <table className="mt-3 w-full">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-4 font-medium">Record type</th>
                    <th className="py-1 px-2 text-right font-medium">Received</th>
                    <th className="py-1 px-2 text-right font-medium">Created</th>
                    <th className="py-1 px-2 text-right font-medium">Updated</th>
                    <th className="py-1 pl-2 text-right font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  <CountRow label="Documents" counts={result.documents} />
                  <CountRow label="Experts" counts={result.experts} />
                  <CountRow label="Projects" counts={result.projects} />
                  <CountRow label="Legal records" counts={result.legalRecords} />
                  <CountRow label="Financial records" counts={result.financialRecords} />
                  <CountRow label="Compliance records" counts={result.complianceRecords} />
                </tbody>
              </table>
              {result.completeness?.experts ? (
                <p className={`mt-3 ${result.completeness.experts.matched ? "text-emerald-800" : "text-amber-800"}`}>
                  Expert completeness: expected {result.completeness.experts.expected}, imported {result.completeness.experts.imported}, missing {result.completeness.experts.missing}, excess {result.completeness.experts.excess}.
                </p>
              ) : null}
              {result.completeness?.projects ? (
                <p className={`mt-1 ${result.completeness.projects.matched ? "text-emerald-800" : "text-amber-800"}`}>
                  Project completeness: expected {result.completeness.projects.expected}, imported {result.completeness.projects.imported}, missing {result.completeness.projects.missing}, excess {result.completeness.projects.excess}.
                </p>
              ) : null}
              {importWarnings.length > 0 ? (
                <div className="mt-3">
                  <p className="font-semibold text-amber-900">Import warnings ({importWarnings.length})</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-800">
                    {importWarnings.slice(0, 30).map((w, idx) => (
                      <li key={`iw-${idx}`}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <h3 className="font-semibold">Verification results</h3>
              <p className="mt-1 text-blue-800">
                Evidence downgraded: <span className="font-mono">{result.evidenceDowngraded ?? 0}</span> record(s) could not be source-verified against stored bytes and were persisted as AI_DRAFT.
              </p>
              {verificationWarnings.length > 0 ? (
                <div className="mt-3">
                  <p className="font-semibold text-blue-900">Records downgraded to AI_DRAFT ({verificationWarnings.length})</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-blue-800">
                    {verificationWarnings.slice(0, 30).map((w, idx) => (
                      <li key={`vw-${idx}`}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-blue-700">
                    To source-verify a downgraded record, upload the source document it came from through the Company Vault. The Engine will re-run source verification automatically — no manual approval step required.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-blue-700">
                  All imported records with a linked source document were source-verified against the official bytes. Records without a linked source document stayed at AI_DRAFT.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Required JSON shape</h2>
        <pre className="mt-4 max-h-[520px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{exampleJson}</pre>
      </section>
    </div>
  );
}
