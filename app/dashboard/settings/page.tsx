"use client";
import { useState, useEffect } from "react";

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

const DEFAULT: Settings = {
  defaultCurrency:"USD", aiStrictMode:true, allowBrandingDefault:true,
  allowSignatureDefault:true, allowStampDefault:true, exportFormat:"DOCX",
  pageNumbering:true, includeTableOfContents:false, language:"en",
};

const CURRENCIES = ["USD","EUR","GBP","AED","SAR","KWD","QAR","OMR","EGP","ETB","NGN","ZAR","KES"];

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULT);
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [settingsRes, companyRes] = await Promise.all([
          fetch("/api/settings"), fetch("/api/company"),
        ]);
        const settingsData = await settingsRes.json() as { settings?: Settings };
        const companyData = await companyRes.json() as { company?: { name?: string } };
        if (settingsData.settings) setS({ ...DEFAULT, ...settingsData.settings });
        if (companyData.company?.name) setCompanyName(companyData.company.name);
      } finally { setLoading(false); }
    }
    load();
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      await Promise.all([
        fetch("/api/settings", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(s) }),
        fetch("/api/company", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name: companyName }) }),
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <p className="text-slate-400 text-center py-12">Loading…</p>;

  return (
    <div className="space-y-6 max-w-2xl">
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
            <input value={companyName} onChange={e=>setCompanyName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Default Currency</label>
            <select value={s.defaultCurrency} onChange={e=>set("defaultCurrency",e.target.value)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black">
              {CURRENCIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Document Language</label>
            <select value={s.language} onChange={e=>set("language",e.target.value)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black">
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="ar">Arabic</option>
              <option value="es">Spanish</option>
              <option value="pt">Portuguese</option>
            </select>
          </div>
        </div>

        {/* AI */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">AI Behavior</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={s.aiStrictMode} onChange={e=>set("aiStrictMode",e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            <div>
              <p className="text-sm font-medium text-slate-800">Strict mode</p>
              <p className="text-xs text-slate-500">Block generation if AI cannot verify facts against company documents</p>
            </div>
          </label>
        </div>

        {/* Branding */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">Default Branding Permissions</h2>
          <p className="text-xs text-slate-500">Applied when the tender does not explicitly restrict or require these elements.</p>
          {[
            { key:"allowBrandingDefault" as const, label:"Apply letterhead and logo by default", desc:"Include company branding on cover pages and headers" },
            { key:"allowSignatureDefault" as const, label:"Apply authorized signature by default", desc:"Include signature on declarations" },
            { key:"allowStampDefault" as const, label:"Apply company stamp by default", desc:"Include stamp on authorization pages" },
          ].map(item => (
            <label key={item.key} className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={s[item.key]} onChange={e=>set(item.key,e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Export */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-slate-900">Export &amp; Document Format</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Default Export Format</label>
            <div className="flex gap-4">
              {["DOCX","ZIP"].map(fmt => (
                <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="exportFormat" value={fmt} checked={s.exportFormat===fmt} onChange={()=>set("exportFormat",fmt)} className="h-4 w-4" />
                  <span className="text-sm text-slate-700">{fmt==="ZIP"?"ZIP Package (all files)":"DOCX (single proposal)"}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={s.pageNumbering} onChange={e=>set("pageNumbering",e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            <div>
              <p className="text-sm font-medium text-slate-800">Page numbering</p>
              <p className="text-xs text-slate-500">Add page numbers to generated documents</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={s.includeTableOfContents} onChange={e=>set("includeTableOfContents",e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            <div>
              <p className="text-sm font-medium text-slate-800">Include table of contents</p>
              <p className="text-xs text-slate-500">Auto-generate ToC for long proposals (where allowed by tender)</p>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving?"Saving…":"Save Settings"}
          </button>
          {saved && <span className="text-sm text-green-600">✓ Settings saved</span>}
        </div>
      </form>
    </div>
  );
}
