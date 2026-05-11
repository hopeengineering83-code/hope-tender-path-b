"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../../../../components/status-badge";
import { NEXT_STATUS, formatDate, formatTenderStatus } from "../../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../../lib/engine/proposal-labels";
import { BidStrategyPanel } from "../../../../components/bid-strategy-panel";
import { EvaluatorSimulatorPanel } from "../../../../components/evaluator-simulator-panel";
import { AIRematchButton } from "../../../../components/ai-rematch-button";

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={idx}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={idx}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function parseDocumentQuality(contentSummary: string | null | undefined): { qualityScore: number; benchmarkScore: number; verdict: string } | null {
  if (!contentSummary) return null;
  const qMatch = contentSummary.match(/Quality score: (\d+)\/100/);
  const bMatch = contentSummary.match(/Benchmark audit (\d+)\/100 \(([A-Z_]+)\)/);
  if (!qMatch && !bMatch) return null;
  return {
    qualityScore: qMatch ? parseInt(qMatch[1], 10) : 0,
    benchmarkScore: bMatch ? parseInt(bMatch[1], 10) : 0,
    verdict: bMatch?.[2] ?? "PENDING",
  };
}

function ProposalMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-slate-800 mt-4 mb-1">{renderInline(trimmed.slice(4))}</h3>);
      i++; continue;
    }
    if (trimmed.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-base font-bold text-blue-900 mt-5 mb-2 pb-1 border-b border-blue-100">{renderInline(trimmed.slice(3))}</h2>);
      i++; continue;
    }
    if (trimmed.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-lg font-bold text-blue-900 mt-6 mb-2 pb-1 border-b-2 border-blue-200">{renderInline(trimmed.slice(2))}</h1>);
      i++; continue;
    }

    if (trimmed.startsWith("> ")) {
      elements.push(<blockquote key={i} className="border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800 my-2 italic">{renderInline(trimmed.slice(2))}</blockquote>);
      i++; continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim()); i++;
      }
      const dataRows = tableLines.filter((l) => !/^\|[\s:|-]+\|$/.test(l));
      if (dataRows.length > 0) {
        const headers = dataRows[0].split("|").slice(1, -1).map((c) => c.trim());
        const bodyRows = dataRows.slice(1);
        elements.push(
          <div key={`t${i}`} className="overflow-x-auto my-3">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="bg-blue-900 text-white">
                  {headers.map((h, hi) => <th key={hi} className="px-2 py-1.5 text-left font-semibold">{renderInline(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => {
                  const cells = row.split("|").slice(1, -1).map((c) => c.trim());
                  return (
                    <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      {cells.map((c, ci) => <td key={ci} className="px-2 py-1 border border-slate-200">{renderInline(c)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*•]\s+/, "")); i++;
      }
      elements.push(
        <ul key={`u${i}`} className="list-disc pl-5 my-1.5 space-y-0.5">
          {bullets.map((b, bi) => <li key={bi} className="text-sm text-slate-700">{renderInline(b)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, "")); i++;
      }
      elements.push(
        <ol key={`o${i}`} className="list-decimal pl-5 my-1.5 space-y-0.5">
          {items.map((item, ii) => <li key={ii} className="text-sm text-slate-700">{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    elements.push(<p key={i} className="text-sm text-slate-700 my-1.5 leading-relaxed">{renderInline(trimmed)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

type TenderFile = {
  id: string;
  fileName: string;
  originalFileName: string;
  size: number;
  mimeType: string;
  createdAt: string | Date;
  extractedText?: string | null;
  classification?: string | null;
};

type UploadItem = {
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  classification: string;
};

const FILE_CLASSIFICATIONS = [
  { value: "", label: "No classification" },
  { value: "BID_DOCUMENT", label: "Bid Document" },
  { value: "TECHNICAL_SPEC", label: "Technical Spec" },
  { value: "PRICING", label: "Pricing" },
  { value: "TERMS", label: "Terms & Conditions" },
  { value: "REFERENCE", label: "Reference" },
  { value: "ADDENDUM", label: "Addendum" },
  { value: "OTHER", label: "Other" },
];

const EXT_COLORS: Record<string, string> = {
  pdf: "bg-red-100 text-red-700",
  docx: "bg-blue-100 text-blue-700",
  doc: "bg-blue-100 text-blue-700",
  xlsx: "bg-green-100 text-green-700",
  xls: "bg-green-100 text-green-700",
  pptx: "bg-orange-100 text-orange-700",
  ppt: "bg-orange-100 text-orange-700",
  csv: "bg-teal-100 text-teal-700",
  txt: "bg-slate-100 text-slate-600",
  rtf: "bg-slate-100 text-slate-600",
  png: "bg-purple-100 text-purple-700",
  jpg: "bg-purple-100 text-purple-700",
  jpeg: "bg-purple-100 text-purple-700",
};

function getExt(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FileTypeBadge({ name }: { name: string }) {
  const ext = getExt(name);
  const cls = EXT_COLORS[ext] ?? "bg-slate-100 text-slate-600";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{ext || "file"}</span>;
}

function ExtractionBadge({ text }: { text?: string | null }) {
  if (!text) return <span className="text-xs text-slate-300">no text</span>;
  if (text.startsWith("[Scanned")) return <span className="text-xs text-amber-600">⚠ scanned</span>;
  return <span className="text-xs text-green-600">{text.length.toLocaleString()} chars</span>;
}

function TrustBadge({ level }: { level?: string | null }) {
  if (level === "REVIEWED") return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">✓ REVIEWED</span>;
  if (level === "AI_DRAFT") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">AI DRAFT</span>;
  return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">DRAFT</span>;
}

type TenderRequirement = {
  id: string;
  title: string;
  description: string;
  priority: string;
  requirementType: string;
  exactFileName: string | null;
  exactOrder: number | null;
};

type ComplianceGap = {
  id: string;
  title: string;
  description: string;
  severity: string;
  isResolved: boolean;
};

type GeneratedDocument = {
  id: string;
  name: string;
  documentType: string;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  reviewNotes: string | null;
  exactFileName?: string | null;
  contentSummary?: string | null;
};

type ExpertMatch = {
  id: string;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  expert: {
    id: string;
    fullName: string;
    title: string | null;
    yearsExperience: number | null;
    disciplines: string;
    sectors: string;
    trustLevel?: string | null;
  };
};

type ProjectMatch = {
  id: string;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  project: {
    id: string;
    name: string;
    clientName: string | null;
    country: string | null;
    sector: string | null;
    contractValue: number | null;
    currency: string | null;
    trustLevel?: string | null;
  };
};

type MatchingDiagnostics = {
  experts: { selected: number; averageSelectedScore: number; lowConfidence: Array<{ id: string; score: number }>; lowCoverage: Array<{ id: string }>; hardExcluded: Array<{ id: string }> };
  projects: { selected: number; averageSelectedScore: number; lowConfidence: Array<{ id: string; score: number }>; lowCoverage: Array<{ id: string }>; hardExcluded: Array<{ id: string }> };
};

type ComplianceMatrixEntry = {
  id: string;
  requirementId: string | null;
  evidenceType: string;
  evidenceSource: string;
  supportLevel: string;
  notes: string | null;
};

type Tender = {
  id: string;
  title: string;
  description: string | null;
  reference: string | null;
  clientName: string | null;
  category: string;
  budget: number | null;
  currency: string;
  deadline: string | Date | null;
  submissionMethod: string | null;
  submissionAddress: string | null;
  status: string;
  intakeSummary: string | null;
  analysisSummary: string | null;
  evaluationMethodology: string | null;
  notes: string | null;
  exactFileNaming: string | string[];
  exactFileOrder: string | string[];
  readinessScore?: number | null;
  files: TenderFile[];
  requirements: TenderRequirement[];
  complianceGaps: ComplianceGap[];
  generatedDocuments: GeneratedDocument[];
  expertMatches?: ExpertMatch[];
  projectMatches?: ProjectMatch[];
  complianceMatrix?: ComplianceMatrixEntry[];
  bidOutcome?: string | null;
  bidOutcomeNote?: string | null;
  bidOutcomeAt?: string | Date | null;
};

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TenderDetail({ tender: initial, aiEnabled }: { tender: Tender; aiEnabled?: boolean }) {
  const router = useRouter();
  const [tender, setTender] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<{ passed: boolean; issues: { code: string; severity: string; message: string }[] } | null>(null);
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileQueue, setFileQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [aiProposal, setAiProposal] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [generationPhase, setGenerationPhase] = useState("");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [bidOutcome, setBidOutcome] = useState(initial.bidOutcome ?? "");
  const [bidOutcomeNote, setBidOutcomeNote] = useState(initial.bidOutcomeNote ?? "");
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [activityLogs, setActivityLogs] = useState<{ id: string; action: string; description: string; createdAt: string }[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [matchingDiagnostics, setMatchingDiagnostics] = useState<MatchingDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const [form, setForm] = useState({
    title: initial.title,
    reference: initial.reference ?? "",
    clientName: initial.clientName ?? "",
    category: initial.category,
    budget: initial.budget?.toString() ?? "",
    currency: initial.currency,
    deadline: initial.deadline ? new Date(initial.deadline).toISOString().slice(0, 10) : "",
    submissionMethod: initial.submissionMethod ?? "",
    submissionAddress: initial.submissionAddress ?? "",
    description: initial.description ?? "",
    intakeSummary: initial.intakeSummary ?? "",
    analysisSummary: initial.analysisSummary ?? "",
    evaluationMethodology: initial.evaluationMethodology ?? "",
    notes: initial.notes ?? "",
  });

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        setError("Failed to save tender");
        return;
      }

      const updated = await res.json();
      setTender(updated);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Debounced auto-save — fires 3s after the last form change while editing
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!editing) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenders/${tender.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, budget: form.budget || null, deadline: form.deadline || null }),
        });
        if (res.ok) setAutoSavedAt(new Date());
      } catch { /* silent — user can still manually save */ }
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const loadDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/matching-diagnostics`);
      if (!res.ok) return;
      const data = await res.json() as MatchingDiagnostics;
      setMatchingDiagnostics(data);
    } catch {
      // diagnostics are optional; keep UI resilient
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [tender.id]);

  // Auto-fetch on mount; loadDiagnostics is also wired to the Refresh button.
  useEffect(() => { void loadDiagnostics(); }, [loadDiagnostics]);

  async function handleSave() {
    await save({
      ...form,
      budget: form.budget || null,
      deadline: form.deadline || null,
    });
    setEditing(false);
  }

  async function handleStatusAdvance() {
    const next = NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS];
    if (!next) return;
    await save({ status: next });
  }

  async function handleRunEngine() {
    setEngineRunning(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/engine`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Engine run failed");
        return;
      }
      if (data.tender) {
        setTender((current) => ({
          ...current,
          ...data.tender,
        }));
        setForm((current) => ({
          ...current,
          analysisSummary: data.tender.analysisSummary || current.analysisSummary,
          evaluationMethodology: data.tender.evaluationMethodology || current.evaluationMethodology,
        }));
      }
      router.refresh();
    } catch {
      setError("Engine run failed");
    } finally {
      setEngineRunning(false);
    }
  }

  async function handleAIAnalyze() {
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/ai-analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Analysis failed"); return; }
      if (data.tender) setTender((cur) => ({ ...cur, ...data.tender }));
      router.refresh();
    } catch { setError("Analysis failed"); }
    finally { setAnalyzing(false); }
  }

  async function handleAIProposal() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/ai-proposal`, { method: "POST" });
      const data = await res.json();
      if (res.status === 429) {
        setError(data.error || "Gemini rate limit — please wait 30–60 seconds and try again.");
        return;
      }
      if (!res.ok) { setError(data.error || "Generation failed"); return; }
      setAiProposal(data.proposal || "");
      setForm((cur) => ({ ...cur, intakeSummary: data.proposal || cur.intakeSummary }));
    } catch { setError("Proposal generation failed"); }
    finally { setGenerating(false); }
  }

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  // Phase-based progress animation for the 45-60s generation window.
  // Gives users something meaningful to read instead of a frozen button.
  const GENERATION_PHASES = [
    { label: "Analyzing tender requirements…", pct: 8 },
    { label: "Matching experts and projects…", pct: 20 },
    { label: "Generating proposal sections (A–D)…", pct: 65 },
    { label: "Refining and humanizing…", pct: 88 },
    { label: "Saving documents…", pct: 97 },
  ];
  function startGenerationProgress() {
    const durations = [6000, 14000, 35000, 10000, 5000];
    let cumulative = 0;
    GENERATION_PHASES.forEach((phase, i) => {
      const delay = cumulative;
      setTimeout(() => {
        setGenerationPhase(phase.label);
        setGenerationProgress(phase.pct);
      }, delay);
      cumulative += durations[i];
    });
  }
  function stopGenerationProgress() {
    setGenerationPhase("");
    setGenerationProgress(0);
  }

  async function handleGenerateDocs() {
    setGeneratingDocs(true);
    setError("");
    startGenerationProgress();
    try {
      const res = await fetch(`/api/tenders/${tender.id}/generate`, { method: "POST" });
      const data = await res.json() as { error?: string; code?: string; nextAction?: string; totalExpertMatches?: number; totalProjectMatches?: number; tender?: Tender };
      if (!res.ok) {
        if (data.code === "NO_EXPERT_MATCHES_SELECTED" || data.code === "NO_EXPERT_MATCHES_FOUND") {
          setError(`${data.error || "Generation failed"} ${typeof data.totalExpertMatches === "number" ? `(${data.totalExpertMatches} expert match(es) found in total.)` : ""}`.trim());
          return;
        }
        if (data.code === "NO_PROJECT_MATCHES_SELECTED" || data.code === "NO_PROJECT_MATCHES_FOUND") {
          setError(`${data.error || "Generation failed"} ${typeof data.totalProjectMatches === "number" ? `(${data.totalProjectMatches} project match(es) found in total.)` : ""}`.trim());
          return;
        }
        const actionHint = data.nextAction === "RUN_ENGINE"
          ? " Use 'Run Engine' first, then retry generation."
          : data.nextAction === "REVIEW_MATCHES"
            ? " Open Expert/Project Matches and select the strongest reviewed evidence, then retry."
            : "";
        setError(`${data.error || "Generation failed"}${actionHint}`.trim());
        return;
      }
      if (data.tender) setTender((cur) => ({ ...cur, ...data.tender }));
      router.refresh();
      const q = data.tender?.generatedDocuments?.[0]?.contentSummary?.match(/Quality score: (\d+)\/100/);
      showToast(`Documents generated${q ? ` — Quality ${q[1]}/100` : ""}`, "success");
    } catch { setError("Document generation failed"); }
    finally { setGeneratingDocs(false); stopGenerationProgress(); }
  }

  // Map document types → sectionId for section-level regeneration
  const SECTION_ID_MAP: Record<string, string> = {
    COVER_LETTER: "cover-and-summary",
    EXECUTIVE_SUMMARY: "cover-and-summary",
    COMPANY_EXPERIENCE: "company-and-experience",
    TECHNICAL_PROPOSAL: "technical-approach",
    METHODOLOGY: "technical-approach",
    DECLARATION: "additional-and-declaration",
    ADDITIONAL: "additional-and-declaration",
  };

  async function handleRegenerateSection(docId: string, documentType: string) {
    const sectionId = SECTION_ID_MAP[documentType];
    if (!sectionId) return;
    setRegeneratingSection(docId);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/regenerate-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Section regeneration failed"); return; }
      router.refresh();
      showToast(`Section regenerated${data.fallback ? " (deterministic fallback)" : ""}`, "success");
    } catch { setError("Section regeneration failed"); }
    finally { setRegeneratingSection(null); }
  }

  async function handleGenerateFullPackage() {
    setGenerating(true);
    setError("");
    startGenerationProgress();
    try {
      const engineRes = await fetch(`/api/tenders/${tender.id}/engine`, { method: "POST" });
      const engineData = await engineRes.json();
      if (!engineRes.ok) { setError(engineData.error || "Engine run failed"); return; }
      if (engineData.tender) setTender((cur) => ({ ...cur, ...engineData.tender }));

      const genRes = await fetch(`/api/tenders/${tender.id}/generate`, { method: "POST" });
      const genData = await genRes.json();
      if (!genRes.ok) { setError(genData.error || "Generation failed"); return; }
      if (genData.tender) setTender((cur) => ({ ...cur, ...genData.tender }));
      router.refresh();
      showToast("Full package generated", "success");
    } catch { setError("Full package generation failed"); }
    finally { setGenerating(false); stopGenerationProgress(); }
  }

  async function handleValidate() {
    setValidating(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/validate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Validation failed"); return; }
      setValidationReport(data.report);
      router.refresh();
    } catch { setError("Validation failed"); }
    finally { setValidating(false); }
  }

  function downloadDoc(type: string) {
    window.open(`/api/tenders/${tender.id}/download?type=${type}`, "_blank");
  }

  function downloadDocById(docId: string) {
    window.open(`/api/tenders/${tender.id}/download?docId=${docId}`, "_blank");
  }

  function downloadZip() {
    window.open(`/api/tenders/${tender.id}/download?type=zip`, "_blank");
  }

  async function loadActivity() {
    if (activityLoaded) return;
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/activity?limit=30`);
      if (res.ok) {
        const data = await res.json() as { items: { id: string; action: string; description: string; createdAt: string }[] };
        setActivityLogs(data.items);
        setActivityLoaded(true);
      }
    } finally {
      setActivityLoading(false);
    }
  }

  async function saveBidOutcome() {
    setSavingOutcome(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/bid-outcome`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidOutcome: bidOutcome || null, bidOutcomeNote: bidOutcomeNote || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError((d as { error?: string }).error || "Failed to save bid outcome"); return; }
      const updated = await res.json() as { tender: { bidOutcome?: string | null; bidOutcomeNote?: string | null; bidOutcomeAt?: string | null } };
      setTender((prev) => ({ ...prev, bidOutcome: updated.tender.bidOutcome, bidOutcomeNote: updated.tender.bidOutcomeNote, bidOutcomeAt: updated.tender.bidOutcomeAt }));
    } catch { setError("Network error saving bid outcome"); }
    finally { setSavingOutcome(false); }
  }

  async function submitReview(docId: string, reviewStatus: string) {
    await fetch(`/api/tenders/${tender.id}/documents/${docId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus, reviewNotes: reviewNote }),
    });
    setReviewingDocId(null);
    setReviewNote("");
    const res = await fetch(`/api/tenders/${tender.id}`);
    if (res.ok) { setTender(await res.json() as Tender); }
  }

  async function handleDelete() {
    if (!confirm("Delete this tender? This cannot be undone.")) return;
    setDeleting(true);
    await fetch(`/api/tenders/${tender.id}`, { method: "DELETE" });
    router.push("/dashboard/tenders");
  }

  const processFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const items: UploadItem[] = newFiles.map((f) => ({ file: f, status: "queued", classification: "" }));
    setFileQueue((q) => [...items, ...q]);
    setUploading(true);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "uploading" } : x));

      try {
        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("tenderId", tender.id);
        if (item.classification) fd.append("classification", item.classification);

        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();

        if (res.ok && data.results?.[0]?.fileRecord) {
          const fileRecord = data.results[0].fileRecord;
          setTender((cur) => ({ ...cur, files: [fileRecord, ...cur.files] }));
          setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "done" } : x));
        } else {
          const msg = data.results?.[0]?.error ?? data.error ?? "Upload failed";
          setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: msg } : x));
        }
      } catch {
        setFileQueue((q) => q.map((x) => x.file === item.file ? { ...x, status: "error", error: "Network error" } : x));
      }
    }

    setUploading(false);
    setTimeout(() => setFileQueue((q) => q.filter((x) => x.status !== "done")), 3000);
  }, [tender.id]);

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    processFiles(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }

  async function handleDeleteFile(fileId: string) {
    if (!confirm("Delete this file?")) return;
    const res = await fetch(`/api/tenders/${tender.id}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) {
      setTender((cur) => ({ ...cur, files: cur.files.filter((f) => f.id !== fileId) }));
    }
  }

  function handleDownloadFile(fileId: string, fileName: string) {
    const a = document.createElement("a");
    a.href = `/api/tenders/${tender.id}/files/${fileId}`;
    a.download = fileName;
    a.click();
  }

  const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
  const criticalGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && gap.severity === "CRITICAL").length;
  const criticalHardBlockExists = tender.complianceGaps.some((gap) =>
    !gap.isResolved
    && gap.severity === "CRITICAL"
    && /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|signature prohibited|branding prohibited)/i.test(`${gap.title} ${gap.description}`),
  );
  const highGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && gap.severity === "HIGH").length;
  const mandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY").length;
  const expertReqExists = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const projectReqExists = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExpertCount = tender.expertMatches?.filter((m) => m.isSelected).length ?? 0;
  const selectedProjectCount = tender.projectMatches?.filter((m) => m.isSelected).length ?? 0;
  const canGenerateDocs = tender.requirements.length > 0
    && (!expertReqExists || selectedExpertCount > 0)
    && (!projectReqExists || selectedProjectCount > 0)
    && !criticalHardBlockExists;
  const generateDisabledReason = tender.requirements.length === 0
    ? "Run AI Analyze or Run Engine first to extract requirements"
    : (expertReqExists && selectedExpertCount === 0)
      ? "Select at least one expert match before generating"
      : (projectReqExists && selectedProjectCount === 0)
        ? "Select at least one project match before generating"
        : criticalHardBlockExists
          ? "Resolve critical hard blockers before generating"
        : "Generate proposal documents";
  const readinessScore = tender.readinessScore ??
    (tender.requirements.length === 0 ? 0
      : Math.max(0, Math.round(((tender.requirements.length - criticalGaps) / tender.requirements.length) * 100)));

  const proposalQuality = (() => {
    const proposal = tender.generatedDocuments.find((d) => d.documentType === "TECHNICAL_PROPOSAL" && d.contentSummary);
    return parseDocumentQuality(proposal?.contentSummary);
  })();

  // Apply the same label-sanitization helpers that proposal generation uses,
  // at display time. The intake stage sometimes captures multi-line garbage
  // from the tender PDF (e.g., "discipline and long-term commitment
  // Headquarters: Not specified in texts, but active in East Africa…")
  // into tender.title and tender.clientName. cleanTenderTitle and
  // cleanClientName already detect and reject those patterns; this surfaces
  // a clean label on the dashboard without requiring an admin DB cleanup.
  // The raw tender.title / tender.clientName are still in the DB and can
  // be edited via the tender Edit page if the user wants to change them.
  const displayTitle = cleanTenderTitle(tender.title, { clientName: tender.clientName, description: tender.description });
  const displayClient = cleanClientName(tender.clientName, tender.description);
  const displayClientLine = displayClient && displayClient !== "Client" ? ` · ${displayClient}` : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{displayTitle}</h1>
            <StatusBadge status={tender.status} />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {tender.reference ? `Ref ${tender.reference}` : "No reference yet"}
            {displayClientLine}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {aiEnabled && (
            <button onClick={handleAIAnalyze} disabled={analyzing}
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700 disabled:opacity-50">
              {analyzing ? "Analyzing..." : "✦ AI Analyze"}
            </button>
          )}
          {aiEnabled && (
            <button onClick={handleAIProposal} disabled={generating}
              className="rounded-lg bg-purple-100 px-3 py-2 text-sm text-purple-800 hover:bg-purple-200 disabled:opacity-50">
              {generating ? "Generating..." : "✦ AI Proposal"}
            </button>
          )}
          <button onClick={handleRunEngine} disabled={engineRunning}
            className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {engineRunning ? "Running…" : "Run Engine"}
          </button>
          <button onClick={handleGenerateDocs} disabled={generatingDocs || !canGenerateDocs}
            title={generateDisabledReason}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {generatingDocs ? "Generating…" : "⚡ Generate Docs"}
          </button>
          <button onClick={handleValidate} disabled={validating}
            className="rounded-lg bg-teal-600 px-3 py-2 text-sm text-white hover:bg-teal-700 disabled:opacity-50">
            {validating ? "Validating…" : "✓ Validate"}
          </button>
          {NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] && (
            <button onClick={handleStatusAdvance} disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              → {formatTenderStatus(NEXT_STATUS[tender.status as keyof typeof NEXT_STATUS] as string)}
            </button>
          )}
          <button onClick={downloadZip}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100">
            ↓ ZIP Package
          </button>
          <button onClick={() => downloadDoc("proposal")}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            ↓ Proposal
          </button>
          <button onClick={() => downloadDoc("requirements")}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            ↓ Requirements
          </button>
          <button onClick={() => setEditing((v) => !v)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>

      {matchingDiagnostics && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-indigo-900">Matching quality diagnostics</h3>
            <div className="flex items-center gap-2">
              <button onClick={loadDiagnostics} className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] text-indigo-800 hover:bg-indigo-100">
                {diagnosticsLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                onClick={() => window.open(`/api/tenders/${tender.id}/matching-diagnostics`, "_blank")}
                className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] text-indigo-800 hover:bg-indigo-100"
              >
                Open JSON
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-indigo-700">
            Expert avg {Math.round(matchingDiagnostics.experts.averageSelectedScore * 100)}% · Project avg {Math.round(matchingDiagnostics.projects.averageSelectedScore * 100)}%
          </p>
          <div className="mt-2 grid gap-2 text-xs text-indigo-800 sm:grid-cols-2">
            <p>Experts low-confidence: {matchingDiagnostics.experts.lowConfidence.length}</p>
            <p>Projects low-confidence: {matchingDiagnostics.projects.lowConfidence.length}</p>
            <p>Experts zero-family-coverage: {matchingDiagnostics.experts.lowCoverage.length}</p>
            <p>Projects zero-family-coverage: {matchingDiagnostics.projects.lowCoverage.length}</p>
            <p>Experts hard-excluded: {matchingDiagnostics.experts.hardExcluded.length}</p>
            <p>Projects hard-excluded: {matchingDiagnostics.projects.hardExcluded.length}</p>
          </div>
        </div>
      )}

      {/* Generation progress bar — visible during generate/generate-docs */}
      {(generatingDocs || generating) && generationPhase && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-blue-800">{generationPhase}</p>
            <p className="text-xs text-blue-600">{generationProgress}%</p>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-1000 ease-in-out"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error display with recovery suggestions and retry */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-medium">{error}</p>
              {/api key|anthropic|gemini|unauthorized/i.test(error) && (
                <p className="mt-1 text-xs text-red-600">Check your AI provider API keys in Settings → AI Configuration.</p>
              )}
              {/rate limit|429|quota/i.test(error) && (
                <p className="mt-1 text-xs text-red-600">AI provider rate limit hit. Wait 60 seconds and retry.</p>
              )}
              {/timeout|timed out/i.test(error) && (
                <p className="mt-1 text-xs text-red-600">Request timed out. Try a smaller generation tier or retry.</p>
              )}
              {/network/i.test(error) && (
                <p className="mt-1 text-xs text-red-600">Check your internet connection and retry.</p>
              )}
            </div>
            <button onClick={() => setError("")} className="shrink-0 text-red-400 hover:text-red-600 text-xs">✕</button>
          </div>
        </div>
      )}

      <div className={`grid gap-4 md:grid-cols-3 ${proposalQuality ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Files</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.files.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Requirements</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.requirements.length}</p>
          <p className="mt-1 text-xs text-slate-500">Mandatory: {mandatoryRequirements}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Gaps</p>
          <p className={`mt-1 text-3xl font-bold ${criticalGaps > 0 ? "text-red-600" : "text-green-600"}`}>{unresolvedGaps}</p>
          {criticalGaps > 0 && <p className="mt-1 text-xs text-red-500">{criticalGaps} critical</p>}
          {criticalGaps === 0 && highGaps > 0 && <p className="mt-1 text-xs text-amber-500">{highGaps} high</p>}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Experts</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.expertMatches?.filter((m) => m.isSelected).length ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">of {tender.expertMatches?.length ?? 0} matched</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Projects</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{tender.projectMatches?.filter((m) => m.isSelected).length ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">of {tender.projectMatches?.length ?? 0} matched</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Readiness</p>
          <p className={`mt-1 text-3xl font-bold ${readinessScore >= 80 ? "text-green-600" : readinessScore >= 50 ? "text-amber-500" : "text-red-500"}`}>
            {readinessScore}%
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${readinessScore >= 80 ? "bg-green-500" : readinessScore >= 50 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${readinessScore}%` }} />
          </div>
        </div>
        {proposalQuality && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Proposal Quality</p>
            <p className={`mt-1 text-3xl font-bold ${proposalQuality.qualityScore >= 80 ? "text-green-600" : proposalQuality.qualityScore >= 60 ? "text-amber-500" : "text-red-500"}`}>
              {proposalQuality.qualityScore}/100
            </p>
            <p className={`mt-1 text-xs font-medium ${proposalQuality.verdict === "BENCHMARK_READY" ? "text-green-600" : "text-amber-600"}`}>
              {proposalQuality.verdict === "BENCHMARK_READY" ? "Benchmark ready ✓" : proposalQuality.benchmarkScore > 0 ? `Benchmark ${proposalQuality.benchmarkScore}/100` : "Generate docs to score"}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(360px,1fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Tender workspace</h2>
            {editing ? (
              <div className="mt-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Tender title" />
                  <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Reference number" />
                  <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Client name" />
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Budget" type="number" />
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border px-3 py-2 text-sm bg-white">
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" type="date" />
                  <input value={form.submissionMethod} onChange={(e) => setForm({ ...form, submissionMethod: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="Submission method" />
                </div>
                <input value={form.submissionAddress} onChange={(e) => setForm({ ...form, submissionAddress: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Submission address or portal" />
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} placeholder="Tender description" />
                <textarea value={form.intakeSummary} onChange={(e) => setForm({ ...form, intakeSummary: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={5} placeholder="Intake summary and known scope" />
                <textarea value={form.analysisSummary} onChange={(e) => setForm({ ...form, analysisSummary: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={4} placeholder="Internal analysis summary" />
                <textarea value={form.evaluationMethodology} onChange={(e) => setForm({ ...form, evaluationMethodology: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={4} placeholder="Evaluation methodology — how to score maximum points on each evaluation criterion (AI-extracted or manually added)" />
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} placeholder="Internal notes" />
                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving} className="rounded-lg bg-black px-5 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  {autoSavedAt && !saving && (
                    <span className="text-xs text-slate-400">Auto-saved {autoSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                </div>
              </div>
            ) : (
              <dl className="mt-5 grid gap-4 md:grid-cols-2">
                <div><dt className="text-sm text-slate-500">Client</dt><dd className="mt-1 font-medium text-slate-900">{displayClient && displayClient !== "Client" ? displayClient : (tender.clientName || "—")}</dd></div>
                <div><dt className="text-sm text-slate-500">Deadline</dt><dd className="mt-1 font-medium text-slate-900">{formatDate(tender.deadline)}</dd></div>
                <div><dt className="text-sm text-slate-500">Category</dt><dd className="mt-1 font-medium text-slate-900">{tender.category}</dd></div>
                <div><dt className="text-sm text-slate-500">Submission</dt><dd className="mt-1 font-medium text-slate-900">{tender.submissionMethod || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Description</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.description || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Intake Summary</dt><dd className="mt-1 text-slate-900">{tender.intakeSummary ? <ProposalMarkdown markdown={tender.intakeSummary} /> : "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Analysis Summary</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.analysisSummary || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Evaluation Methodology</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.evaluationMethodology || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-sm text-slate-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{tender.notes || "—"}</dd></div>
                <div className="md:col-span-2 pt-2 border-t">
                  <dt className="text-sm font-medium text-slate-700 mb-2">Bid Outcome</dt>
                  <dd>
                    <div className="flex flex-wrap items-start gap-3">
                      <select
                        value={bidOutcome}
                        onChange={(e) => setBidOutcome(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Not recorded</option>
                        <option value="WON">Won</option>
                        <option value="LOST">Lost</option>
                        <option value="WITHDRAWN">Withdrawn</option>
                        <option value="PENDING">Pending result</option>
                      </select>
                      <input
                        value={bidOutcomeNote}
                        onChange={(e) => setBidOutcomeNote(e.target.value)}
                        placeholder="Optional note (reason for loss, award value, etc.)"
                        className="flex-1 min-w-[200px] rounded-lg border px-3 py-2 text-sm"
                      />
                      <button
                        onClick={saveBidOutcome}
                        disabled={savingOutcome}
                        className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {savingOutcome ? "Saving..." : "Save Outcome"}
                      </button>
                    </div>
                    {tender.bidOutcomeAt && (
                      <p className="mt-1 text-xs text-slate-400">Recorded {formatDate(tender.bidOutcomeAt)}</p>
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Tender files
                {tender.files.length > 0 && <span className="ml-2 text-sm font-normal text-slate-400">({tender.files.length})</span>}
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "+ Upload files"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`mb-4 cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
            >
              <p className="text-sm text-slate-500">Drop tender documents here, or click to browse</p>
              <p className="mt-1 text-xs text-slate-400">PDF, DOCX, XLSX, PPTX, CSV, images — up to 10 MB each</p>
            </div>

            {fileQueue.length > 0 && (
              <ul className="mb-4 space-y-1.5">
                {fileQueue.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3 rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                    <FileTypeBadge name={item.file.name} />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{item.file.name}</span>
                    {item.status === "queued" && <span className="text-xs text-slate-400">queued</span>}
                    {item.status === "uploading" && (
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                        uploading
                      </span>
                    )}
                    {item.status === "done" && <span className="text-xs text-green-600">✓ done</span>}
                    {item.status === "error" && <span className="max-w-[140px] truncate text-xs text-red-600">{item.error}</span>}
                  </li>
                ))}
              </ul>
            )}

            {tender.files.length === 0 ? (
              <p className="text-sm text-slate-400">No tender files uploaded yet.</p>
            ) : (
              <ul className="space-y-2">
                {tender.files.map((file) => (
                  <li key={file.id} className="group rounded-xl border px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileTypeBadge name={file.originalFileName} />
                          <p className="text-sm font-medium text-slate-900 truncate">{file.originalFileName}</p>
                          {file.classification && (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              {file.classification.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <span>{formatBytes(file.size)}</span>
                          <span>·</span>
                          <span>{formatDate(file.createdAt)}</span>
                          <span>·</span>
                          <ExtractionBadge text={file.extractedText} />
                        </div>
                        {file.extractedText?.startsWith("[Scanned") && (
                          <p className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                            ⚠ Scanned PDF — no text layer found. Run OCR or upload a text-based version for AI analysis.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDownloadFile(file.id, file.originalFileName)}
                          className="rounded border px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Requirement snapshot</h2>
            {tender.requirements.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Tender analysis has not created structured requirements yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {tender.requirements.slice(0, 5).map((req) => (
                  <li key={req.id} className="rounded-xl border px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{req.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{req.priority} · {req.requirementType}</p>
                    <p className="mt-2 text-sm text-slate-600">{req.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Bid Strategy panel (PR #249) — beyond-spec feature.
              Surfaces win probability + strategic recommendation BEFORE
              the bid team commits effort to generation. Saves 40+
              person-hours per misjudged bid. */}
          <BidStrategyPanel tenderId={tender.id} />

          {/* Evaluator Persona Simulator panel (PR #251) — pre-submission
              red team. 4 parallel Claude calls with specialist personas
              (Technical / Compliance / End-User / Commercial) score the
              proposal as a real evaluation panel would. Catches issues
              before the actual evaluator sees them. User-triggered. */}
          <EvaluatorSimulatorPanel tenderId={tender.id} />

          {/* AI Multi-Perspective Rematch (PR #255) — re-scores experts
              and projects through 4 evaluator lenses (Discipline / Scale
              / Sector / Role+Recency). Replaces lexical TF-IDF ranking
              with senior-bid-director judgment. User-triggered, ~$0.07
              per rematch. */}
          <AIRematchButton
            tenderId={tender.id}
            experts={(tender.expertMatches ?? []).map((m) => ({
              id: m.expert?.id ?? "",
              fullName: m.expert?.fullName ?? "Expert",
            }))}
            projects={(tender.projectMatches ?? []).map((m) => ({
              id: m.project?.id ?? "",
              name: m.project?.name ?? "Project",
            }))}
            onRematchComplete={() => router.refresh()}
          />

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Compliance gaps</h2>
            {tender.complianceGaps.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No compliance gaps recorded yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {tender.complianceGaps.slice(0, 5).map((gap) => (
                  <li key={gap.id} className="rounded-xl border px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{gap.title}</p>
                      <span className="text-xs font-medium text-amber-700">{gap.severity}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {gap.description.length > 140 ? `${gap.description.slice(0, 140)}…` : gap.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(tender.expertMatches?.length ?? 0) > 0 && (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                Expert Matches
                <span className="ml-2 text-sm font-normal text-slate-400">
                  ({tender.expertMatches!.filter((m) => m.isSelected).length} selected)
                </span>
              </h2>
              <ul className="space-y-2">
                {tender.expertMatches!.slice(0, 8).map((match) => {
                  // Find the expert's CV document if one has been generated
                  const cvDoc = tender.generatedDocuments.find(
                    (d) => d.generationStatus === "GENERATED" &&
                           d.documentType === "EXPERT_CV_PACKAGE" &&
                           (d.name?.includes(match.expert.fullName) || d.exactFileName?.includes(match.expert.fullName.replace(/\s+/g, "-")))
                  );
                  return (
                  <li key={match.id} className={`rounded-xl border px-4 py-3 ${match.isSelected ? "border-green-200 bg-green-50" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-900">{match.expert.fullName}</p>
                          {match.isSelected && <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
                          <TrustBadge level={match.expert.trustLevel} />
                          {cvDoc && (
                            <button
                              onClick={() => downloadDocById(cvDoc.id)}
                              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"
                              title="Download expert CV"
                            >
                              ⬇ CV
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{match.expert.title ?? "Expert"}{match.expert.yearsExperience ? ` · ${match.expert.yearsExperience} yrs` : ""}</p>
                        <p className="mt-1 text-xs text-slate-500 truncate">{match.rationale}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-slate-700">{Math.round(match.score * 100)}%</p>
                        <div className="mt-1 h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${match.score >= 0.6 ? "bg-green-500" : match.score >= 0.3 ? "bg-amber-400" : "bg-slate-300"}`}
                            style={{ width: `${Math.round(match.score * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(tender.projectMatches?.length ?? 0) > 0 && (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                Project Matches
                <span className="ml-2 text-sm font-normal text-slate-400">
                  ({tender.projectMatches!.filter((m) => m.isSelected).length} selected)
                </span>
              </h2>
              <ul className="space-y-2">
                {tender.projectMatches!.slice(0, 8).map((match) => (
                  <li key={match.id} className={`rounded-xl border px-4 py-3 ${match.isSelected ? "border-blue-200 bg-blue-50" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-900">{match.project.name}</p>
                          {match.isSelected && <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
                          <TrustBadge level={match.project.trustLevel} />
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[match.project.clientName, match.project.country, match.project.sector].filter(Boolean).join(" · ")}
                          {match.project.contractValue ? ` · ${match.project.currency ?? "USD"} ${match.project.contractValue.toLocaleString()}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 truncate">{match.rationale}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-slate-700">{Math.round(match.score * 100)}%</p>
                        <div className="mt-1 h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${match.score >= 0.6 ? "bg-blue-500" : match.score >= 0.3 ? "bg-amber-400" : "bg-slate-300"}`}
                            style={{ width: `${Math.round(match.score * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(tender.complianceMatrix?.length ?? 0) > 0 && (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                Compliance Matrix
                <span className="ml-2 text-sm font-normal text-slate-400">
                  ({tender.complianceMatrix!.filter((m) => m.supportLevel === "SUPPORTED").length}/{tender.complianceMatrix!.length} supported)
                </span>
              </h2>
              <ul className="space-y-1.5">
                {tender.complianceMatrix!.slice(0, 10).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      entry.supportLevel === "SUPPORTED" ? "bg-green-100 text-green-700" :
                      entry.supportLevel === "PARTIAL" ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    }`}>{entry.supportLevel}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700">{entry.evidenceType} — {entry.evidenceSource}</p>
                      {entry.notes && <p className="mt-0.5 text-xs text-slate-400 truncate">{entry.notes}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Generated outputs</h2>
              <button onClick={() => downloadDoc("compliance")} className="text-xs text-blue-600 hover:underline">↓ Compliance Report</button>
            </div>
            {tender.generatedDocuments.length === 0 ? (
              <p className="text-sm text-slate-400">Run the engine then click "Generate Docs" to create submission-ready files.</p>
            ) : (
              <ul className="space-y-2">
                {tender.generatedDocuments.map((doc) => (
                  <li key={doc.id} className="rounded-xl border px-3 py-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.exactFileName ?? doc.name}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          <span className={`text-xs ${doc.generationStatus === "GENERATED" ? "text-green-600" : "text-slate-400"}`}>
                            {doc.generationStatus}
                          </span>
                          {doc.validationStatus && doc.validationStatus !== "PENDING" && (
                            <span className={`text-xs ${doc.validationStatus === "PASSED" ? "text-green-600" : "text-red-500"}`}>
                              · {doc.validationStatus}
                            </span>
                          )}
                          {doc.reviewStatus && doc.reviewStatus !== "PENDING" && (
                            <span className={`text-xs font-medium ${
                              doc.reviewStatus === "APPROVED" ? "text-green-700" :
                              doc.reviewStatus === "REJECTED" ? "text-red-600" :
                              "text-amber-600"
                            }`}>
                              · {doc.reviewStatus}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const q = parseDocumentQuality(doc.contentSummary);
                          if (!q) return null;
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {q.qualityScore > 0 && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${q.qualityScore >= 80 ? "bg-green-50 text-green-700" : q.qualityScore >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>
                                  Quality {q.qualityScore}/100
                                </span>
                              )}
                              {q.benchmarkScore > 0 && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${q.verdict === "BENCHMARK_READY" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                                  Benchmark {q.benchmarkScore}/100{q.verdict === "BENCHMARK_READY" ? " ✓" : ""}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {doc.reviewNotes && (
                          <p className="mt-1 text-xs text-slate-500 italic">&ldquo;{doc.reviewNotes}&rdquo;</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {/* L2: Inline content preview */}
                        {doc.contentSummary && (
                          <button
                            onClick={() => setPreviewDocId(previewDocId === doc.id ? null : doc.id)}
                            className="text-xs text-slate-500 hover:text-slate-800 border rounded px-2 py-0.5"
                          >
                            {previewDocId === doc.id ? "Hide" : "Preview"}
                          </button>
                        )}
                        {/* H1: Regenerate section button */}
                        {doc.generationStatus === "GENERATED" && SECTION_ID_MAP[doc.documentType] && (
                          <button
                            onClick={() => void handleRegenerateSection(doc.id, doc.documentType)}
                            disabled={regeneratingSection === doc.id}
                            className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 rounded px-2 py-0.5 disabled:opacity-50"
                            title="Regenerate this section only (~20s)"
                          >
                            {regeneratingSection === doc.id ? "Regenerating…" : "↺"}
                          </button>
                        )}
                        {doc.generationStatus === "GENERATED" && (
                          <button
                            onClick={() => { setReviewingDocId(reviewingDocId === doc.id ? null : doc.id); setReviewNote(doc.reviewNotes ?? ""); }}
                            className="text-xs text-slate-500 hover:text-slate-800 border rounded px-2 py-0.5"
                          >
                            Review
                          </button>
                        )}
                        {doc.generationStatus === "GENERATED" && (
                          <button onClick={() => downloadDocById(doc.id)} className="text-xs text-blue-600 hover:underline">↓</button>
                        )}
                      </div>
                    </div>

                    {/* L2: Inline content preview panel */}
                    {previewDocId === doc.id && doc.contentSummary && (
                      <div className="border-t pt-2">
                        <p className="text-xs font-medium text-slate-600 mb-1">Content preview</p>
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                          {doc.contentSummary}
                        </div>
                      </div>
                    )}

                    {reviewingDocId === doc.id && (
                      <div className="border-t pt-2 space-y-2">
                        <textarea
                          className="w-full rounded border px-2 py-1.5 text-xs resize-none"
                          rows={2}
                          placeholder="Review notes (optional)"
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                        />
                        <div className="flex gap-1.5">
                          <button onClick={() => submitReview(doc.id, "APPROVED")} className="rounded bg-green-600 px-2.5 py-1 text-xs text-white hover:bg-green-700">Approve</button>
                          <button onClick={() => submitReview(doc.id, "NEEDS_REVISION")} className="rounded bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600">Needs Revision</button>
                          <button onClick={() => submitReview(doc.id, "REJECTED")} className="rounded bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700">Reject</button>
                          <button onClick={() => setReviewingDocId(null)} className="rounded border px-2.5 py-1 text-xs">Cancel</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {validationReport && (
        <div className={`rounded-2xl border p-6 shadow-sm ${validationReport.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-lg font-semibold ${validationReport.passed ? "text-green-800" : "text-red-800"}`}>
              {validationReport.passed ? "✓ Validation Passed — Ready for Export" : "✗ Validation Failed"}
            </h2>
            <button onClick={() => setValidationReport(null)} className="text-sm text-slate-400 hover:text-slate-600">Dismiss</button>
          </div>
          {validationReport.issues.length === 0 ? (
            <p className="text-sm text-green-700">All checks passed. This tender package is ready for export.</p>
          ) : (
            <ul className="space-y-2">
              {validationReport.issues.map((issue) => (
                <li key={issue.code} className={`rounded-lg px-3 py-2 text-sm ${issue.severity === "BLOCK" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  <span className="font-medium">{issue.severity === "BLOCK" ? "BLOCKING: " : "WARNING: "}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {aiProposal && (
        <div className="rounded-2xl border border-purple-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">✦ AI-Generated Proposal Draft</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  setForm((c) => ({ ...c, intakeSummary: aiProposal }));
                  setAiProposal("");
                  await handleGenerateFullPackage();
                }}
                disabled={generating}
                className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs text-white hover:bg-blue-800 disabled:opacity-50">
                {generating ? "Generating…" : "⚡ Save & Generate Full DOCX"}
              </button>
              <button onClick={() => { setForm((c) => ({ ...c, intakeSummary: aiProposal })); setAiProposal(""); }}
                className="rounded-lg bg-black px-3 py-1.5 text-xs text-white hover:bg-slate-800">
                Save as Intake Summary
              </button>
              <button onClick={() => setAiProposal("")}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50">
                Dismiss
              </button>
            </div>
          </div>
          <div className="max-w-none">
            <ProposalMarkdown markdown={aiProposal} />
          </div>
        </div>
      )}

      <ActivityFeed
        logs={activityLogs}
        loaded={activityLoaded}
        loading={activityLoading}
        onLoad={loadActivity}
      />

      {/* Toast notification — bottom-right fixed */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium ${
          toast.type === "success" ? "bg-emerald-700 text-white" : "bg-red-700 text-white"
        }`}>
          {toast.type === "success" ? "✓" : "✗"} {toast.message}
          <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}

function ActivityFeed({
  logs,
  loaded,
  loading,
  onLoad,
}: {
  logs: { id: string; action: string; description: string; createdAt: string }[];
  loaded: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen((v) => {
      if (!v) onLoad();
      return !v;
    });
  }

  function formatAction(action: string) {
    return action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <h2 className="text-lg font-semibold text-slate-900">Activity log</h2>
        <span className="text-slate-400 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {open && (
        <div className="border-t px-6 pb-6">
          {loading && (
            <p className="pt-4 text-sm text-slate-400">Loading activity…</p>
          )}
          {!loading && loaded && logs.length === 0 && (
            <p className="pt-4 text-sm text-slate-400">No activity recorded for this tender yet.</p>
          )}
          {!loading && logs.length > 0 && (
            <ol className="relative mt-4 border-l border-slate-200 ml-2 space-y-4">
              {logs.map((log) => (
                <li key={log.id} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-400" />
                  <p className="text-sm text-slate-800">{log.description}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatAction(log.action)} · {timeAgo(log.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
