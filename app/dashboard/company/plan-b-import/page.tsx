"use client";

import { useState } from "react";
import Link from "next/link";

type CompletenessMetric = { expected: number | null; imported: number; missing: number; excess: number; matched: boolean };

type ImportResult = {
  success: boolean;
  error?: string;
  code?: string;
  schemaVersion?: string | null;
  trustLevel?: string;
  requireRawText?: boolean;
  enforceExpectedCounts?: boolean;
  expectedCounts?: Record<string, number | null>;
  importedCounts?: Record<string, number>;
  preflightInvalid?: { experts: number; projects: number; sourceDocuments?: number };
  completeness?: Record<string, CompletenessMetric>;
  duplicateCollisions?: { experts: string[]; projects: string[] };
  experts?: { received: number; created: number; updated: number; skipped: number };
  projects?: { received: number; created: number; updated: number; skipped: number };
  documents?: { received: number; created: number; updated: number; skipped: number };
  warnings?: string[];
};

const exampleJson = `{
  "schemaVersion": "hope-plan-b-v1",
  "importPolicy": {
    "trustLevel": "REVIEWED",
    "requireRawText": true,
    "reviewNotes": "Exact Plan B import from uploaded PDF source text."
  },
  "completenessPolicy": {
    "enforceExpectedCounts": true
  },
  "expectedCounts": {
    "experts": 25,
    "projects": 114,
    "sourceDocuments": 2
  },
  "sourceDocuments": [
    { "fileName": "Expert CVS.pdf", "type": "Expert CV library", "parsedExperts": 25, "rawText": "FULL SOURCE TEXT FROM THE CV PDF..." },
    { "fileName": "Projects Reference.pdf", "type": "Project portfolio", "parsedProjects": 114, "rawText": "FULL SOURCE TEXT FROM THE PROJECT PDF..." }
  ],
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

function CompletenessRows({ result }: { result: ImportResult }) {
  const entries = Object.entries(result.completeness ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Expected</th>
            <th className="px-3 py-2">Importable</th>
            <th className="px-3 py-2">Missing</th>
            <th className="px-3 py-2">Excess</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, item]) => (
            <tr key={name} className="border-t">
              <td className="px-3 py-2 font-medium capitalize">{name}</td>
              <td className="px-3 py-2">{item.expected ?? "not set"}</td>
              <td className="px-3 py-2">{item.imported}</td>
              <td className={item.missing > 0 ? "px-3 py-2 font-semibold text-red-700" : "px-3 py-2"}>{item.missing}</td>
              <td className={item.excess > 0 ? "px-3 py-2 font-semibold text-amber-700" : "px-3 py-2"}>{item.excess}</td>
              <td className={item.matched ? "px-3 py-2 text-green-700" : "px-3 py-2 text-red-700"}>{item.matched ? "Matched" : "Mismatch"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PlanBImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit() {
    setLoading(true);
    setError("");
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
        res = await fetch("/api/company/plan-b-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(data);
        throw new Error(data.error || "Plan B import failed");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan B import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan B exact extraction</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Exact JSON Knowledge Import</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Use this when the app PDF parser fails or misses details. Upload structured JSON produced from exact PDF text blocks. Strict mode can block imports before database writes when expected counts do not match.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/company/review-board" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Review Board</Link>
          <Link href="/dashboard/company" className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Knowledge Vault</Link>
        </div>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h2 className="font-semibold">Strict Plan B rules</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Do not upload summaries as the source of truth.</li>
          <li>Each CV/project record should include full raw source text in <code>rawText</code>.</li>
          <li>Set <code>completenessPolicy.enforceExpectedCounts=true</code> to block under-imports before database writes.</li>
          <li>Use <code>expectedCounts</code> to enforce the expected expert/project totals from the source documents.</li>
          <li>Imported records can be marked REVIEWED only because exact raw source text is preserved in the record.</li>
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Upload exact extracted JSON</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">JSON file</label>
            <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full rounded-xl border bg-white px-3 py-3 text-sm" />
            {file && <p className="text-xs text-slate-500">Selected: {file.name}</p>}
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Or paste JSON</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste exact Plan B JSON here..." className="h-40 w-full rounded-xl border px-3 py-3 text-sm font-mono" />
          </div>
        </div>
        <button onClick={() => void submit()} disabled={loading} className="mt-5 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "Importing exact knowledge…" : "Import Plan B Knowledge"}</button>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {result && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${result.success ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            <p className="font-semibold">{result.success ? "Import completed" : "Import blocked"}</p>
            <p className="mt-1">Strict expected-count enforcement: {result.enforceExpectedCounts ? "enabled" : "disabled"}</p>
            <p className="mt-1">Experts: {result.experts?.created ?? 0} created, {result.experts?.updated ?? 0} updated, {result.experts?.skipped ?? 0} skipped. Preflight invalid: {result.preflightInvalid?.experts ?? 0}.</p>
            <p>Projects: {result.projects?.created ?? 0} created, {result.projects?.updated ?? 0} updated, {result.projects?.skipped ?? 0} skipped. Preflight invalid: {result.preflightInvalid?.projects ?? 0}.</p>
            <CompletenessRows result={result} />
            {result.duplicateCollisions?.experts?.length ? <p className="mt-2 text-amber-800">Duplicate expert keys: {result.duplicateCollisions.experts.join(", ")}</p> : null}
            {result.duplicateCollisions?.projects?.length ? <p className="mt-2 text-amber-800">Duplicate project keys: {result.duplicateCollisions.projects.join(", ")}</p> : null}
            {result.warnings?.length ? <p className="mt-2 text-amber-800">Warnings: {result.warnings.join(" | ")}</p> : null}
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
