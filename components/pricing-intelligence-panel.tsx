"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { emitTenderWorkflowSync, subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";

type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
type Line = {
  key: string; category: string; label: string; quantity: number; unit: string;
  quantityBasis: string; quantityConfidence: Confidence;
  rate: number | null; amount: number | null;
  rateBasis: string; rateSource: string; sourceDate: string | null; rateConfidence: Confidence;
  confidence: Confidence; assumptions: string[];
  build?: { costRate: number; overheadPct: number; marginPct: number } | null;
};
type Warning = { code: string; message: string };
type BenchmarkRef = { id: string; label: string; source: string; sourceUrl: string | null; effectiveDate: string; confidence: string; origin: "SEED" | "OWNER" };
type Scenario = { id: string; label: string; description: string; contingencyPct: number; overheadPct?: number; marginPct?: number; build?: { directCost: number; overhead: number; margin: number; feeLines: number }; lines: Line[]; subtotal: number; contingency: number; vat: number; offerTotal: number; complete: boolean; notes: string[] };
type Estimate = {
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_EVIDENCE";
  currency: string; currencyBasis: string;
  vatPercent: number; vatBasis: string;
  withholdingPct: number; withholdingBasis: string;
  validityDays: number; validityBasis: string;
  durationMonths: number; durationBasis: string;
  budget: { amount: number; currency: string; basis: string } | null;
  envelope: { low: number; median: number; high: number; basis: string; confidence: Confidence; comparables: string[] } | null;
  scenarios: Scenario[];
  recommended: string;
  recommendation: string;
  lowConfidence: string[];
  evidenceUsed: string[];
  warnings?: Warning[];
  evaluation?: { model: string; technicalWeight: number | null; financialWeight: number | null; basis: string };
  benchmarksUsed?: BenchmarkRef[];
};

/** The rate-card category for an estimate line, so an entered rate prices the same line on the next tender. */
const LINE_CATEGORY: Record<string, string> = {
  "field-transport": "TRANSPORT", "per-diem": "PER_DIEM", "enumerators": "ENUMERATOR", "workshops": "WORKSHOP",
  "boreholes": "DRILLING", "laboratory": "LABORATORY", "survey": "SURVEY", "site-vehicle": "EQUIPMENT", "reports": "PRINTING",
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 border-emerald-200",
  MEDIUM: "bg-sky-50 text-sky-700 border-sky-200",
  LOW: "bg-amber-50 text-amber-800 border-amber-300",
  NONE: "bg-rose-50 text-rose-700 border-rose-300",
};

function money(value: number, currency: string): string {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PricingIntelligencePanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [scenarioId, setScenarioId] = useState<string>("BALANCED");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveToRateCard, setSaveToRateCard] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/pricing/estimate`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to load the estimate (${res.status})`);
      setEstimate(data.estimate);
      setScenarioId((current) => current || data.estimate?.recommended || "BALANCED");
    } catch {
      setError("Failed to load the pricing estimate.");
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void load(); }), [load, tenderId]);

  const scenario = useMemo(() => estimate?.scenarios.find((s) => s.id === scenarioId) ?? null, [estimate, scenarioId]);

  const adjusted = useMemo(() => {
    if (!scenario) return { total: 0, unpriced: 0 };
    let subtotal = 0;
    let unpriced = 0;
    for (const l of scenario.lines) {
      if (excluded[l.key]) continue;
      const rate = rates[l.key] !== undefined && rates[l.key] !== "" ? Number(rates[l.key]) : l.rate;
      const qty = quantities[l.key] !== undefined && quantities[l.key] !== "" ? Number(quantities[l.key]) : l.quantity;
      if (!rate || !(rate > 0)) { unpriced += 1; continue; }
      subtotal += rate * qty;
    }
    const contingency = subtotal * scenario.contingencyPct / 100;
    const vat = (subtotal + contingency) * (estimate?.vatPercent ?? 0) / 100;
    return { total: subtotal + contingency + vat, unpriced };
  }, [scenario, rates, quantities, excluded, estimate]);

  async function approve() {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const numeric = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== "" && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    try {
      // Rates the owner typed for lines the evidence could not price go to the
      // rate card too, so the next tender prices them without asking again.
      const typed = scenario.lines.filter((l) => !excluded[l.key] && l.rate === null && Number(rates[l.key]) > 0 && (l.category === "PERSONNEL" ? l.unit === "DAY" : LINE_CATEGORY[l.key]));
      if (saveToRateCard && typed.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await fetch("/api/company/pricing-benchmarks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entries: typed.map((l) => ({
              category: l.category === "PERSONNEL" ? "PERSONNEL_FEE" : LINE_CATEGORY[l.key],
              serviceKey: l.category === "PERSONNEL" ? undefined : l.key.replace(/-/g, "_"),
              label: l.label.split(" — ")[0],
              unit: l.unit, currency: estimate?.currency, median: Number(rates[l.key]),
              source: "Rate entered by the owner when approving a tender price",
              sourceType: "OWNER_RATE_CARD", confidence: "HIGH", effectiveDate: today, lastVerified: today,
            })),
          }),
        }).catch(() => null);
      }
      const res = await fetch(`/api/tenders/${tenderId}/pricing/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: scenario.id,
          rates: numeric(rates),
          quantities: numeric(quantities),
          exclude: Object.entries(excluded).filter(([, v]) => v).map(([k]) => k),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const list = Array.isArray(data.unpriced) ? ` ${data.unpriced.map((u: { label: string }) => u.label).join("; ")}` : "";
        throw new Error(`${data.error ?? "Approval failed."}${list}`);
      }
      setMessage(`Approved ${scenario.label}: ${money(data.approved.offerTotal, data.approved.currency)}. The financial proposal is being written and packaged automatically.`);
      emitTenderWorkflowSync({ tenderId, source: "pricing-approve" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!estimate) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="pricing-intelligence-heading">
        <h3 id="pricing-intelligence-heading" className="text-base font-semibold text-slate-900">Pricing Intelligence</h3>
        <p className="mt-2 text-sm text-slate-600">{error ?? "Preparing the estimated price…"}</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="pricing-intelligence-heading" data-testid="pricing-intelligence-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="pricing-intelligence-heading" className="text-base font-semibold text-slate-900">Pricing Intelligence</h3>
          <p className="text-xs text-slate-500">An estimated bid price from the tender and the firm&apos;s own evidence. Nothing is priced until you approve it.</p>
        </div>
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${estimate.status === "COMPLETE" ? CONFIDENCE_STYLE.MEDIUM : estimate.status === "PARTIAL" ? CONFIDENCE_STYLE.LOW : CONFIDENCE_STYLE.NONE}`}>
          {estimate.status === "COMPLETE" ? "Estimate complete" : estimate.status === "PARTIAL" ? "Some rates needed" : "Rates needed"}
        </span>
      </div>

      <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-800" data-testid="pricing-recommendation">{estimate.recommendation}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pricing scenario">
        {estimate.scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === scenarioId}
            onClick={() => setScenarioId(s.id)}
            className={`rounded border p-3 text-left text-sm ${s.id === scenarioId ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}
          >
            <div className="font-semibold text-slate-900">{s.label}{s.id === estimate.recommended ? " ★" : ""}</div>
            <div className="mt-1 text-slate-900">{s.complete ? money(s.offerTotal, estimate.currency) : "Rates needed"}</div>
            <div className="mt-1 text-xs text-slate-500">{s.description}</div>
          </button>
        ))}
      </div>

      {estimate.evaluation ? (
        <p className="mt-2 text-xs text-slate-600" data-testid="pricing-evaluation"><span className="font-medium">Evaluation:</span> {estimate.evaluation.model === "UNKNOWN" ? "not stated" : estimate.evaluation.model} — {estimate.evaluation.basis}</p>
      ) : null}
      {scenario?.build && (scenario.build.directCost > 0 || scenario.build.feeLines > 0) ? (
        <p className="mt-1 text-xs text-slate-600" data-testid="pricing-build">
          <span className="font-medium">Price build ({scenario.label}):</span> cost {money(scenario.build.directCost, estimate.currency)} + overhead {money(scenario.build.overhead, estimate.currency)} + margin {money(scenario.build.margin, estimate.currency)} (cost-built personnel) + fee and reimbursable lines {money(scenario.build.feeLines, estimate.currency)} → subtotal {money(scenario.subtotal, estimate.currency)} + contingency {money(scenario.contingency, estimate.currency)} + VAT {money(scenario.vat, estimate.currency)} = offer {money(scenario.offerTotal, estimate.currency)}.{estimate.withholdingPct > 0 ? ` Withholding ${estimate.withholdingPct}% is deducted by the client at payment; it does not reduce the offer.` : ""}
        </p>
      ) : null}

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
        <div><dt className="inline font-medium">Currency:</dt> <dd className="inline">{estimate.currency} — {estimate.currencyBasis}</dd></div>
        <div><dt className="inline font-medium">VAT:</dt> <dd className="inline">{estimate.vatPercent}% — {estimate.vatBasis}</dd></div>
        <div><dt className="inline font-medium">Period:</dt> <dd className="inline">{estimate.durationMonths} months — {estimate.durationBasis}</dd></div>
        <div><dt className="inline font-medium">Validity:</dt> <dd className="inline">{estimate.validityDays} days — {estimate.validityBasis}</dd></div>
        {estimate.budget ? <div><dt className="inline font-medium">Client budget:</dt> <dd className="inline">{money(estimate.budget.amount, estimate.budget.currency)} — {estimate.budget.basis}</dd></div> : null}
        {estimate.envelope ? <div><dt className="inline font-medium">Past-contract envelope:</dt> <dd className="inline">{money(estimate.envelope.median, estimate.currency)} median — {estimate.envelope.basis}</dd></div> : null}
      </dl>

      {scenario ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1 pr-2">Line</th><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Unit</th><th className="py-1 pr-2">Rate</th><th className="py-1 pr-2">Amount</th><th className="py-1 pr-2">Basis / source</th><th className="py-1 pr-2">Confidence</th>{canMutate ? <th className="py-1">Include</th> : null}
              </tr>
            </thead>
            <tbody>
              {scenario.lines.map((l) => (
                <tr key={l.key} className={`border-b align-top ${excluded[l.key] ? "opacity-50" : ""}`}>
                  <td className="py-1 pr-2 font-medium text-slate-900">{l.label}<div className="font-normal text-slate-500">{l.quantityBasis}</div></td>
                  <td className="py-1 pr-2">
                    {canMutate
                      ? <input aria-label={`Quantity for ${l.label}`} className="w-16 rounded border px-1" inputMode="decimal" value={quantities[l.key] ?? String(l.quantity)} onChange={(e) => setQuantities({ ...quantities, [l.key]: e.target.value })} />
                      : l.quantity}
                  </td>
                  <td className="py-1 pr-2">{l.unit}</td>
                  <td className="py-1 pr-2">
                    {canMutate
                      ? <input aria-label={`Rate for ${l.label}`} className={`w-24 rounded border px-1 ${l.rate === null && !rates[l.key] ? "border-rose-400" : ""}`} inputMode="decimal" placeholder="Enter rate" value={rates[l.key] ?? (l.rate === null ? "" : String(l.rate))} onChange={(e) => setRates({ ...rates, [l.key]: e.target.value })} />
                      : l.rate === null ? "—" : l.rate.toLocaleString()}
                  </td>
                  <td className="py-1 pr-2">{l.amount === null ? "—" : l.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="py-1 pr-2 text-slate-600">{l.rateBasis}{l.sourceDate ? ` (${l.sourceDate})` : ""}{l.assumptions.length > 0 ? <div className="text-slate-500">{l.assumptions.join(" ")}</div> : null}</td>
                  <td className="py-1 pr-2"><span className={`rounded border px-1.5 py-0.5 ${CONFIDENCE_STYLE[l.confidence]}`}>{l.confidence}</span></td>
                  {canMutate ? <td className="py-1"><input type="checkbox" aria-label={`Include ${l.label}`} checked={!excluded[l.key]} onChange={(e) => setExcluded({ ...excluded, [l.key]: !e.target.checked })} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {estimate.warnings && estimate.warnings.length > 0 ? (
        <details className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900" open data-testid="pricing-warnings">
          <summary className="cursor-pointer font-medium">Pricing warnings ({estimate.warnings.length})</summary>
          <ul className="mt-1 list-disc pl-5">{estimate.warnings.map((w) => <li key={`${w.code}:${w.message}`}><span className="font-mono">{w.code}</span> — {w.message}</li>)}</ul>
        </details>
      ) : null}

      {estimate.benchmarksUsed && estimate.benchmarksUsed.length > 0 ? (
        <details className="mt-3 rounded border border-slate-200 p-2 text-xs text-slate-700" data-testid="pricing-sources">
          <summary className="cursor-pointer font-medium">Benchmark sources ({estimate.benchmarksUsed.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {estimate.benchmarksUsed.map((b) => (
              <li key={b.id}>
                {b.label} — {b.origin === "OWNER" ? "your rate card" : b.sourceUrl ? <a className="underline" href={b.sourceUrl} target="_blank" rel="noreferrer noopener">{b.source}</a> : b.source} (effective {b.effectiveDate}, {b.confidence})
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {estimate.lowConfidence.length > 0 ? (
        <details className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" open={estimate.status !== "COMPLETE"}>
          <summary className="cursor-pointer font-medium">Check before approving ({estimate.lowConfidence.length})</summary>
          <ul className="mt-1 list-disc pl-5">{estimate.lowConfidence.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      ) : null}

      {canMutate && scenario ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => { void approve(); }}
            disabled={busy || adjusted.unpriced > 0}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-testid="pricing-approve"
          >
            {busy ? "Approving…" : `Approve ${scenario.label} price — ${money(adjusted.total, estimate.currency)}`}
          </button>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={saveToRateCard} onChange={(e) => setSaveToRateCard(e.target.checked)} />
            Save rates I enter to the rate card for future tenders
          </label>
          {adjusted.unpriced > 0 ? <span className="text-xs text-rose-700">Enter a rate for {adjusted.unpriced} line(s) or untick them.</span> : null}
        </div>
      ) : null}
      {message ? <p className="mt-2 text-sm text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
