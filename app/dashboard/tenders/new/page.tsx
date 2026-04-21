"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD"];

export default function NewTenderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        const d = await res.json();
        setError(d.error || "Failed to create tender");
        return;
      }
      const tender = await res.json();
      router.push(`/dashboard/tenders/${tender.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">New Tender Intake</h1>
        <p className="mt-1 text-slate-500">Capture enough intake detail for the tender engine to analyze, match, and validate.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
            <input name="title" required placeholder="e.g. Urban master planning consultancy" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Reference Number</label>
            <input name="reference" placeholder="e.g. RFP-2026-004" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Client</label>
            <input name="clientName" placeholder="Client / procurement entity" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
            <select name="category" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Submission Method</label>
            <input name="submissionMethod" placeholder="Portal / email / hard copy" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Budget</label>
            <input name="budget" type="number" min="0" step="0.01" placeholder="0.00" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Currency</label>
            <select name="currency" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Deadline</label>
            <input name="deadline" type="date" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Submission Address / Portal</label>
            <input name="submissionAddress" placeholder="Portal URL, office address, or submission email" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea name="description" rows={3} placeholder="Brief description of the opportunity" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Tender Intake Summary</label>
            <textarea name="intakeSummary" rows={6} placeholder="Paste known requirements, mandatory forms, expert needs, project experience rules, evaluation criteria, and file naming rules" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
            <textarea name="notes" rows={3} placeholder="Internal proposal notes" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {loading ? "Creating..." : "Create Tender"}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-lg border px-6 py-2 text-sm hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
