"use client";

import { useState } from "react";
import type { ProviderTestResult } from "../app/api/admin/ai-provider-health/test/route";

type TestSummary = {
  tested: number;
  ok: number;
  failed: number;
  skipped: number;
  notConfigured: number;
  notTested: number;
  chainLength: number;
  partial: boolean;
};

type UntestedProvider = { provider: string; reason: string };

type TestResponse = {
  success: boolean;
  results: ProviderTestResult[];
  summary: TestSummary;
  notTested?: UntestedProvider[];
  partial?: boolean;
};

const STATUS_BADGE: Record<ProviderTestResult["status"], string> = {
  ok: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  skipped_cooldown: "bg-amber-100 text-amber-800",
  not_configured: "bg-slate-100 text-slate-500",
  // Deliberately not red: nothing failed. Nothing was measured.
  not_tested: "bg-sky-100 text-sky-800",
};

const STATUS_LABEL: Record<ProviderTestResult["status"], string> = {
  ok: "OK",
  failed: "Failed",
  skipped_cooldown: "Cooldown",
  not_configured: "Not configured",
  not_tested: "Not tested",
};

export function AIHealthTestButton() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProviderTestResult[] | null>(null);
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [notTested, setNotTested] = useState<UntestedProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testedAt, setTestedAt] = useState<string | null>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    setResults(null);
    setSummary(null);
    setNotTested([]);
    try {
      const res = await fetch("/api/admin/ai-provider-health/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as TestResponse;
      setResults(data.results);
      setSummary(data.summary);
      setNotTested(data.notTested ?? []);
      setTestedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={runTest}
        disabled={loading}
        className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Testing providers…" : "Test provider chain"}
      </button>

      {error && (
        <p className="mt-2 text-sm text-red-700">Test failed: {error}</p>
      )}

      {results && summary && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-slate-500">
            Tested at {testedAt} — {summary.ok}/{summary.tested} responded OK
            {summary.skipped > 0 ? `, ${summary.skipped} skipped (cooldown)` : ""}
            {summary.notConfigured > 0 ? `, ${summary.notConfigured} not configured` : ""}
          </p>

          {summary.partial && (
            <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <p className="font-semibold">Partial result — this run hit its time limit.</p>
              <p className="mt-0.5">
                {summary.notTested} of {summary.chainLength} provider(s) in the chain were never contacted, so
                nothing here says whether they work. Test them individually to complete the picture.
              </p>
              {notTested.length > 0 && (
                <p className="mt-0.5 capitalize">Not tested: {notTested.map((p) => p.provider).join(", ")}</p>
              )}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r) => (
              <div key={r.provider} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize text-slate-900">{r.provider}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                {r.model && <p className="mt-0.5 text-xs text-slate-500">Model: {r.model}</p>}
                {r.durationMs > 0 && <p className="mt-0.5 text-xs text-slate-400">{r.durationMs} ms</p>}
                {r.errorCategory && <p className="mt-0.5 text-xs text-red-600">{r.errorCategory}</p>}
                {r.safeError && <p className="mt-0.5 text-xs text-red-500 break-words">{r.safeError}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
