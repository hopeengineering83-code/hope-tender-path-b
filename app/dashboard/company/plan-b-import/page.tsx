"use client";

import { useState } from "react";
import Link from "next/link";

type RecordCounts = {
  received: number;
  created: number;
  updated: number;
  skipped: number;
};

type LegacyImportResult = {
  success?: boolean;
  error?: string;
  validationIssues?: Array<{ path?: string; message?: string; code?: string }>;
  companyProfileUpdated?: boolean;
  requestedTrust?: string;
  persistedTrustRange?: string[];
  evidenceDowngraded?: number;
  documents?: RecordCounts;
  experts?: RecordCounts;
  projects?: RecordCounts;
  legalRecords?: RecordCounts;
  financialRecords?: RecordCounts;
  complianceRecords?: RecordCounts;
  warnings?: string[];
};

type FinalizeResult = {
  success?: boolean;
  error?: string;
  restored?: { experts: number; projects: number; total: number };
  linked?: { experts: number; projects: number; total: number };
  sourceVerified?: { experts: number; projects: number; total: number };
  activeCounts?: { experts: number; projects: number };
  sourceDescriptorsStaged?: number;
  missingOriginalSources?: number;
  sourceBlocker?: string | null;
  verificationBlocker?: string | null;
};

type CombinedResult = {
  imported: LegacyImportResult;
  finalized: FinalizeResult;
};

const exampleJson = `{
  "schemaVersion": "hope-plan-b-v1",
  "importPolicy": {
    "trustLevel": "SOURCE_VERIFIED",
    "requireRawText": true,
    "reviewNotes": "Exact structured import from source text."
  },
  "completenessPolicy": { "enforceExpectedCounts": true },
  "sourceDocuments": [
    {
      "fileName": "Expert CVs.pdf",
      "sha256": "64-character SHA-256 of the official uploaded file",
      "type": "Expert CV library",
      "parsedExperts": 28
    },
    {
      "fileName": "Project References.pdf",
      "sha256": "64-character SHA-256 of the official uploaded file",
      "type": "Project portfolio",
      "parsedProjects": 114
    }
  ],
  "expectedCounts": { "experts": 28, "projects": 114 },
  "experts": [
    {
      "fullName": "Exact expert name",
      "title": "Exact title",
      "rawText": "Full CV text copied from the source.",
      "sourceDocument": "Expert CVs.pdf"
    }
  ],
  "projects": [
    {
      "name": "Exact project name",
      "clientName": "Exact client",
      "rawText": "Full project record text copied from the source.",
      "sourceDocument": "Project References.pdf"
    }
  ]
}`;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The selected file or pasted content is not valid JSON.");
  }
}

function visibleWarnings(warnings: string[] | undefined): string[] {
  return (warnings ?? []).filter((warning) =>
    !/could not be source-verified.*upload the source document/i.test(warning),
  );
}

function CountRow({
  label,
  counts,
  restored,
}: {
  label: string;
  counts?: RecordCounts;
  restored?: number;
}) {
  if (!counts) return null;
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 pr-4 text-sm font-medium text-slate-700">{label}</td>
      <td className="px-2 py-2 text-right text-sm tabular-nums text-slate-600">{counts.received}</td>
      <td className="px-2 py-2 text-right text-sm tabular-nums text-emerald-700">{counts.created}</td>
      <td className="px-2 py-2 text-right text-sm tabular-nums text-blue-700">{counts.updated}</td>
      <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums text-violet-700">{restored ?? 0}</td>
      <td className="py-2 pl-2 text-right text-sm tabular-nums text-amber-700">{counts.skipped}</td>
    </tr>
  );
}

export default function PlanBImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationIssues, setValidationIssues] = useState<LegacyImportResult["validationIssues"]>([]);
  const [result, setResult] = useState<CombinedResult | null>(null);

  async function readInput(): Promise<{ payload: unknown; rawText: string }> {
    if (file) {
      if (!file.name.toLowerCase().endsWith(".json")) {
        throw new Error("Plan B accepts JSON descriptors only. Upload PDF, DOCX, XLSX, CSV or TXT originals in Company Vault.");
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Plan B JSON exceeds the 10 MB limit.");
      }
      const rawText = await file.text();
      return { payload: safeJson(rawText), rawText };
    }
    if (!text.trim()) throw new Error("Upload a Plan B JSON file or paste JSON first.");
    return { payload: safeJson(text), rawText: text };
  }

  async function submit() {
    if (loading) return;
    setLoading(true);
    setError("");
    setValidationIssues([]);
    setResult(null);

    try {
      const { payload, rawText } = await readInput();
      const importResponse = await fetch("/api/company/plan-b-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawText,
      });
      const imported = await importResponse.json().catch(() => ({})) as LegacyImportResult;
      if (!importResponse.ok || imported.success !== true) {
        setValidationIssues(imported.validationIssues ?? []);
        throw new Error(imported.error || "Plan B import failed.");
      }

      const finalizeResponse = await fetch("/api/company/plan-b-import/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const finalized = await finalizeResponse.json().catch(() => ({})) as FinalizeResult;
      if (!finalizeResponse.ok || finalized.success !== true) {
        throw new Error(finalized.error || "Plan B records were imported, but Vault reconciliation failed.");
      }

      const companyResponse = await fetch("/api/company", { cache: "no-store" });
      if (companyResponse.ok) {
        const company = await companyResponse.json() as {
          expertCount?: number;
          projectCount?: number;
          company?: { expertCount?: number; projectCount?: number };
        };
        const source = company.company ?? company;
        finalized.activeCounts = {
          experts: source.expertCount ?? finalized.activeCounts?.experts ?? 0,
          projects: source.projectCount ?? finalized.activeCounts?.projects ?? 0,
        };
      }

      setResult({ imported, finalized });
      try {
        localStorage.setItem("company-vault-refresh", String(Date.now()));
        window.dispatchEvent(new Event("company-vault-refresh"));
      } catch {
        // Counts above are already refreshed from the server.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan B import failed.");
    } finally {
      setLoading(false);
    }
  }

  const warnings = visibleWarnings(result?.imported.warnings);

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan B structured recovery</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Exact JSON Knowledge Import</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Plan B JSON stages structured descriptors. It never becomes an official Company Vault document. Upload the original PDF, DOCX, XLSX, CSV or TXT file in Company Vault for source verification.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Company Vault</Link>
          <Link href="/dashboard/company/review" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Automatic Verification</Link>
        </div>
      </header>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <h2 className="font-semibold">Plan B authority rules</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><code>sourceDocuments</code> are staging descriptors, not uploaded files.</li>
          <li>Official evidence is linked from tenant-owned VERIFIED CompanyDocuments by SHA-256 first, normalized filename second.</li>
          <li>One official source may verify many experts or projects.</li>
          <li>Matching soft-deleted experts and projects are restored automatically.</li>
          <li>Records without an original source remain AI_DRAFT and produce one company-level blocker.</li>
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Import Plan B JSON</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="plan-b-json" className="block text-sm font-medium text-slate-700">JSON file</label>
            <input
              id="plan-b-json"
              type="file"
              accept="application/json,.json"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-xl border bg-white px-3 py-3 text-sm"
            />
            {file ? <p className="text-xs text-slate-600">Selected: {file.name}</p> : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="plan-b-text" className="block text-sm font-medium text-slate-700">Or paste JSON</label>
            <textarea
              id="plan-b-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste exact Plan B JSON here…"
              className="h-44 w-full rounded-xl border px-3 py-3 font-mono text-sm"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading}
          className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? "Importing and refreshing Vault…" : "Import and refresh Company Vault"}
        </button>

        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">{error}</p>
            {validationIssues?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {validationIssues.slice(0, 10).map((issue, index) => (
                  <li key={`${issue.path ?? "payload"}-${index}`}>
                    <strong>{issue.path || "payload"}:</strong> {issue.message || issue.code || "Invalid value"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {result ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-emerald-950">Company Vault refreshed</h2>
            <p className="mt-1 text-emerald-900">
              Active and visible now: <strong>{result.finalized.activeCounts?.experts ?? 0} experts</strong> and <strong>{result.finalized.activeCounts?.projects ?? 0} projects</strong>.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white p-3">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Record type</th>
                  <th className="px-2 py-2 text-right">Received</th>
                  <th className="px-2 py-2 text-right">Created</th>
                  <th className="px-2 py-2 text-right">Updated</th>
                  <th className="px-2 py-2 text-right">Restored</th>
                  <th className="py-2 pl-2 text-right">Skipped</th>
                </tr>
              </thead>
              <tbody>
                <CountRow label="Experts" counts={result.imported.experts} restored={result.finalized.restored?.experts} />
                <CountRow label="Projects" counts={result.imported.projects} restored={result.finalized.restored?.projects} />
                <CountRow label="Legal records" counts={result.imported.legalRecords} />
                <CountRow label="Financial records" counts={result.imported.financialRecords} />
                <CountRow label="Compliance records" counts={result.imported.complianceRecords} />
              </tbody>
            </table>
          </div>

          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-3">
              <dt className="text-xs font-semibold uppercase text-slate-500">Source descriptors staged</dt>
              <dd className="mt-1 text-xl font-bold text-slate-900">{result.finalized.sourceDescriptorsStaged ?? 0}</dd>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <dt className="text-xs font-semibold uppercase text-slate-500">Official links</dt>
              <dd className="mt-1 text-xl font-bold text-slate-900">{result.finalized.linked?.total ?? 0}</dd>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <dt className="text-xs font-semibold uppercase text-slate-500">Source verified</dt>
              <dd className="mt-1 text-xl font-bold text-slate-900">{result.finalized.sourceVerified?.total ?? 0}</dd>
            </div>
          </dl>

          {result.finalized.sourceBlocker ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
              <p className="font-semibold">Company source blocker</p>
              <p className="mt-1">{result.finalized.sourceBlocker}</p>
            </div>
          ) : null}

          {result.finalized.verificationBlocker ? (
            <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-blue-950">
              <p className="font-semibold">Source-text verification</p>
              <p className="mt-1">{result.finalized.verificationBlocker}</p>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-xl border bg-white px-4 py-3">
              <p className="font-semibold text-slate-900">Other import notes</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {warnings.slice(0, 25).map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="rounded-2xl border bg-white p-5">
        <summary className="cursor-pointer font-semibold text-slate-900">Example JSON</summary>
        <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{exampleJson}</pre>
      </details>
    </div>
  );
}
