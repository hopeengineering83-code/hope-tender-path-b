"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = ["General","IT","Construction","Services","Consulting","Supply","Healthcare","Education","Infrastructure","Urban Planning","Environmental","Other"];
const CURRENCIES = ["USD","EUR","GBP","ZAR","AUD","CAD","AED","SAR","KWD","EGP","ETB","NGN"];

export default function NewTenderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  async function handleUploadFirst() {
    setUploading(true);
    setUploadError("");
    try {
      if (files.length === 0) {
        setUploadError("Upload at least one tender document first.");
        return;
      }
      const form = new FormData();
      for (const file of files) form.append("file", file);
      const res = await fetch("/api/tenders/upload-first", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || "Upload-first tender intake failed");
        return;
      }
      router.push(`/dashboard/tenders/${data.tenderId}`);
    } catch {
      setUploadError("Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setError("");
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    try {
      const res = await fetch("/api/tenders", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error||"Failed to create tender"); return; }
      const tender = await res.json();
      router.push(`/dashboard/tenders/${tender.id}`);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Tender Intake</h1>
        <p className="mt-1 text-slate-500 text-sm">Upload tender documents first so the app can extract details, requirements, matching, and compliance automatically. Manual fields remain available as a fallback.</p>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Upload tender documents first</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">The app will create the tender record, extract title/reference/client/deadline/submission method from the uploaded files, run analysis, and rank best-fit experts and projects with 10 matching cycles.</p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-dashed border-blue-300 bg-white p-5">
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full rounded-xl border bg-white px-3 py-3 text-sm"
          />
          {files.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              {files.map((file) => <div key={`${file.name}-${file.size}`} className="rounded-lg bg-slate-50 px-3 py-2">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</div>)}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleUploadFirst()}
            disabled={uploading}
            className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Extracting and running engine…" : "Create Tender from Uploaded Documents"}
          </button>
          {uploadError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadError}</div>}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Manual tender intake fallback</h2>
          <p className="mt-1 text-sm text-slate-500">Use this only when you do not have tender documents yet.</p>
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
            <input name="title" required placeholder="e.g. Urban master planning consultancy" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Reference Number</label>
            <input name="reference" placeholder="e.g. RFP-2026-004" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Client</label>
            <input name="clientName" placeholder="Client / procurement entity" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
            <select name="category" className="w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black">
              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Country</label>
            <input name="country" placeholder="Country of procurement" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Submission Method</label>
            <input name="submissionMethod" placeholder="Portal / email / hard copy" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Deadline</label>
            <input name="deadline" type="date" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Budget</label>
            <input name="budget" type="number" min="0" step="0.01" placeholder="0.00" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Currency</label>
            <select name="currency" className="w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black">
              {CURRENCIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Submission Address / Portal</label>
            <input name="submissionAddress" placeholder="Portal URL, office address, or submission email" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea name="description" rows={3} placeholder="Brief description of the opportunity" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Tender Intake Summary</label>
            <textarea name="intakeSummary" rows={6} placeholder="Paste known requirements, mandatory forms, expert needs, project experience rules, evaluation criteria, and file naming rules" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Internal Notes</label>
            <textarea name="notes" rows={2} placeholder="Internal proposal notes (not included in submissions)" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {loading?"Creating...":"Create Manual Tender"}
          </button>
          <button type="button" onClick={()=>router.back()} className="rounded-lg border px-6 py-2 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </div>
  );
}
