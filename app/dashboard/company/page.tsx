"use client";

import { useEffect, useState } from "react";

type CompanyDocument = {
  id: string;
  originalFileName: string;
  type: string;
};

type Expert = {
  id: string;
  fullName: string;
  title: string | null;
  disciplines: string[];
};

type Project = {
  id: string;
  name: string;
  clientName: string | null;
  sector: string | null;
  serviceAreas: string[];
};

type Company = {
  id?: string;
  name: string;
  legalName: string;
  description: string;
  website: string;
  address: string;
  phone: string;
  email: string;
  knowledgeMode: string;
  serviceLines: string[];
  sectors: string[];
  profileSummary: string;
  documents?: CompanyDocument[];
  experts?: Expert[];
  projects?: Project[];
};

const empty: Company = {
  name: "",
  legalName: "",
  description: "",
  website: "",
  address: "",
  phone: "",
  email: "",
  knowledgeMode: "PROFILE_FIRST",
  serviceLines: [],
  sectors: [],
  profileSummary: "",
  documents: [],
  experts: [],
  projects: [],
};

export default function CompanyPage() {
  const [company, setCompany] = useState<Company>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expertSaving, setExpertSaving] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [serviceLinesText, setServiceLinesText] = useState("");
  const [sectorsText, setSectorsText] = useState("");
  const [expertForm, setExpertForm] = useState({ fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "" });
  const [projectForm, setProjectForm] = useState({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });

  useEffect(() => {
    fetch("/api/company")
      .then((r) => r.json())
      .then((d) => {
        if (d) {
          setCompany({ ...empty, ...d });
          setServiceLinesText((d.serviceLines || []).join(", "));
          setSectorsText((d.sectors || []).join(", "));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const payload = {
        ...company,
        serviceLines: serviceLinesText,
        sectors: sectorsText,
      };
      const res = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError("Failed to save");
        return;
      }
      const updated = await res.json();
      setCompany({ ...empty, ...updated });
      setServiceLinesText((updated.serviceLines || []).join(", "));
      setSectorsText((updated.sectors || []).join(", "));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setCompany((current) => ({
        ...current,
        documents: [data.fileRecord, ...(current.documents || [])],
      }));
    } else {
      setError("Upload failed");
    }
    setUploading(false);
    e.target.value = "";
  }

  async function addExpert(e: React.FormEvent) {
    e.preventDefault();
    setExpertSaving(true);
    setError("");
    const res = await fetch("/api/company/experts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expertForm),
    });
    if (res.ok) {
      const expert = await res.json();
      setCompany((current) => ({ ...current, experts: [expert, ...(current.experts || [])] }));
      setExpertForm({ fullName: "", title: "", disciplines: "", sectors: "", certifications: "", yearsExperience: "", profile: "" });
    } else {
      setError("Failed to create expert");
    }
    setExpertSaving(false);
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    setProjectSaving(true);
    setError("");
    const res = await fetch("/api/company/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectForm),
    });
    if (res.ok) {
      const project = await res.json();
      setCompany((current) => ({ ...current, projects: [project, ...(current.projects || [])] }));
      setProjectForm({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "USD", summary: "" });
    } else {
      setError("Failed to create project");
    }
    setProjectSaving(false);
  }

  if (loading) return <div className="text-sm text-slate-400">Loading...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Knowledge Vault</h1>
        <p className="mt-1 text-slate-500">Build reusable company knowledge for tender analysis, matching, and compliance.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Company profile saved.</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Documents</p><p className="mt-1 text-3xl font-bold text-slate-900">{company.documents?.length || 0}</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Experts</p><p className="mt-1 text-3xl font-bold text-slate-900">{company.experts?.length || 0}</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Projects</p><p className="mt-1 text-3xl font-bold text-slate-900">{company.projects?.length || 0}</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Knowledge Mode</p><p className="mt-1 text-lg font-bold text-slate-900">{company.knowledgeMode === "FULL_LIBRARY" ? "Full Library" : "Profile First"}</p></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(360px,1fr)]">
        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Company name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} placeholder="Legal name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} placeholder="Email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} placeholder="Phone" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} placeholder="Website" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={company.knowledgeMode} onChange={(e) => setCompany({ ...company, knowledgeMode: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
              <option value="PROFILE_FIRST">Profile First</option>
              <option value="FULL_LIBRARY">Full Library</option>
            </select>
          </div>
          <input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} placeholder="Address" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.description} onChange={(e) => setCompany({ ...company, description: e.target.value })} rows={3} placeholder="Company description" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.profileSummary} onChange={(e) => setCompany({ ...company, profileSummary: e.target.value })} rows={4} placeholder="Profile summary used in drafting mode A" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={serviceLinesText} onChange={(e) => setServiceLinesText(e.target.value)} placeholder="Service lines, comma separated" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={sectorsText} onChange={(e) => setSectorsText(e.target.value)} placeholder="Sectors, comma separated" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button type="submit" disabled={saving || !company.name} className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving..." : "Save Company Vault"}
          </button>
        </form>

        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Company documents</h2>
              <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
                {uploading ? "Uploading..." : "+ Upload"}
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            {(company.documents || []).length === 0 ? <p className="text-sm text-slate-400">No company documents yet.</p> : (
              <ul className="space-y-2">{company.documents?.map((doc) => <li key={doc.id} className="rounded-xl border px-3 py-3 text-sm"><p className="font-medium text-slate-900">{doc.originalFileName}</p><p className="text-xs text-slate-500">{doc.type}</p></li>)}</ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Expert library</h2>
          <form onSubmit={addExpert} className="mt-4 space-y-3">
            <input value={expertForm.fullName} onChange={(e) => setExpertForm({ ...expertForm, fullName: e.target.value })} placeholder="Full name" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.title} onChange={(e) => setExpertForm({ ...expertForm, title: e.target.value })} placeholder="Title" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.disciplines} onChange={(e) => setExpertForm({ ...expertForm, disciplines: e.target.value })} placeholder="Disciplines, comma separated" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={expertForm.sectors} onChange={(e) => setExpertForm({ ...expertForm, sectors: e.target.value })} placeholder="Sectors, comma separated" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <textarea value={expertForm.profile} onChange={(e) => setExpertForm({ ...expertForm, profile: e.target.value })} rows={3} placeholder="Expert profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={expertSaving || !expertForm.fullName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{expertSaving ? "Adding..." : "Add Expert"}</button>
          </form>
          <div className="mt-5 space-y-2">{company.experts?.map((expert) => <div key={expert.id} className="rounded-xl border px-3 py-3"><p className="font-medium text-slate-900">{expert.fullName}</p><p className="text-xs text-slate-500">{expert.title || "No title"}</p><p className="mt-1 text-xs text-slate-500">{(expert.disciplines || []).join(", ")}</p></div>)}</div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Project reference library</h2>
          <form onSubmit={addProject} className="mt-4 space-y-3">
            <input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="Project name" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} placeholder="Client name" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={projectForm.sector} onChange={(e) => setProjectForm({ ...projectForm, sector: e.target.value })} placeholder="Sector" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={projectForm.serviceAreas} onChange={(e) => setProjectForm({ ...projectForm, serviceAreas: e.target.value })} placeholder="Service areas, comma separated" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <textarea value={projectForm.summary} onChange={(e) => setProjectForm({ ...projectForm, summary: e.target.value })} rows={3} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <button disabled={projectSaving || !projectForm.name} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{projectSaving ? "Adding..." : "Add Project"}</button>
          </form>
          <div className="mt-5 space-y-2">{company.projects?.map((project) => <div key={project.id} className="rounded-xl border px-3 py-3"><p className="font-medium text-slate-900">{project.name}</p><p className="text-xs text-slate-500">{project.clientName || "No client"}{project.sector ? ` · ${project.sector}` : ""}</p><p className="mt-1 text-xs text-slate-500">{(project.serviceAreas || []).join(", ")}</p></div>)}</div>
        </div>
      </div>
    </div>
  );
}
