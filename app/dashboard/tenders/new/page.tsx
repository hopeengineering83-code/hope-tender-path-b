"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_TENDER_PACKAGE_BYTES,
  MAX_TENDER_PACKAGE_FILES,
  MAX_TENDER_UPLOAD_FILE_BYTES,
  partitionTenderUploadPackage,
  validateTenderPackageSelection,
} from "../../../../lib/tender-upload-package";
// Upload owns verified storage and automatic extraction only. AI Analyze and Run Engine remain manual.

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Infrastructure", "Urban Planning", "Environmental", "Feasibility Study", "NGO/Donor-Funded", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD", "AED", "SAR", "KWD", "EGP", "ETB", "NGN"];

type UploadProgress = {
  completed: number;
  total: number;
  phase: "creating" | "adding";
};

type UploadFirstPayload = {
  error?: string;
  errors?: string[];
  tenderId?: string;
  /** Upload-first explicitly skips every manual workflow gate. */
  engineSkipped?: boolean;
  /** Intake status only; never an instruction to auto-run AI Analyze. */
  nextAction?: string;
  processingJobId?: string;
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | null;
  intakeSessionId?: string;
};

type AdditionalUploadPayload = {
  error?: string;
  results?: Array<{ success?: boolean; fileRecord?: { id: string }; error?: string }>;
  processingJobId?: string;
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | null;
};

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function NewTenderPage() {
  const router = useRouter();
  const fileInputId = useId();
  const uploadHelpId = useId();
  const uploadStatusId = useId();
  const intakeSessionIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const totalSelectedBytes = files.reduce((total, file) => total + file.size, 0);
  const uploadBatches = partitionTenderUploadPackage(files);

  function selectTenderFiles(selected: File[]) {
    const validationError = validateTenderPackageSelection(selected);
    if (validationError) {
      setFiles([]);
      setUploadError(validationError);
      return;
    }
    setUploadError("");
    setUploadProgress(null);
    intakeSessionIdRef.current = null;
    setFiles(selected);
  }

  function removeTenderFile(index: number) {
    const nextFiles = files.filter((_, fileIndex) => fileIndex !== index);
    setFiles(nextFiles);
    setUploadError("");
    setUploadProgress(null);
    intakeSessionIdRef.current = null;
  }

  async function appendTenderBatch(
    tenderId: string,
    batch: File[],
    deferAnalysis: boolean,
    intake: {
      sessionId: string;
      batchIndex: number;
      expectedBatches: number;
      expectedFiles: number;
      manifestJson: string;
    },
  ): Promise<{
    uploaded: number;
    failed: number;
    processingJobId: string | null;
    pipelineStage: "EXTRACT_TEXT_QUEUED" | null;
  }> {
    const body = new FormData();
    for (const file of batch) body.append("file", file);
    body.append("tenderId", tenderId);
    body.append("classification", "BID_DOCUMENT");
    if (deferAnalysis) body.append("deferAnalysis", "true");
    body.append("intakeSessionId", intake.sessionId);
    body.append("intakeBatchIndex", String(intake.batchIndex));
    body.append("intakeExpectedBatches", String(intake.expectedBatches));
    body.append("intakeExpectedFiles", String(intake.expectedFiles));
    body.append("intakeManifest", intake.manifestJson);

    try {
      const response = await fetch("/api/upload", { method: "POST", body });
      const payload = await response.json().catch(() => ({})) as AdditionalUploadPayload;
      if (!Array.isArray(payload.results)) {
        return { uploaded: 0, failed: batch.length, processingJobId: null, pipelineStage: null };
      }
      const uploaded = payload.results.filter((result) => result.success === true && Boolean(result.fileRecord)).length;
      return {
        uploaded,
        failed: Math.max(0, batch.length - uploaded),
        processingJobId: payload.processingJobId ?? null,
        pipelineStage: payload.pipelineStage ?? null,
      };
    } catch (e) {
      // Batch upload failed — surface to operator via console.
      // Previously bare `catch {}` — silent upload failures were invisible.
      try { console.error("[tenders/new] batch upload failed", e); } catch {}
      return { uploaded: 0, failed: batch.length, processingJobId: null, pipelineStage: null };
    }
  }

  async function handleUploadFirst() {
    if (uploading || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    setUploadProgress({ completed: 0, total: files.length, phase: "creating" });

    try {
      const validationError = validateTenderPackageSelection(files);
      if (validationError) {
        setUploadError(validationError);
        return;
      }

      const batches = partitionTenderUploadPackage(files);
      const intakeSessionId = intakeSessionIdRef.current ?? crypto.randomUUID();
      intakeSessionIdRef.current = intakeSessionId;
      const intakeManifest = batches.map((batch) =>
        batch.map((file) => ({ name: file.name, size: file.size })),
      );
      const intakeManifestJson = JSON.stringify(intakeManifest);
      const firstBatch = batches[0];
      if (!firstBatch || firstBatch.length === 0) {
        setUploadError("Select at least one supported tender document.");
        return;
      }

      const form = new FormData();
      for (const file of firstBatch) form.append("file", file);
      if (batches.length > 1) form.append("deferAnalysis", "true");
      form.append("intakeSessionId", intakeSessionId);
      form.append("intakeBatchIndex", "0");
      form.append("intakeExpectedBatches", String(batches.length));
      form.append("intakeExpectedFiles", String(files.length));
      form.append("intakeManifest", intakeManifestJson);
      const res = await fetch("/api/tenders/upload-first", { method: "POST", body: form });
      const data = await res.json().catch(() => ({})) as UploadFirstPayload;
      if (!res.ok) {
        const details = Array.isArray(data.errors) && data.errors.length > 0 ? ` Details: ${data.errors.join("; ")}` : "";
        setUploadError(`${data.error || "Upload-first tender intake failed"}${details}`.trim());
        return;
      }
      if (!data.tenderId) {
        setUploadError("Tender intake completed without a tender identifier. Refresh the tender list before retrying to avoid creating a duplicate.");
        return;
      }

      let processed = firstBatch.length;
      let failed = 0;
      let resumeBatchIndex: number | null = null;
      let processingJobId = data.processingJobId ?? null;
      let pipelineStage = data.pipelineStage ?? null;
      const additionalBatches = batches.slice(1);
      if (additionalBatches.length > 0) {
        setUploadProgress({ completed: processed, total: files.length, phase: "adding" });
        for (const [batchIndex, batch] of additionalBatches.entries()) {
          const isFinalBatch = batchIndex === additionalBatches.length - 1;
          const result = await appendTenderBatch(
            data.tenderId,
            batch,
            !isFinalBatch || failed > 0,
            {
              sessionId: intakeSessionId,
              batchIndex: batchIndex + 1,
              expectedBatches: batches.length,
              expectedFiles: files.length,
              manifestJson: intakeManifestJson,
            },
          );
          if (result.failed > 0) {
            resumeBatchIndex = batchIndex + 1;
            failed = files.length - processed;
            setUploadProgress({ completed: processed, total: files.length, phase: "adding" });
            break;
          }
          processed += batch.length;
          processingJobId = result.processingJobId ?? processingJobId;
          pipelineStage = result.pipelineStage ?? pipelineStage;
          setUploadProgress({ completed: processed, total: files.length, phase: "adding" });
        }
      }

      // This response describes upload-owned extraction only.
      const pipelineStatus = pipelineStage === "EXTRACT_TEXT_QUEUED" ? "extracting" : "ready-for-ai-analyze";

      if (batches.length > 1) {
        const query = new URLSearchParams({
          packageIntake: "1",
          packageFailed: String(failed),
          pipeline: pipelineStatus,
          intakeSession: data.intakeSessionId ?? intakeSessionId,
          ...(resumeBatchIndex !== null ? { resumeBatch: String(resumeBatchIndex) } : {}),
        });
        setUploadProgress({ completed: processed, total: files.length, phase: "adding" });
        router.push(`/dashboard/tenders/${data.tenderId}?${query.toString()}`);
      } else {
        router.push(`/dashboard/tenders/${data.tenderId}?pipeline=${pipelineStatus}`);
      }
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

  const uploadButtonLabel = uploading
    ? uploadProgress?.phase === "adding"
      ? `Adding package batches… ${uploadProgress.completed}/${uploadProgress.total}`
      : `Creating tender… ${uploadProgress?.completed ?? 0}/${uploadProgress?.total ?? files.length}`
    : files.length > 10
      ? `Create Tender from ${files.length} Documents`
      : "Create Tender from Uploaded Documents";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Tender Intake</h1>
        <p className="mt-1 text-sm text-slate-500">Upload the complete tender package once. The app verifies source bytes and extracts documents automatically. When extraction completes, AI Analyze is ready as a manual action; Run Engine remains the next manual action after analysis.</p>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:p-6" aria-labelledby="upload-first-heading">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</p>
          <h2 id="upload-first-heading" className="mt-1 text-xl font-bold text-slate-900">Upload tender documents first</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">The first secure batch creates the tender. Larger packages are added in request-safe batches, then extraction runs automatically. After the final batch is extracted, open the tender and select AI Analyze.</p>
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-blue-300 bg-white p-4 sm:p-5">
          <label htmlFor={fileInputId} className="block text-sm font-semibold text-slate-800">Tender source documents</label>
          <p id={uploadHelpId} className="mt-1 text-xs leading-5 text-slate-500">
            PDF, DOCX, XLSX, TXT, and CSV. Up to {MAX_TENDER_PACKAGE_FILES} files and {formatMegabytes(MAX_TENDER_PACKAGE_BYTES)} per intake package; {formatMegabytes(MAX_TENDER_UPLOAD_FILE_BYTES)} maximum per file. The app preserves the server&apos;s secure 10-file / 30-MB request boundary by uploading large packages in batches. Convert legacy DOC/XLS files first.
          </p>
          <input
            id={fileInputId}
            type="file"
            multiple
            disabled={uploading}
            accept=".pdf,.docx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={`${uploadHelpId} ${uploadStatusId}`}
            onChange={(event) => selectTenderFiles(Array.from(event.target.files ?? []))}
            className="mt-3 block w-full min-w-0 rounded-xl border bg-white px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 disabled:opacity-60"
          />

          <div id={uploadStatusId} role="status" aria-live="polite" className="mt-3 text-xs text-slate-600">
            {files.length === 0
              ? "No tender documents selected."
              : `${files.length} of ${MAX_TENDER_PACKAGE_FILES} files selected · ${formatMegabytes(totalSelectedBytes)} of ${formatMegabytes(MAX_TENDER_PACKAGE_BYTES)} · ${uploadBatches.length} secure batch${uploadBatches.length === 1 ? "" : "es"}.`}
          </div>

          {files.length > 0 && (
            <>
              <ul className="mt-3 space-y-2" aria-label="Selected tender documents">
                {files.slice(0, 12).map((file, index) => (
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
              {files.length > 12 && (
                <p className="mt-2 text-xs text-slate-500">And {files.length - 12} more selected document(s). All selected files remain part of the package.</p>
              )}
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleUploadFirst()}
              disabled={uploading || files.length === 0}
              title={files.length === 0 ? "Select at least one tender document to enable this action." : uploading ? "Upload in progress…" : undefined}
              className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {uploadButtonLabel}
            </button>
            {files.length > 0 && (
              <button
                type="button"
                onClick={() => { setFiles([]); setUploadError(""); setUploadProgress(null); }}
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
