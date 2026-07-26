"use client";
import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { classifyDeleteResponse, type DeleteResponse } from "../../../lib/company-vault-delete-classifier";
import { CheckIcon, CrossIcon, PersonIcon, FolderIcon, ChevronDownIcon } from "../../../components/icons";

type CompanyDoc = {
  id: string; originalFileName: string; mimeType: string; category: string;
  size: number; extractedTextLength?: number | null; aiExtractionStatus?: string | null; createdAt: string;
  hasPrivateStorage?: boolean | null; hasInlineFileContent?: boolean | null;
};
type Expert = {
  id: string; fullName: string; title: string | null; disciplines: string[];
  sectors: string[]; certifications: string[]; yearsExperience: number | null;
  profile: string | null; isActive: boolean; trustLevel?: string | null;
};
type Project = {
  id: string; name: string; clientName: string | null; sector: string | null;
  country: string | null; serviceAreas: string[]; contractValue: number | null;
  currency: string | null; summary: string | null; trustLevel?: string | null;
};
type Company = {
  id?: string; name: string; legalName: string; description: string; website: string;
  address: string; phone: string; email: string; knowledgeMode: string;
  serviceLines: string[]; sectors: string[]; profileSummary: string;
  // Round-10 institutional metadata fields
  gmName?: string | null; gmTitle?: string | null; gmLicense?: string | null;
  foundingYear?: number | null; headcount?: number | null;
  licenseGrade?: string | null; registrationNumber?: string | null;
  tin?: string | null; vat?: string | null;
  experts?: Expert[]; projects?: Project[];
};
type UploadItem = { file: File; status: "queued"|"uploading"|"done"|"error"; error?: string; category: string };

/**
 * Pipeline status surfaced after a company-document upload completes.
 *
 * The secure-upload handler enqueues a background VAULT_INGEST job when
 * `companyDoc=true` rather than running the ingestion inline (a full AI
 * extraction pass over every usable document could otherwise risk the
 * upload request's timeout). This badge tells the user their newly
 * uploaded document has been queued for re-ingestion, so they know not to
 * expect it in the Review Board instantly, without needing a live-polling
 * progress indicator — refreshing the Review Board after a short wait
 * shows the new drafts once the job completes.
 */
type VaultPipelineStatus = {
  phase: "queued" | "failed";
  message: string;
  /** ISO timestamp so the badge can fade after a few seconds if desired. */
  at: number;
};
type CompanyAsset = { id: string; assetType: string; originalFileName: string; isActive: boolean; hasPrivateStorage?: boolean | null; hasInlineFileContent?: boolean | null };

const REQUIRED_ASSET_TYPES = ["LOGO", "LETTERHEAD", "SIGNATURE", "STAMP"];

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
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt";
const empty: Company = { name:"",legalName:"",description:"",website:"",address:"",phone:"",email:"",knowledgeMode:"PROFILE_FIRST",serviceLines:[],sectors:[],profileSummary:"",gmName:"",gmTitle:"",gmLicense:"",foundingYear:null,headcount:null,licenseGrade:"",registrationNumber:"",tin:"",vat:"" };

const PLACEHOLDER_PATTERNS = /^\s*(tbd|tbc|n\/a|unknown|not provided|placeholder|pending|to be confirmed|to be determined)\s*$/i;
function isPlaceholder(v: unknown): boolean {
  if (!v && v !== 0) return true;
  return PLACEHOLDER_PATTERNS.test(String(v));
}
function hasReal(v: unknown): boolean { return !isPlaceholder(v); }

function fmt(b: number) { return b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(0)} KB`:`${(b/1048576).toFixed(1)} MB`; }
function ext(name: string) { return name.toLowerCase().split(".").pop()??""; }

type Tab = "documents"|"experts"|"projects"|"compliance";

type ComplianceRecord = {
  id: string; complianceType: string; title: string; status: string;
  evidenceSummary: string | null; referenceNumber: string | null; expiryDate: string | null; createdAt: string;
};
type LegalRecord = {
  id: string; recordType: string; title: string; authority: string | null;
  referenceNumber: string | null; status: string; issueDate: string | null; expiryDate: string | null; createdAt: string;
};
type FinancialRecord = {
  id: string; recordType: string; fiscalYear: number; currency: string | null;
  amount: number | null; notes: string | null; createdAt: string;
};

export default function CompanyPage() {
  const [tab, setTab] = useState<Tab>("documents");
  const [company, setCompany] = useState<Company>(empty);
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [docCategory, setDocCategory] = useState("AUTO_DETECT");
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  /** Vault pipeline status — shown as a live badge after a successful
   * company-document upload. Null when no upload has happened recently. */
  const [vaultPipeline, setVaultPipeline] = useState<VaultPipelineStatus | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [searchDoc, setSearchDoc] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [deletingDocId, setDeletingDocId] = useState<string|null>(null);
  const [confirmingDeleteDocId, setConfirmingDeleteDocId] = useState<string|null>(null);
  const [reextractingDocId, setReextractingDocId] = useState<string|null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deleteButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const confirmDeleteButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Expert state
  const [expertForm, setExpertForm] = useState({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
  const [expertSaving, setExpertSaving] = useState(false);
  const [editExpert, setEditExpert] = useState<Expert|null>(null);
  const [expertEditSaving, setExpertEditSaving] = useState(false);
  const [expertEditForm, setExpertEditForm] = useState({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
  const [deletingExpertId, setDeletingExpertId] = useState<string|null>(null);
  const [confirmingDeleteExpertId, setConfirmingDeleteExpertId] = useState<string|null>(null);

  // Project state
  const [projectForm, setProjectForm] = useState({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"",summary:"" });
  const projectFormRef = useRef<HTMLFormElement>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [editProject, setEditProject] = useState<Project|null>(null);
  const [projectEditSaving, setProjectEditSaving] = useState(false);
  const [projectEditForm, setProjectEditForm] = useState({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"",summary:"" });
  const [deletingProjectId, setDeletingProjectId] = useState<string|null>(null);
  const [confirmingDeleteProjectId, setConfirmingDeleteProjectId] = useState<string|null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [reimportResult, setReimportResult] = useState<{expertsCreated:number;projectsCreated:number;docsProcessed:number}|null>(null);
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [searchExpert, setSearchExpert] = useState("");
  const [searchProject, setSearchProject] = useState("");

  // Compliance / Legal / Financial record state
  const [complianceRecords, setComplianceRecords] = useState<ComplianceRecord[]>([]);
  const [legalRecords, setLegalRecords] = useState<LegalRecord[]>([]);
  const [financialRecords, setFinancialRecords] = useState<FinancialRecord[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceForm, setComplianceForm] = useState({ complianceType:"", title:"", status:"ACTIVE", evidenceSummary:"", referenceNumber:"", expiryDate:"" });
  const [legalForm, setLegalForm] = useState({ recordType:"", title:"", authority:"", referenceNumber:"", status:"ACTIVE", issueDate:"", expiryDate:"" });
  const [financialForm, setFinancialForm] = useState({ recordType:"", fiscalYear: String(new Date().getFullYear()), currency:"", amount:"", notes:"" });
  const [complianceSaving, setComplianceSaving] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [financialSaving, setFinancialSaving] = useState(false);
  const [deletingComplianceId, setDeletingComplianceId] = useState<string|null>(null);
  const [deletingLegalId, setDeletingLegalId] = useState<string|null>(null);
  const [deletingFinancialId, setDeletingFinancialId] = useState<string|null>(null);
  const [confirmingDeleteComplianceId, setConfirmingDeleteComplianceId] = useState<string|null>(null);
  const [confirmingDeleteLegalId, setConfirmingDeleteLegalId] = useState<string|null>(null);
  const [confirmingDeleteFinancialId, setConfirmingDeleteFinancialId] = useState<string|null>(null);
  const [complianceSubTab, setComplianceSubTab] = useState<"compliance"|"legal"|"financial">("compliance");
  const [showAllExperts, setShowAllExperts] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllCompliance, setShowAllCompliance] = useState(false);
  const [showAllLegal, setShowAllLegal] = useState(false);
  const [showAllFinancial, setShowAllFinancial] = useState(false);
  const ROWS_PREVIEW = 5;

  async function loadComplianceData() {
    setComplianceLoading(true);
    try {
      const [cr, lr, fr] = await Promise.all([
        fetch("/api/company/compliance-records?limit=50").then(r=>r.json()),
        fetch("/api/company/legal-records?limit=50").then(r=>r.json()),
        fetch("/api/company/financial-records?limit=50").then(r=>r.json()),
      ]);
      setComplianceRecords(cr.records ?? []);
      setLegalRecords(lr.records ?? []);
      setFinancialRecords(fr.records ?? []);
    } finally {
      setComplianceLoading(false);
    }
  }

  async function addComplianceRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!complianceForm.complianceType || !complianceForm.title) return;
    setComplianceSaving(true);
    try {
      const res = await fetch("/api/company/compliance-records", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(complianceForm) });
      if (!res.ok) { setError("We could not add that compliance record. Please check the required fields and try again."); return; }
      setComplianceForm({ complianceType:"", title:"", status:"ACTIVE", evidenceSummary:"", referenceNumber:"", expiryDate:"" }); await loadComplianceData();
    } catch {
      setError("Network interruption while adding the compliance record. Please retry when your connection is stable.");
    } finally { setComplianceSaving(false); }
  }

  async function addLegalRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!legalForm.recordType || !legalForm.title) return;
    setLegalSaving(true);
    try {
      const res = await fetch("/api/company/legal-records", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(legalForm) });
      if (!res.ok) { setError("We could not add that legal record. Please check the required fields and try again."); return; }
      setLegalForm({ recordType:"", title:"", authority:"", referenceNumber:"", status:"ACTIVE", issueDate:"", expiryDate:"" }); await loadComplianceData();
    } catch {
      setError("Network interruption while adding the legal record. Please retry when your connection is stable.");
    } finally { setLegalSaving(false); }
  }

  async function addFinancialRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!financialForm.recordType || !financialForm.fiscalYear) return;
    setFinancialSaving(true);
    try {
      const res = await fetch("/api/company/financial-records", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ...financialForm, fiscalYear: Number(financialForm.fiscalYear), amount: financialForm.amount ? Number(financialForm.amount) : null }) });
      if (!res.ok) { setError("We could not add that financial record. Please check the required fields and try again."); return; }
      setFinancialForm({ recordType:"", fiscalYear: String(new Date().getFullYear()), currency:"", amount:"", notes:"" }); await loadComplianceData();
    } catch {
      setError("Network interruption while adding the financial record. Please retry when your connection is stable.");
    } finally { setFinancialSaving(false); }
  }

  async function deleteComplianceRecord(id: string) {
    if (deletingComplianceId) return;
    setDeletingComplianceId(id);
    setError("");
    try {
      const res = await fetch(`/api/company/compliance-records?id=${id}`, { method:"DELETE" });
      if (!res.ok) {
        setError("We could not delete that compliance record. Please retry, or refresh to check whether it was already removed.");
        return;
      }
      setConfirmingDeleteComplianceId(null);
      await loadComplianceData();
    } catch {
      setError("Network interruption while deleting the compliance record. Please retry when your connection is stable.");
    } finally { setDeletingComplianceId(null); }
  }

  async function deleteLegalRecord(id: string) {
    if (deletingLegalId) return;
    setDeletingLegalId(id);
    setError("");
    try {
      const res = await fetch(`/api/company/legal-records?id=${id}`, { method:"DELETE" });
      if (!res.ok) {
        setError("We could not delete that legal record. Please retry, or refresh to check whether it was already removed.");
        return;
      }
      setConfirmingDeleteLegalId(null);
      await loadComplianceData();
    } catch {
      setError("Network interruption while deleting the legal record. Please retry when your connection is stable.");
    } finally { setDeletingLegalId(null); }
  }

  async function deleteFinancialRecord(id: string) {
    if (deletingFinancialId) return;
    setDeletingFinancialId(id);
    setError("");
    try {
      const res = await fetch(`/api/company/financial-records?id=${id}`, { method:"DELETE" });
      if (!res.ok) {
        setError("We could not delete that financial record. Please retry, or refresh to check whether it was already removed.");
        return;
      }
      setConfirmingDeleteFinancialId(null);
      await loadComplianceData();
    } catch {
      setError("Network interruption while deleting the financial record. Please retry when your connection is stable.");
    } finally { setDeletingFinancialId(null); }
  }

  async function loadDocs(): Promise<boolean> {
    try {
      const r = await fetch("/api/company/documents?limit=50");
      if (!r.ok) return false;
      const d = await r.json() as { items?: CompanyDoc[] };
      if (!d || !Array.isArray(d.items)) return false;
      setDocs(d.items);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/company").then(r=>r.json()),
      fetch("/api/company/documents?limit=50").then(r=>r.json()),
      fetch("/api/company/assets?limit=50").then(r=>r.json()),
    ]).then(([c, d, a]: [{ company?: Company } & Company, { items?: CompanyDoc[] }, { assets?: CompanyAsset[] }]) => {
      const co = c.company ?? c;
      if (co.name !== undefined) {
        setCompany({ ...empty, ...(co as Company) });
      }
      setDocs(d.items ?? []);
      setAssets(a.assets ?? []);
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
        const data = await res.json() as {
          success?: boolean;
          results?: Array<{ error?: string }>;
          /** Vault re-ingest status — present when companyDoc=true. The
           * secure-upload handler enqueues a background VAULT_INGEST job
           * rather than running ingestion inline, so this reports "QUEUED"
           * or "FAILED" (enqueue failure), not the finished result. */
          companyImport?: { status?: string; jobId?: string; error?: string } | null;
        };
        const firstErr = data.results?.[0] && "error" in data.results[0] ? data.results[0].error : undefined;
        if (!res.ok || firstErr) {
          setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"error", error:firstErr??"Upload failed" } : x));
        } else {
          setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"done" } : x));
          await loadDocs();
          // Surface the auto-pipeline status. Ingestion now runs in the
          // background, so this badge tells the user their newly uploaded
          // document has been queued for re-ingestion — check back in the
          // Review Board shortly, rather than the old "already done" message.
          if (data.companyImport && data.companyImport.status === "QUEUED") {
            setVaultPipeline({
              phase: "queued",
              message: "Document stored. Vault re-ingestion queued — new drafts will appear in the Review Board shortly.",
              at: Date.now(),
            });
          } else if (data.companyImport && data.companyImport.status === "FAILED") {
            setVaultPipeline({
              phase: "failed",
              message: "Document stored, but vault re-ingest could not be queued. Open the Review Board to repair manually.",
              at: Date.now(),
            });
          }
        }
      } catch {
        setUploadQueue(q => q.map(x => x.file===item.file ? { ...x, status:"error", error:"Network interruption — please retry" } : x));
      }
    }
  }, [docCategory]);

  function openDeleteConfirmation(docId: string) {
    setConfirmingDeleteDocId(docId);
    setError("");
  }

  function cancelDeleteConfirmation(docId: string) {
    setConfirmingDeleteDocId(null);
    requestAnimationFrame(() => deleteButtonRefs.current[docId]?.focus());
  }

  function onDeleteConfirmationKeyDown(event: React.KeyboardEvent<HTMLDivElement>, docId: string) {
    if (event.key !== "Escape" || deletingDocId === docId) return;
    event.preventDefault();
    cancelDeleteConfirmation(docId);
  }

  async function deleteDoc(doc: CompanyDoc) {
    if (deletingDocId) return;

    setDeletingDocId(doc.id);
    setError("");
    try {
      const res = await fetch(`/api/company/documents/${doc.id}`, { method: "DELETE" });

      let deleteResponse: DeleteResponse;
      if (res.ok) {
        deleteResponse = { ok: true, status: res.status };
      } else {
        // Parse the structured error response without exposing technical details.
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        deleteResponse = {
          ok: false,
          status: res.status,
          code: typeof data?.code === "string" ? data.code : undefined,
          retryable: data?.retryable === true,
        };
      }

      // Always attempt to reload the authoritative list — classifyDeleteResponse
      // interprets whether that attempt succeeded (or was even relevant) per
      // response type. This is the single source of UI-action truth; no
      // per-status branching lives in the component.
      const refreshSucceeded = await loadDocs();
      const classified = classifyDeleteResponse(deleteResponse, refreshSucceeded);

      if (classified.shouldRemoveRow) {
        setDocs(d => d.filter(x => x.id !== doc.id));
      }
      if (classified.shouldDisableRow) {
        setDocs(d => d.map(x => x.id === doc.id ? { ...x, aiExtractionStatus: "PENDING_DELETE" } : x));
      }
      if (classified.message) {
        setError(classified.message);
      }
      if (classified.shouldCloseConfirmation) {
        setConfirmingDeleteDocId(null);
      }
    } catch {
      setError("Network interruption while deleting the Company Vault document. Please retry when your connection is stable.");
    } finally {
      setDeletingDocId(null);
    }
  }

  async function reextractDoc(doc: CompanyDoc) {
    if (reextractingDocId) return;
    setReextractingDocId(doc.id);
    setError("");
    try {
      const res = await fetch(`/api/company/documents/${doc.id}`, { method:"POST" });
      if (!res.ok) {
        setError("We could not re-extract text from that Company Vault document. Please retry, or upload a clearer source file if the problem continues.");
        return;
      }
      await loadDocs();
    } catch {
      setError("Network interruption while re-extracting the Company Vault document. Please retry when your connection is stable.");
    } finally {
      setReextractingDocId(null);
    }
  }

  async function reimportAll() {
    setReimporting(true); setReimportResult(null);
    try {
      const res = await fetch("/api/company/reimport", { method:"POST" });
      if (!res.ok) { setError("We could not re-import Company Vault documents. Please retry, or re-extract the specific failed document first."); return; }
      const data = await res.json() as { expertsCreated?:number; projectsCreated?:number; docsProcessed?:number };
      setReimportResult({ expertsCreated: data.expertsCreated ?? 0, projectsCreated: data.projectsCreated ?? 0, docsProcessed: data.docsProcessed ?? 0 });
      await loadDocs();
      // Refresh experts/projects in company state
      const c = await fetch("/api/company").then(r=>r.json()) as Company;
      setCompany(prev => ({ ...prev, experts: c.experts ?? [], projects: c.projects ?? [] }));
    } catch {
      setError("Network interruption while re-importing Company Vault documents. Please retry when your connection is stable.");
    } finally {
      setReimporting(false);
    }
  }

  async function addExpert(e: React.FormEvent) {
    e.preventDefault();
    if (expertSaving) return;
    setExpertSaving(true);
    setError("");
    try {
      const res = await fetch("/api/company/experts", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(expertForm),
      });
      if (!res.ok) { setError("We could not add that expert record. Please check the required fields and try again."); return; }
      const expert = await res.json() as Expert;
      setCompany(c => ({ ...c, experts:[expert, ...(c.experts||[])] }));
      setExpertForm({ fullName:"",title:"",disciplines:"",sectors:"",certifications:"",yearsExperience:"",profile:"" });
    } catch {
      setError("Network interruption while adding the expert record. Please retry when your connection is stable.");
    } finally {
      setExpertSaving(false);
    }
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
    if (!editExpert || expertEditSaving) return;
    setExpertEditSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/company/experts/${editExpert.id}`, {
        method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(expertEditForm),
      });
      if (!res.ok) { setError("We could not save that expert record. Please check the required fields and try again."); return; }
      const updated = await res.json() as Expert;
      setCompany(c => ({ ...c, experts:(c.experts||[]).map(x => x.id===editExpert.id ? updated : x) }));
      setEditExpert(null);
    } catch {
      setError("Network interruption while saving the expert record. Please retry when your connection is stable.");
    } finally {
      setExpertEditSaving(false);
    }
  }

  async function deleteExpert(id: string) {
    if (deletingExpertId) return;
    setDeletingExpertId(id);
    setError("");
    try {
      const res = await fetch(`/api/company/experts/${id}`, { method:"DELETE" });
      if (!res.ok) {
        setError("We could not delete that expert record. Please retry, or refresh to check whether it was already removed.");
        return;
      }
      setCompany(c => ({ ...c, experts:(c.experts||[]).filter(x => x.id!==id) }));
      setConfirmingDeleteExpertId(null);
    } catch {
      setError("Network interruption while deleting the expert record. Please retry when your connection is stable.");
    } finally {
      setDeletingExpertId(null);
    }
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    if (projectSaving) return;
    setProjectSaving(true);
    setError("");
    try {
      const res = await fetch("/api/company/projects", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(projectForm),
      });
      if (!res.ok) { setError("We could not add that project record. Please check the required fields and try again."); return; }
      const project = await res.json() as Project;
      setCompany(c => ({ ...c, projects:[project, ...(c.projects||[])] }));
      setProjectForm({ name:"",clientName:"",sector:"",country:"",serviceAreas:"",contractValue:"",currency:"",summary:"" });
    } catch {
      setError("Network interruption while adding the project record. Please retry when your connection is stable.");
    } finally {
      setProjectSaving(false);
    }
  }

  function startEditProject(p: Project) {
    setEditProject(p);
    setProjectEditForm({
      name:p.name, clientName:p.clientName??"", sector:p.sector??"", country:p.country??"",
      serviceAreas:(p.serviceAreas||[]).join(", "), contractValue:p.contractValue?.toString()??"",
      currency:p.currency??"", summary:p.summary??"",
    });
  }

  async function saveEditProject() {
    if (!editProject || projectEditSaving) return;
    setProjectEditSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/company/projects/${editProject.id}`, {
        method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(projectEditForm),
      });
      if (!res.ok) { setError("We could not save that project record. Please check the required fields and try again."); return; }
      const updated = await res.json() as Project;
      setCompany(c => ({ ...c, projects:(c.projects||[]).map(x => x.id===editProject.id ? updated : x) }));
      setEditProject(null);
    } catch {
      setError("Network interruption while saving the project record. Please retry when your connection is stable.");
    } finally {
      setProjectEditSaving(false);
    }
  }

  async function deleteProject(id: string) {
    if (deletingProjectId) return;
    setDeletingProjectId(id);
    setError("");
    try {
      const res = await fetch(`/api/company/projects/${id}`, { method:"DELETE" });
      if (!res.ok) {
        setError("We could not delete that project record. Please retry, or refresh to check whether it was already removed.");
        return;
      }
      setCompany(c => ({ ...c, projects:(c.projects||[]).filter(x => x.id!==id) }));
      setConfirmingDeleteProjectId(null);
    } catch {
      setError("Network interruption while deleting the project record. Please retry when your connection is stable.");
    } finally {
      setDeletingProjectId(null);
    }
  }

  useEffect(() => {
    if (!confirmingDeleteDocId) return;
    requestAnimationFrame(() => confirmDeleteButtonRefs.current[confirmingDeleteDocId]?.focus());
  }, [confirmingDeleteDocId]);

  const filteredDocs = docs.filter(d => {
    const ms = !searchDoc || d.originalFileName.toLowerCase().includes(searchDoc.toLowerCase());
    const mc = filterCat==="ALL" || d.category===filterCat;
    return ms && mc;
  });

  const filteredExperts = (company.experts ?? []).filter(ex =>
    !searchExpert ||
    ex.fullName.toLowerCase().includes(searchExpert.toLowerCase()) ||
    (ex.title ?? "").toLowerCase().includes(searchExpert.toLowerCase()) ||
    (ex.disciplines ?? []).some(d => d.toLowerCase().includes(searchExpert.toLowerCase()))
  );

  const filteredProjects = (company.projects ?? []).filter(p =>
    !searchProject ||
    p.name.toLowerCase().includes(searchProject.toLowerCase()) ||
    (p.clientName ?? "").toLowerCase().includes(searchProject.toLowerCase()) ||
    (p.sector ?? "").toLowerCase().includes(searchProject.toLowerCase())
  );

  if (loading) return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      {/* Spinner + darker text for WCAG AA contrast (was text-slate-400 on
          white — too low contrast per live VLM audit). The spinner gives
          visible feedback that the page is actively loading, not stuck. */}
      <svg className="h-8 w-8 animate-spin text-slate-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm font-medium text-slate-700">Loading Company Vault…</p>
    </div>
  );

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id:"documents", label:"Documents", count:docs.length },
    { id:"experts", label:"Experts", count:(company.experts||[]).length },
    { id:"projects", label:"Projects", count:(company.projects||[]).length },
    { id:"compliance", label:"Compliance & Legal", count: complianceRecords.length + legalRecords.length + financialRecords.length || undefined },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Knowledge Vault</h1>
        <p className="mt-1 text-slate-500 text-sm">Reusable company knowledge for all tender proposals.</p>
      </div>

      {(() => {
        const activeAssetTypes = new Set(assets.filter(a => a.isActive).map(a => a.assetType));
        const allExperts = company.experts ?? [];
        const allProjects = company.projects ?? [];
        const reviewedExpertCount = allExperts.filter(e => e.trustLevel === "REVIEWED").length;
        const reviewedProjectCount = allProjects.filter(p => p.trustLevel === "REVIEWED").length;
        const draftExpertCount = allExperts.length - reviewedExpertCount;
        const draftProjectCount = allProjects.length - reviewedProjectCount;
        const checks = [
          { label: "Company name", done: hasReal(company.name) },
          { label: "Legal name", done: hasReal(company.legalName) },
          { label: "Description", done: hasReal(company.description) },
          { label: "Address", done: hasReal(company.address) },
          { label: "Email", done: hasReal(company.email) },
          { label: "Phone", done: hasReal(company.phone) },
          { label: "Website", done: hasReal(company.website) },
          { label: "Registration number", done: hasReal(company.registrationNumber) },
          { label: "TIN", done: hasReal(company.tin) },
          { label: "VAT", done: hasReal(company.vat) },
          { label: "GM name", done: hasReal(company.gmName) },
          { label: "GM title", done: hasReal(company.gmTitle) },
          { label: "Founding year", done: hasReal(company.foundingYear) },
          { label: "Headcount", done: hasReal(company.headcount) },
          { label: "License grade", done: hasReal(company.licenseGrade) },
          { label: "Service lines", done: (company.serviceLines||[]).length > 0 },
          { label: "Sectors", done: (company.sectors||[]).length > 0 },
          { label: "Profile summary", done: hasReal(company.profileSummary) },
          { label: "At least 1 expert", done: allExperts.length > 0 },
          { label: "At least 1 project", done: allProjects.length > 0 },
          { label: "At least 1 document", done: docs.length > 0 },
          ...REQUIRED_ASSET_TYPES.map(t => ({ label: `${t.charAt(0) + t.slice(1).toLowerCase()} asset`, done: activeAssetTypes.has(t) })),
        ];
        const done = checks.filter(c => c.done).length;
        const pct = Math.round((done / checks.length) * 100);
        const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
        const textColor = pct >= 80 ? "text-green-600" : pct >= 50 ? "text-amber-600" : "text-red-600";
        const missing = checks.filter(c => !c.done).map(c => c.label);
        return (
          <div className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">Profile completeness</p>
              <span className={`text-sm font-bold ${textColor}`}>{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            {missing.length > 0 && (
              <p className="mt-2 text-xs text-slate-400">Missing: {missing.join(", ")}</p>
            )}
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-slate-600 mb-1.5">Knowledge vault</p>
              <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                <span>Experts: <span className="font-medium text-slate-700">{reviewedExpertCount} reviewed</span>{draftExpertCount > 0 ? `, ${draftExpertCount} draft` : ""}</span>
                <span>Projects: <span className="font-medium text-slate-700">{reviewedProjectCount} reviewed</span>{draftProjectCount > 0 ? `, ${draftProjectCount} draft` : ""}</span>
              </div>
            </div>
          </div>
        );
      })()}

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
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "compliance") void loadComplianceData(); }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab===t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}{t.count !== undefined ? <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {error && <div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Documents Tab */}
      {tab==="documents" && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Document Library</h2>
              <p className="text-xs text-slate-400 mt-0.5">{docs.length} file{docs.length!==1?"s":""} · Review each file before using it as tender evidence</p>
            </div>
            <button onClick={()=>void reimportAll()} disabled={reimporting||docs.length===0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60 font-medium">
              {reimporting ? "Re-importing…" : "Re-extract & Re-import All"}
            </button>
          </div>
          {reimportResult && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-xs text-green-800">
              Re-import complete — {reimportResult.docsProcessed} docs processed · {reimportResult.expertsCreated} expert{reimportResult.expertsCreated!==1?"s":""} added · {reimportResult.projectsCreated} project{reimportResult.projectsCreated!==1?"s":""} added
            </div>
          )}
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
            <p className="mt-1 text-xs text-slate-400">PDF · DOCX · XLSX · CSV · TXT · Up to 10 MB</p>
          </div>
          {uploadQueue.length>0 && (
            <div role="status" aria-live="polite" aria-label="Upload progress" className="space-y-1.5">
              {uploadQueue.slice(0,6).map((item,i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 ${item.status==="done"?"border-green-200 bg-green-50":item.status==="error"?"border-red-200 bg-red-50":item.status==="uploading"?"border-blue-200 bg-blue-50":"border-slate-200"}`}>
                  <span className="truncate font-medium">{item.file.name}</span>
                  <span className={item.status==="done"?"text-green-600":item.status==="error"?"text-red-600":item.status==="uploading"?"text-blue-600":"text-slate-400"}>
                    {item.status==="uploading"?"Uploading…":item.status==="done"?<><CheckIcon /> Done</>:item.status==="error"?<><CrossIcon /> {item.error??"Failed"}</>:"Queued"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {vaultPipeline && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                vaultPipeline.phase === "queued"
                  ? "border-blue-200 bg-blue-50 text-blue-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                  vaultPipeline.phase === "queued"
                    ? "animate-pulse bg-blue-600"
                    : "bg-amber-600"
                }`}
              />
              <span className="leading-5">{vaultPipeline.message}</span>
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
                      <span className="text-[10px] text-slate-400">{fmt(doc.size)}{doc.hasInlineFileContent && !doc.hasPrivateStorage ? " · Restored inline file available" : ""}</span>
                      {(doc.extractedTextLength ?? 0) > 0 ? <span className="text-[10px] text-green-600"><CheckIcon /> {(doc.extractedTextLength ?? 0).toLocaleString()} chars</span> : doc.aiExtractionStatus === "FAILED" ? <span className="text-[10px] text-red-500">text extraction failed</span> : <span className="text-[10px] text-slate-400">no text</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    {doc.aiExtractionStatus === "PENDING_DELETE" ? (
                      <span className="text-[10px] font-medium text-amber-600 px-2 py-1" aria-label={`Deletion pending for ${doc.originalFileName}`}>Deletion pending</span>
                    ) : (
                      <>
                        <button type="button" onClick={()=>void reextractDoc(doc)} disabled={reextractingDocId!==null || deletingDocId!==null} aria-busy={reextractingDocId===doc.id} aria-label={`Re-extract text from ${doc.originalFileName}`} className="min-h-8 rounded border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 border-slate-200" title="Re-extract text">{reextractingDocId===doc.id ? "Re-extracting…" : "Re-extract"}</button>
                        <a href={`/api/company/documents/${doc.id}`} download={doc.originalFileName} aria-label={`Download ${doc.originalFileName}`} className="inline-flex min-h-8 items-center justify-center rounded border px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 border-blue-200">Download</a>
                        <button ref={(node)=>{ if (node) deleteButtonRefs.current[doc.id]=node; else delete deleteButtonRefs.current[doc.id]; }} type="button" onClick={()=>openDeleteConfirmation(doc.id)} disabled={deletingDocId!==null || reextractingDocId!==null} aria-expanded={confirmingDeleteDocId===doc.id} {...(confirmingDeleteDocId===doc.id ? { "aria-controls": `delete-confirm-${doc.id}`, "aria-describedby": `delete-confirm-help-${doc.id}` } : {})} aria-label={`Delete ${doc.originalFileName} from Company Vault`} className="min-h-8 rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 border-red-200">{deletingDocId===doc.id ? "Deleting…" : "Delete"}</button>
                      </>
                    )}
                  </div>
                </div>
                {confirmingDeleteDocId===doc.id && (
                  <div id={`delete-confirm-${doc.id}`} role="region" aria-labelledby={`delete-confirm-title-${doc.id}`} aria-describedby={`delete-confirm-help-${doc.id}`} onKeyDown={(event)=>onDeleteConfirmationKeyDown(event, doc.id)} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                    <p id={`delete-confirm-title-${doc.id}`} className="font-medium">Delete this Company Vault document?</p>
                    <p id={`delete-confirm-help-${doc.id}`} className="mt-1 text-red-800">This removes the document from future evidence selection. Unreviewed AI-drafted and regex-drafted expert and project records created from this document will also be removed. Reviewed records remain for audit but will block deletion if they still depend on this source. This action cannot be undone. Press Escape to cancel.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button ref={(node)=>{ if (node) confirmDeleteButtonRefs.current[doc.id]=node; else delete confirmDeleteButtonRefs.current[doc.id]; }} type="button" onClick={()=>void deleteDoc(doc)} disabled={deletingDocId===doc.id} className="min-h-8 rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60">{deletingDocId===doc.id ? "Deleting…" : "Yes, delete document"}</button>
                      <button type="button" onClick={()=>cancelDeleteConfirmation(doc.id)} disabled={deletingDocId===doc.id} className="min-h-8 rounded-md border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                    </div>
                  </div>
                )}
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
              <button disabled={expertSaving||!expertForm.fullName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
                {expertSaving?"Adding…":"Add Expert"}
              </button>
            </form>
          </div>

          {(company.experts ?? []).length > 0 && (
            <div className="mb-2">
              <input
                value={searchExpert}
                onChange={e => setSearchExpert(e.target.value)}
                placeholder="Search experts by name, title, or discipline…"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          )}
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {(company.experts||[]).length===0 ? (
              <div className="flex flex-col items-center py-12 px-6 text-center">
                <PersonIcon className="text-4xl mb-3" />
                <h3 className="text-sm font-semibold text-slate-700 mb-1">No experts in your knowledge vault</h3>
                <p className="text-xs text-slate-400 max-w-xs mb-4">Import CVs to add experts. They&apos;ll be automatically matched to tenders.</p>
                <button
                  onClick={() => setTab("documents")}
                  className="rounded-lg bg-black px-4 py-2 text-xs text-white hover:bg-slate-800"
                >
                  Upload expert CVs
                </button>
              </div>
            ) : filteredExperts.length === 0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">No experts match your search.</p>
            ) : (
              <>
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
                  {(showAllExperts ? filteredExperts : filteredExperts.slice(0, ROWS_PREVIEW)).map(ex => (
                    <Fragment key={ex.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{ex.fullName}</td>
                        <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{ex.title??"-"}</td>
                        <td className="px-5 py-3 text-slate-500 hidden lg:table-cell text-xs">{(ex.disciplines||[]).slice(0,3).join(", ")||"-"}</td>
                        <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{ex.yearsExperience ? `${ex.yearsExperience}y` : "-"}</td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={()=>startEditExpert(ex)} className="rounded border px-2.5 py-1 text-xs hover:bg-slate-100 mr-1">Edit</button>
                          <button type="button" onClick={()=>setConfirmingDeleteExpertId(ex.id)} disabled={deletingExpertId!==null} aria-expanded={confirmingDeleteExpertId===ex.id} {...(confirmingDeleteExpertId===ex.id ? { "aria-controls": `expert-delete-confirm-${ex.id}` } : {})} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60">
                            {deletingExpertId===ex.id?"Deleting…":"Delete"}
                          </button>
                        </td>
                      </tr>
                      {confirmingDeleteExpertId===ex.id && (
                        <tr id={`expert-delete-confirm-${ex.id}`} className="bg-red-50 text-xs text-red-900">
                          <td colSpan={5} className="px-5 py-3">
                            <p className="font-medium">Delete expert record for {ex.fullName}?</p>
                            <p className="mt-1 text-red-800">This removes the expert from future evidence selection. Tender documents that already referenced this expert are not changed automatically.</p>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={()=>void deleteExpert(ex.id)} disabled={deletingExpertId===ex.id} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deletingExpertId===ex.id?"Deleting…":"Yes, delete expert"}</button>
                              <button type="button" onClick={()=>setConfirmingDeleteExpertId(null)} disabled={deletingExpertId===ex.id} className="rounded border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {filteredExperts.length > ROWS_PREVIEW && (
                <div className="border-t px-5 py-2.5 text-center">
                  <button onClick={() => setShowAllExperts(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
                    {showAllExperts ? `Show fewer` : <>Show all {filteredExperts.length} experts <ChevronDownIcon /></>}
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Projects Tab */}
      {tab==="projects" && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
            <h2 className="font-semibold text-slate-900 mb-4">Add Project</h2>
            <form ref={projectFormRef} onSubmit={addProject} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={projectForm.name} onChange={e=>setProjectForm({...projectForm,name:e.target.value})} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.clientName} onChange={e=>setProjectForm({...projectForm,clientName:e.target.value})} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.sector} onChange={e=>setProjectForm({...projectForm,sector:e.target.value})} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.country} onChange={e=>setProjectForm({...projectForm,country:e.target.value})} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectForm.contractValue} onChange={e=>setProjectForm({...projectForm,contractValue:e.target.value})} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
                <select value={projectForm.currency} onChange={e=>setProjectForm({...projectForm,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                  <option value="">Currency unresolved</option>
                  {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <input value={projectForm.serviceAreas} onChange={e=>setProjectForm({...projectForm,serviceAreas:e.target.value})} placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea value={projectForm.summary} onChange={e=>setProjectForm({...projectForm,summary:e.target.value})} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <button disabled={projectSaving||!projectForm.name} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
                {projectSaving?"Adding…":"Add Project"}
              </button>
            </form>
          </div>

          {(company.projects ?? []).length > 0 && (
            <div className="mb-2">
              <input
                value={searchProject}
                onChange={e => setSearchProject(e.target.value)}
                placeholder="Search projects by name, client, or sector…"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          )}
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {(company.projects||[]).length===0 ? (
              <div className="flex flex-col items-center py-12 px-6 text-center">
                <FolderIcon className="text-4xl mb-3" />
                <h3 className="text-sm font-semibold text-slate-700 mb-1">No projects in your portfolio</h3>
                <p className="text-xs text-slate-400 max-w-xs mb-4">Add completed projects as references. They&apos;ll be matched to tender requirements.</p>
                <button
                  onClick={() => projectFormRef.current?.scrollIntoView({ block: "start" })}
                  className="rounded-lg bg-black px-4 py-2 text-xs text-white hover:bg-slate-800"
                >
                  Add your first project
                </button>
              </div>
            ) : filteredProjects.length === 0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">No projects match your search.</p>
            ) : (
              <>
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
                  {(showAllProjects ? filteredProjects : filteredProjects.slice(0, ROWS_PREVIEW)).map(p => (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                        <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{p.clientName??"-"}</td>
                        <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{p.sector??"-"}</td>
                        <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{p.country??"-"}</td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={()=>startEditProject(p)} className="rounded border px-2.5 py-1 text-xs hover:bg-slate-100 mr-1">Edit</button>
                          <button type="button" onClick={()=>setConfirmingDeleteProjectId(p.id)} disabled={deletingProjectId!==null} aria-expanded={confirmingDeleteProjectId===p.id} {...(confirmingDeleteProjectId===p.id ? { "aria-controls": `project-delete-confirm-${p.id}` } : {})} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60">
                            {deletingProjectId===p.id?"Deleting…":"Delete"}
                          </button>
                        </td>
                      </tr>
                      {confirmingDeleteProjectId===p.id && (
                        <tr id={`project-delete-confirm-${p.id}`} className="bg-red-50 text-xs text-red-900">
                          <td colSpan={5} className="px-5 py-3">
                            <p className="font-medium">Delete project record {p.name}?</p>
                            <p className="mt-1 text-red-800">This removes the project from future evidence matching. Tender documents that already referenced this project are not changed automatically.</p>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={()=>void deleteProject(p.id)} disabled={deletingProjectId===p.id} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deletingProjectId===p.id?"Deleting…":"Yes, delete project"}</button>
                              <button type="button" onClick={()=>setConfirmingDeleteProjectId(null)} disabled={deletingProjectId===p.id} className="rounded border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {filteredProjects.length > ROWS_PREVIEW && (
                <div className="border-t px-5 py-2.5 text-center">
                  <button onClick={() => setShowAllProjects(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
                    {showAllProjects ? `Show fewer` : <>Show all {filteredProjects.length} projects <ChevronDownIcon /></>}
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Compliance & Legal Tab */}
      {tab==="compliance" && (
        <div className="space-y-6">
          {/* Sub-tabs */}
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-sm">
            {([["compliance","Compliance Records"],["legal","Legal & Registrations"],["financial","Financials"]] as const).map(([id,label]) => (
              <button key={id} onClick={() => setComplianceSubTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${complianceSubTab===id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>

          {complianceLoading && <p role="status" aria-live="polite" className="text-sm text-slate-400">Loading compliance records…</p>}

          {/* Compliance Records */}
          {complianceSubTab==="compliance" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
                <h2 className="font-semibold text-slate-900 mb-1">Add Compliance Record</h2>
                <p className="text-xs text-slate-500 mb-4">Tax clearance, professional registration, ISO certifications, and similar compliance credentials.</p>
                <form onSubmit={addComplianceRecord} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={complianceForm.complianceType} onChange={e=>setComplianceForm({...complianceForm,complianceType:e.target.value})} placeholder="Type (e.g. TAX_CLEARANCE, ISO_9001) *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={complianceForm.title} onChange={e=>setComplianceForm({...complianceForm,title:e.target.value})} placeholder="Title / label *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={complianceForm.referenceNumber} onChange={e=>setComplianceForm({...complianceForm,referenceNumber:e.target.value})} placeholder="Reference number" className="rounded-lg border px-3 py-2 text-sm" />
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-slate-500 shrink-0">Expiry</label>
                      <input type="date" value={complianceForm.expiryDate} onChange={e=>setComplianceForm({...complianceForm,expiryDate:e.target.value})} className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <select value={complianceForm.status} onChange={e=>setComplianceForm({...complianceForm,status:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {["ACTIVE","EXPIRED","PENDING","REVOKED"].map(s=><option key={s}>{s}</option>)}
                  </select>
                  <textarea value={complianceForm.evidenceSummary} onChange={e=>setComplianceForm({...complianceForm,evidenceSummary:e.target.value})} rows={2} placeholder="Evidence summary (optional)" className="w-full rounded-lg border px-3 py-2 text-sm" />
                  <button disabled={complianceSaving||!complianceForm.complianceType||!complianceForm.title} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
                    {complianceSaving?"Adding…":"Add Record"}
                  </button>
                </form>
              </div>
              {complianceRecords.length > 0 && (
                <div className="rounded-2xl border bg-white shadow-sm overflow-hidden max-w-3xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-left">Title</th><th className="px-4 py-2 text-left hidden md:table-cell">Ref.</th><th className="px-4 py-2 text-left hidden md:table-cell">Expiry</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2"></th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {(showAllCompliance ? complianceRecords : complianceRecords.slice(0, ROWS_PREVIEW)).map(r => (
                        <Fragment key={r.id}>
                          <tr className="hover:bg-slate-50">
                            <td className="px-4 py-2 text-xs text-slate-500">{r.complianceType}</td>
                            <td className="px-4 py-2 font-medium text-slate-900">{r.title}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{r.referenceNumber??"-"}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("en-GB") : "-"}</td>
                            <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.status==="ACTIVE"?"bg-green-100 text-green-700":r.status==="EXPIRED"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                            <td className="px-4 py-2 text-right"><button type="button" onClick={()=>setConfirmingDeleteComplianceId(r.id)} disabled={deletingComplianceId!==null} aria-expanded={confirmingDeleteComplianceId===r.id} {...(confirmingDeleteComplianceId===r.id ? { "aria-controls": `compliance-delete-confirm-${r.id}` } : {})} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60">{deletingComplianceId===r.id?"Deleting…":"Delete"}</button></td>
                          </tr>
                          {confirmingDeleteComplianceId===r.id && (
                            <tr id={`compliance-delete-confirm-${r.id}`} className="bg-red-50 text-xs text-red-900"><td colSpan={6} className="px-4 py-3"><p className="font-medium">Delete compliance record {r.title}?</p><p className="mt-1 text-red-800">This removes the credential from future evidence selection. Tender documents already generated are not changed automatically.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={()=>void deleteComplianceRecord(r.id)} disabled={deletingComplianceId===r.id} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deletingComplianceId===r.id?"Deleting…":"Yes, delete compliance record"}</button><button type="button" onClick={()=>setConfirmingDeleteComplianceId(null)} disabled={deletingComplianceId===r.id} className="rounded border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">Cancel</button></div></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  {complianceRecords.length > ROWS_PREVIEW && (
                    <div className="border-t px-4 py-2 text-center">
                      <button onClick={() => setShowAllCompliance(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
                        {showAllCompliance ? "Show fewer" : <>Show all {complianceRecords.length} records <ChevronDownIcon /></>}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {complianceRecords.length === 0 && !complianceLoading && <p className="text-sm text-slate-400">No compliance records yet.</p>}
            </div>
          )}

          {/* Legal Records */}
          {complianceSubTab==="legal" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
                <h2 className="font-semibold text-slate-900 mb-1">Add Legal / Registration Record</h2>
                <p className="text-xs text-slate-500 mb-4">Business registration, trade licences, professional memberships, and similar legal credentials.</p>
                <form onSubmit={addLegalRecord} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={legalForm.recordType} onChange={e=>setLegalForm({...legalForm,recordType:e.target.value})} placeholder="Type (e.g. BUSINESS_REGISTRATION, TRADE_LICENCE) *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={legalForm.title} onChange={e=>setLegalForm({...legalForm,title:e.target.value})} placeholder="Title / label *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={legalForm.authority} onChange={e=>setLegalForm({...legalForm,authority:e.target.value})} placeholder="Issuing authority" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={legalForm.referenceNumber} onChange={e=>setLegalForm({...legalForm,referenceNumber:e.target.value})} placeholder="Reference number" className="rounded-lg border px-3 py-2 text-sm" />
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-slate-500 shrink-0">Issue</label>
                      <input type="date" value={legalForm.issueDate} onChange={e=>setLegalForm({...legalForm,issueDate:e.target.value})} className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                    </div>
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-slate-500 shrink-0">Expiry</label>
                      <input type="date" value={legalForm.expiryDate} onChange={e=>setLegalForm({...legalForm,expiryDate:e.target.value})} className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <select value={legalForm.status} onChange={e=>setLegalForm({...legalForm,status:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {["ACTIVE","EXPIRED","PENDING","REVOKED"].map(s=><option key={s}>{s}</option>)}
                  </select>
                  <button disabled={legalSaving||!legalForm.recordType||!legalForm.title} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
                    {legalSaving?"Adding…":"Add Record"}
                  </button>
                </form>
              </div>
              {legalRecords.length > 0 && (
                <div className="rounded-2xl border bg-white shadow-sm overflow-hidden max-w-3xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-left">Title</th><th className="px-4 py-2 text-left hidden md:table-cell">Authority</th><th className="px-4 py-2 text-left hidden md:table-cell">Expiry</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2"></th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {(showAllLegal ? legalRecords : legalRecords.slice(0, ROWS_PREVIEW)).map(r => (
                        <Fragment key={r.id}>
                          <tr className="hover:bg-slate-50">
                            <td className="px-4 py-2 text-xs text-slate-500">{r.recordType}</td>
                            <td className="px-4 py-2 font-medium text-slate-900">{r.title}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{r.authority??"-"}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("en-GB") : "-"}</td>
                            <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.status==="ACTIVE"?"bg-green-100 text-green-700":r.status==="EXPIRED"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                            <td className="px-4 py-2 text-right"><button type="button" onClick={()=>setConfirmingDeleteLegalId(r.id)} disabled={deletingLegalId!==null} aria-expanded={confirmingDeleteLegalId===r.id} {...(confirmingDeleteLegalId===r.id ? { "aria-controls": `legal-delete-confirm-${r.id}` } : {})} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60">{deletingLegalId===r.id?"Deleting…":"Delete"}</button></td>
                          </tr>
                          {confirmingDeleteLegalId===r.id && (
                            <tr id={`legal-delete-confirm-${r.id}`} className="bg-red-50 text-xs text-red-900"><td colSpan={6} className="px-4 py-3"><p className="font-medium">Delete legal record {r.title}?</p><p className="mt-1 text-red-800">This removes the credential from future evidence selection. Tender documents already generated are not changed automatically.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={()=>void deleteLegalRecord(r.id)} disabled={deletingLegalId===r.id} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deletingLegalId===r.id?"Deleting…":"Yes, delete legal record"}</button><button type="button" onClick={()=>setConfirmingDeleteLegalId(null)} disabled={deletingLegalId===r.id} className="rounded border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">Cancel</button></div></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  {legalRecords.length > ROWS_PREVIEW && (
                    <div className="border-t px-4 py-2 text-center">
                      <button onClick={() => setShowAllLegal(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
                        {showAllLegal ? "Show fewer" : <>Show all {legalRecords.length} records <ChevronDownIcon /></>}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {legalRecords.length === 0 && !complianceLoading && <p className="text-sm text-slate-400">No legal records yet.</p>}
            </div>
          )}

          {/* Financial Records */}
          {complianceSubTab==="financial" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-3xl">
                <h2 className="font-semibold text-slate-900 mb-1">Add Financial Record</h2>
                <p className="text-xs text-slate-500 mb-4">Annual turnover, audited financial statements, and other financial capacity evidence by fiscal year.</p>
                <form onSubmit={addFinancialRecord} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={financialForm.recordType} onChange={e=>setFinancialForm({...financialForm,recordType:e.target.value})} placeholder="Type (e.g. ANNUAL_TURNOVER, AUDITED_ACCOUNTS) *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={financialForm.fiscalYear} onChange={e=>setFinancialForm({...financialForm,fiscalYear:e.target.value})} type="number" min="1990" max="2100" placeholder="Fiscal year *" className="rounded-lg border px-3 py-2 text-sm" />
                    <input value={financialForm.amount} onChange={e=>setFinancialForm({...financialForm,amount:e.target.value})} type="number" placeholder="Amount" className="rounded-lg border px-3 py-2 text-sm" />
                    <select value={financialForm.currency} onChange={e=>setFinancialForm({...financialForm,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                      <option value="">Currency unresolved</option>
                      {["USD","EUR","GBP","ETB","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <textarea value={financialForm.notes} onChange={e=>setFinancialForm({...financialForm,notes:e.target.value})} rows={2} placeholder="Notes (optional)" className="w-full rounded-lg border px-3 py-2 text-sm" />
                  <button disabled={financialSaving||!financialForm.recordType||!financialForm.fiscalYear} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
                    {financialSaving?"Adding…":"Add Record"}
                  </button>
                </form>
              </div>
              {financialRecords.length > 0 && (
                <div className="rounded-2xl border bg-white shadow-sm overflow-hidden max-w-3xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-left">Year</th><th className="px-4 py-2 text-left hidden md:table-cell">Amount</th><th className="px-4 py-2 text-left hidden md:table-cell">Notes</th><th className="px-4 py-2"></th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {(showAllFinancial ? financialRecords : financialRecords.slice(0, ROWS_PREVIEW)).map(r => (
                        <Fragment key={r.id}>
                          <tr className="hover:bg-slate-50">
                            <td className="px-4 py-2 text-xs text-slate-500">{r.recordType}</td>
                            <td className="px-4 py-2 font-medium text-slate-900">{r.fiscalYear}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{r.amount != null ? `${r.currency ?? ""} ${r.amount.toLocaleString()}` : "-"}</td>
                            <td className="px-4 py-2 text-slate-500 hidden md:table-cell truncate max-w-xs">{r.notes??"-"}</td>
                            <td className="px-4 py-2 text-right"><button type="button" onClick={()=>setConfirmingDeleteFinancialId(r.id)} disabled={deletingFinancialId!==null} aria-expanded={confirmingDeleteFinancialId===r.id} {...(confirmingDeleteFinancialId===r.id ? { "aria-controls": `financial-delete-confirm-${r.id}` } : {})} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60">{deletingFinancialId===r.id?"Deleting…":"Delete"}</button></td>
                          </tr>
                          {confirmingDeleteFinancialId===r.id && (
                            <tr id={`financial-delete-confirm-${r.id}`} className="bg-red-50 text-xs text-red-900"><td colSpan={5} className="px-4 py-3"><p className="font-medium">Delete financial record for {r.fiscalYear}?</p><p className="mt-1 text-red-800">This removes the financial evidence from future evidence selection. Tender documents already generated are not changed automatically.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={()=>void deleteFinancialRecord(r.id)} disabled={deletingFinancialId===r.id} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60">{deletingFinancialId===r.id?"Deleting…":"Yes, delete financial record"}</button><button type="button" onClick={()=>setConfirmingDeleteFinancialId(null)} disabled={deletingFinancialId===r.id} className="rounded border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">Cancel</button></div></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  {financialRecords.length > ROWS_PREVIEW && (
                    <div className="border-t px-4 py-2 text-center">
                      <button onClick={() => setShowAllFinancial(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
                        {showAllFinancial ? "Show fewer" : <>Show all {financialRecords.length} records <ChevronDownIcon /></>}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {financialRecords.length === 0 && !complianceLoading && <p className="text-sm text-slate-400">No financial records yet.</p>}
            </div>
          )}
        </div>
      )}

      {/* Edit Expert Modal */}
      {editExpert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={()=>{ if (!expertEditSaving) setEditExpert(null); }} />
          <div role="dialog" aria-modal="true" aria-labelledby="edit-expert-title" className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="edit-expert-title" className="text-lg font-semibold text-slate-900 mb-4">Edit Expert</h2>
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
              <button onClick={saveEditExpert} disabled={expertEditSaving||!expertEditForm.fullName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">{expertEditSaving?"Saving…":"Save"}</button>
              <button onClick={()=>setEditExpert(null)} disabled={expertEditSaving} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={()=>{ if (!projectEditSaving) setEditProject(null); }} />
          <div role="dialog" aria-modal="true" aria-labelledby="edit-project-title" className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="edit-project-title" className="text-lg font-semibold text-slate-900 mb-4">Edit Project</h2>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={projectEditForm.name} onChange={e=>setProjectEditForm({...projectEditForm,name:e.target.value})} placeholder="Project name *" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.clientName} onChange={e=>setProjectEditForm({...projectEditForm,clientName:e.target.value})} placeholder="Client name" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.sector} onChange={e=>setProjectEditForm({...projectEditForm,sector:e.target.value})} placeholder="Sector" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.country} onChange={e=>setProjectEditForm({...projectEditForm,country:e.target.value})} placeholder="Country" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={projectEditForm.contractValue} onChange={e=>setProjectEditForm({...projectEditForm,contractValue:e.target.value})} type="number" placeholder="Contract value" className="rounded-lg border px-3 py-2 text-sm" />
                <select value={projectEditForm.currency} onChange={e=>setProjectEditForm({...projectEditForm,currency:e.target.value})} className="rounded-lg border px-3 py-2 text-sm bg-white">
                  <option value="">Currency unresolved</option>
                  {["USD","EUR","GBP","AED","SAR","KWD","EGP","ZAR"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <input value={projectEditForm.serviceAreas} onChange={e=>setProjectEditForm({...projectEditForm,serviceAreas:e.target.value})} placeholder="Service areas (comma-separated)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea value={projectEditForm.summary} onChange={e=>setProjectEditForm({...projectEditForm,summary:e.target.value})} rows={2} placeholder="Project summary" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditProject} disabled={projectEditSaving||!projectEditForm.name} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">{projectEditSaving?"Saving…":"Save"}</button>
              <button onClick={()=>setEditProject(null)} disabled={projectEditSaving} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
