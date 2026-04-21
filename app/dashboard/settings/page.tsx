"use client";

import { useEffect, useState } from "react";

type Settings = {
  brandingEnabled: boolean;
  allowLetterheadByDefault: boolean;
  allowSignatureByDefault: boolean;
  allowStampByDefault: boolean;
  exportDocxEnabled: boolean;
  exportPdfEnabled: boolean;
  exportZipEnabled: boolean;
  aiStrictMode: boolean;
};

const defaults: Settings = {
  brandingEnabled: true,
  allowLetterheadByDefault: true,
  allowSignatureByDefault: false,
  allowStampByDefault: false,
  exportDocxEnabled: true,
  exportPdfEnabled: true,
  exportZipEnabled: true,
  aiStrictMode: true,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch("/api/company/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data) setSettings({ ...defaults, ...data });
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/company/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        setError("Failed to save settings");
        return;
      }
      const data = await res.json();
      setSettings({ ...defaults, ...data });
      setSuccess("Settings saved.");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-400">Loading settings...</div>;

  const toggles: Array<{ key: keyof Settings; label: string; description: string }> = [
    { key: "brandingEnabled", label: "Branding enabled", description: "Allow company branding rules during generation." },
    { key: "allowLetterheadByDefault", label: "Use letterhead by default", description: "Apply letterhead unless a tender prohibits it." },
    { key: "allowSignatureByDefault", label: "Allow signatures by default", description: "Permit signature placement unless restricted." },
    { key: "allowStampByDefault", label: "Allow stamp by default", description: "Permit stamp placement unless restricted." },
    { key: "exportDocxEnabled", label: "Enable DOCX exports", description: "Allow Word-compatible output generation." },
    { key: "exportPdfEnabled", label: "Enable PDF exports", description: "Reserve PDF export in later generation steps." },
    { key: "exportZipEnabled", label: "Enable ZIP packages", description: "Allow final submission package preparation." },
    { key: "aiStrictMode", label: "AI strict mode", description: "Keep generation tightly constrained to tender and company evidence." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure branding, export behavior, and workflow guardrails for the tender engine.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      <form onSubmit={handleSave} className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="space-y-4">
          {toggles.map((toggle) => (
            <label key={toggle.key} className="flex items-start justify-between gap-4 rounded-xl border px-4 py-4">
              <div>
                <p className="font-medium text-slate-900">{toggle.label}</p>
                <p className="text-sm text-slate-500">{toggle.description}</p>
              </div>
              <input
                type="checkbox"
                checked={settings[toggle.key]}
                onChange={(e) => setSettings({ ...settings, [toggle.key]: e.target.checked })}
                className="mt-1 h-4 w-4"
              />
            </label>
          ))}
        </div>

        <button type="submit" disabled={saving} className="mt-6 rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
