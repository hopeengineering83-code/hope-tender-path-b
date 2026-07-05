"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3 | 4 | 5;
type UploadState = { name: string; status: "uploading" | "done" | "error" };

const STEPS = [
  { n: 1 as Step, label: "Company Info" },
  { n: 2 as Step, label: "Upload Documents" },
  { n: 3 as Step, label: "Add Experts" },
  { n: 4 as Step, label: "Add Projects" },
  { n: 5 as Step, label: "Complete" },
];

const DOC_CATS = ["AUTO_DETECT", "COMPANY_PROFILE", "EXPERT_CV", "PROJECT_REFERENCE", "PROJECT_CONTRACT", "FINANCIAL_STATEMENT", "LEGAL_REGISTRATION", "CERTIFICATION", "MANUAL", "PORTFOLIO", "COMPLIANCE_RECORD", "OTHER"];
const CAT_LABELS: Record<string, string> = {
  AUTO_DETECT: "Auto-detect", COMPANY_PROFILE: "Company Profile", EXPERT_CV: "Expert CV", PROJECT_REFERENCE: "Project Reference",
  PROJECT_CONTRACT: "Project Contract", FINANCIAL_STATEMENT: "Financial Statement", LEGAL_REGISTRATION: "Legal / Registration",
  CERTIFICATION: "Certificate", MANUAL: "Manual / Policy", PORTFOLIO: "Portfolio", COMPLIANCE_RECORD: "Compliance Record", OTHER: "Other",
};
const SAFE_UPLOAD_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "csv", "txt"]);

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState({
    name: "", legalName: "", email: "", phone: "", website: "", address: "", description: "",
    profileSummary: "", serviceLines: "", sectors: "", knowledgeMode: "PROFILE_FIRST",
  });
  const [docCat, setDocCat] = useState("AUTO_DETECT");
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadState[]>([]);
  const [expert, setExpert] = useState({ fullName: "", title: "", disciplines: "", sectors: "", yearsExperience: "", profile: "" });
  const [experts, setExperts] = useState<{ name: string }[]>([]);
  const [addingExpert, setAddingExpert] = useState(false);
  const [project, setProject] = useState({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });
  const [projects, setProjects] = useState<{ name: string }[]>([]);
  const [addingProject, setAddingProject] = useState(false);

  async function saveProfile() {
    if (!profile.name.trim()) { setError("Company name is required"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/company", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      if (!res.ok) { setError("Failed to save profile"); return; }
      setStep(2);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  async function handleDocUpload(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selected = Array.from(files);
    const invalid = selected.filter((file) => !SAFE_UPLOAD_EXTENSIONS.has(extensionOf(file.name)));
    if (invalid.length > 0) {
      setError(`${invalid.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, CSV, or TXT. Convert legacy DOC/XLS files first.`);
      return;
    }

    setUploading(true); setError("");
    for (const file of selected) {
      setUploadedDocs((current) => [...current, { name: file.name, status: "uploading" }]);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("companyDoc", "true");
      fd.append("category", docCat === "AUTO_DETECT" ? "AUTO" : docCat);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        setUploadedDocs((current) => current.map((item) => item.name === file.name ? { ...item, status: res.ok ? "done" : "error" } : item));
      } catch {
        setUploadedDocs((current) => current.map((item) => item.name === file.name ? { ...item, status: "error" } : item));
      }
    }
    setUploading(false);
  }

  async function saveExpert() {
    if (!expert.fullName.trim()) { setError("Expert name required"); return; }
    setAddingExpert(true); setError("");
    try {
      const res = await fetch("/api/company/experts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expert) });
      if (res.ok) {
        setExperts((current) => [...current, { name: expert.fullName }]);
        setExpert({ fullName: "", title: "", disciplines: "", sectors: "", yearsExperience: "", profile: "" });
      } else setError("Failed to add expert");
    } catch { setError("Network error"); } finally { setAddingExpert(false); }
  }

  async function saveProject() {
    if (!project.name.trim()) { setError("Project name required"); return; }
    setAddingProject(true); setError("");
    try {
      const res = await fetch("/api/company/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
      if (res.ok) {
        setProjects((current) => [...current, { name: project.name }]);
        setProject({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });
      } else setError("Failed to add project");
    } catch { setError("Network error"); } finally { setAddingProject(false); }
  }

  async function completeSetup() {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/company", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupCompletedAt: new Date().toISOString() }) });
      if (!res.ok) { setError("Failed to complete setup"); return; }
      router.push("/dashboard");
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Company Setup Wizard</h1>
        <p className="mt-1 text-sm text-slate-500">Configure your knowledge vault once. Reuse for every tender.</p>
      </div>

      <div className="mb-8 flex items-center gap-0">
        {STEPS.map((item, index) => (
          <div key={item.n} className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${step === item.n ? "border-black bg-black text-white" : step > item.n ? "border-green-500 bg-green-500 text-white" : "border-slate-300 text-slate-400"}`}>{step > item.n ? "✓" : item.n}</div>
            <span className={`ml-1.5 hidden text-xs font-medium sm:inline ${step === item.n ? "text-slate-900" : step > item.n ? "text-green-600" : "text-slate-400"}`}>{item.label}</span>
            {index < STEPS.length - 1 && <div className={`mx-2 h-0.5 w-6 sm:w-10 ${step > item.n ? "bg-green-400" : "bg-slate-200"}`} />}
          </div>
        ))}
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === 1 && (
        <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Company Information</h2>
          <p className="text-sm text-slate-500">Enter your company details. These become the foundation of every proposal.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Company name *" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.legalName} onChange={(e) => setProfile({ ...profile, legalName: e.target.value })} placeholder="Legal registered name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} type="email" placeholder="Company email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="Phone" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} placeholder="Website" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} placeholder="Registered address" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <textarea value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} rows={2} placeholder="Company description" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <textarea value={profile.profileSummary} onChange={(e) => setProfile({ ...profile, profileSummary: e.target.value })} rows={3} placeholder="Profile summary — used in proposal drafting" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.serviceLines} onChange={(e) => setProfile({ ...profile, serviceLines: e.target.value })} placeholder="Service lines (comma-separated)" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.sectors} onChange={(e) => setProfile({ ...profile, sectors: e.target.value })} placeholder="Sectors (comma-separated)" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <select value={profile.knowledgeMode} onChange={(e) => setProfile({ ...profile, knowledgeMode: e.target.value })} className="col-span-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <option value="PROFILE_FIRST">Mode A — Profile First (recommended for most tenders)</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library (deep evidence matching)</option>
            </select>
          </div>
          <button onClick={() => void saveProfile()} disabled={saving || !profile.name.trim()} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{saving ? "Saving…" : "Save & Continue →"}</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Upload Company Documents</h2>
          <p className="text-sm text-slate-500">Upload CVs, company profiles, financial statements, certificates, contracts, and manuals. Accepted formats are PDF, DOCX, XLSX, CSV, and TXT. Convert legacy DOC/XLS files first.</p>
          <div className="flex gap-2">
            <select value={docCat} onChange={(e) => setDocCat(e.target.value)} className="flex-1 rounded-lg border bg-white px-2 py-2 text-sm">
              {DOC_CATS.map((category) => <option key={category} value={category}>{CAT_LABELS[category]}</option>)}
            </select>
            <label className={`cursor-pointer rounded-lg px-4 py-2 text-sm text-white ${uploading ? "cursor-not-allowed bg-slate-400" : "bg-black hover:bg-slate-800"}`}>
              {uploading ? "Uploading…" : "Browse Files"}
              <input type="file" accept=".pdf,.docx,.xlsx,.csv,.txt" multiple disabled={uploading} className="hidden" onChange={(e) => void handleDocUpload(e.target.files)} />
            </label>
          </div>
          {uploadedDocs.length > 0 && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto">
              {uploadedDocs.map((item, index) => (
                <div key={`${item.name}-${index}`} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${item.status === "done" ? "border-green-200 bg-green-50" : item.status === "error" ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
                  <span className="truncate font-medium text-slate-700">{item.name}</span>
                  <span className={item.status === "done" ? "text-green-600" : item.status === "error" ? "text-red-600" : "text-blue-600"}>{item.status === "done" ? "✓ Done" : item.status === "error" ? "✕ Failed" : "Uploading…"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700"><strong>Tip:</strong> Upload at least your Company Profile, 3-5 Expert CVs, and 3-5 Project References for best matching results.</div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(3)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">Continue →</button>
            <button onClick={() => setStep(1)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Add Expert Profiles</h2>
          <p className="text-sm text-slate-500">Add key experts manually, or they will be auto-extracted from reviewed CVs.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={expert.fullName} onChange={(e) => setExpert({ ...expert, fullName: e.target.value })} placeholder="Full name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.title} onChange={(e) => setExpert({ ...expert, title: e.target.value })} placeholder="Title / Position" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.disciplines} onChange={(e) => setExpert({ ...expert, disciplines: e.target.value })} placeholder="Disciplines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.sectors} onChange={(e) => setExpert({ ...expert, sectors: e.target.value })} placeholder="Sectors (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.yearsExperience} onChange={(e) => setExpert({ ...expert, yearsExperience: e.target.value })} type="number" min="0" placeholder="Years experience" className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <textarea value={expert.profile} onChange={(e) => setExpert({ ...expert, profile: e.target.value })} rows={2} placeholder="Profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button onClick={() => void saveExpert()} disabled={addingExpert || !expert.fullName.trim()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-black disabled:opacity-50">{addingExpert ? "Adding…" : "+ Add Expert"}</button>
          {experts.length > 0 && <div className="space-y-1.5 rounded-xl border bg-slate-50 p-3"><p className="text-xs font-medium text-slate-600">{experts.length} expert{experts.length !== 1 ? "s" : ""} added</p>{experts.map((item, index) => <p key={`${item.name}-${index}`} className="text-xs text-slate-700">• {item.name}</p>)}</div>}
          <div className="flex gap-3 pt-2"><button onClick={() => setStep(4)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">Continue →</button><button onClick={() => setStep(2)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button></div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Add Project References</h2>
          <p className="text-sm text-slate-500">Add key past projects. These are matched against tender experience requirements.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.clientName} onChange={(e) => setProject({ ...project, clientName: e.target.value })} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.sector} onChange={(e) => setProject({ ...project, sector: e.target.value })} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.country} onChange={(e) => setProject({ ...project, country: e.target.value })} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.serviceAreas} onChange={(e) => setProject({ ...project, serviceAreas: e.target.value })} placeholder="Service areas (comma-separated)" className="col-span-2 rounded-lg border px-3 py-2 text-sm" />
            <input value={project.contractValue} onChange={(e) => setProject({ ...project, contractValue: e.target.value })} type="number" min="0" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={project.currency} onChange={(e) => setProject({ ...project, currency: e.target.value })} className="rounded-lg border bg-white px-3 py-2 text-sm">{["USD", "EUR", "GBP", "AED", "SAR", "KWD", "EGP", "ZAR", "ETB"].map((currency) => <option key={currency}>{currency}</option>)}</select>
          </div>
          <textarea value={project.summary} onChange={(e) => setProject({ ...project, summary: e.target.value })} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button onClick={() => void saveProject()} disabled={addingProject || !project.name.trim()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-black disabled:opacity-50">{addingProject ? "Adding…" : "+ Add Project"}</button>
          {projects.length > 0 && <div className="space-y-1.5 rounded-xl border bg-slate-50 p-3"><p className="text-xs font-medium text-slate-600">{projects.length} project{projects.length !== 1 ? "s" : ""} added</p>{projects.map((item, index) => <p key={`${item.name}-${index}`} className="text-xs text-slate-700">• {item.name}</p>)}</div>}
          <div className="flex gap-3 pt-2"><button onClick={() => setStep(5)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">Continue →</button><button onClick={() => setStep(3)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button></div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5 rounded-2xl border bg-white p-6 text-center shadow-sm">
          <div className="flex justify-center"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div></div>
          <h2 className="text-xl font-semibold text-slate-900">Setup Complete!</h2>
          <p className="mx-auto max-w-sm text-sm text-slate-500">Your company knowledge vault is ready. You can now create tenders and the engine will automatically match experts, projects, and evidence from your vault.</p>
          <div className="space-y-2 rounded-xl border bg-slate-50 p-4 text-left text-sm text-slate-600"><p className="font-medium text-slate-800">What happens next:</p><p>1. Create a new tender and upload the tender documents</p><p>2. Run the analysis engine to extract requirements</p><p>3. Review matching and compliance results</p><p>4. Generate and export your submission package</p></div>
          <div className="flex justify-center gap-3 pt-2"><button onClick={() => void completeSetup()} disabled={saving} className="rounded-lg bg-black px-6 py-2.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{saving ? "Setting up…" : "Go to Dashboard →"}</button><button onClick={() => router.push("/dashboard/tenders/new")} className="rounded-lg border px-6 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Create First Tender</button></div>
        </div>
      )}
    </div>
  );
}
