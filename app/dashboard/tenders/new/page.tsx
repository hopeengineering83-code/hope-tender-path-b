"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Infrastructure", "Urban Planning", "Environmental", "Feasibility Study", "NGO/Donor-Funded", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD", "AED", "SAR", "KWD", "EGP", "ETB", "NGN"];
const ALLOWED_TENDER_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "txt", "csv"]);
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function validateTenderFiles(selected: File[]): string | null {
  if (selected.length === 0) return null;
  if (selected.length > MAX_UPLOAD_FILES) return `Select no more than ${MAX_UPLOAD_FILES} files per tender intake.`;

  const unsupported = selected.filter((file) => !ALLOWED_TENDER_EXTENSIONS.has(fileExtension(file.name)));
  if (unsupported.length > 0) {
    return `${unsupported.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, TXT, or CSV. Convert legacy DOC/XLS files first.`;
  }

  const oversized = selected.filter((file) => file.size > MAX_UPLOAD_FILE_BYTES);
  if (oversized.length > 0) {
    return `${oversized.map((file) => file.name).join(", ")}: each file must be 10 MB or smaller.`;
  }

  const totalBytes = selected.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) return "The selected files exceed the 30 MB total upload limit.";
  return null;
}

export default function NewTenderPage() {
  const router = useRouter();
  const fileInputId = useId();
  const uploadHelpId = useId();
  const uploadStatusId = useId();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const totalSelectedBytes = files.reduce((total, file) => total + file.size, 0);

  function selectTenderFiles(selected: File[]) {
    const validationError = validateTenderFiles(selected);
    if (validationError) {
      setFiles([]);
      setUploadError(validationError);
      return;
    }
    setUploadError("");
    setFiles(selected);
  }

  function removeTenderFile(index: number) {
    const nextFiles = files.filter((_, fileIndex) => fileIndex !== index);
    setFiles(nextFiles);
    setUploadError("");
  }

  async function handleUploadFirst() {
    if (uploading || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const validationError = validateTenderFiles(files);
      if (validationError) {
        setUploadError(validationError);
        return;
      }

      const form = new FormData();
      for (const file of files) form.append("file", file);
      const res = await fetch("/api/tenders/upload-first", { method: "POST", body: form });
      const data = await res.json().catch(() => ({})) as { error?: string; errors?: string[]; tenderId?: string };
      if (!res.ok) {
        const details = Array.isArray(data.errors) && data.errors.length > 0 ? ` Details: ${data.errors.join("; ")}` : "";
        setUploadError(`${data.error || "Upload-first tender intake failed"}${details}`.trim());
        return;
      }
      if (!data.tenderId) {
        setUploadError("Tender intake completed without a tender identifier. Refresh the tender list before retrying to avoid creating a duplicate.");
        return;
      }
      router.push(`/dashboard/tenders/${data.tenderId}`);
    } catch {
      setUploadError("Network error. The tender was not confirmed as created. Check the tender list before retrying.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    try {
      const res = await fetch("/api/tenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error || "Failed to create tender");
        return;
      }
      const tender = await res.json() as { id?: string };
      if (!tender.id) {
        setError("Tender creation returned no identifier. Check the tender list before retrying.");
        return;
      }
      router.push(`/dashboard/tenders/${tender.id}`);
    } catch {
      setError("Network error. The tender was not confirmed as created. Check the tender list before retrying.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Tender Intake</h1>
        <p className="mt-1 text-sm text-slate-500">Upload tender documents first so the app can extract details, requirements, matching, and compliance automatically. Manual fields remain available as a fallback.</p>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:p-6" aria-labelledby="upload-first-heading">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</p>
          <h2 id="upload-first-heading" className="mt-1 text-xl font-bold text-slate-900">Upload tender documents first</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">The app will create the tender record, extract title/reference/client/deadline/submission method from the uploaded files, run analysis, and rank best-fit experts and projects with 10 matching cycles.</p>
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-blue-300 bg-white p-4 sm:p-5">
          <label htmlFor={fileInputId} className="block text-sm font-semibold text-slate-800">Tender source documents</label>
          <p id={uploadHelpId} className="mt-1 text-xs text-slate-500">PDF, DOCX, XLSX, TXT, and CSV. Maximum 10 files, 10 MB each, and 30 MB total. Convert legacy DOC/XLS files first.</p>
          <input
            id={fileInputId}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={`${uploadHelpId} ${uploadStatusId}`}
            onChange={(event) => selectTenderFiles(Array.from(event.target.files ?? []))}
            className="mt-3 block w-full min-w-0 rounded-xl border bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
          />

          <div id={uploadStatusId} role="status" aria-live="polite" className="mt-3 text-xs text-slate-600">
            {files.length === 0
              ? "No tender documents selected."
              : `${files.length} of ${MAX_UPLOAD_FILES} files selected · ${formatMegabytes(totalSelectedBytes)} of 30.00 MB.`}
          </div>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="Selected tender documents">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="min-w-0 break-all">{file.name} · {formatMegabytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeTenderFile(index)}
                    disabled={uploading}
                    className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                    aria-label={`Remove ${file.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleUploadFirst()}
              disabled={uploading || files.length === 0}
              className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? "Extracting and running engine…" : "Create Tender from Uploaded Documents"}
            </button>
            {files.length > 0 && (
              <button
                type="button"
                onClick={() => { setFiles([]); setUploadError(""); }}
                disabled={uploading}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Clear selection
              </button>
            )}
          </div>
          {uploadError && <div role="alert" aria-live="assertive" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadError}</div>}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Manual tender intake fallback</h2>
          <p className="mt-1 text-sm text-slate-500">Use this only when you do not have tender documents yet.</p>
        </div>
        {error && <div role="alert" aria-live="assertive" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="manual-tender-title" className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
            <input id="manual-tender-title" name="title" required placeholder="e.g. Urban master planning consultancy" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-reference" className="mb-1 block text-sm font-medium text-slate-700">Reference Number</label>
            <input id="manual-tender-reference" name="reference" placeholder="e.g. RFP-2026-004" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-client" className="mb-1 block text-sm font-medium text-slate-700">Client</label>
            <input id="manual-tender-client" name="clientName" placeholder="Client / procurement entity" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-category" className="mb-1 block text-sm font-medium text-slate-700">Category</label>
            <select id="manual-tender-category" name="category" className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black">
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="manual-tender-country" className="mb-1 block text-sm font-medium text-slate-700">Country</label>
            <input id="manual-tender-country" name="country" placeholder="Country of procurement" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-method" className="mb-1 block text-sm font-medium text-slate-700">Submission Method</label>
            <input id="manual-tender-method" name="submissionMethod" placeholder="Portal / email / hard copy" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-deadline" className="mb-1 block text-sm font-medium text-slate-700">Deadline</label>
            <input id="manual-tender-deadline" name="deadline" type="date" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-budget" className="mb-1 block text-sm font-medium text-slate-700">Budget</label>
            <input id="manual-tender-budget" name="budget" type="number" min="0" step="0.01" placeholder="0.00" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label htmlFor="manual-tender-currency" className="mb-1 block text-sm font-medium text-slate-700">Currency</label>
            <select id="manual-tender-currency" name="currency" className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black">
              {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="manual-tender-address" className="mb-1 block text-sm font-medium text-slate-700">Submission Address / Portal</label>
            <input id="manual-tender-address" name="submissionAddress" placeholder="Portal URL, office address, or submission email" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="manual-tender-description" className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea id="manual-tender-description" name="description" rows={3} placeholder="Brief description of the opportunity" className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="manual-tender-summary" className="mb-1 block text-sm font-medium text-slate-700">Tender Intake Summary</label>
            <textarea id="manual-tender-summary" name="intakeSummary" rows={6} placeholder="Paste known requirements, mandatory forms, expert needs, project experience rules, evaluation criteria, and file naming rules" className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="manual-tender-notes" className="mb-1 block text-sm font-medium text-slate-700">Internal Notes</label>
            <textarea id="manual-tender-notes" name="notes" rows={2} placeholder="Internal proposal notes (not included in submissions)" className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="submit" disabled={loading} className="min-h-11 rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? "Creating…" : "Create Manual Tender"}
          </button>
          <button type="button" onClick={() => router.back()} disabled={loading} className="min-h-11 rounded-lg border px-6 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">Cancel</button>
        </div>
      </form>
    </div>
  );
}
