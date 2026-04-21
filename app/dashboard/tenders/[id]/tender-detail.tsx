"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../../../../components/status-badge";

type Document = { id: string; name: string; size: number; mimeType: string; createdAt: Date };
type Tender = {
  id: string; title: string; description: string | null; reference: string | null;
  category: string; budget: number | null; currency: string; deadline: string | null;
  status: string; requirements: string | null; proposal: string | null; notes: string | null;
  createdAt: Date; updatedAt: Date; documents: Document[];
};

const STATUS_FLOW: Record<string, string> = {
  draft: "active", active: "submitted", submitted: "awarded", awarded: "closed",
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
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: initial.title, description: initial.description ?? "",
    reference: initial.reference ?? "", category: initial.category,
    budget: initial.budget?.toString() ?? "", currency: initial.currency,
    deadline: initial.deadline ?? "", requirements: initial.requirements ?? "",
    notes: initial.notes ?? "", proposal: initial.proposal ?? "",
  });
  const [error, setError] = useState("");

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { setError("Failed to save"); return; }
      const updated = await res.json();
      setTender({ ...tender, ...updated });
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }

  async function handleSave() {
    await save({ ...form, budget: form.budget || null });
    setEditing(false);
  }

  async function handleStatusChange() {
    const next = STATUS_FLOW[tender.status];
    if (!next) return;
    await save({ status: next });
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
      setTender((t) => ({ ...t, documents: [data.document, ...t.documents] }));
    }
    setUploading(false);
    e.target.value = "";
  }

  async function handleProposalSave() {
    await save({ proposal: form.proposal });
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{tender.title}</h1>
            <StatusBadge status={tender.status} />
          </div>
          {tender.reference && <p className="text-sm text-gray-500">Ref: {tender.reference}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {STATUS_FLOW[tender.status] && (
            <button onClick={handleStatusChange} disabled={saving}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 capitalize">
              Mark as {STATUS_FLOW[tender.status]}
            </button>
          )}
          <button onClick={() => setEditing(!editing)}
            className="border px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {/* Details */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Tender Details</h2>
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
                <input type="number" min="0" step="0.01" value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Requirements</label>
                <textarea rows={4} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
              </div>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="bg-black text-white px-5 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            {[
              ["Category", tender.category],
              ["Budget", tender.budget ? `${tender.currency} ${tender.budget.toLocaleString()}` : "—"],
              ["Deadline", tender.deadline || "—"],
              ["Status", <StatusBadge key="s" status={tender.status} />],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-gray-500">{k}</dt>
                <dd className="font-medium text-gray-900 mt-0.5">{v}</dd>
              </div>
            ))}
            {tender.description && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Description</dt>
                <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">{tender.description}</dd>
              </div>
            )}
            {tender.requirements && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Requirements</dt>
                <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">{tender.requirements}</dd>
              </div>
            )}
            {tender.notes && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Notes</dt>
                <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">{tender.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Proposal */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Proposal</h2>
        <textarea
          rows={10}
          value={form.proposal}
          onChange={(e) => setForm({ ...form, proposal: e.target.value })}
          placeholder="Write your proposal here..."
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-y"
        />
        <button onClick={handleProposalSave} disabled={saving}
          className="mt-3 bg-black text-white px-5 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Saving..." : "Save Proposal"}
        </button>
      </div>

      {/* Documents */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Documents ({tender.documents.length})</h2>
          <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-sm transition-colors">
            {uploading ? "Uploading..." : "+ Upload"}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
        {tender.documents.length === 0 ? (
          <p className="text-sm text-gray-400">No documents attached.</p>
        ) : (
          <ul className="space-y-2">
            {tender.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                  <p className="text-xs text-gray-500">{formatBytes(doc.size)} · {doc.mimeType}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
