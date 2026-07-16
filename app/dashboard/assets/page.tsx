"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Asset = {
  id: string;
  assetType: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  isActive: boolean;
  createdAt: string;
  storagePath?: string | null;
  hasInlineFileContent?: boolean | null;
};

type AssetResponse = { assets?: Asset[]; error?: string };

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ASSET_TYPES = [
  { value: "LETTERHEAD", label: "Letterhead DOCX Template", desc: "Official macro-free DOCX letterhead. Header and footer repeat on generated pages when permitted." },
  { value: "LOGO", label: "Company Logo", desc: "PNG or JPEG backup logo used when no DOCX letterhead is active." },
  { value: "HEADER", label: "Page Header", desc: "Optional PNG or JPEG page-header image." },
  { value: "FOOTER", label: "Page Footer", desc: "Optional PNG or JPEG page-footer image." },
  { value: "SIGNATURE", label: "Authorized Signature", desc: "PNG or JPEG signature used on authorized declarations when permitted." },
  { value: "STAMP", label: "Company Stamp / Seal", desc: "PNG or JPEG official stamp used where authorization is required." },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function acceptFor(type: string) {
  return type === "LETTERHEAD"
    ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : ".png,.jpg,.jpeg,image/png,image/jpeg";
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/company/assets", { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as AssetResponse;
    if (!response.ok) throw new Error(data.error ?? `Assets could not be loaded (HTTP ${response.status}).`);
    setAssets(data.assets ?? []);
    return data.assets ?? [];
  }, []);

  useEffect(() => {
    setError(null);
    void load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Assets could not be loaded."))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleUpload(assetType: string, file: File) {
    setError(null);
    setStatus(null);
    if (file.size > MAX_ASSET_BYTES) {
      setError("Company assets must not exceed 5 MB.");
      return;
    }

    setUploading(assetType);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("assetType", assetType);
      const response = await fetch("/api/company/assets", { method: "POST", body: form });
      const data = await response.json().catch(() => ({})) as AssetResponse;
      if (!response.ok) throw new Error(data.error ?? `Upload failed (HTTP ${response.status}).`);
      await load();
      setStatus(`${file.name} uploaded and confirmed by the server.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function handleDelete(asset: Asset) {
    setError(null);
    setStatus(null);
    setDeleting(asset.id);
    try {
      const response = await fetch(`/api/company/assets?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as AssetResponse;
      if (!response.ok) throw new Error(data.error ?? `Asset removal failed (HTTP ${response.status}).`);
      await load();
      setStatus(`${asset.originalFileName} removed and the asset list was refreshed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Asset removal failed.");
    } finally {
      setDeleting(null);
    }
  }

  const activeAssets = Object.fromEntries(assets.filter((asset) => asset.isActive).map((asset) => [asset.assetType, asset]));

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Brand Assets</h1>
        <p className="mt-1 text-sm text-slate-500">Upload reviewed company assets once. Tender instructions still control whether each asset may be used.</p>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold">Recommended setup</p>
        <p className="mt-1">Upload the official letterhead under Letterhead DOCX Template. It becomes the preferred header and footer source where branding is allowed.</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {status && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div>}

      {loading ? (
        <p role="status" className="py-12 text-center text-slate-500">Loading assets…</p>
      ) : (
        <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {ASSET_TYPES.map((assetType) => {
            const active = activeAssets[assetType.value];
            const isUploading = uploading === assetType.value;
            const isDeleting = active && deleting === active.id;
            const busy = Boolean(isUploading || isDeleting);

            return (
              <section key={assetType.value} className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm" aria-busy={busy}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900">{assetType.label}</h2>
                    <p className="mt-1 text-xs text-slate-500">{assetType.desc}</p>
                  </div>
                  {active && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>}
                </div>

                {active ? (
                  <div className="mt-3 min-w-0 space-y-3 rounded-lg bg-slate-50 p-3 text-xs">
                    <p className="break-all font-medium text-slate-700">{active.originalFileName}</p>
                    <p className="break-all text-slate-500">{formatBytes(active.size)} · {active.mimeType}</p>
                    {active.hasInlineFileContent && !(active.storagePath ?? "").trim() && <p className="font-medium text-emerald-700">Restored inline file available</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => fileRefs.current[assetType.value]?.click()}
                        disabled={busy}
                        className="min-h-11 rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUploading ? "Replacing…" : "Replace"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(active)}
                        disabled={busy}
                        className="min-h-11 rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDeleting ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRefs.current[assetType.value]?.click()}
                    disabled={busy}
                    className="mt-3 min-h-14 w-full rounded-lg border-2 border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isUploading ? "Uploading…" : "Upload file"}
                  </button>
                )}

                <input
                  type="file"
                  accept={acceptFor(assetType.value)}
                  className="hidden"
                  ref={(element) => { fileRefs.current[assetType.value] = element; }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUpload(assetType.value, file);
                    event.target.value = "";
                  }}
                />
              </section>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-800">Asset usage rules</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-700">
          <li>DOCX letterhead is a preferred source only where branding is permitted.</li>
          <li>Logo, header, footer, signature, and stamp files must be PNG or JPEG.</li>
          <li>Macro-enabled or embedded-object letterhead files are rejected.</li>
          <li>Tender restrictions override every presentation preference.</li>
        </ul>
      </div>
    </div>
  );
}
