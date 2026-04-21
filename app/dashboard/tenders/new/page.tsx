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
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Tender</h1>
        <p className="text-gray-500 mt-1">Fill in the details for the tender opportunity.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-6 space-y-5">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input name="title" required placeholder="e.g. IT Infrastructure Upgrade" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number</label>
            <input name="reference" placeholder="e.g. TND-2024-001" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select name="category" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
            <input name="budget" type="number" min="0" step="0.01" placeholder="0.00" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <select name="currency" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black bg-white">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
            <input name="deadline" type="date" className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea name="description" rows={3} placeholder="Brief description of the tender..." className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Requirements / Scope</label>
            <textarea name="requirements" rows={4} placeholder="Technical requirements, eligibility criteria..." className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea name="notes" rows={2} placeholder="Internal notes..." className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black resize-none" />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="bg-black text-white px-6 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
            {loading ? "Creating..." : "Create Tender"}
          </button>
          <button type="button" onClick={() => router.back()} className="border px-6 py-2 rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
