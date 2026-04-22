"use client";
import { useState, useEffect } from "react";

type Settings = {
  companyName: string;
  defaultCurrency: string;
  aiStrictMode: boolean;
  allowBrandingDefault: boolean;
  allowSignatureDefault: boolean;
  allowStampDefault: boolean;
  exportFormat: string;
};

const DEFAULT_SETTINGS: Settings = {
  companyName: "",
  defaultCurrency: "USD",
  aiStrictMode: true,
  allowBrandingDefault: true,
  allowSignatureDefault: true,
  allowStampDefault: true,
  exportFormat: "DOCX",
};

const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/company");
        const data = await res.json();
        if (data.company) {
          setSettings((s) => ({
            ...s,
            companyName: data.company.name ?? "",
            defaultCurrency: data.company.currency ?? "USD",
          }));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Persist company name and currency via company API
      await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: settings.companyName }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-slate-400 text-center py-12">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">Workflow defaults, AI behavior, and generation controls.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Company */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Company Defaults</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Company Display Name</label>
            <input value={settings.companyName} onChange={(e) => set("companyName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Default Currency</label>
            <select value={settings.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* AI */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">AI Behavior</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.aiStrictMode} onChange={(e) => set("aiStrictMode", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300" />
            <div>
              <p className="text-sm font-medium text-slate-800">Strict mode</p>
              <p className="text-xs text-slate-500">Block generation if AI cannot verify all facts against company documents</p>
            </div>
          </label>
        </div>

        {/* Branding */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">Default Branding Permissions</h2>
          <p className="text-xs text-slate-500">These defaults apply when the tender does not explicitly restrict or require these elements.</p>
          {[
            { key: "allowBrandingDefault" as const, label: "Apply letterhead and logo by default", desc: "Include company branding on cover pages and headers" },
            { key: "allowSignatureDefault" as const, label: "Apply authorized signature by default", desc: "Include signature image on declarations" },
            { key: "allowStampDefault" as const, label: "Apply company stamp by default", desc: "Include company stamp on authorization pages" },
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={settings[item.key]} onChange={(e) => set(item.key, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Export */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">Export Format</h2>
          <div className="flex gap-3">
            {["DOCX", "ZIP"].map((fmt) => (
              <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="exportFormat" value={fmt} checked={settings.exportFormat === fmt}
                  onChange={() => set("exportFormat", fmt)} className="h-4 w-4" />
                <span className="text-sm text-slate-700">{fmt === "ZIP" ? "ZIP Package (all files)" : "DOCX (single proposal)"}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
