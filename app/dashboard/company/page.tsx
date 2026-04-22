"use client";
import { useEffect, useState } from "react";

type CompanyDoc = { id: string; originalFileName: string; category: string; size: number; extractedText?: string | null; createdAt: string };
type Expert = { id: string; fullName: string; title: string | null; disciplines: string[] };
type Project = { id: string; name: string; clientName: string | null; sector: string | null; serviceAreas: string[] };
type Company = {
  id?: string; name: string; legalName: string; description: string; website: string;
  address: string; phone: string; email: string; knowledgeMode: string;
  serviceLines: string[]; sectors: string[]; profileSummary: string;
  experts?: Expert[]; projects?: Project[];
};

const DOC_CATEGORIES = ["PROFILE", "LEGAL", "FINANCIAL", "EXPERT_CV", "PROJECT_REFERENCE", "MANUAL", "PORTFOLIO", "OTHER"];

const empty: Company = {
  name: "", legalName: "", description: "", website: "", address: "", phone: "", email: "",
  knowledgeMode: "PROFILE_FIRST", serviceLines: [], sectors: [], profileSummary: "",
};

function fmt(b: number) { return b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`; }

export default function CompanyPage() {
  const [company, setCompany] = useState<Company>(empty);
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docCategory, setDocCategory] = useState("OTHER");
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const [expertSaving, setExpertSaving] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [serviceLinesText, setServiceLinesText] = useState("");
  const [sectorsText, setSectorsText] = useState("");
  const [expertForm, setExpertForm] = useState({ fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "" });
  const [projectForm, setProjectForm] = useState({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });

  async function loadDocs() {
    const r = await fetch("/api/company/documents");
    const d = await r.json();
    setDocs(d.documents ?? []);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/company").then((r) => r.json()),
      fetch("/api/company/documents").then((r) => r.json()),
    ]).then(([c, d]) => {
      if (c.company ?? c) {
        const co = c.company ?? c;
        setCompany({ ...empty, ...co });
        setServiceLinesText((co.serviceLines || []).join(", "));
        setSectorsText((co.sectors || []).join(", "));
      }
      setDocs(d.documents ?? []);
    }).finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess(false);
    try {
      const res = await fetch("/api/company", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...company, serviceLines: serviceLinesText, sectors: sectorsText }),
      });
      if (!res.ok) { setError("Failed to save"); return; }
      const updated = await res.json();
      setCompany({ ...empty, ...updated });
      setServiceLinesText((updated.serviceLines || []).join(", "));
      setSectorsText((updated.sectors || []).join(", "));
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("companyDoc", "true");
    fd.append("category", docCategory);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) { await loadDocs(); }
    else { setError("Upload failed"); }
    setUploading(false); e.target.value = "";
  }

  async function handleDeleteDoc(id: string) {
    setDeletingDoc(id);
    await fetch(`/api/company/documents?id=${id}`, { method: "DELETE" });
    await loadDocs();
    setDeletingDoc(null);
  }

  async function addExpert(e: React.FormEvent) {
    e.preventDefault(); setExpertSaving(true); setError("");
    const res = await fetch("/api/company/experts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expertForm),
    });
    if (res.ok) {
      const expert = await res.json();
      setCompany((c) => ({ ...c, experts: [expert, ...(c.experts || [])] }));
      setExpertForm({ fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "" });
    } else { setError("Failed to create expert"); }
    setExpertSaving(false);
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault(); setProjectSaving(true); setError("");
    const res = await fetch("/api/company/projects", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(projectForm),
    });
    if (res.ok) {
      const project = await res.json();
      setCompany((c) => ({ ...c, projects: [project, ...(c.projects || [])] }));
      setProjectForm({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });
    } else { setError("Failed to create project"); }
    setProjectSaving(false);
  }

  if (loading) return <div className="text-sm text-slate-400 py-12 text-center">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Knowledge Vault</h1>
        <p className="mt-1 text-slate-500 text-sm">Build reusable company knowledge for analysis, matching, and generation.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Saved.</div>}

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Documents", value: docs.length },
          { label: "Experts", value: company.experts?.length ?? 0 },
          { label: "Projects", value: company.projects?.length ?? 0 },
          { label: "Mode", value: company.knowledgeMode === "FULL_LIBRARY" ? "Full Library" : "Profile First", small: true },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className={`mt-1 font-bold text-slate-900 ${s.small ? "text-lg" : "text-3xl"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(360px,1fr)]">
        {/* Profile form */}
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Company Profile</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Company name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} placeholder="Legal name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} placeholder="Email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} placeholder="Phone" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} placeholder="Website" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={company.knowledgeMode} onChange={(e) => setCompany({ ...company, knowledgeMode: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
              <option value="PROFILE_FIRST">Mode A — Profile First</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library</option>
            </select>
          </div>
          <input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} placeholder="Address" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.description} onChange={(e) => setCompany({ ...company, description: e.target.value })} rows={3} placeholder="Company description" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.profileSummary} onChange={(e) => setCompany({ ...company, profileSummary: e.target.value })} rows={4} placeholder="Profile summary (used in Mode A drafting)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={serviceLinesText} onChange={(e) => setServiceLinesText(e.target.value)} placeholder="Service lines (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={sectorsText} onChange={(e) => setSectorsText(e.target.value)} placeholder="Sectors (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button type="submit" disabled={saving || !company.name} className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving…" : "Save Company Profile"}
          </button>
        </form>

        {/* Document library */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Company Document Library</h2>
          <p className="text-xs text-slate-500">Upload PDF or DOCX company documents. Text is extracted automatically and used in analysis.</p>
          <div className="flex gap-2">
            <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs bg-white flex-1">
              {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <label className="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-xs text-white hover:bg-slate-800">
              {uploading ? "Uploading…" : "+ Upload"}
              <input type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleDocUpload} disabled={uploading} />
            </label>
          </div>
          {docs.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">No documents yet. Upload CVs, company profile, legal documents, project references, or financial statements.</p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {docs.map((doc) => (
                <li key={doc.id} className="rounded-xl border px-3 py-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{doc.originalFileName}</p>
                      <p className="text-slate-400">{doc.category} · {fmt(doc.size)}</p>
                      {doc.extractedText && <p className="text-green-600 mt-0.5">✓ Text extracted ({doc.extractedText.length.toLocaleString()} chars)</p>}
                    </div>
                    <button onClick={() => handleDeleteDoc(doc.id)} disabled={deletingDoc === doc.id} className="text-red-400 hover:text-red-600 shrink-0 disabled:opacity-40">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Expert + Project libraries */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Expert Library</h2>
          <form onSubmit={addExpert} className="space-y-3">
            <input value={expertForm.fullName} onChange={(e) => setExpertForm({ ...expertForm, fullName: e.target.value })} placeholder="Full name *" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.title} onChange={(e) => setExpertForm({ ...expertForm, title: e.target.value })} placeholder="Title / Position" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.disciplines} onChange={(e) => setExpertForm({ ...expertForm, disciplines: e.target.value })} placeholder="Disciplines (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.sectors} onChange={(e) => setExpertForm({ ...expertForm, sectors: e.target.value })} placeholder="Sectors (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.certifications} onChange={(e) => setExpertForm({ ...expertForm, certifications: e.target.value })} placeholder="Certifications (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.yearsExperience} onChange={(e) => setExpertForm({ ...expertForm, yearsExperience: e.target.value })} type="number" placeholder="Years of experience" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <textarea value={expertForm.profile} onChange={(e) => setExpertForm({ ...expertForm, profile: e.target.value })} rows={3} placeholder="Expert profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={expertSaving || !expertForm.fullName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {expertSaving ? "Adding…" : "Add Expert"}
            </button>
          </form>
          <div className="mt-5 space-y-2 max-h-64 overflow-y-auto">
            {company.experts?.map((expert) => (
              <div key={expert.id} className="rounded-xl border px-3 py-2.5">
                <p className="font-medium text-slate-900 text-sm">{expert.fullName}</p>
                <p className="text-xs text-slate-500">{expert.title ?? "—"}</p>
                <p className="text-xs text-slate-400 mt-0.5">{(expert.disciplines || []).join(", ")}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Project Reference Library</h2>
          <form onSubmit={addProject} className="space-y-3">
            <input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="Project name *" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} placeholder="Client name" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <div className="grid gap-3 grid-cols-2">
              <input value={projectForm.sector} onChange={(e) => setProjectForm({ ...projectForm, sector: e.target.value })} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.country} onChange={(e) => setProjectForm({ ...projectForm, country: e.target.value })} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={projectForm.contractValue} onChange={(e) => setProjectForm({ ...projectForm, contractValue: e.target.value })} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
              <select value={projectForm.currency} onChange={(e) => setProjectForm({ ...projectForm, currency: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
                {["USD","EUR","GBP","AED","SAR","KWD","EGP"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <input value={projectForm.serviceAreas} onChange={(e) => setProjectForm({ ...projectForm, serviceAreas: e.target.value })} placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <textarea value={projectForm.summary} onChange={(e) => setProjectForm({ ...projectForm, summary: e.target.value })} rows={3} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={projectSaving || !projectForm.name} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {projectSaving ? "Adding…" : "Add Project"}
            </button>
          </form>
          <div className="mt-5 space-y-2 max-h-64 overflow-y-auto">
            {company.projects?.map((project) => (
              <div key={project.id} className="rounded-xl border px-3 py-2.5">
                <p className="font-medium text-slate-900 text-sm">{project.name}</p>
                <p className="text-xs text-slate-500">{project.clientName ?? "—"}{project.sector ? ` · ${project.sector}` : ""}</p>
                <p className="text-xs text-slate-400 mt-0.5">{(project.serviceAreas || []).join(", ")}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
