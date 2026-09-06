"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CrossIcon } from "../../../components/icons";

type Step = 1 | 2 | 3 | 4 | 5;
type UploadState = { name: string; status: "uploading" | "done" | "error"; error?: string };
type CompanyPayload = {
  name?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  description?: string;
  profileSummary?: string;
  serviceLines?: string[];
  sectors?: string[];
  knowledgeMode?: string;
  setupCompletedAt?: string | null;
  experts?: Array<{ fullName?: string }>;
  projects?: Array<{ name?: string }>;
  error?: string;
};

type ErrorPayload = { error?: string };

const STEPS = [
  { n: 1 as Step, label: "Company Info" },
  { n: 2 as Step, label: "Documents" },
  { n: 3 as Step, label: "Experts" },
  { n: 4 as Step, label: "Projects" },
  { n: 5 as Step, label: "Complete" },
];

const DOC_CATEGORIES = ["AUTO_DETECT", "COMPANY_PROFILE", "EXPERT_CV", "PROJECT_REFERENCE", "PROJECT_CONTRACT", "FINANCIAL_STATEMENT", "LEGAL_REGISTRATION", "CERTIFICATION", "MANUAL", "PORTFOLIO", "COMPLIANCE_RECORD", "OTHER"];
const CATEGORY_LABELS: Record<string, string> = {
  AUTO_DETECT: "Auto-detect",
  COMPANY_PROFILE: "Company Profile",
  EXPERT_CV: "Expert CV",
  PROJECT_REFERENCE: "Project Reference",
  PROJECT_CONTRACT: "Project Contract",
  FINANCIAL_STATEMENT: "Financial Statement",
  LEGAL_REGISTRATION: "Legal / Registration",
  CERTIFICATION: "Certificate",
  MANUAL: "Manual / Policy",
  PORTFOLIO: "Portfolio",
  COMPLIANCE_RECORD: "Compliance Record",
  OTHER: "Other",
};
const SAFE_UPLOAD_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "csv", "txt"]);
const CURRENCIES = ["ETB", "USD", "EUR", "GBP", "AED", "SAR", "KWD", "EGP", "ZAR"];

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function responseError(payload: ErrorPayload, fallback: string) {
  return payload.error || fallback;
}

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    name: "", legalName: "", email: "", phone: "", website: "", address: "", description: "",
    profileSummary: "", serviceLines: "", sectors: "", knowledgeMode: "PROFILE_FIRST",
  });
  const [existingExpertCount, setExistingExpertCount] = useState(0);
  const [existingProjectCount, setExistingProjectCount] = useState(0);
  const [docCategory, setDocCategory] = useState("AUTO_DETECT");
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadState[]>([]);
  const [expert, setExpert] = useState({ fullName: "", title: "", disciplines: "", sectors: "", yearsExperience: "", profile: "" });
  const [addingExpert, setAddingExpert] = useState(false);
  const [project, setProject] = useState({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "", summary: "" });
  const [addingProject, setAddingProject] = useState(false);

  const loadCompany = useCallback(async () => {
    const response = await fetch("/api/company", { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as CompanyPayload;
    if (!response.ok) throw new Error(responseError(data, `Company profile could not be loaded (HTTP ${response.status}).`));

    setProfile({
      name: data.name ?? "",
      legalName: data.legalName ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      website: data.website ?? "",
      address: data.address ?? "",
      description: data.description ?? "",
      profileSummary: data.profileSummary ?? "",
      serviceLines: (data.serviceLines ?? []).join(", "),
      sectors: (data.sectors ?? []).join(", "),
      knowledgeMode: data.knowledgeMode ?? "PROFILE_FIRST",
    });
    setExistingExpertCount(data.experts?.length ?? 0);
    setExistingProjectCount(data.projects?.length ?? 0);
    return data;
  }, []);

  useEffect(() => {
    setError(null);
    void loadCompany()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Company profile could not be loaded."))
      .finally(() => setLoading(false));
  }, [loadCompany]);

  function clearMessages() {
    setError(null);
    setStatus(null);
  }

  async function saveProfile() {
    clearMessages();
    if (!profile.name.trim()) {
      setError("Company name is required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await response.json().catch(() => ({})) as ErrorPayload;
      if (!response.ok) throw new Error(responseError(data, `Profile could not be saved (HTTP ${response.status}).`));
      await loadCompany();
      setStatus("Company information saved and confirmed by the server.");
      setStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDocumentUpload(files: FileList | null) {
    if (!files?.length || uploading) return;
    clearMessages();
    const selected = Array.from(files);
    const invalid = selected.filter((file) => !SAFE_UPLOAD_EXTENSIONS.has(extensionOf(file.name)));
    if (invalid.length > 0) {
      setError(`${invalid.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, CSV, or TXT.`);
      return;
    }

    setUploading(true);
    let successful = 0;
    for (const file of selected) {
      setUploadedDocs((current) => [...current, { name: file.name, status: "uploading" }]);
      const form = new FormData();
      form.append("file", file);
      form.append("companyDoc", "true");
      form.append("category", docCategory === "AUTO_DETECT" ? "AUTO" : docCategory);
      try {
        const response = await fetch("/api/upload", { method: "POST", body: form });
        const data = await response.json().catch(() => ({})) as ErrorPayload;
        if (!response.ok) throw new Error(responseError(data, `Upload failed (HTTP ${response.status}).`));
        successful += 1;
        setUploadedDocs((current) => current.map((item) => item.name === file.name ? { ...item, status: "done", error: undefined } : item));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Upload failed.";
        setUploadedDocs((current) => current.map((item) => item.name === file.name ? { ...item, status: "error", error: message } : item));
      }
    }
    setUploading(false);
    if (successful > 0) setStatus(`${successful} document${successful === 1 ? "" : "s"} accepted by the server.`);
    if (successful !== selected.length) setError(`${selected.length - successful} document${selected.length - successful === 1 ? "" : "s"} failed. Review the file list below.`);
  }

  async function saveExpert() {
    clearMessages();
    if (!expert.fullName.trim()) {
      setError("Expert name is required.");
      return;
    }
    setAddingExpert(true);
    try {
      const response = await fetch("/api/company/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expert),
      });
      const data = await response.json().catch(() => ({})) as ErrorPayload;
      if (!response.ok) throw new Error(responseError(data, `Expert could not be added (HTTP ${response.status}).`));
      await loadCompany();
      setExpert({ fullName: "", title: "", disciplines: "", sectors: "", yearsExperience: "", profile: "" });
      setStatus("Expert added and confirmed in the company profile.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Expert could not be added.");
    } finally {
      setAddingExpert(false);
    }
  }

  async function saveProject() {
    clearMessages();
    if (!project.name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (project.contractValue && !project.currency) {
      setError("Select a currency when a contract value is entered.");
      return;
    }
    setAddingProject(true);
    try {
      const response = await fetch("/api/company/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...project, currency: project.currency || null }),
      });
      const data = await response.json().catch(() => ({})) as ErrorPayload;
      if (!response.ok) throw new Error(responseError(data, `Project could not be added (HTTP ${response.status}).`));
      await loadCompany();
      setProject({ name: "", clientName: "", sector: "", country: "", serviceAreas: "", contractValue: "", currency: "", summary: "" });
      setStatus("Project added and confirmed in the company profile.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Project could not be added.");
    } finally {
      setAddingProject(false);
    }
  }

  async function completeSetup() {
    clearMessages();
    setSaving(true);
    try {
      const completedAt = new Date().toISOString();
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupCompletedAt: completedAt }),
      });
      const data = await response.json().catch(() => ({})) as ErrorPayload;
      if (!response.ok) throw new Error(responseError(data, `Setup could not be completed (HTTP ${response.status}).`));
      const refreshed = await loadCompany();
      if (!refreshed.setupCompletedAt) throw new Error("The server did not confirm setup completion.");
      router.push("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status" className="py-12 text-center text-slate-500">Loading existing company profile…</p>;

  const inputClass = "min-h-11 min-w-0 rounded-lg border px-3 py-2 text-sm";
  const actionClass = "min-h-11 rounded-lg px-5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="mx-auto min-w-0 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Company Setup Wizard</h1>
        <p className="mt-1 text-sm text-slate-500">Existing company facts are loaded first. Saving never starts from a blank replacement state.</p>
      </div>

      <ol className="mb-6 flex max-w-full gap-2 overflow-x-auto pb-2" aria-label="Setup progress">
        {STEPS.map((item) => (
          <li key={item.n} className="shrink-0">
            <button
              type="button"
              onClick={() => setStep(item.n)}
              aria-current={step === item.n ? "step" : undefined}
              className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium ${step === item.n ? "border-slate-900 bg-slate-900 text-white" : step > item.n ? "border-green-300 bg-green-50 text-green-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {step > item.n ? <><CheckIcon /> </> : `${item.n}. `}{item.label}
            </button>
          </li>
        ))}
      </ol>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {status && <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div>}

      {step === 1 && (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" aria-busy={saving}>
          <div><h2 className="font-semibold text-slate-900">Company information</h2><p className="mt-1 text-sm text-slate-500">Review the loaded values before saving. These are company facts, not tender facts.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Company name" aria-label="Company name" className={`${inputClass} sm:col-span-2`} />
            <input value={profile.legalName} onChange={(event) => setProfile({ ...profile, legalName: event.target.value })} placeholder="Legal registered name" aria-label="Legal registered name" className={inputClass} />
            <input value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} type="email" placeholder="Company email" aria-label="Company email" className={inputClass} />
            <input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Phone" aria-label="Company phone" className={inputClass} />
            <input value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} placeholder="Website" aria-label="Company website" className={inputClass} />
            <input value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} placeholder="Registered address" aria-label="Registered address" className={`${inputClass} sm:col-span-2`} />
            <textarea value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} rows={2} placeholder="Company description" aria-label="Company description" className={`${inputClass} sm:col-span-2`} />
            <textarea value={profile.profileSummary} onChange={(event) => setProfile({ ...profile, profileSummary: event.target.value })} rows={3} placeholder="Reviewed profile summary" aria-label="Profile summary" className={`${inputClass} sm:col-span-2`} />
            <input value={profile.serviceLines} onChange={(event) => setProfile({ ...profile, serviceLines: event.target.value })} placeholder="Service lines, comma-separated" aria-label="Service lines" className={`${inputClass} sm:col-span-2`} />
            <input value={profile.sectors} onChange={(event) => setProfile({ ...profile, sectors: event.target.value })} placeholder="Sectors, comma-separated" aria-label="Sectors" className={`${inputClass} sm:col-span-2`} />
            <select value={profile.knowledgeMode} onChange={(event) => setProfile({ ...profile, knowledgeMode: event.target.value })} aria-label="Knowledge mode" className={`${inputClass} bg-white sm:col-span-2`}>
              <option value="PROFILE_FIRST">Mode A — Profile First</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library</option>
            </select>
          </div>
          <button type="button" onClick={() => void saveProfile()} disabled={saving || !profile.name.trim()} className={`${actionClass} w-full bg-black text-white hover:bg-slate-800 sm:w-auto`}>{saving ? "Saving and confirming…" : "Save and continue"}</button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" aria-busy={uploading}>
          <div><h2 className="font-semibold text-slate-900">Upload company documents</h2><p className="mt-1 text-sm text-slate-500">Accepted: PDF, DOCX, XLSX, CSV, and TXT. Each file shows its server-confirmed result.</p></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr),auto]">
            <select value={docCategory} onChange={(event) => setDocCategory(event.target.value)} className={`${inputClass} bg-white`} aria-label="Document category">
              {DOC_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
            </select>
            <label className={`${actionClass} flex cursor-pointer items-center justify-center bg-black text-white hover:bg-slate-800 ${uploading ? "cursor-not-allowed opacity-60" : ""}`}>
              {uploading ? "Uploading…" : "Browse files"}
              <input type="file" accept=".pdf,.docx,.xlsx,.csv,.txt" multiple disabled={uploading} className="hidden" onChange={(event) => void handleDocumentUpload(event.target.files)} />
            </label>
          </div>
          {uploadedDocs.length > 0 && <ul className="max-h-64 space-y-2 overflow-y-auto">{uploadedDocs.map((item, index) => <li key={`${item.name}-${index}`} className={`min-w-0 rounded-lg border px-3 py-2 text-xs ${item.status === "done" ? "border-green-200 bg-green-50" : item.status === "error" ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}><div className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 break-all font-medium text-slate-700">{item.name}</span><span className="shrink-0">{item.status === "done" ? <><CheckIcon /> Accepted</> : item.status === "error" ? <><CrossIcon /> Failed</> : "Uploading…"}</span></div>{item.error && <p className="mt-1 text-red-700">{item.error}</p>}</li>)}</ul>}
          <div className="grid gap-2 sm:flex"><button type="button" onClick={() => setStep(3)} className={`${actionClass} bg-black text-white hover:bg-slate-800`}>Continue</button><button type="button" onClick={() => setStep(1)} className={`${actionClass} border text-slate-700 hover:bg-slate-50`}>Back</button></div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" aria-busy={addingExpert}>
          <div><h2 className="font-semibold text-slate-900">Add expert profiles</h2><p className="mt-1 text-sm text-slate-500">Existing experts: {existingExpertCount}. Add only reviewed company facts.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={expert.fullName} onChange={(event) => setExpert({ ...expert, fullName: event.target.value })} placeholder="Full name" aria-label="Expert full name" className={inputClass} />
            <input value={expert.title} onChange={(event) => setExpert({ ...expert, title: event.target.value })} placeholder="Title or position" aria-label="Expert title" className={inputClass} />
            <input value={expert.disciplines} onChange={(event) => setExpert({ ...expert, disciplines: event.target.value })} placeholder="Disciplines" aria-label="Expert disciplines" className={inputClass} />
            <input value={expert.sectors} onChange={(event) => setExpert({ ...expert, sectors: event.target.value })} placeholder="Sectors" aria-label="Expert sectors" className={inputClass} />
            <input value={expert.yearsExperience} onChange={(event) => setExpert({ ...expert, yearsExperience: event.target.value })} type="number" min="0" placeholder="Years experience" aria-label="Years experience" className={inputClass} />
            <textarea value={expert.profile} onChange={(event) => setExpert({ ...expert, profile: event.target.value })} rows={2} placeholder="Profile summary" aria-label="Expert profile summary" className={`${inputClass} sm:col-span-2`} />
          </div>
          <button type="button" onClick={() => void saveExpert()} disabled={addingExpert || !expert.fullName.trim()} className={`${actionClass} w-full bg-slate-800 text-white hover:bg-black sm:w-auto`}>{addingExpert ? "Adding and confirming…" : "Add expert"}</button>
          <div className="grid gap-2 sm:flex"><button type="button" onClick={() => setStep(4)} className={`${actionClass} bg-black text-white hover:bg-slate-800`}>Continue</button><button type="button" onClick={() => setStep(2)} className={`${actionClass} border text-slate-700 hover:bg-slate-50`}>Back</button></div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm" aria-busy={addingProject}>
          <div><h2 className="font-semibold text-slate-900">Add project references</h2><p className="mt-1 text-sm text-slate-500">Existing projects: {existingProjectCount}. Currency stays blank unless a verified value is entered.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} placeholder="Project name" aria-label="Project name" className={inputClass} />
            <input value={project.clientName} onChange={(event) => setProject({ ...project, clientName: event.target.value })} placeholder="Client name" aria-label="Project client" className={inputClass} />
            <input value={project.sector} onChange={(event) => setProject({ ...project, sector: event.target.value })} placeholder="Sector" aria-label="Project sector" className={inputClass} />
            <input value={project.country} onChange={(event) => setProject({ ...project, country: event.target.value })} placeholder="Country" aria-label="Project country" className={inputClass} />
            <input value={project.serviceAreas} onChange={(event) => setProject({ ...project, serviceAreas: event.target.value })} placeholder="Service areas" aria-label="Project service areas" className={`${inputClass} sm:col-span-2`} />
            <input value={project.contractValue} onChange={(event) => setProject({ ...project, contractValue: event.target.value })} type="number" min="0" placeholder="Verified contract value" aria-label="Contract value" className={inputClass} />
            <select value={project.currency} onChange={(event) => setProject({ ...project, currency: event.target.value })} aria-label="Contract currency" className={`${inputClass} bg-white`}><option value="">No verified currency</option>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
            <textarea value={project.summary} onChange={(event) => setProject({ ...project, summary: event.target.value })} rows={2} placeholder="Project summary" aria-label="Project summary" className={`${inputClass} sm:col-span-2`} />
          </div>
          <button type="button" onClick={() => void saveProject()} disabled={addingProject || !project.name.trim()} className={`${actionClass} w-full bg-slate-800 text-white hover:bg-black sm:w-auto`}>{addingProject ? "Adding and confirming…" : "Add project"}</button>
          <div className="grid gap-2 sm:flex"><button type="button" onClick={() => setStep(5)} className={`${actionClass} bg-black text-white hover:bg-slate-800`}>Continue</button><button type="button" onClick={() => setStep(3)} className={`${actionClass} border text-slate-700 hover:bg-slate-50`}>Back</button></div>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-5 rounded-2xl border bg-white p-5 text-center shadow-sm" aria-busy={saving}>
          <div className="flex justify-center"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl"><CheckIcon /></div></div>
          <h2 className="text-xl font-semibold text-slate-900">Review complete</h2>
          <p className="mx-auto max-w-lg text-sm text-slate-500">Completing setup records only that this company profile review finished. It does not authorize tender claims, matching, generation, or export.</p>
          <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void completeSetup()} disabled={saving} className={`${actionClass} bg-black text-white hover:bg-slate-800`}>{saving ? "Confirming…" : "Complete and open dashboard"}</button><button type="button" onClick={() => router.push("/dashboard/tenders/new")} disabled={saving} className={`${actionClass} border text-slate-700 hover:bg-slate-50`}>Create tender</button></div>
        </section>
      )}
    </div>
  );
}
