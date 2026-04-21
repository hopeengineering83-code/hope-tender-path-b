"use client";

import { useState } from "react";
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
};

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

export function TenderDetail({ tender: initial }: { tender: Tender }) {
  const router = useRouter();
  const [tender, setTender] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
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

  async function handleDelete() {
    if (!confirm("Delete this tender? This cannot be undone.")) return;
    setDeleting(true);
    await fetch(`/api/tenders/${tender.id}`, { method: "DELETE" });
    router.push("/dashboard/tenders");
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("tenderId", tender.id);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setTender((current) => ({
        ...current,
        files: [data.fileRecord, ...current.files],
      }));
    } else {
      setError("Upload failed");
    }

    setUploading(false);
    e.target.value = "";
  }

  const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
  const mandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY").length;

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
          <button
            onClick={handleRunEngine}
            disabled={engineRunning}
            className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {engineRunning ? "Running Engine..." : "Run Tender Engine"}
          </button>
          {NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] && (
            <button
              onClick={handleStatusAdvance}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Move to {formatTenderStatus(NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] as string)}
            </button>
          )}
          <button onClick={() => setEditing((value) => !value)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Tender Files</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.files.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Requirements</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.requirements.length}</p>
          <p className="mt-1 text-xs text-slate-500">Mandatory: {mandatoryRequirements}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Compliance Gaps</p>
          <p className="mt-1 text-3xl font-bold text-amber-600">{unresolvedGaps}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Generated Docs</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.generatedDocuments.length}</p>
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
              <h2 className="text-lg font-semibold text-slate-900">Tender files</h2>
              <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
                {uploading ? "Uploading..." : "+ Upload file"}
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            {tender.files.length === 0 ? (
              <p className="text-sm text-slate-400">No tender files uploaded yet.</p>
            ) : (
              <ul className="space-y-3">
                {tender.files.map((file) => (
                  <li key={file.id} className="flex items-center justify-between rounded-xl border px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{file.originalFileName}</p>
                      <p className="text-xs text-slate-500">{formatBytes(file.size)} · {file.mimeType}</p>
                    </div>
                    <p className="text-xs text-slate-400">{formatDate(file.createdAt)}</p>
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
            <h2 className="text-lg font-semibold text-slate-900">Generated outputs</h2>
            {tender.generatedDocuments.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No generated documents have been planned yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {tender.generatedDocuments.slice(0, 5).map((doc) => (
                  <li key={doc.id} className="rounded-xl border px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{doc.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{doc.documentType} · {doc.generationStatus} · {doc.validationStatus}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
