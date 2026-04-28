"use client";
import { useState, useEffect, useRef } from "react";

type Asset = { id: string; assetType: string; originalFileName: string; mimeType: string; size: number; isActive: boolean; createdAt: string; };

const ASSET_TYPES = [
  { value: "LETTERHEAD", label: "Letterhead DOCX Template", desc: "Upload official Word letterhead. Header and footer repeat on generated pages." },
  { value: "LOGO", label: "Company Logo", desc: "Backup logo used when no DOCX letterhead is active" },
  { value: "HEADER", label: "Page Header", desc: "Optional separate header file" },
  { value: "FOOTER", label: "Page Footer", desc: "Optional separate footer file" },
  { value: "SIGNATURE", label: "Authorized Signature", desc: "Used on declarations and sign-off pages" },
  { value: "STAMP", label: "Company Stamp / Seal", desc: "Official stamp for declarations requiring authorization" },
];

function fmt(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function acceptFor(type: string) { return type === "LETTERHEAD" ? ".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "image/*,.pdf,.doc,.docx"; }

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    setLoading(true);
    try { const res = await fetch("/api/company/assets"); const data = await res.json(); setAssets(data.assets ?? []); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleUpload(assetType: string, file: File) {
    setUploading(assetType);
    try {
      const form = new FormData(); form.append("file", file); form.append("assetType", assetType);
      const res = await fetch("/api/company/assets", { method: "POST", body: form });
      if (!res.ok) { const err = await res.json(); alert(err.error ?? "Upload failed"); return; }
      await load();
    } finally { setUploading(null); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try { await fetch(`/api/company/assets?id=${id}`, { method: "DELETE" }); await load(); } finally { setDeleting(null); }
  }

  const activeAssets = Object.fromEntries(assets.filter((a) => a.isActive).map((a) => [a.assetType, a]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Brand Assets</h1>
        <p className="mt-0.5 text-sm text-slate-500">Upload once. Assets are reused automatically in generated documents where the tender permits.</p>
      </div>
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold">Best setup</p>
        <p className="mt-1">Upload Hope Letter Head.docx under Letterhead DOCX Template. It becomes the master header/footer template for every generated Word page.</p>
      </div>
      {loading ? <p className="text-center text-slate-400 py-12">Loading…</p> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {ASSET_TYPES.map((at) => {
            const active = activeAssets[at.value]; const isUploading = uploading === at.value;
            return <div key={at.value} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-slate-900 text-sm">{at.label}</p><p className="mt-0.5 text-xs text-slate-500">{at.desc}</p></div>{active && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>}</div>
              {active ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs space-y-2"><p className="font-medium text-slate-700 truncate">{active.originalFileName}</p><p className="text-slate-400">{fmt(active.size)} · {active.mimeType}</p><div className="flex gap-2 pt-1"><button onClick={() => fileRefs.current[at.value]?.click()} disabled={isUploading} className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300 disabled:opacity-50">Replace</button><button onClick={() => handleDelete(active.id)} disabled={deleting === active.id} className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:opacity-50">Remove</button></div></div> : <button onClick={() => fileRefs.current[at.value]?.click()} disabled={isUploading} className="mt-3 w-full rounded-lg border-2 border-dashed border-slate-200 py-4 text-xs text-slate-400 hover:border-slate-400 hover:text-slate-600 disabled:opacity-50">{isUploading ? "Uploading…" : "+ Upload file"}</button>}
              <input type="file" accept={acceptFor(at.value)} className="hidden" ref={(el) => { fileRefs.current[at.value] = el; }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(at.value, f); e.target.value = ""; }} />
            </div>;
          })}
        </div>
      )}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-800">Asset usage rules</p><ul className="mt-1 list-disc list-inside space-y-0.5 text-xs text-amber-700"><li>DOCX Letterhead is the master template for every generated Word page where branding is permitted.</li><li>Logo is used as fallback if no DOCX letterhead is active.</li><li>Signature and stamp are placed on declarations requiring authorization.</li><li>Assets are not included if the tender restricts branding or signatures.</li></ul></div>
    </div>
  );
}
