"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";

type CostLine = {
  id: string;
  category: string;
  label: string;
  quantity: number;
  unit: string;
  rate: number;
  expertId: string | null;
  total: number;
  notes: string | null;
};

type PricingWorkbook = {
  id: string;
  tenderId: string;
  currency: string;
  validityDays: number;
  vatPercent: number;
  withholdingPct: number;
  contingencyPct: number;
  scenario: string;
  noPriceLeakage: boolean;
  notes: string | null;
  totals: {
    subtotal: number;
    contingency: number;
    withholding: number;
    vat: number;
    grandTotal: number;
    lineCount: number;
  };
  lines: CostLine[];
};

type DraftLine = {
  category: string;
  label: string;
  quantity: string;
  unit: string;
  rate: string;
  notes: string;
};

const CATEGORIES = ["PERSONNEL", "REIMBURSABLE", "SUBCONSULTANT", "EQUIPMENT", "TRAVEL", "OTHER"];
const UNITS = ["DAY", "MONTH", "LUMP_SUM", "EACH", "KM"];
const SCENARIOS = ["AGGRESSIVE", "BALANCED", "CONSERVATIVE"];

const EMPTY_LINE: DraftLine = { category: "PERSONNEL", label: "", quantity: "1", unit: "DAY", rate: "0", notes: "" };

function money(value: number, currency: string): string {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PricingWorkbookPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [workbook, setWorkbook] = useState<PricingWorkbook | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftLine>(EMPTY_LINE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/pricing`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to load pricing workbook (${res.status})`);
      setWorkbook(data.workbook);
    } catch (err) {
      setError("Failed to load pricing workbook.");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  // Auto-load on mount + auto-refresh on workflow sync — no manual Load button needed.
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void load(); }), [load, tenderId]);

  async function saveHeader(patch: Partial<PricingWorkbook>) {
    if (!workbook) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...workbook, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to save pricing workbook (${res.status})`);
      setWorkbook(data.workbook);
      router.refresh();
    } catch (err) {
      setError("Failed to save pricing workbook.");
    } finally {
      setSaving(false);
    }
  }

  async function addLine() {
    if (!draft.label.trim()) {
      setError("Line label is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/pricing/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: draft.category,
          label: draft.label,
          quantity: Number(draft.quantity),
          unit: draft.unit,
          rate: Number(draft.rate),
          notes: draft.notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to add cost line (${res.status})`);
      setDraft(EMPTY_LINE);
      await load();
      router.refresh();
    } catch (err) {
      setError("Failed to add cost line.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLine(lineId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/pricing/lines/${lineId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to delete cost line (${res.status})`);
      await load();
      router.refresh();
    } catch (err) {
      setError("Failed to delete cost line.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Pricing Workbook</h3>
          <p className="mt-0.5 text-xs text-slate-500">Build the commercial workbook, validate price leakage status, and keep financial assumptions structured.</p>
        </div>
        {/* Load/Refresh button removed — panel auto-loads on mount and auto-refreshes via workflow sync. */}
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {!workbook && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          Pricing workbook will appear here once the tender pipeline creates it.
        </div>
      )}

      {workbook && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <label className="text-xs text-slate-600">Currency<input value={workbook.currency} onChange={(e) => setWorkbook({ ...workbook, currency: e.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" /></label>
            <label className="text-xs text-slate-600">Validity days<input type="number" value={workbook.validityDays} onChange={(e) => setWorkbook({ ...workbook, validityDays: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" /></label>
            <label className="text-xs text-slate-600">VAT %<input type="number" value={workbook.vatPercent} onChange={(e) => setWorkbook({ ...workbook, vatPercent: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" /></label>
            <label className="text-xs text-slate-600">Withholding %<input type="number" value={workbook.withholdingPct} onChange={(e) => setWorkbook({ ...workbook, withholdingPct: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" /></label>
            <label className="text-xs text-slate-600">Contingency %<input type="number" value={workbook.contingencyPct} onChange={(e) => setWorkbook({ ...workbook, contingencyPct: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" /></label>
            <label className="text-xs text-slate-600">Scenario<select value={workbook.scenario} onChange={(e) => setWorkbook({ ...workbook, scenario: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs">{SCENARIOS.map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={workbook.noPriceLeakage} onChange={(e) => setWorkbook({ ...workbook, noPriceLeakage: e.target.checked })} /> Technical envelope has no price leakage</label>
            {canMutate && (
            <button type="button" disabled={saving} onClick={() => void saveHeader({})} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">Save pricing settings</button>
            )}
          </div>

          <div className="grid gap-2 rounded-xl border border-slate-100 bg-white p-3 text-xs md:grid-cols-5">
            <div><p className="text-slate-500">Subtotal</p><p className="font-bold text-slate-900">{money(workbook.totals.subtotal, workbook.currency)}</p></div>
            <div><p className="text-slate-500">Contingency</p><p className="font-bold text-slate-900">{money(workbook.totals.contingency, workbook.currency)}</p></div>
            <div><p className="text-slate-500">VAT</p><p className="font-bold text-slate-900">{money(workbook.totals.vat, workbook.currency)}</p></div>
            <div><p className="text-slate-500">Withholding</p><p className="font-bold text-slate-900">{money(workbook.totals.withholding, workbook.currency)}</p></div>
            <div><p className="text-slate-500">Grand total</p><p className="font-bold text-emerald-700">{money(workbook.totals.grandTotal, workbook.currency)}</p></div>
          </div>

          <div className="rounded-xl border border-slate-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Add cost line</p>
            <div className="mt-2 grid gap-2 md:grid-cols-6">
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="rounded-lg border px-2 py-1.5 text-xs">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label / role" className="rounded-lg border px-2 py-1.5 text-xs md:col-span-2" />
              <input type="number" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className="rounded-lg border px-2 py-1.5 text-xs" />
              <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="rounded-lg border px-2 py-1.5 text-xs">{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
              <input type="number" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} placeholder="Rate" className="rounded-lg border px-2 py-1.5 text-xs" />
            </div>
            <div className="mt-2 flex gap-2">
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" />
              {canMutate && (
              <button type="button" disabled={saving} onClick={() => void addLine()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">Add line</button>
              )}
            </div>
          </div>

          {workbook.lines.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Label</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-left">Unit</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {workbook.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{line.category}</td><td className="px-3 py-2 font-medium text-slate-900">{line.label}</td><td className="px-3 py-2 text-right">{line.quantity}</td><td className="px-3 py-2">{line.unit}</td><td className="px-3 py-2 text-right">{money(line.rate, workbook.currency)}</td><td className="px-3 py-2 text-right font-semibold">{money(line.total, workbook.currency)}</td><td className="px-3 py-2 text-right">{canMutate && (<button type="button" onClick={() => void deleteLine(line.id)} className="text-red-600 hover:underline">Delete</button>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
