"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1|2|3|4|5;

const STEPS = [
  { n:1 as Step, label:"Company Info" },
  { n:2 as Step, label:"Upload Documents" },
  { n:3 as Step, label:"Add Experts" },
  { n:4 as Step, label:"Add Projects" },
  { n:5 as Step, label:"Complete" },
];

const DOC_CATS = ["AUTO_DETECT","COMPANY_PROFILE","EXPERT_CV","PROJECT_REFERENCE","PROJECT_CONTRACT","FINANCIAL_STATEMENT","LEGAL_REGISTRATION","CERTIFICATION","MANUAL","PORTFOLIO","COMPLIANCE_RECORD","OTHER"];
const CAT_LABELS: Record<string,string> = {
  AUTO_DETECT:"Auto-detect",COMPANY_PROFILE:"Company Profile",EXPERT_CV:"Expert CV",PROJECT_REFERENCE:"Project Reference",
  PROJECT_CONTRACT:"Project Contract",FINANCIAL_STATEMENT:"Financial Statement",LEGAL_REGISTRATION:"Legal / Registration",
  CERTIFICATION:"Certificate",MANUAL:"Manual / Policy",PORTFOLIO:"Portfolio",COMPLIANCE_RECORD:"Compliance Record",OTHER:"Other",
};

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1 - Company info
  const [profile, setProfile] = useState({
    name:"",legalName:"",email:"",phone:"",website:"",address:"",description:"",
    profileSummary:"",serviceLines:"",sectors:"",knowledgeMode:"PROFILE_FIRST",
  });

  // Step 2 - Documents
  const [docCat, setDocCat] = useState("AUTO_DETECT");
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<{name:string;status:string}[]>([]);

  // Step 3 - Expert
  const [expert, setExpert] = useState({ fullName:"",title:"",disciplines:"",sectors:"",yearsExperience:"",profile:"" });
  const [experts, setExperts] = useState<{name:string}[]>([]);
  const [addingExpert, setAddingExpert] = useState(false);

  // Step 4 - Project
  const [project, setProject] = useState({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"USD",summary:"" });
  const [projects, setProjects] = useState<{name:string}[]>([]);
  const [addingProject, setAddingProject] = useState(false);

  async function saveProfile() {
    if (!profile.name.trim()) { setError("Company name is required"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/company", {
        method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(profile),
      });
      if (!res.ok) { setError("Failed to save profile"); return; }
      setStep(2);
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  async function handleDocUpload(files: FileList|null) {
    if (!files||!files.length) return;
    setUploading(true);
    const arr = [...files];
    for (const file of arr) {
      setUploadedDocs(d=>[...d,{name:file.name,status:"uploading"}]);
      const fd = new FormData();
      fd.append("file",file);
      fd.append("companyDoc","true");
      fd.append("category", docCat==="AUTO_DETECT"?"AUTO":docCat);
      try {
        const res = await fetch("/api/upload",{method:"POST",body:fd});
        const ok = res.ok;
        setUploadedDocs(d=>d.map(x=>x.name===file.name?{...x,status:ok?"done":"error"}:x));
      } catch { setUploadedDocs(d=>d.map(x=>x.name===file.name?{...x,status:"error"}:x)); }
    }
    setUploading(false);
  }

  async function saveExpert() {
    if (!expert.fullName.trim()) { setError("Expert name required"); return; }
    setAddingExpert(true); setError("");
    try {
      const res = await fetch("/api/company/experts", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(expert),
      });
      if (res.ok) {
        setExperts(e=>[...e,{name:expert.fullName}]);
        setExpert({fullName:"",title:"",disciplines:"",sectors:"",yearsExperience:"",profile:""});
      }
    } finally { setAddingExpert(false); }
  }

  async function saveProject() {
    if (!project.name.trim()) { setError("Project name required"); return; }
    setAddingProject(true); setError("");
    try {
      const res = await fetch("/api/company/projects", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(project),
      });
      if (res.ok) {
        setProjects(p=>[...p,{name:project.name}]);
        setProject({name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"USD",summary:""});
      }
    } finally { setAddingProject(false); }
  }

  async function completeSetup() {
    setSaving(true);
    await fetch("/api/company", {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ setupCompletedAt: new Date().toISOString() }),
    });
    router.push("/dashboard");
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Company Setup Wizard</h1>
        <p className="mt-1 text-slate-500 text-sm">Configure your knowledge vault once. Reuse for every tender.</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s,i) => (
          <div key={s.n} className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors ${step===s.n?"border-black bg-black text-white":step>s.n?"border-green-500 bg-green-500 text-white":"border-slate-300 text-slate-400"}`}>
              {step>s.n ? "✓" : s.n}
            </div>
            <span className={`ml-1.5 text-xs font-medium hidden sm:inline ${step===s.n?"text-slate-900":step>s.n?"text-green-600":"text-slate-400"}`}>{s.label}</span>
            {i<STEPS.length-1 && <div className={`mx-2 h-0.5 w-6 sm:w-10 ${step>s.n?"bg-green-400":"bg-slate-200"}`} />}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Step 1 */}
      {step===1 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Company Information</h2>
          <p className="text-sm text-slate-500">Enter your company details. These become the foundation of every proposal.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})} placeholder="Company name *" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <input value={profile.legalName} onChange={e=>setProfile({...profile,legalName:e.target.value})} placeholder="Legal registered name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.email} onChange={e=>setProfile({...profile,email:e.target.value})} type="email" placeholder="Company email" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.phone} onChange={e=>setProfile({...profile,phone:e.target.value})} placeholder="Phone" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.website} onChange={e=>setProfile({...profile,website:e.target.value})} placeholder="Website" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={profile.address} onChange={e=>setProfile({...profile,address:e.target.value})} placeholder="Registered address" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <textarea value={profile.description} onChange={e=>setProfile({...profile,description:e.target.value})} rows={2} placeholder="Company description" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <textarea value={profile.profileSummary} onChange={e=>setProfile({...profile,profileSummary:e.target.value})} rows={3} placeholder="Profile summary — used in proposal drafting" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <input value={profile.serviceLines} onChange={e=>setProfile({...profile,serviceLines:e.target.value})} placeholder="Service lines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <input value={profile.sectors} onChange={e=>setProfile({...profile,sectors:e.target.value})} placeholder="Sectors (comma-separated)" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <select value={profile.knowledgeMode} onChange={e=>setProfile({...profile,knowledgeMode:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white col-span-2">
              <option value="PROFILE_FIRST">Mode A — Profile First (recommended for most tenders)</option>
              <option value="FULL_LIBRARY">Mode B — Full Document Library (deep evidence matching)</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={saveProfile} disabled={saving||!profile.name.trim()} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {saving?"Saving…":"Save & Continue →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step===2 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Upload Company Documents</h2>
          <p className="text-sm text-slate-500">Upload CVs, company profile, financial statements, certificates, contracts, and manuals. The system extracts text and builds the knowledge base.</p>
          <div className="flex gap-2">
            <select value={docCat} onChange={e=>setDocCat(e.target.value)} className="flex-1 rounded-lg border px-2 py-2 text-sm bg-white">
              {DOC_CATS.map(c=><option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
            <label className={`cursor-pointer rounded-lg px-4 py-2 text-sm text-white ${uploading?"bg-slate-400 cursor-not-allowed":"bg-black hover:bg-slate-800"}`}>
              {uploading?"Uploading…":"Browse Files"}
              <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt,.rtf,.jpg,.jpeg,.png" multiple disabled={uploading}
                className="hidden" onChange={e=>handleDocUpload(e.target.files)} />
            </label>
          </div>
          {uploadedDocs.length>0 && (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {uploadedDocs.map((d,i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${d.status==="done"?"border-green-200 bg-green-50":d.status==="error"?"border-red-200 bg-red-50":"border-blue-200 bg-blue-50"}`}>
                  <span className="truncate font-medium text-slate-700">{d.name}</span>
                  <span className={d.status==="done"?"text-green-600":d.status==="error"?"text-red-600":"text-blue-600"}>
                    {d.status==="done"?"✓ Done":d.status==="error"?"✕ Failed":"Uploading…"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700">
            <strong>Tip:</strong> Upload at least your Company Profile, 3-5 Expert CVs, and 3-5 Project References for best matching results.
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={()=>setStep(3)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">
              Continue →
            </button>
            <button onClick={()=>setStep(1)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step===3 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Add Expert Profiles</h2>
          <p className="text-sm text-slate-500">Add key experts manually, or they will be auto-extracted from CVs you uploaded. The matching engine uses these to assign experts to tenders.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={expert.fullName} onChange={e=>setExpert({...expert,fullName:e.target.value})} placeholder="Full name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.title} onChange={e=>setExpert({...expert,title:e.target.value})} placeholder="Title / Position" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.disciplines} onChange={e=>setExpert({...expert,disciplines:e.target.value})} placeholder="Disciplines (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.sectors} onChange={e=>setExpert({...expert,sectors:e.target.value})} placeholder="Sectors (comma-separated)" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={expert.yearsExperience} onChange={e=>setExpert({...expert,yearsExperience:e.target.value})} type="number" placeholder="Years experience" className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <textarea value={expert.profile} onChange={e=>setExpert({...expert,profile:e.target.value})} rows={2} placeholder="Profile summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button onClick={saveExpert} disabled={addingExpert||!expert.fullName.trim()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-black disabled:opacity-50">
            {addingExpert?"Adding…":"+ Add Expert"}
          </button>
          {experts.length>0 && (
            <div className="rounded-xl bg-slate-50 border p-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-600">{experts.length} expert{experts.length!==1?"s":""} added</p>
              {experts.map((e,i)=><p key={i} className="text-xs text-slate-700">• {e.name}</p>)}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={()=>setStep(4)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">Continue →</button>
            <button onClick={()=>setStep(2)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button>
          </div>
        </div>
      )}

      {/* Step 4 */}
      {step===4 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-slate-900">Add Project References</h2>
          <p className="text-sm text-slate-500">Add key past projects. These are matched against tender experience requirements.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={project.name} onChange={e=>setProject({...project,name:e.target.value})} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.clientName} onChange={e=>setProject({...project,clientName:e.target.value})} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.sector} onChange={e=>setProject({...project,sector:e.target.value})} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.country} onChange={e=>setProject({...project,country:e.target.value})} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
            <input value={project.serviceAreas} onChange={e=>setProject({...project,serviceAreas:e.target.value})} placeholder="Service areas (comma-separated)" className="rounded-lg border px-3 py-2 text-sm col-span-2" />
            <input value={project.contractValue} onChange={e=>setProject({...project,contractValue:e.target.value})} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
            <select value={project.currency} onChange={e=>setProject({...project,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
              {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <textarea value={project.summary} onChange={e=>setProject({...project,summary:e.target.value})} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button onClick={saveProject} disabled={addingProject||!project.name.trim()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-black disabled:opacity-50">
            {addingProject?"Adding…":"+ Add Project"}
          </button>
          {projects.length>0 && (
            <div className="rounded-xl bg-slate-50 border p-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-600">{projects.length} project{projects.length!==1?"s":""} added</p>
              {projects.map((p,i)=><p key={i} className="text-xs text-slate-700">• {p.name}</p>)}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={()=>setStep(5)} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800">Continue →</button>
            <button onClick={()=>setStep(3)} className="rounded-lg border px-5 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button>
          </div>
        </div>
      )}

      {/* Step 5 */}
      {step===5 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-5 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Setup Complete!</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Your company knowledge vault is ready. You can now create tenders and the engine will automatically match experts, projects, and evidence from your vault.
          </p>
          <div className="rounded-xl bg-slate-50 border p-4 text-sm text-slate-600 text-left space-y-2">
            <p className="font-medium text-slate-800">What happens next:</p>
            <p>1. Create a new tender and upload the tender documents</p>
            <p>2. Run the analysis engine to extract requirements</p>
            <p>3. Review matching and compliance results</p>
            <p>4. Generate and export your submission package</p>
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={completeSetup} disabled={saving} className="rounded-lg bg-black px-6 py-2.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
              {saving?"Setting up…":"Go to Dashboard →"}
            </button>
            <button onClick={()=>router.push("/dashboard/tenders/new")} className="rounded-lg border px-6 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
              Create First Tender
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
