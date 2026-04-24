"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type CompanyDoc = {
  id: string; originalFileName: string; mimeType: string; category: string;
  size: number; extractedText?: string | null; createdAt: string;
};
type Expert = { id: string; fullName: string; title: string | null; disciplines: string[] };
type Project = { id: string; name: string; clientName: string | null; sector: string | null; serviceAreas: string[] };
type Company = {
  id?: string; name: string; legalName: string; description: string; website: string;
  address: string; phone: string; email: string; knowledgeMode: string;
  serviceLines: string[]; sectors: string[]; profileSummary: string;
  experts?: Expert[]; projects?: Project[];
};

type UploadItem = { file: File; status: "queued" | "uploading" | "done" | "error"; error?: string; category: string };

const DOC_CATEGORIES = [
  "AUTO_DETECT",
  "COMPANY_PROFILE", "EXPERT_CV", "PROJECT_REFERENCE", "PROJECT_CONTRACT",
  "FINANCIAL_STATEMENT", "LEGAL_REGISTRATION", "CERTIFICATION",
  "MANUAL", "PORTFOLIO", "COMPLIANCE_RECORD", "OTHER",
];

const CATEGORY_LABELS: Record<string, string> = {
  AUTO_DETECT: "Auto-detect from filename",
  COMPANY_PROFILE: "Company Profile",
  EXPERT_CV: "Expert CV / Resume",
  PROJECT_REFERENCE: "Project Reference",
  PROJECT_CONTRACT: "Project Contract",
  FINANCIAL_STATEMENT: "Financial Statement",
  LEGAL_REGISTRATION: "Legal / Registration",
  CERTIFICATION: "Certificate / License",
  MANUAL: "Manual / Policy",
  PORTFOLIO: "Portfolio",
  COMPLIANCE_RECORD: "Compliance Record",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  COMPANY_PROFILE: "bg-blue-100 text-blue-700",
  EXPERT_CV: "bg-purple-100 text-purple-700",
  PROJECT_REFERENCE: "bg-green-100 text-green-700",
  PROJECT_CONTRACT: "bg-emerald-100 text-emerald-700",
  FINANCIAL_STATEMENT: "bg-amber-100 text-amber-700",
  LEGAL_REGISTRATION: "bg-red-100 text-red-700",
  CERTIFICATION: "bg-orange-100 text-orange-700",
  MANUAL: "bg-slate-100 text-slate-600",
  PORTFOLIO: "bg-teal-100 text-teal-700",
  COMPLIANCE_RECORD: "bg-rose-100 text-rose-700",
  OTHER: "bg-slate-100 text-slate-500",
};

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "bg-red-50 text-red-600 border-red-200",
  docx: "bg-blue-50 text-blue-600 border-blue-200",
  doc: "bg-blue-50 text-blue-600 border-blue-200",
  xlsx: "bg-green-50 text-green-600 border-green-200",
  xls: "bg-green-50 text-green-600 border-green-200",
  ods: "bg-green-50 text-green-600 border-green-200",
  pptx: "bg-orange-50 text-orange-600 border-orange-200",
  ppt: "bg-orange-50 text-orange-600 border-orange-200",
  csv: "bg-teal-50 text-teal-600 border-teal-200",
  txt: "bg-slate-50 text-slate-600 border-slate-200",
  rtf: "bg-slate-50 text-slate-600 border-slate-200",
  jpg: "bg-purple-50 text-purple-600 border-purple-200",
  jpeg: "bg-purple-50 text-purple-600 border-purple-200",
  png: "bg-purple-50 text-purple-600 border-purple-200",
};

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.csv,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp";

const empty: Company = {
  name: "", legalName: "", description: "", website: "", address: "", phone: "", email: "",
  knowledgeMode: "PROFILE_FIRST", serviceLines: [], sectors: [], profileSummary: "",
};

function fmt(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

function fileExt(name: string) { return name.toLowerCase().split(".").pop() ?? ""; }

function ExtractionBadge({ text }: { text?: string | null }) {
  if (!text) return <span className="text-xs text-slate-400">No text extracted</span>;
  if (text.startsWith("[Scanned")) return <span className="text-xs text-amber-600" title={text}>⚠ Scanned — text not extractable</span>;
  return <span className="text-xs text-green-600">✓ {text.length.toLocaleString()} chars extracted</span>;
}

export default function CompanyPage() {
  const [company, setCompany] = useState<Company>(empty);
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [serviceLinesText, setServiceLinesText] = useState("");
  const [sectorsText, setSectorsText] = useState("");

  // Document library
  const [docCategory, setDocCategory] = useState("AUTO_DETECT");
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [searchDoc, setSearchDoc] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expert / Project forms
  const [expertSaving, setExpertSaving] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [expertForm, setExpertForm] = useState({
    fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "",
  });
  const [projectForm, setProjectForm] = useState({
    name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "",
  });

  async function loadDocs() {
    const r = await fetch("/api/company/documents");
    const d = await r.json() as { documents?: CompanyDoc[] };
    setDocs(d.documents ?? []);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/company").then((r) => r.json()),
      fetch("/api/company/documents").then((r) => r.json()),
    ]).then(([c, d]: [{ company?: Company } & Company, { documents?: CompanyDoc[] }]) => {
      const co = c.company ?? c;
      if (co.name !== undefined) {
        setCompany({ ...empty, ...(co as Company) });
        setServiceLinesText(((co as Company).serviceLines || []).join(", "));
        setSectorsText(((co as Company).sectors || []).join(", "));
      }
      setDocs(d.documents ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    const items: UploadItem[] = files.map((f) => ({ file: f, status: "queued", category: docCategory }));
    setUploadQueue((q) => [...items, ...q]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setUploadQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "uploading" } : x));

      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("companyDoc", "true");
      fd.append("category", docCategory === "AUTO_DETECT" ? "AUTO" : docCategory);

      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json() as { success?: boolean; results?: Array<{ error?: string }> };
        const firstErr = data.results?.[0] && "error" in data.results[0] ? data.results[0].error : undefined;
        if (!res.ok || firstErr) {
          setUploadQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: firstErr ?? "Upload failed" } : x));
        } else {
          setUploadQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "done" } : x));
          await loadDocs();
        }
      } catch {
        setUploadQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: "Network error" } : x));
      }
    }
  }, [docCategory]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void processFiles(files);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    if (files.length) void processFiles(files);
    e.target.value = "";
  }

  async function deleteDoc(id: string) {
    await fetch(`/api/company/documents/${id}`, { method: "DELETE" });
    setDocs((d) => d.filter((x) => x.id !== id));
  }

  function downloadDoc(id: string, name: string) {
    const a = document.createElement("a");
    a.href = `/api/company/documents/${id}`;
    a.download = name;
    a.click();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess(false);
    try {
      const res = await fetch("/api/company", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...company, serviceLines: serviceLinesText, sectors: sectorsText }),
      });
      if (!res.ok) { setError("Failed to save"); return; }
      const updated = await res.json() as Company;
      setCompany({ ...empty, ...updated });
      setServiceLinesText((updated.serviceLines || []).join(", "));
      setSectorsText((updated.sectors || []).join(", "));
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  async function addExpert(e: React.FormEvent) {
    e.preventDefault(); setExpertSaving(true);
    const res = await fetch("/api/company/experts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expertForm),
    });
    if (res.ok) {
      const expert = await res.json() as Expert;
      setCompany((c) => ({ ...c, experts: [expert, ...(c.experts || [])] }));
      setExpertForm({ fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "" });
    }
    setExpertSaving(false);
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault(); setProjectSaving(true);
    const res = await fetch("/api/company/projects", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(projectForm),
    });
    if (res.ok) {
      const project = await res.json() as Project;
      setCompany((c) => ({ ...c, projects: [project, ...(c.projects || [])] }));
      setProjectForm({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });
    }
    setProjectSaving(false);
  }

  const filteredDocs = docs.filter((d) => {
    const matchSearch = !searchDoc || d.originalFileName.toLowerCase().includes(searchDoc.toLowerCase());
    const matchCat = filterCat === "ALL" || d.category === filterCat;
    return matchSearch && matchCat;
  });

  const activeUploads = uploadQueue.filter((u) => u.status === "uploading" || u.status === "queued").length;

  if (loading) return <div className="text-sm text-slate-400 py-16 text-center">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Knowledge Vault</h1>
        <p className="mt-1 text-slate-500 text-sm">Build reusable knowledge for analysis, matching, and proposal generation.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Profile saved successfully.</div>}

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Documents", value: docs.length, color: "text-blue-600" },
          { label: "Experts", value: company.experts?.length ?? 0, color: "text-purple-600" },
          { label: "Projects", value: company.projects?.length ?? 0, color: "text-green-600" },
          { label: "Knowledge Mode", value: company.knowledgeMode === "FULL_LIBRARY" ? "Full Library" : "Profile First", small: true },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`mt-1.5 font-bold ${s.small ? "text-base text-slate-700" : `text-3xl ${s.color ?? "text-slate-900"}`}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(420px,1fr)]">
        {/* Company profile form */}
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Company Profile</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })}
              placeholder="Company name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })}
              placeholder="Legal registered name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })}
              type="email" placeholder="Contact email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })}
              placeholder="Phone number" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })}
              placeholder="Website URL" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={company.knowledgeMode} onChange={(e) => setCompany({ ...company, knowledgeMode: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm bg-white">
              <option value="PROFILE_FIRST">Mode A — Profile First</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library</option>
            </select>
          </div>
          <input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })}
            placeholder="Registered address" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.description} onChange={(e) => setCompany({ ...company, description: e.target.value })}
            rows={2} placeholder="Company description" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.profileSummary} onChange={(e) => setCompany({ ...company, profileSummary: e.target.value })}
            rows={4} placeholder="Profile summary — used in proposal drafting" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={serviceLinesText} onChange={(e) => setServiceLinesText(e.target.value)}
            placeholder="Service lines (comma-separated, e.g. IT Consulting, Engineering, Audit)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={sectorsText} onChange={(e) => setSectorsText(e.target.value)}
            placeholder="Sectors (comma-separated, e.g. Government, Healthcare, Finance)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button type="submit" disabled={saving || !company.name}
            className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving…" : "Save Company Profile"}
          </button>
        </form>

        {/* Document library — drag-drop, multi-file, full type support */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Document Library</h2>
              <p className="text-xs text-slate-500 mt-0.5">PDF · DOCX · XLSX · PPTX · CSV · RTF · Images · and more</p>
            </div>
            <span className="text-xs text-slate-400">{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Category + browse button row */}
          <div className="flex gap-2 items-center">
            <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)}
              className="flex-1 rounded-lg border px-2 py-1.5 text-xs bg-white min-w-0">
              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            </select>
            <button onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs text-white hover:bg-slate-800">
              Browse
            </button>
            <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={onFileInput} />
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
              dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
            }`}
          >
            <p className="text-sm font-medium text-slate-600">{dragOver ? "Drop files here" : "Drag & drop files here"}</p>
            <p className="mt-1 text-xs text-slate-400">Any document type · Up to 10 MB per file · Multiple files at once</p>
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">Upload queue</p>
                {activeUploads === 0 && (
                  <button onClick={() => setUploadQueue([])} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
                )}
              </div>
              {uploadQueue.slice(0, 8).map((item, i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                  item.status === "done" ? "border-green-200 bg-green-50" :
                  item.status === "error" ? "border-red-200 bg-red-50" :
                  item.status === "uploading" ? "border-blue-200 bg-blue-50" : "border-slate-200"
                }`}>
                  <span className="truncate font-medium text-slate-700">{item.file.name}</span>
                  <span className={`shrink-0 ${
                    item.status === "done" ? "text-green-600" :
                    item.status === "error" ? "text-red-600" :
                    item.status === "uploading" ? "text-blue-600" : "text-slate-400"
                  }`}>
                    {item.status === "uploading" ? "Uploading…" :
                     item.status === "done" ? "✓ Done" :
                     item.status === "error" ? `✕ ${item.error ?? "Failed"}` : "Queued"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Search + filter */}
          {docs.length > 0 && (
            <div className="flex gap-2">
              <input value={searchDoc} onChange={(e) => setSearchDoc(e.target.value)}
                placeholder="Search documents…" className="flex-1 rounded-lg border px-2 py-1.5 text-xs min-w-0" />
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                className="shrink-0 rounded-lg border px-2 py-1.5 text-xs bg-white max-w-[130px]">
                <option value="ALL">All categories</option>
                {[...new Set(docs.map((d) => d.category))].map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Document list */}
          <div className="flex-1 overflow-y-auto max-h-[480px] space-y-2 min-h-0">
            {filteredDocs.length === 0 && docs.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-400">No documents yet</p>
                <p className="mt-1 text-xs text-slate-300">Drop files above or click Browse to upload CVs, profiles, financial statements, certificates and more.</p>
              </div>
            )}
            {filteredDocs.length === 0 && docs.length > 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">No documents match your filter.</p>
            )}
            {filteredDocs.map((doc) => {
              const ext = fileExt(doc.originalFileName);
              const typeColor = FILE_TYPE_COLORS[ext] ?? "bg-slate-50 text-slate-600 border-slate-200";
              const catColor = CATEGORY_COLORS[doc.category] ?? "bg-slate-100 text-slate-500";
              return (
                <div key={doc.id} className="rounded-xl border px-3 py-2.5 hover:bg-slate-50 group transition-colors">
                  <div className="flex items-start gap-2.5">
                    <span className={`shrink-0 mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${typeColor}`}>
                      {ext || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-800 truncate" title={doc.originalFileName}>
                        {doc.originalFileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
                          {CATEGORY_LABELS[doc.category] ?? doc.category}
                        </span>
                        <span className="text-[10px] text-slate-400">{fmt(doc.size)}</span>
                        <ExtractionBadge text={doc.extractedText} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => downloadDoc(doc.id, doc.originalFileName)}
                        className="rounded border px-2 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 border-blue-200">
                        ↓
                      </button>
                      <button onClick={() => deleteDoc(doc.id)}
                        className="rounded border px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-50 border-red-200">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Expert + Project libraries */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Expert Library</h2>
          <form onSubmit={addExpert} className="space-y-2.5">
            <div className="grid gap-2.5 md:grid-cols-2">
              <input value={expertForm.fullName} onChange={(e) => setExpertForm({ ...expertForm, fullName: e.target.value })}
                placeholder="Full name *" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={expertForm.title} onChange={(e) => setExpertForm({ ...expertForm, title: e.target.value })}
                placeholder="Title / Position" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={expertForm.disciplines} onChange={(e) => setExpertForm({ ...expertForm, disciplines: e.target.value })}
                placeholder="Disciplines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={expertForm.sectors} onChange={(e) => setExpertForm({ ...expertForm, sectors: e.target.value })}
                placeholder="Sectors (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={expertForm.certifications} onChange={(e) => setExpertForm({ ...expertForm, certifications: e.target.value })}
                placeholder="Certifications" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={expertForm.yearsExperience} onChange={(e) => setExpertForm({ ...expertForm, yearsExperience: e.target.value })}
                type="number" placeholder="Years experience" className="rounded-lg border px-3 py-2 text-sm" />
            </div>
            <textarea value={expertForm.profile} onChange={(e) => setExpertForm({ ...expertForm, profile: e.target.value })}
              rows={2} placeholder="Profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={expertSaving || !expertForm.fullName}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {expertSaving ? "Adding…" : "Add Expert"}
            </button>
          </form>
          <div className="mt-4 space-y-2 max-h-52 overflow-y-auto">
            {(company.experts ?? []).map((e) => (
              <div key={e.id} className="rounded-xl border px-3 py-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 text-sm truncate">{e.fullName}</p>
                  <p className="text-xs text-slate-500">{e.title ?? "—"}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{(e.disciplines || []).join(", ")}</p>
                </div>
              </div>
            ))}
            {(company.experts ?? []).length === 0 && (
              <p className="text-xs text-slate-400 py-3 text-center">No experts yet. Add expert profiles to power the matching engine.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Project Reference Library</h2>
          <form onSubmit={addProject} className="space-y-2.5">
            <div className="grid gap-2.5 md:grid-cols-2">
              <input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })}
                placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.sector} onChange={(e) => setProjectForm({ ...projectForm, sector: e.target.value })}
                placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.country} onChange={(e) => setProjectForm({ ...projectForm, country: e.target.value })}
                placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.contractValue} onChange={(e) => setProjectForm({ ...projectForm, contractValue: e.target.value })}
                type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
              <select value={projectForm.currency} onChange={(e) => setProjectForm({ ...projectForm, currency: e.target.value })}
                className="rounded-lg border px-3 py-2 text-sm bg-white">
                {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <input value={projectForm.serviceAreas} onChange={(e) => setProjectForm({ ...projectForm, serviceAreas: e.target.value })}
              placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <textarea value={projectForm.summary} onChange={(e) => setProjectForm({ ...projectForm, summary: e.target.value })}
              rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={projectSaving || !projectForm.name}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {projectSaving ? "Adding…" : "Add Project"}
            </button>
          </form>
          <div className="mt-4 space-y-2 max-h-52 overflow-y-auto">
            {(company.projects ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border px-3 py-2.5">
                <p className="font-medium text-slate-900 text-sm truncate">{p.name}</p>
                <p className="text-xs text-slate-500">{p.clientName ?? "—"}{p.sector ? ` · ${p.sector}` : ""}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{(p.serviceAreas || []).join(", ")}</p>
              </div>
            ))}
            {(company.projects ?? []).length === 0 && (
              <p className="text-xs text-slate-400 py-3 text-center">No projects yet. Add past project references to power evidence matching.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
