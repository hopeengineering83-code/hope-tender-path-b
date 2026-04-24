"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type CompanyDoc = {
  id: string; originalFileName: string; mimeType: string; category: string;
  size: number; extractedText?: string | null; createdAt: string;
};
type Expert = {
  id: string; fullName: string; title: string | null; disciplines: string[];
  sectors: string[]; certifications: string[]; yearsExperience: number | null;
  profile: string | null; isActive: boolean;
};
type Project = {
  id: string; name: string; clientName: string | null; sector: string | null;
  country: string | null; serviceAreas: string[]; contractValue: number | null;
  currency: string | null; summary: string | null;
};
type Company = {
  id?: string; name: string; legalName: string; description: string; website: string;
  address: string; phone: string; email: string; knowledgeMode: string;
  serviceLines: string[]; sectors: string[]; profileSummary: string;
  experts?: Expert[]; projects?: Project[];
};
type UploadItem = { file: File; status: "queued"|"uploading"|"done"|"error"; error?: string; category: string };

const DOC_CATEGORIES = [
  "AUTO_DETECT","COMPANY_PROFILE","EXPERT_CV","PROJECT_REFERENCE","PROJECT_CONTRACT",
  "FINANCIAL_STATEMENT","LEGAL_REGISTRATION","CERTIFICATION","MANUAL","PORTFOLIO","COMPLIANCE_RECORD","OTHER",
];
const CATEGORY_LABELS: Record<string,string> = {
  AUTO_DETECT:"Auto-detect",COMPANY_PROFILE:"Company Profile",EXPERT_CV:"Expert CV",
  PROJECT_REFERENCE:"Project Reference",PROJECT_CONTRACT:"Project Contract",
  FINANCIAL_STATEMENT:"Financial Statement",LEGAL_REGISTRATION:"Legal / Registration",
  CERTIFICATION:"Certificate",MANUAL:"Manual / Policy",PORTFOLIO:"Portfolio",
  COMPLIANCE_RECORD:"Compliance Record",OTHER:"Other",
};
const CAT_COLORS: Record<string,string> = {
  COMPANY_PROFILE:"bg-blue-100 text-blue-700",EXPERT_CV:"bg-purple-100 text-purple-700",
  PROJECT_REFERENCE:"bg-green-100 text-green-700",PROJECT_CONTRACT:"bg-emerald-100 text-emerald-700",
  FINANCIAL_STATEMENT:"bg-amber-100 text-amber-700",LEGAL_REGISTRATION:"bg-red-100 text-red-700",
  CERTIFICATION:"bg-orange-100 text-orange-700",MANUAL:"bg-slate-100 text-slate-600",
  PORTFOLIO:"bg-teal-100 text-teal-700",COMPLIANCE_RECORD:"bg-rose-100 text-rose-700",OTHER:"bg-slate-100 text-slate-500",
};
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx,.csv,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp";
const empty: Company = { name:"",legalName:"",description:"",website:"",address:"",phone:"",email:"",knowledgeMode:"PROFILE_FIRST",serviceLines:[],sectors:[],profileSummary:"" };

function fmt(b: number) { return b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(0)} KB`:`${(b/1048576).toFixed(1)} MB`; }
function ext(name: string) { return name.toLowerCase().split(".").pop()??""; }

type Tab = "profile"|"documents"|"experts"|"projects";

export default function CompanyPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const [company, setCompany] = useState<Company>(empty);
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [serviceLinesTxt, setServiceLinesTxt] = useState("");
  const [sectorsTxt, setSectorsTxt] = useState("");
  const [docCategory, setDocCategory] = useState("AUTO_DETECT");
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [searchDoc, setSearchDoc] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expert state
  const [expertForm, setExpertForm] = useState({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
  const [expertSaving, setExpertSaving] = useState(false);
  const [editExpert, setEditExpert] = useState<Expert|null>(null);
  const [expertEditForm, setExpertEditForm] = useState({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
  const [deletingExpertId, setDeletingExpertId] = useState<string|null>(null);

  // Project state
  const [projectForm, setProjectForm] = useState({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"USD",summary:"" });
  const [projectSaving, setProjectSaving] = useState(false);
  const [editProject, setEditProject] = useState<Project|null>(null);
  const [projectEditForm, setProjectEditForm] = useState({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"USD",summary:"" });
  const [deletingProjectId, setDeletingProjectId] = useState<string|null>(null);

  async function loadDocs() {
    const r = await fetch("/api/company/documents");
    const d = await r.json() as { documents?: CompanyDoc[] };
    setDocs(d.documents ?? []);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/company").then(r=>r.json()),
      fetch("/api/company/documents").then(r=>r.json()),
    ]).then(([c, d]: [{ company?: Company } & Company, { documents?: CompanyDoc[] }]) => {
      const co = c.company ?? c;
      if (co.name !== undefined) {
        setCompany({ ...empty, ...(co as Company) });
        setServiceLinesTxt(((co as Company).serviceLines||[]).join(", "));
        setSectorsTxt(((co as Company).sectors||[]).join(", "));
      }
      setDocs(d.documents ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    const items: UploadItem[] = files.map(f => ({ file:f, status:"queued", category:docCategory }));
    setUploadQueue(q => [...items, ...q]);
    for (const item of items) {
      setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"uploading" } : x));
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("companyDoc", "true");
      fd.append("category", docCategory==="AUTO_DETECT" ? "AUTO" : docCategory);
      try {
        const res = await fetch("/api/upload", { method:"POST", body:fd });
        const data = await res.json() as { success?: boolean; results?: Array<{ error?: string }> };
        const firstErr = data.results?.[0] && "error" in data.results[0] ? data.results[0].error : undefined;
        if (!res.ok || firstErr) {
          setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"error", error:firstErr??"Upload failed" } : x));
        } else {
          setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"done" } : x));
          await loadDocs();
        }
      } catch {
        setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"error", error:"Network error" } : x));
      }
    }
  }, [docCategory]);

  async function deleteDoc(id: string) {
    await fetch(`/api/company/documents/${id}`, { method:"DELETE" });
    setDocs(d => d.filter(x => x.id!==id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(""); setSuccess(false);
    try {
      const res = await fetch("/api/company", {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ ...company, serviceLines:serviceLinesTxt, sectors:sectorsTxt }),
      });
      if (!res.ok) { setError("Failed to save"); return; }
      const updated = await res.json() as Company;
      setCompany({ ...empty, ...updated });
      setServiceLinesTxt((updated.serviceLines||[]).join(", "));
      setSectorsTxt((updated.sectors||[]).join(", "));
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  async function addExpert(e: React.FormEvent) {
    e.preventDefault(); setExpertSaving(true);
    const res = await fetch("/api/company/experts", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(expertForm),
    });
    if (res.ok) {
      const expert = await res.json() as Expert;
      setCompany(c => ({ ...c, experts:[expert, ...(c.experts||[])] }));
      setExpertForm({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
    }
    setExpertSaving(false);
  }

  function startEditExpert(ex: Expert) {
    setEditExpert(ex);
    setExpertEditForm({
      fullName:ex.fullName, title:ex.title??"", disciplines:(ex.disciplines||[]).join(", "),
      sectors:(ex.sectors||[]).join(", "), certifications:(ex.certifications||[]).join(", "),
      yearsExperience:ex.yearsExperience?.toString()??"", profile:ex.profile??"",
    });
  }

  async function saveEditExpert() {
    if (!editExpert) return;
    const res = await fetch(`/api/company/experts/${editExpert.id}`, {
      method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(expertEditForm),
    });
    if (res.ok) {
      const updated = await res.json() as Expert;
      setCompany(c => ({ ...c, experts:(c.experts||[]).map(x => x.id===editExpert.id ? updated : x) }));
      setEditExpert(null);
    }
  }

  async function deleteExpert(id: string) {
    if (!confirm("Delete this expert?")) return;
    setDeletingExpertId(id);
    const res = await fetch(`/api/company/experts/${id}`, { method:"DELETE" });
    if (res.ok) setCompany(c => ({ ...c, experts:(c.experts||[]).filter(x => x.id!==id) }));
    setDeletingExpertId(null);
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault(); setProjectSaving(true);
    const res = await fetch("/api/company/projects", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(projectForm),
    });
    if (res.ok) {
      const project = await res.json() as Project;
      setCompany(c => ({ ...c, projects:[project, ...(c.projects||[])] }));
      setProjectForm({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"USD",summary:"" });
    }
    setProjectSaving(false);
  }

  function startEditProject(p: Project) {
    setEditProject(p);
    setProjectEditForm({
      name:p.name, clientName:p.clientName??"", sector:p.sector??"", country:p.country??"",
      serviceAreas:(p.serviceAreas||[]).join(", "), contractValue:p.contractValue?.toString()??"",
      currency:p.currency??"USD", summary:p.summary??"",
    });
  }

  async function saveEditProject() {
    if (!editProject) return;
    const res = await fetch(`/api/company/projects/${editProject.id}`, {
      method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(projectEditForm),
    });
    if (res.ok) {
      const updated = await res.json() as Project;
      setCompany(c => ({ ...c, projects:(c.projects||[]).map(x => x.id===editProject.id ? updated : x) }));
      setEditProject(null);
    }
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project?")) return;
    setDeletingProjectId(id);
    const res = await fetch(`/api/company/projects/${id}`, { method:"DELETE" });
    if (res.ok) setCompany(c => ({ ...c, projects:(c.projects||[]).filter(x => x.id!==id) }));
    setDeletingProjectId(null);
  }

  const filteredDocs = docs.filter(d => {
    const ms = !searchDoc || d.originalFileName.toLowerCase().includes(searchDoc.toLowerCase());
    const mc = filterCat==="ALL" || d.category===filterCat;
    return ms && mc;
  });

  if (loading) return <div className="text-sm text-slate-400 py-16 text-center">Loading…</div>;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id:"profile", label:"Company Profile" },
    { id:"documents", label:"Documents", count:docs.length },
    { id:"experts", label:"Experts", count:(company.experts||[]).length },
    { id:"projects", label:"Projects", count:(company.projects||[]).length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Knowledge Vault</h1>
        <p className="mt-1 text-slate-500 text-sm">Reusable company knowledge for all tender proposals.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {[
          { label:"Documents", value:docs.length, color:"text-blue-600" },
          { label:"Experts", value:(company.experts||[]).length, color:"text-purple-600" },
          { label:"Projects", value:(company.projects||[]).length, color:"text-green-600" },
          { label:"Knowledge Mode", value:company.knowledgeMode==="FULL_LIBRARY"?"Full Library":"Profile First", small:true },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`mt-1.5 font-bold ${s.small ? "text-base text-slate-700" : `text-3xl ${s.color}`}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab===t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}{t.count !== undefined ? <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Profile saved successfully.</div>}

      {/* Profile Tab */}
      {tab==="profile" && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
          <h2 className="font-semibold text-slate-900">Company Profile</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={company.name} onChange={e=>setCompany({...company,name:e.target.value})} placeholder="Company name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.legalName} onChange={e=>setCompany({...company,legalName:e.target.value})} placeholder="Legal registered name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.email} onChange={e=>setCompany({...company,email:e.target.value})} type="email" placeholder="Contact email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.phone} onChange={e=>setCompany({...company,phone:e.target.value})} placeholder="Phone number" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={company.website} onChange={e=>setCompany({...company,website:e.target.value})} placeholder="Website URL" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={company.knowledgeMode} onChange={e=>setCompany({...company,knowledgeMode:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
              <option value="PROFILE_FIRST">Mode A — Profile First</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library</option>
            </select>
          </div>
          <input value={company.address} onChange={e=>setCompany({...company,address:e.target.value})} placeholder="Registered address" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.description} onChange={e=>setCompany({...company,description:e.target.value})} rows={2} placeholder="Company description" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={company.profileSummary} onChange={e=>setCompany({...company,profileSummary:e.target.value})} rows={4} placeholder="Profile summary — used in proposal drafting" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={serviceLinesTxt} onChange={e=>setServiceLinesTxt(e.target.value)} placeholder="Service lines (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input value={sectorsTxt} onChange={e=>setSectorsTxt(e.target.value)} placeholder="Sectors (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button type="submit" disabled={saving||!company.name} className="rounded-lg bg-black px-6 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      )}

      {/* Documents Tab */}
      {tab==="documents" && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Document Library</h2>
            <span className="text-xs text-slate-400">{docs.length} file{docs.length!==1?"s":""}</span>
          </div>
          <div className="flex gap-2 items-center">
            <select value={docCategory} onChange={e=>setDocCategory(e.target.value)} className="flex-1 rounded-lg border px-2 py-1.5 text-xs bg-white">
              {DOC_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]??c}</option>)}
            </select>
            <button onClick={()=>fileInputRef.current?.click()} className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs text-white hover:bg-slate-800">Browse</button>
            <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={e=>{ const f=[...(e.target.files??[])]; if(f.length) void processFiles(f); e.target.value=""; }} />
          </div>
          <div ref={dropRef} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);const f=[...e.dataTransfer.files];if(f.length) void processFiles(f);}}
            onClick={()=>fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragOver?"border-blue-400 bg-blue-50":"border-slate-200 hover:border-slate-400"}`}>
            <p className="text-sm font-medium text-slate-600">{dragOver?"Drop files here":"Drag & drop files here"}</p>
            <p className="mt-1 text-xs text-slate-400">PDF · DOCX · XLSX · Images · and more · Up to 10 MB</p>
          </div>
          {uploadQueue.length>0 && (
            <div className="space-y-1.5">
              {uploadQueue.slice(0,6).map((item,i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 ${item.status==="done"?"border-green-200 bg-green-50":item.status==="error"?"border-red-200 bg-red-50":item.status==="uploading"?"border-blue-200 bg-blue-50":"border-slate-200"}`}>
                  <span className="truncate font-medium">{item.file.name}</span>
                  <span className={item.status==="done"?"text-green-600":item.status==="error"?"text-red-600":item.status==="uploading"?"text-blue-600":"text-slate-400"}>
                    {item.status==="uploading"?"Uploading…":item.status==="done"?"✓ Done":item.status==="error"?`✕ ${item.error??"Failed"}`:"Queued"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {docs.length>0 && (
            <div className="flex gap-2">
              <input value={searchDoc} onChange={e=>setSearchDoc(e.target.value)} placeholder="Search…" className="flex-1 rounded-lg border px-2 py-1.5 text-xs" />
              <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs bg-white">
                <option value="ALL">All categories</option>
                {[...new Set(docs.map(d=>d.category))].map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]??c}</option>)}
              </select>
            </div>
          )}
          <div className="max-h-[500px] overflow-y-auto space-y-2">
            {filteredDocs.length===0 && <p className="text-xs text-slate-400 py-4 text-center">No documents yet.</p>}
            {filteredDocs.map(doc => (
              <div key={doc.id} className="rounded-xl border px-3 py-2.5 hover:bg-slate-50 group">
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase bg-slate-50 text-slate-600 border-slate-200">{ext(doc.originalFileName)||"?"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-800 truncate">{doc.originalFileName}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CAT_COLORS[doc.category]??"bg-slate-100 text-slate-500"}`}>{CATEGORY_LABELS[doc.category]??doc.category}</span>
                      <span className="text-[10px] text-slate-400">{fmt(doc.size)}</span>
                      {doc.extractedText ? <span className="text-[10px] text-green-600">✓ {doc.extractedText.length.toLocaleString()} chars</span> : <span className="text-[10px] text-slate-400">no text</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
                    <a href={`/api/company/documents/${doc.id}`} download={doc.originalFileName} className="rounded border px-2 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 border-blue-200">↓</a>
                    <button onClick={()=>deleteDoc(doc.id)} className="rounded border px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-50 border-red-200">✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Experts Tab */}
      {tab==="experts" && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
            <h2 className="font-semibold text-slate-900 mb-4">Add Expert</h2>
            <form onSubmit={addExpert} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={expertForm.fullName} onChange={e=>setExpertForm({...expertForm,fullName:e.target.value})} placeholder="Full name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertForm.title} onChange={e=>setExpertForm({...expertForm,title:e.target.value})} placeholder="Title / Position" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertForm.disciplines} onChange={e=>setExpertForm({...expertForm,disciplines:e.target.value})} placeholder="Disciplines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertForm.sectors} onChange={e=>setExpertForm({...expertForm,sectors:e.target.value})} placeholder="Sectors (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertForm.certifications} onChange={e=>setExpertForm({...expertForm,certifications:e.target.value})} placeholder="Certifications" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertForm.yearsExperience} onChange={e=>setExpertForm({...expertForm,yearsExperience:e.target.value})} type="number" placeholder="Years experience" className="rounded-lg border px-3 py-2 text-sm" />
              </div>
              <textarea value={expertForm.profile} onChange={e=>setExpertForm({...expertForm,profile:e.target.value})} rows={2} placeholder="Profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <button disabled={expertSaving||!expertForm.fullName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
                {expertSaving?"Adding…":"Add Expert"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {(company.experts||[]).length===0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">No experts yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium hidden md:table-cell">Title</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Disciplines</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Exp.</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(company.experts||[]).map(ex => (
                    <tr key={ex.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{ex.fullName}</td>
                      <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{ex.title??"-"}</td>
                      <td className="px-5 py-3 text-slate-500 hidden lg:table-cell text-xs">{(ex.disciplines||[]).slice(0,3).join(", ")||"-"}</td>
                      <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{ex.yearsExperience ? `${ex.yearsExperience}y` : "-"}</td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={()=>startEditExpert(ex)} className="rounded border px-2.5 py-1 text-xs hover:bg-slate-100 mr-1">Edit</button>
                        <button onClick={()=>deleteExpert(ex.id)} disabled={deletingExpertId===ex.id} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40">
                          {deletingExpertId===ex.id?"…":"Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Projects Tab */}
      {tab==="projects" && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
            <h2 className="font-semibold text-slate-900 mb-4">Add Project</h2>
            <form onSubmit={addProject} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={projectForm.name} onChange={e=>setProjectForm({...projectForm,name:e.target.value})} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.clientName} onChange={e=>setProjectForm({...projectForm,clientName:e.target.value})} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.sector} onChange={e=>setProjectForm({...projectForm,sector:e.target.value})} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.country} onChange={e=>setProjectForm({...projectForm,country:e.target.value})} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.contractValue} onChange={e=>setProjectForm({...projectForm,contractValue:e.target.value})} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
                <select value={projectForm.currency} onChange={e=>setProjectForm({...projectForm,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                  {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <input value={projectForm.serviceAreas} onChange={e=>setProjectForm({...projectForm,serviceAreas:e.target.value})} placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea value={projectForm.summary} onChange={e=>setProjectForm({...projectForm,summary:e.target.value})} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <button disabled={projectSaving||!projectForm.name} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
                {projectSaving?"Adding…":"Add Project"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {(company.projects||[]).length===0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">No projects yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-medium">Project</th>
                    <th className="px-5 py-3 font-medium hidden md:table-cell">Client</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Sector</th>
                    <th className="px-5 py-3 font-medium hidden lg:table-cell">Country</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(company.projects||[]).map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                      <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{p.clientName??"-"}</td>
                      <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{p.sector??"-"}</td>
                      <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{p.country??"-"}</td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={()=>startEditProject(p)} className="rounded border px-2.5 py-1 text-xs hover:bg-slate-100 mr-1">Edit</button>
                        <button onClick={()=>deleteProject(p.id)} disabled={deletingProjectId===p.id} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40">
                          {deletingProjectId===p.id?"…":"Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Edit Expert Modal */}
      {editExpert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setEditExpert(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Expert</h2>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={expertEditForm.fullName} onChange={e=>setExpertEditForm({...expertEditForm,fullName:e.target.value})} placeholder="Full name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertEditForm.title} onChange={e=>setExpertEditForm({...expertEditForm,title:e.target.value})} placeholder="Title" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertEditForm.disciplines} onChange={e=>setExpertEditForm({...expertEditForm,disciplines:e.target.value})} placeholder="Disciplines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertEditForm.sectors} onChange={e=>setExpertEditForm({...expertEditForm,sectors:e.target.value})} placeholder="Sectors" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertEditForm.certifications} onChange={e=>setExpertEditForm({...expertEditForm,certifications:e.target.value})} placeholder="Certifications" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={expertEditForm.yearsExperience} onChange={e=>setExpertEditForm({...expertEditForm,yearsExperience:e.target.value})} type="number" placeholder="Years exp." className="rounded-lg border px-3 py-2 text-sm" />
              </div>
              <textarea value={expertEditForm.profile} onChange={e=>setExpertEditForm({...expertEditForm,profile:e.target.value})} rows={2} placeholder="Profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditExpert} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">Save</button>
              <button onClick={()=>setEditExpert(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setEditProject(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Project</h2>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={projectEditForm.name} onChange={e=>setProjectEditForm({...projectEditForm,name:e.target.value})} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.clientName} onChange={e=>setProjectEditForm({...projectEditForm,clientName:e.target.value})} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.sector} onChange={e=>setProjectEditForm({...projectEditForm,sector:e.target.value})} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.country} onChange={e=>setProjectEditForm({...projectEditForm,country:e.target.value})} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.contractValue} onChange={e=>setProjectEditForm({...projectEditForm,contractValue:e.target.value})} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
                <select value={projectEditForm.currency} onChange={e=>setProjectEditForm({...projectEditForm,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                  {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <input value={projectEditForm.serviceAreas} onChange={e=>setProjectEditForm({...projectEditForm,serviceAreas:e.target.value})} placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea value={projectEditForm.summary} onChange={e=>setProjectEditForm({...projectEditForm,summary:e.target.value})} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditProject} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">Save</button>
              <button onClick={()=>setEditProject(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
