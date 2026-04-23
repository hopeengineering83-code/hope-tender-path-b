"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../../../../components/status-badge";
import { NEXT_STATUS, formatDate, formatTenderStatus } from "../../../../lib/tender-workflow";

type TenderFile = {
  id: string;
  fileName: string;
  originalFileName: string;
  size: number;
  mimeType: string;
  createdAt: string | Date;
  extractedText?: string | null;
  classification?: string | null;
};

type UploadItem = {
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  classification: string;
};

const FILE_CLASSIFICATIONS = [
  { value: "", label: "No classification" },
  { value: "BID_DOCUMENT", label: "Bid Document" },
  { value: "TECHNICAL_SPEC", label: "Technical Spec" },
  { value: "PRICING", label: "Pricing" },
  { value: "TERMS", label: "Terms & Conditions" },
  { value: "REFERENCE", label: "Reference" },
  { value: "ADDENDUM", label: "Addendum" },
  { value: "OTHER", label: "Other" },
];

const EXT_COLORS: Record<string, string> = {
  pdf: "bg-red-100 text-red-700",
  docx: "bg-blue-100 text-blue-700",
  doc: "bg-blue-100 text-blue-700",
  xlsx: "bg-green-100 text-green-700",
  xls: "bg-green-100 text-green-700",
  pptx: "bg-orange-100 text-orange-700",
  ppt: "bg-orange-100 text-orange-700",
  csv: "bg-teal-100 text-teal-700",
  txt: "bg-slate-100 text-slate-600",
  rtf: "bg-slate-100 text-slate-600",
  png: "bg-purple-100 text-purple-700",
  jpg: "bg-purple-100 text-purple-700",
  jpeg: "bg-purple-100 text-purple-700",
};

function getExt(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FileTypeBadge({ name }: { name: string }) {
  const ext = getExt(name);
  const cls = EXT_COLORS[ext] ?? "bg-slate-100 text-slate-600";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{ext || "file"}</span>;
}

function ExtractionBadge({ text }: { text?: string | null }) {
  if (!text) return <span className="text-xs text-slate-300">no text</span>;
  if (text.startsWith("[Scanned")) return <span className="text-xs text-amber-600">⚠ scanned</span>;
  return <span className="text-xs text-green-600">{text.length.toLocaleString()} chars</span>;
}

type TenderRequirement = {
  id: string;
  title: string;
  description: string;
  priority: string;
  requirementType: string;
  exactFileName: string | null;
  exactOrder: number | null;
};

type ComplianceGap = {
  id: string;
  title: string;
  description: string;
  severity: string;
  isResolved: boolean;
};

type GeneratedDocument = {
  id: string;
  name: string;
  documentType: string;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  reviewNotes: string | null;
  exactFileName?: string | null;
  fileContent?: string | null;
};

type Tender = {
  id: string;
  title: string;
  description: string | null;
  reference: string | null;
  clientName: string | null;
  category: string;
  budget: number | null;
  currency: string;
  deadline: string | Date | null;
  submissionMethod: string | null;
  submissionAddress: string | null;
  status: string;
  intakeSummary: string | null;
  analysisSummary: string | null;
  notes: string | null;
  exactFileNaming: string | string[];
  exactFileOrder: string | string[];
  files: TenderFile[];
  requirements: TenderRequirement[];
  complianceGaps: ComplianceGap[];
  generatedDocuments: GeneratedDocument[];
};

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TenderDetail({ tender: initial, aiEnabled }: { tender: Tender; aiEnabled?: boolean }) {
  const router = useRouter();
  const [tender, setTender] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<{ passed: boolean; issues: { code: string; severity: string; message: string }[] } | null>(null);
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileQueue, setFileQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [aiProposal, setAiProposal] = useState("");
  const [form, setForm] = useState({
    title: initial.title,
    reference: initial.reference ?? "",
    clientName: initial.clientName ?? "",
    category: initial.category,
    budget: initial.budget?.toString() ?? "",
    currency: initial.currency,
    deadline: initial.deadline ? new Date(initial.deadline).toISOString().slice(0, 10) : "",
    submissionMethod: initial.submissionMethod ?? "",
    submissionAddress: initial.submissionAddress ?? "",
    description: initial.description ?? "",
    intakeSummary: initial.intakeSummary ?? "",
    analysisSummary: initial.analysisSummary ?? "",
    notes: initial.notes ?? "",
  });

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        setError("Failed to save tender");
        return;
      }

      const updated = await res.json();
      setTender(updated);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await save({
      ...form,
      budget: form.budget || null,
      deadline: form.deadline || null,
    });
    setEditing(false);
  }

  async function handleStatusAdvance() {
    const next = NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS];
    if (!next) return;
    await save({ status: next });
  }

  async function handleRunEngine() {
    setEngineRunning(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/engine`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Engine run failed");
        return;
      }
      if (data.tender) {
        setTender((current) => ({
          ...current,
          ...data.tender,
        }));
        setForm((current) => ({
          ...current,
          analysisSummary: data.tender.analysisSummary || current.analysisSummary,
        }));
      }
      router.refresh();
    } catch {
      setError("Engine run failed");
    } finally {
      setEngineRunning(false);
    }
  }

  async function handleAIAnalyze() {
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/ai-analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Analysis failed"); return; }
      if (data.tender) setTender((cur) => ({ ...cur, ...data.tender }));
      router.refresh();
    } catch { setError("Analysis failed"); }
    finally { setAnalyzing(false); }
  }

  async function handleAIProposal() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/ai-proposal`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed"); return; }
      setAiProposal(data.proposal || "");
      setForm((cur) => ({ ...cur, intakeSummary: data.proposal || cur.intakeSummary }));
    } catch { setError("Proposal generation failed"); }
    finally { setGenerating(false); }
  }

  async function handleGenerateDocs() {
    setGeneratingDocs(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed"); return; }
      if (data.tender) setTender((cur) => ({ ...cur, ...data.tender }));
      router.refresh();
    } catch { setError("Document generation failed"); }
    finally { setGeneratingDocs(false); }
  }

  async function handleValidate() {
    setValidating(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/validate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Validation failed"); return; }
      setValidationReport(data.report);
      router.refresh();
    } catch { setError("Validation failed"); }
    finally { setValidating(false); }
  }

  function downloadDoc(type: string) {
    window.open(`/api/tenders/${tender.id}/download?type=${type}`, "_blank");
  }

  function downloadDocById(docId: string) {
    window.open(`/api/tenders/${tender.id}/download?docId=${docId}`, "_blank");
  }

  function downloadZip() {
    window.open(`/api/tenders/${tender.id}/download?type=zip`, "_blank");
  }

  async function submitReview(docId: string, reviewStatus: string) {
    await fetch(`/api/tenders/${tender.id}/documents/${docId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus, reviewNotes: reviewNote }),
    });
    setReviewingDocId(null);
    setReviewNote("");
    const res = await fetch(`/api/tenders/${tender.id}`);
    if (res.ok) { const d = await res.json() as { tender: Tender }; setTender(d.tender); }
  }

  async function handleDelete() {
    if (!confirm("Delete this tender? This cannot be undone.")) return;
    setDeleting(true);
    await fetch(`/api/tenders/${tender.id}`, { method: "DELETE" });
    router.push("/dashboard/tenders");
  }

  const processFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const items: UploadItem[] = newFiles.map((f) => ({ file: f, status: "queued", classification: "" }));
    setFileQueue((q) => [...items, ...q]);
    setUploading(true);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "uploading" } : x));

      try {
        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("tenderId", tender.id);
        if (item.classification) fd.append("classification", item.classification);

        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();

        if (res.ok && data.results?.[0]?.fileRecord) {
          const fileRecord = data.results[0].fileRecord;
          setTender((cur) => ({ ...cur, files: [fileRecord, ...cur.files] }));
          setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "done" } : x));
        } else {
          const msg = data.results?.[0]?.error ?? data.error ?? "Upload failed";
          setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: msg } : x));
        }
      } catch {
        setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: "Network error" } : x));
      }
    }

    setUploading(false);
    setTimeout(() => setFileQueue((q) => q.filter((x) => x.status !== "done")), 3000);
  }, [tender.id]);

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    processFiles(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }

  async function handleDeleteFile(fileId: string) {
    if (!confirm("Delete this file?")) return;
    const res = await fetch(`/api/tenders/${tender.id}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) {
      setTender((cur) => ({ ...cur, files: cur.files.filter((f) => f.id !== fileId) }));
    }
  }

  function handleDownloadFile(fileId: string, fileName: string) {
    const a = document.createElement("a");
    a.href = `/api/tenders/${tender.id}/files/${fileId}`;
    a.download = fileName;
    a.click();
  }

  const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
  const criticalGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity)).length;
  const mandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY").length;
  const readinessScore = tender.requirements.length === 0 ? 0
    : Math.max(0, Math.round(((tender.requirements.length - criticalGaps) / tender.requirements.length) * 100));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{tender.title}</h1>
            <StatusBadge status={tender.status} />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {tender.reference ? `Ref ${tender.reference}` : "No reference yet"}
            {tender.clientName ? ` · ${tender.clientName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {aiEnabled && (
            <button onClick={handleAIAnalyze} disabled={analyzing}
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700 disabled:opacity-50">
              {analyzing ? "Analyzing..." : "✦ AI Analyze"}
            </button>
          )}
          {aiEnabled && (
            <button onClick={handleAIProposal} disabled={generating}
              className="rounded-lg bg-purple-100 px-3 py-2 text-sm text-purple-800 hover:bg-purple-200 disabled:opacity-50">
              {generating ? "Generating..." : "✦ AI Proposal"}
            </button>
          )}
          <button onClick={handleRunEngine} disabled={engineRunning}
            className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {engineRunning ? "Running…" : "Run Engine"}
          </button>
          <button onClick={handleGenerateDocs} disabled={generatingDocs}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {generatingDocs ? "Generating…" : "⚡ Generate Docs"}
          </button>
          <button onClick={handleValidate} disabled={validating}
            className="rounded-lg bg-teal-600 px-3 py-2 text-sm text-white hover:bg-teal-700 disabled:opacity-50">
            {validating ? "Validating…" : "✓ Validate"}
          </button>
          {NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] && (
            <button onClick={handleStatusAdvance} disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              → {formatTenderStatus(NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] as string)}
            </button>
          )}
          <button onClick={downloadZip}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100">
            ↓ ZIP Package
          </button>
          <button onClick={() => downloadDoc("proposal")}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            ↓ Proposal
          </button>
          <button onClick={() => downloadDoc("requirements")}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            ↓ Requirements
          </button>
          <button onClick={() => setEditing((v) => !v)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Files</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.files.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Requirements</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.requirements.length}</p>
          <p className="mt-1 text-xs text-slate-500">Mandatory: {mandatoryRequirements}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Gaps</p>
          <p className={`mt-1 text-3xl font-bold ${criticalGaps > 0 ? "text-red-600" : "text-green-600"}`}>{unresolvedGaps}</p>
          {criticalGaps > 0 && <p className="mt-1 text-xs text-red-500">{criticalGaps} critical</p>}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Generated Docs</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.generatedDocuments.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Readiness</p>
          <p className={`mt-1 text-3xl font-bold ${readinessScore >= 80 ? "text-green-600" : readinessScore >= 50 ? "text-amber-500" : "text-red-500"}`}>
            {readinessScore}%
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${readinessScore >= 80 ? "bg-green-500" : readinessScore >= 50 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${readinessScore}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(360px,1fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Tender workspace</h2>
            {editing ? (
              <div className="mt-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Tender title" />
                  <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Reference number" />
                  <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Client name" />
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Budget" type="number" />
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" type="date" />
                  <input value={form.submissionMethod} onChange={(e) => setForm({ ...form, submissionMethod: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Submission method" />
                </div>
                <input value={form.submissionAddress} onChange={(e) => setForm({ ...form, submissionAddress: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Submission address or portal" />
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} placeholder="Tender description" />
                <textarea value={form.intakeSummary} onChange={(e) => setForm({ ...form, intakeSummary: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={5} placeholder="Intake summary and known scope" />
                <textarea value={form.analysisSummary} onChange={(e) => setForm({ ...form, analysisSummary: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={4} placeholder="Internal analysis summary" />
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} placeholder="Internal notes" />
                <button onClick={handleSave} disabled={saving} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            ) : (
              <dl className="mt-5 grid gap-4 md:grid-cols-2">
                <div><dt className="text-sm text-slate-500">Client</dt><dd className="mt-1 font-medium text-slate-900">{tender.clientName || "—"}</dd></div>
                <div><dt className="text-sm text-slate-500">Deadline</dt><dd className="mt-1 font-medium text-slate-900">{formatDate(tender.deadline)}</dd></div>
                <div><dt className="text-sm text-slate-500">Category</dt><dd className="mt-1 font-medium text-slate-900">{tender.category}</dd></div>
                <div><dt className="text-sm text-slate-500">Submission</dt><dd className="mt-1 font-medium text-slate-900">{tender.submissionMethod || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Description</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.description || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Intake Summary</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.intakeSummary || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Analysis Summary</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.analysisSummary || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.notes || "—"}</dd></div>
              </dl>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Tender files
                {tender.files.length > 0 && <span className="ml-2 text-sm font-normal text-slate-400">({tender.files.length})</span>}
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "+ Upload files"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`mb-4 cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
            >
              <p className="text-sm text-slate-500">Drop tender documents here, or click to browse</p>
              <p className="mt-1 text-xs text-slate-400">PDF, DOCX, XLSX, PPTX, CSV, images — up to 10 MB each</p>
            </div>

            {fileQueue.length > 0 && (
              <ul className="mb-4 space-y-1.5">
                {fileQueue.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3 rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                    <FileTypeBadge name={item.file.name} />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{item.file.name}</span>
                    {item.status === "queued" && <span className="text-xs text-slate-400">queued</span>}
                    {item.status === "uploading" && (
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                        uploading
                      </span>
                    )}
                    {item.status === "done" && <span className="text-xs text-green-600">✓ done</span>}
                    {item.status === "error" && <span className="max-w-[140px] truncate text-xs text-red-600">{item.error}</span>}
                  </li>
                ))}
              </ul>
            )}

            {tender.files.length === 0 ? (
              <p className="text-sm text-slate-400">No tender files uploaded yet.</p>
            ) : (
              <ul className="space-y-2">
                {tender.files.map((file) => (
                  <li key={file.id} className="group rounded-xl border px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileTypeBadge name={file.originalFileName} />
                          <p className="text-sm font-medium text-slate-900 truncate">{file.originalFileName}</p>
                          {file.classification && (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              {file.classification.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <span>{formatBytes(file.size)}</span>
                          <span>·</span>
                          <span>{formatDate(file.createdAt)}</span>
                          <span>·</span>
                          <ExtractionBadge text={file.extractedText} />
                        </div>
                        {file.extractedText?.startsWith("[Scanned") && (
                          <p className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                            ⚠ Scanned PDF — no text layer found. Run OCR or upload a text-based version for AI analysis.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDownloadFile(file.id, file.originalFileName)}
                          className="rounded border px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Requirement snapshot</h2>
            {tender.requirements.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Tender analysis has not created structured requirements yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {tender.requirements.slice(0, 5).map((req) => (
                  <li key={req.id} className="rounded-xl border px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{req.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{req.priority} · {req.requirementType}</p>
                    <p className="mt-2 text-sm text-slate-600">{req.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Compliance gaps</h2>
            {tender.complianceGaps.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No compliance gaps recorded yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {tender.complianceGaps.slice(0, 5).map((gap) => (
                  <li key={gap.id} className="rounded-xl border px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{gap.title}</p>
                      <span className="text-xs font-medium text-amber-700">{gap.severity}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{gap.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Generated outputs</h2>
              <button onClick={() => downloadDoc("compliance")} className="text-xs text-blue-600 hover:underline">↓ Compliance Report</button>
            </div>
            {tender.generatedDocuments.length === 0 ? (
              <p className="text-sm text-slate-400">Run the engine then click "Generate Docs" to create submission-ready files.</p>
            ) : (
              <ul className="space-y-2">
                {tender.generatedDocuments.slice(0, 8).map((doc) => (
                  <li key={doc.id} className="rounded-xl border px-3 py-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.exactFileName ?? doc.name}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          <span className={`text-xs ${doc.generationStatus === "GENERATED" ? "text-green-600" : "text-slate-400"}`}>
                            {doc.generationStatus}
                          </span>
                          {doc.validationStatus && doc.validationStatus !== "PENDING" && (
                            <span className={`text-xs ${doc.validationStatus === "PASSED" ? "text-green-600" : "text-red-500"}`}>
                              · {doc.validationStatus}
                            </span>
                          )}
                          {doc.reviewStatus && doc.reviewStatus !== "PENDING" && (
                            <span className={`text-xs font-medium ${
                              doc.reviewStatus === "APPROVED" ? "text-green-700" :
                              doc.reviewStatus === "REJECTED" ? "text-red-600" :
                              "text-amber-600"
                            }`}>
                              · {doc.reviewStatus}
                            </span>
                          )}
                        </div>
                        {doc.reviewNotes && (
                          <p className="mt-1 text-xs text-slate-500 italic">&ldquo;{doc.reviewNotes}&rdquo;</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {doc.generationStatus === "GENERATED" && (
                          <button
                            onClick={() => { setReviewingDocId(reviewingDocId === doc.id ? null : doc.id); setReviewNote(doc.reviewNotes ?? ""); }}
                            className="text-xs text-slate-500 hover:text-slate-800 border rounded px-2 py-0.5"
                          >
                            Review
                          </button>
                        )}
                        {doc.generationStatus === "GENERATED" && (
                          <button onClick={() => downloadDocById(doc.id)} className="text-xs text-blue-600 hover:underline">↓</button>
                        )}
                      </div>
                    </div>
                    {reviewingDocId === doc.id && (
                      <div className="border-t pt-2 space-y-2">
                        <textarea
                          className="w-full rounded border px-2 py-1.5 text-xs resize-none"
                          rows={2}
                          placeholder="Review notes (optional)"
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                        />
                        <div className="flex gap-1.5">
                          <button onClick={() => submitReview(doc.id, "APPROVED")} className="rounded bg-green-600 px-2.5 py-1 text-xs text-white hover:bg-green-700">Approve</button>
                          <button onClick={() => submitReview(doc.id, "NEEDS_REVISION")} className="rounded bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">Needs Revision</button>
                          <button onClick={() => submitReview(doc.id, "REJECTED")} className="rounded bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700">Reject</button>
                          <button onClick={() => setReviewingDocId(null)} className="rounded border px-2.5 py-1 text-xs">Cancel</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {validationReport && (
        <div className={`rounded-2xl border p-6 shadow-sm ${validationReport.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-lg font-semibold ${validationReport.passed ? "text-green-800" : "text-red-800"}`}>
              {validationReport.passed ? "✓ Validation Passed — Ready for Export" : "✗ Validation Failed"}
            </h2>
            <button onClick={() => setValidationReport(null)} className="text-sm text-slate-400 hover:text-slate-600">Dismiss</button>
          </div>
          {validationReport.issues.length === 0 ? (
            <p className="text-sm text-green-700">All checks passed. This tender package is ready for export.</p>
          ) : (
            <ul className="space-y-2">
              {validationReport.issues.map((issue) => (
                <li key={issue.code} className={`rounded-lg px-3 py-2 text-sm ${issue.severity === "BLOCK" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  <span className="font-medium">{issue.severity === "BLOCK" ? "BLOCKING: " : "WARNING: "}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aiProposal && (
        <div className="rounded-2xl border border-purple-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">✦ AI-Generated Proposal Draft</h2>
            <div className="flex gap-2">
              <button onClick={() => { setForm((c) => ({ ...c, intakeSummary: aiProposal })); setAiProposal(""); }}
                className="rounded-lg bg-black px-3 py-1.5 text-xs text-white hover:bg-slate-800">
                Save as Intake Summary
              </button>
              <button onClick={() => setAiProposal("")}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50">
                Dismiss
              </button>
            </div>
          </div>
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">{aiProposal}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
