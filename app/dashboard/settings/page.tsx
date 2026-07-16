"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  SETTINGS_PRESENTATION_SEMANTICS,
  type SettingsPresentationSemantics,
} from "./settings-contract";

type Settings = {
  defaultCurrency: string;
  aiStrictMode: boolean;
  allowBrandingDefault: boolean;
  allowSignatureDefault: boolean;
  allowStampDefault: boolean;
  exportFormat: string;
  pageNumbering: boolean;
  includeTableOfContents: boolean;
  language: string;
};

type SettingsResponse = {
  settings?: Partial<Settings> | null;
  presentationSemantics?: SettingsPresentationSemantics;
  error?: string;
  fieldErrors?: Array<{ field: string; message: string }>;
};

const DEFAULT: Settings = {
  defaultCurrency: "USD",
  aiStrictMode: true,
  allowBrandingDefault: true,
  allowSignatureDefault: true,
  allowStampDefault: true,
  exportFormat: "DOCX",
  pageNumbering: true,
  includeTableOfContents: false,
  language: "en",
};

const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES"];

function errorMessage(data: SettingsResponse, fallback: string): string {
  if (data.fieldErrors?.length) {
    return data.fieldErrors.map((item) => `${item.field}: ${item.message}`).join("; ");
  }
  return data.error || fallback;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [semantics, setSemantics] = useState<SettingsPresentationSemantics>(SETTINGS_PRESENTATION_SEMANTICS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/settings", { cache: "no-store", signal });
    const data = await response.json().catch(() => ({})) as SettingsResponse;
    if (!response.ok) throw new Error(errorMessage(data, `Settings could not be loaded (HTTP ${response.status}).`));
    if (data.settings) setSettings({ ...DEFAULT, ...data.settings });
    if (data.presentationSemantics) setSemantics(data.presentationSemantics);
    return data;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void load(controller.signal)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Settings could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [load]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setStatus(null);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json().catch(() => ({})) as SettingsResponse;
      if (!response.ok) throw new Error(errorMessage(data, `Settings could not be saved (HTTP ${response.status}).`));

      // Re-read the server state before claiming success. This prevents an
      // optimistic success message when persistence or normalization differs.
      const refreshed = await load();
      if (!refreshed.settings) throw new Error("The server did not return the saved settings.");
      setStatus("Presentation defaults saved and confirmed by the server.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p role="status" className="py-12 text-center text-slate-500">Loading settings…</p>;
  }

  return (
    <div className="min-w-0 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Authoring and presentation preferences for future document work.</p>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Presentation defaults only</p>
        <p className="mt-1">{semantics.description}</p>
        <p className="mt-2 text-xs text-blue-800">
          These choices never populate tender currency, financial-proposal requirements, submission method, client details, or evidence. Edit company facts in the <Link href="/dashboard/setup" className="font-semibold underline">Setup Wizard</Link>.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {status && (
        <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {status}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5" aria-busy={saving}>
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-slate-900">Authoring preferences</h2>
            <p className="mt-1 text-xs text-slate-500">Used only when a tender does not provide an authoritative value or format requirement.</p>
          </div>

          <div>
            <label htmlFor="default-currency" className="mb-1 block text-xs font-medium text-slate-600">Fallback display currency</label>
            <select
              id="default-currency"
              value={settings.defaultCurrency}
              onChange={(event) => set("defaultCurrency", event.target.value)}
              className="min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black sm:max-w-xs"
            >
              {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">A display fallback only. It is not a tender currency and cannot create a financial-proposal requirement.</p>
          </div>

          <div>
            <label htmlFor="document-language" className="mb-1 block text-xs font-medium text-slate-600">Preferred document language</label>
            <select
              id="document-language"
              value={settings.language}
              onChange={(event) => set("language", event.target.value)}
              className="min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black sm:max-w-xs"
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="ar">Arabic</option>
              <option value="es">Spanish</option>
              <option value="pt">Portuguese</option>
            </select>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Evidence preference</h2>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1">
            <input
              type="checkbox"
              checked={settings.aiStrictMode}
              onChange={(event) => set("aiStrictMode", event.target.checked)}
              className="mt-1 h-5 w-5 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Use stricter evidence checks for generated claims</span>
              <span className="mt-0.5 block text-xs text-slate-500">This preference does not supply facts, requirements, experts, projects, clients, or credentials.</span>
            </span>
          </label>
        </section>

        <section className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Default branding permissions</h2>
          <p className="text-xs text-slate-500">Applied only when tender instructions permit the element.</p>
          {[
            { key: "allowBrandingDefault" as const, label: "Prefer letterhead and logo", description: "Use company branding on cover pages and headers when allowed." },
            { key: "allowSignatureDefault" as const, label: "Prefer authorized signature", description: "Use a reviewed signature on declarations when allowed." },
            { key: "allowStampDefault" as const, label: "Prefer company stamp", description: "Use the reviewed stamp on authorization pages when allowed." },
          ].map((item) => (
            <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-xl p-1">
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={(event) => set(item.key, event.target.checked)}
                className="mt-1 h-5 w-5 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{item.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-slate-900">Document presentation</h2>
            <p className="mt-1 text-xs text-slate-500">Tender-required deliverables and formats always override these preferences.</p>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-600">Preferred first-open document format</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {["DOCX", "PDF"].map((format) => (
                <label key={format} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2">
                  <input
                    type="radio"
                    name="exportFormat"
                    value={format}
                    checked={settings.exportFormat === format}
                    onChange={() => set("exportFormat", format)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-slate-700">{format}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">This does not change the tender’s required submission format or authorize a final package.</p>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1">
            <input type="checkbox" checked={settings.pageNumbering} onChange={(event) => set("pageNumbering", event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300" />
            <span><span className="block text-sm font-medium text-slate-800">Prefer page numbering</span><span className="block text-xs text-slate-500">Applied when document and tender rules allow it.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1">
            <input type="checkbox" checked={settings.includeTableOfContents} onChange={(event) => set("includeTableOfContents", event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300" />
            <span><span className="block text-sm font-medium text-slate-800">Prefer a table of contents</span><span className="block text-xs text-slate-500">Applied to long proposals when permitted.</span></span>
          </label>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="min-h-11 w-full rounded-lg bg-black px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Saving and confirming…" : "Save presentation defaults"}
        </button>
      </form>
    </div>
  );
}
