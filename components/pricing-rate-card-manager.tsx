"use client";

import { useCallback, useEffect, useState } from "react";

type Benchmark = {
  id: string; origin: "SEED" | "OWNER"; market: string; category: string; serviceKey: string; label: string;
  seniority?: string | null; unit: string; currency: string; low: number; median: number; high: number;
  rateBasis: string; effectiveDate: string; source: string; sourceUrl?: string | null; sourceType: string;
  confidence: string; notes?: string | null; lastVerified: string;
};
type RateCard = { available: boolean; owner: Benchmark[]; seed: Benchmark[] };

const CATEGORIES = ["PERSONNEL_FEE", "TRANSPORT", "WORKSHOP", "ENUMERATOR", "LABORATORY", "DRILLING", "SURVEY", "EQUIPMENT", "PRINTING", "PER_DIEM", "PERSONNEL_SALARY"];
/** Per diem is filed by where the work is, as the estimator reads it. */
const PER_DIEM_TIERS: Array<[string, string]> = [
  ["per_diem_addis_ababa", "Addis Ababa"], ["per_diem_regional_capital", "Regional capitals"], ["per_diem_zonal_capital", "Zonal capitals"], ["per_diem_woreda", "Woredas and rural sites"],
];
const CATEGORY_LABEL: Record<string, string> = {
  PERSONNEL_FEE: "Personnel day/month fee", TRANSPORT: "Field transport", WORKSHOP: "Workshop / meeting", ENUMERATOR: "Enumerators",
  LABORATORY: "Laboratory testing", DRILLING: "Drilling / test pits", SURVEY: "Topographic / site survey", EQUIPMENT: "Site vehicle / equipment",
  PRINTING: "Printing and binding", PER_DIEM: "Per diem", SUBCONSULTANT: "Subconsultant", PERSONNEL_SALARY: "Personnel salary (cost)",
  PERCENT_OF_WORKS: "Fee as % of works", STATUTORY_RATE: "Statutory rate",
};
/** The estimate line each category prices, so an entry here prices that line on every tender. */
const SERVICE_KEY: Record<string, string> = {
  TRANSPORT: "field_transport", WORKSHOP: "workshops", ENUMERATOR: "enumerators", LABORATORY: "laboratory",
  DRILLING: "boreholes", SURVEY: "survey", EQUIPMENT: "site_vehicle", PRINTING: "reports",
};
const STALE_AFTER_MONTHS = 24;

function ageMonths(date: string): number {
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.4);
}

function amount(n: number): string {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const today = () => new Date().toISOString().slice(0, 10);

export function PricingRateCardManager() {
  const [card, setCard] = useState<RateCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ category: "TRANSPORT", label: "", seniority: "MID", tier: PER_DIEM_TIERS[0]![0], unit: "DAY", currency: "ETB", market: "ET", low: "", median: "", high: "", source: "", sourceUrl: "", effectiveDate: today() });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/company/pricing-benchmarks", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error();
      setCard(data);
    } catch {
      setError("Failed to load the rate card.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function call(url: string, init: RequestInit, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const rejected = Array.isArray(data.rejected) && data.rejected.length > 0 ? ` ${data.rejected.map((r: { error: string }) => r.error).join("; ")}` : "";
        throw new Error(`${data.error ?? "The change was not saved."}${rejected}`);
      }
      setMessage(done);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change was not saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const entry = {
      category: form.category, label: form.label, unit: form.unit, currency: form.currency, market: form.market,
      seniority: form.category.startsWith("PERSONNEL") ? form.seniority : "",
      serviceKey: form.category === "PER_DIEM" ? form.tier : SERVICE_KEY[form.category],
      median: form.median, low: form.low || form.median, high: form.high || form.median,
      rateBasis: form.category === "PERSONNEL_SALARY" || form.category === "PER_DIEM" ? "COST" : "FEE",
      source: form.source, sourceUrl: form.sourceUrl, sourceType: "OWNER_RATE_CARD", effectiveDate: form.effectiveDate, lastVerified: today(),
    };
    const ok = await call("/api/company/pricing-benchmarks", { method: "POST", body: JSON.stringify({ entries: [entry] }) }, `Added "${form.label}". Every later estimate uses it.`);
    if (ok) setForm({ ...form, label: "", low: "", median: "", high: "", source: "", sourceUrl: "" });
  }

  if (!card) {
    return <p className="text-sm text-slate-600">{error ?? "Loading the rate card…"}</p>;
  }

  return (
    <div className="space-y-6" data-testid="pricing-rate-card">
      {!card.available ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The rate card needs the latest database migration. Estimates still use the public benchmarks below.</p>
      ) : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Your rates ({card.owner.length})</h2>
        <p className="mt-1 text-xs text-slate-500">Rates you entered once — here or when approving a tender price. Each one prices the same line on every later tender in the same currency and market. A rate older than {STALE_AFTER_MONTHS} months is flagged on every estimate that uses it.</p>
        {card.owner.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No rates yet. Lines no evidence can price (vehicle hire, venues, drilling, laboratory work) ask for a rate on the first tender; tick &quot;Save rates I enter to the rate card&quot; when you approve, or add them here.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Unit</th><th className="py-1 pr-2">Rate (low / median / high)</th><th className="py-1 pr-2">Source</th><th className="py-1 pr-2">Dates</th><th className="py-1">Change</th>
                </tr>
              </thead>
              <tbody>
                {card.owner.map((b) => {
                  const stale = ageMonths(b.effectiveDate) > STALE_AFTER_MONTHS;
                  return (
                    <tr key={b.id} className="border-b align-top">
                      <td className="py-1 pr-2 font-medium text-slate-900">{b.label}{b.seniority ? <span className="font-normal text-slate-500"> · {b.seniority.toLowerCase()}</span> : null}</td>
                      <td className="py-1 pr-2">{CATEGORY_LABEL[b.category] ?? b.category}</td>
                      <td className="py-1 pr-2">{b.unit} · {b.currency} · {b.market}</td>
                      <td className="py-1 pr-2">{amount(b.low)} / <span className="font-semibold">{amount(b.median)}</span> / {amount(b.high)}</td>
                      <td className="py-1 pr-2 text-slate-600">{b.sourceUrl ? <a className="underline" href={b.sourceUrl} target="_blank" rel="noreferrer noopener">{b.source}</a> : b.source}</td>
                      <td className="py-1 pr-2 text-slate-600">effective {b.effectiveDate}<br />verified {b.lastVerified}{stale ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">stale</span> : null}</td>
                      <td className="py-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <input aria-label={`New rate for ${b.label}`} className="w-24 rounded border px-1" inputMode="decimal" placeholder={String(b.median)} value={edits[b.id] ?? ""} onChange={(e) => setEdits({ ...edits, [b.id]: e.target.value })} />
                          <button type="button" disabled={busy || !(Number(edits[b.id]) > 0)} className="rounded border px-2 py-0.5 disabled:opacity-50" onClick={() => { void call(`/api/company/pricing-benchmarks?id=${encodeURIComponent(b.id)}`, { method: "PATCH", body: JSON.stringify({ median: Number(edits[b.id]), effectiveDate: today(), lastVerified: today() }) }, `Updated "${b.label}".`).then((ok) => { if (ok) setEdits({ ...edits, [b.id]: "" }); }); }}>Save rate</button>
                          <button type="button" disabled={busy} className="rounded border px-2 py-0.5 disabled:opacity-50" onClick={() => { void call(`/api/company/pricing-benchmarks?id=${encodeURIComponent(b.id)}`, { method: "PATCH", body: JSON.stringify({ lastVerified: today() }) }, `Confirmed "${b.label}" is still current.`); }}>Still current</button>
                          <button type="button" disabled={busy} className="rounded border border-rose-300 px-2 py-0.5 text-rose-700 disabled:opacity-50" onClick={() => { if (window.confirm(`Remove "${b.label}" from the rate card?`)) void call(`/api/company/pricing-benchmarks?id=${encodeURIComponent(b.id)}`, { method: "DELETE" }, `Removed "${b.label}".`); }}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Add a rate</h2>
        <p className="mt-1 text-xs text-slate-500">Every rate needs a source (a quote, an invoice, a published scale) and the date it applies from. A rate without them is refused.</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <label className="flex flex-col text-xs text-slate-600">Type
            <select className="rounded border px-1 py-1 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">Item
            <input className="rounded border px-1 py-1 text-sm" placeholder={form.category === "PERSONNEL_FEE" ? "e.g. Structural Engineer" : "e.g. 4WD with driver and fuel"} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          {form.category.startsWith("PERSONNEL") ? (
            <label className="flex flex-col text-xs text-slate-600">Seniority
              <select className="rounded border px-1 py-1 text-sm" value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })}>
                <option value="JUNIOR">Junior</option><option value="MID">Mid-career</option><option value="SENIOR">Senior</option><option value="EXPERT">Expert / team lead</option>
              </select>
            </label>
          ) : null}
          {form.category === "PER_DIEM" ? (
            <label className="flex flex-col text-xs text-slate-600">Where
              <select className="rounded border px-1 py-1 text-sm" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {PER_DIEM_TIERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col text-xs text-slate-600">Unit
            <select className="rounded border px-1 py-1 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {["DAY", "MONTH", "EACH", "LUMP_SUM", "KM"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">Currency
            <input className="rounded border px-1 py-1 text-sm" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">Market (country code)
            <input className="rounded border px-1 py-1 text-sm" maxLength={2} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">Rate
            <input className="rounded border px-1 py-1 text-sm" inputMode="decimal" value={form.median} onChange={(e) => setForm({ ...form, median: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">Low (optional)
            <input className="rounded border px-1 py-1 text-sm" inputMode="decimal" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">High (optional)
            <input className="rounded border px-1 py-1 text-sm" inputMode="decimal" value={form.high} onChange={(e) => setForm({ ...form, high: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600 sm:col-span-2">Source
            <input className="rounded border px-1 py-1 text-sm" placeholder="e.g. Car-hire quotation, September 2026" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">Applies from
            <input type="date" className="rounded border px-1 py-1 text-sm" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          </label>
          <label className="flex flex-col text-xs text-slate-600 sm:col-span-3">Source link (optional)
            <input className="rounded border px-1 py-1 text-sm" placeholder="https://…" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} />
          </label>
        </div>
        <button type="button" disabled={busy || !form.label || !(Number(form.median) > 0) || form.source.trim().length < 5} className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" onClick={() => { void add(); }}>
          Add to rate card
        </button>
      </section>

      {message ? <p className="text-sm text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700" role="alert">{error}</p> : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Public benchmarks the app ships ({card.seed.length})</h2>
        <p className="mt-1 text-xs text-slate-500">Published figures, each with its source and date. Personnel without a rate of yours are priced from the salary scale through a visible cost, overhead and margin build. Nothing here is an invented market rate.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
          {card.seed.map((b) => (
            <li key={b.id}>
              <span className="font-medium">{b.label}</span>: {amount(b.median)} {b.currency}/{b.unit.toLowerCase()} — {b.sourceUrl ? <a className="underline" href={b.sourceUrl} target="_blank" rel="noreferrer noopener">{b.source}</a> : b.source} (effective {b.effectiveDate}, {b.confidence}{ageMonths(b.effectiveDate) > STALE_AFTER_MONTHS ? ", stale" : ""})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
