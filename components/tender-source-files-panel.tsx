"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type TenderSourceFile = {
  id: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  classification: string | null;
  createdAt: string | Date;
  extractionScore: number | null;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  storagePath?: string | null;
  hasInlineFileContent?: boolean | null;
};

type UploadResult = {
  fileRecord?: TenderSourceFile;
  error?: string;
};

const CLASSIFICATIONS = [
  ["", "No classification"],
  ["BID_DOCUMENT", "Bid document"],
  ["TECHNICAL_SPEC", "Technical specification"],
  ["PRICING", "Pricing / commercial"],
  ["TERMS", "Terms and conditions"],
  ["REFERENCE", "Reference"],
  ["ADDENDUM", "Addendum"],
  ["OTHER", "Other"],
] as const;

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "csv", "txt"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractionLabel(file: TenderSourceFile): string {
  if ((file.failedPages ?? 0) > 0) return `${file.failedPages} failed page(s)`;

  const hasCoverage = file.totalPages != null
    && file.totalPages > 0
    && file.extractedPages != null;
  const quality = file.extractionScore != null ? Math.round(file.extractionScore) : null;

  if (hasCoverage) {
    const coverage = Math.round((file.extractedPages! / file.totalPages!) * 100);
    const coverageLabel = `${file.extractedPages}/${file.totalPages} pages (${coverage}%)`;
    return quality != null ? `${coverageLabel} · quality ${quality}/100` : coverageLabel;
  }
  if (quality != null) return `Quality ${quality}/100`;
  return "Extraction pending";
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function safePackageFailureCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(50, parsed);
}

export function TenderSourceFilesPanel({ tenderId, initialFiles, canMutate = false }: { tenderId: string; initialFiles: TenderSourceFile[]; canMutate?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState(initialFiles);
  const [classification, setClassification] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const packageIntake = searchParams.get("packageIntake") === "1";
  const packageFailed = safePackageFailureCount(searchParams.get("packageFailed"));
  const [showPackageNotice, setShowPackageNotice] = useState(packageIntake);

  const uploadFiles = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0 || uploading) return;
    const invalid = incoming.filter((file) => !ALLOWED_EXTENSIONS.has(extensionOf(file.name)));
    if (invalid.length > 0) {
      setMessage({
        kind: "error",
        text: `${invalid.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, CSV, or TXT. Legacy DOC/XLS files must be converted first.`,
      });
      return;
    }

    setUploading(true);
    setMessage(null);
    let uploaded = 0;
    const errors: string[] = [];

    for (const file of incoming) {
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("tenderId", tenderId);
        if (classification) body.append("classification", classification);

        const response = await fetch("/api/upload", { method: "POST", body });
        const payload = await response.json().catch(() => ({})) as { results?: UploadResult[]; error?: string };
        const result = payload.results?.[0];
        if (!response.ok || !result?.fileRecord) {
          errors.push(`${file.name}: ${result?.error ?? payload.error ?? "Upload failed"}`);
          continue;
        }

        setFiles((current) => [result.fileRecord!, ...current.filter((item) => item.id !== result.fileRecord!.id)]);
        uploaded += 1;
      } catch {
        errors.push(`${file.name}: network error`);
      }
    }

    setUploading(false);
    if (errors.length > 0) {
      setMessage({ kind: "error", text: errors.join(" · ") });
    } else {
      setMessage({ kind: "success", text: `${uploaded} file(s) uploaded. Run Engine to refresh extraction, analysis, and matching.` });
    }
    router.refresh();
  }, [classification, router, tenderId, uploading]);

  async function removeFile(file: TenderSourceFile) {
    if (!window.confirm(`Delete ${file.originalFileName}?`)) return;
    setDeletingId(file.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/files/${file.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: payload.error ?? "File deletion failed." });
        return;
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setMessage({ kind: "success", text: `${file.originalFileName} deleted.` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Network error while deleting the file." });
    } finally {
      setDeletingId(null);
    }
  }

  function downloadFile(file: TenderSourceFile) {
    const anchor = document.createElement("a");
    anchor.href = `/api/tenders/${tenderId}/files/${file.id}`;
    anchor.download = file.originalFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <section id="tender-files" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="tender-source-files-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="tender-source-files-title" className="text-lg font-semibold text-slate-900">Tender source files</h2>
          <p className="mt-1 text-sm text-slate-500">Upload, inspect, download, or remove the authoritative tender documents used by extraction and analysis.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="source-file-classification">Classification</label>
          <select
            id="source-file-classification"
            value={classification}
            onChange={(event) => setClassification(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {CLASSIFICATIONS.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {showPackageNotice && (
        <div
          role={packageFailed > 0 ? "alert" : "status"}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${packageFailed > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">Large tender package intake completed</p>
              <p className="mt-1 leading-6">
                The authoritative source-file list currently contains <strong>{files.length}</strong> file(s).
                {packageFailed > 0
                  ? ` ${packageFailed} additional file(s) could not be uploaded; select those files again below.`
                  : " Confirm that every selected document appears below before running AI Analyze."}
              </p>
              <p className="mt-1 text-xs opacity-80">The server&apos;s per-request security limits remained unchanged; the package was processed in smaller requests.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPackageNotice(false)}
              className="min-h-11 shrink-0 rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold hover:bg-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div
        className={`mt-4 rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors ${dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
        onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Upload tender source documents"
          className="sr-only"
          accept=".pdf,.docx,.xlsx,.csv,.txt"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(selected);
          }}
        />
        <p className="text-sm font-medium text-slate-700">Drop tender documents here</p>
        <p className="mt-1 text-xs text-slate-500">PDF, DOCX, XLSX, TXT, and CSV only. Convert legacy DOC/XLS files before upload.</p>
        {canMutate && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Choose files"}
        </button>
        )}
        {!canMutate && (
          <p className="mt-3 text-xs text-slate-500 italic">Read-only — file upload requires ADMIN or PROPOSAL_MANAGER role</p>
        )}
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        {files.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No tender source files are uploaded. Upload at least one tender/RFP document before running Engine.</p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">File</th>
                <th className="px-3 py-2 font-semibold">Classification</th>
                <th className="px-3 py-2 font-semibold">Coverage / quality</th>
                <th className="px-3 py-2 font-semibold">Size</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {files.map((file) => (
                <tr key={file.id}>
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{file.originalFileName}</div>
                    <div className="mt-0.5 text-xs text-slate-500">Uploaded {new Date(file.createdAt).toLocaleDateString()}</div>
                    {file.hasInlineFileContent && !(file.storagePath ?? "").trim() && (
                      <div className="mt-1 text-xs font-medium text-emerald-700">Restored inline file available</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{file.classification?.replace(/_/g, " ") ?? "Not classified"}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${(file.failedPages ?? 0) > 0 ? "bg-red-50 text-red-700" : file.extractionScore != null && file.extractionScore >= 70 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>
                      {extractionLabel(file)}
                    </span>
                    {(file.ocrPages ?? 0) > 0 && <div className="mt-1 text-xs text-slate-500">OCR: {file.ocrPages} page(s)</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{formatBytes(file.size)}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => downloadFile(file)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Download</button>
                      {canMutate && (
                      <button type="button" onClick={() => void removeFile(file)} disabled={deletingId === file.id} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">
                        {deletingId === file.id ? "Deleting…" : "Delete"}
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
