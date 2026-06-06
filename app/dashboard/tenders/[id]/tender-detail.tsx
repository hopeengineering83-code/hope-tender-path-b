"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "../../../../components/status-badge";
import { NEXT_STATUS, formatDate, formatTenderStatus } from "../../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../../lib/engine/proposal-labels";
import { getClientNameStatus, clientNameDisplayMessage } from "../../../../lib/engine/metadata-validators";
import { BidStrategyPanel } from "../../../../components/bid-strategy-panel";
import { EvaluatorSimulatorPanel } from "../../../../components/evaluator-simulator-panel";
import { AIRematchButton } from "../../../../components/ai-rematch-button";
import { CanonicalReadinessScoreWidget } from "../../../../components/canonical-readiness-score-widget";
import { SubmissionPlanCompletenessPanel } from "../../../../components/submission-plan-completeness-panel";
import TenderRecoveryCommandCenter from "../../../../components/tender-recovery-command-center";
import RequirementCoveragePanel from "../../../../components/requirement-coverage-panel";
import TenderControlsPanel from "../../../../components/tender-controls-panel";
import ScoreBreakdownPanel from "../../../../components/score-breakdown-panel";
import { detectAnalysisSource } from "../../../../lib/engine/analysis-source";

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
  extractedTextLength?: number | null;
  isScannedPlaceholder?: boolean | null;
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

function ExtractionBadge({ extractedTextLength, isScannedPlaceholder }: { extractedTextLength?: number | null; isScannedPlaceholder?: boolean | null }) {
  if (isScannedPlaceholder) return <span className="text-xs text-amber-600">⚠ scanned</span>;
  const length = extractedTextLength ?? 0;
  if (length <= 0) return <span className="text-xs text-slate-300">no text</span>;
  return <span className="text-xs text-green-600">{length.toLocaleString()} chars</span>;
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
  exactOrder?: number | null;
  contentSummary?: string | null;
  reviewedExpertCount?: number | null;
  draftExpertCount?: number | null;
  reviewedProjectCount?: number | null;
  draftProjectCount?: number | null;
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
  stage?: string | null;
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
  // Extended client/procuring-entity fields (PR XX-CLIENT)
  procuringEntityName?: string | null;
  legalClientName?: string | null;
  donorAgency?: string | null;
  implementingAgency?: string | null;
  metadataContaminated?: boolean | null;
  clientNameSourcePage?: number | null;
  clientNameSourceQuote?: string | null;
  submissionEmailSourcePage?: number | null;
  submissionEmails?: string | null;
  // Contact & location fields extracted by AI Analyze
  country?: string | null;
  clientAddress?: string | null;
  clientCity?: string | null;
  clientWebsite?: string | null;
  clientContactName?: string | null;
  clientContactTitle?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  submissionEmailSubject?: string | null;
  preBidChannel?: string | null;
  clientRepresentative?: string | null;
  contactDetailsSourceJson?: string | null;
  // Submission source traceability
  submissionMethodSourcePage?: number | null;
  submissionMethodSourceQuote?: string | null;
  submissionAddressSourcePage?: number | null;
  submissionAddressSourceQuote?: string | null;
  // Evaluation criteria source traceability
  evaluationCriteriaSourceJson?: string | null;
  // Extraction/analysis quality signals used by generation gate
  analysisExtractionStatus?: string | null;
};

const CATEGORIES = ["General", "IT", "Construction", "Services", "Consulting", "Supply", "Healthcare", "Education", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function normalizeRequirementType(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase();
}

const GAP_SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH:     "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM:   "bg-amber-100 text-amber-700 border-amber-200",
  LOW:      "bg-slate-100 text-slate-600 border-slate-200",
};

const GAPS_PAGE_SIZE = 10;
const GAPS_PAGINATION_THRESHOLD = 20; // use pagination instead of show-all when gap count exceeds this

function ComplianceGapsPanel({ tenderId, initialGaps }: { tenderId: string; initialGaps: ComplianceGap[] }) {
  const router = useRouter();
  const [gaps, setGaps] = useState<ComplianceGap[]>(initialGaps);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0); // zero-based; only used when gaps.length > GAPS_PAGINATION_THRESHOLD

  async function toggleResolved(gap: ComplianceGap) {
    setToggling(gap.id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gaps/${gap.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isResolved: !gap.isResolved }),
      });
      if (res.ok) {
        const updated = await res.json() as ComplianceGap;
        setGaps((prev) => prev.map((g) => g.id === gap.id ? { ...g, isResolved: updated.isResolved } : g));
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        setToggleError(typeof data.error === "string" ? data.error : `Failed to update gap (${res.status}). Please try again.`);
      }
    } catch {
      setToggleError("Network error — please check your connection and try again.");
    } finally {
      setToggling(null);
    }
  }

  const usePagination = gaps.length > GAPS_PAGINATION_THRESHOLD;
  const totalPages = usePagination ? Math.ceil(gaps.length / GAPS_PAGE_SIZE) : 1;
  const clampedPage = Math.min(page, totalPages - 1);
  const visible = usePagination
    ? gaps.slice(clampedPage * GAPS_PAGE_SIZE, (clampedPage + 1) * GAPS_PAGE_SIZE)
    : showAll ? gaps : gaps.slice(0, 5);
  const unresolvedCount = gaps.filter((g) => !g.isResolved).length;

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Compliance gaps</h2>
        {unresolvedCount > 0 && (
          <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-medium text-red-700">
            {unresolvedCount} unresolved
          </span>
        )}
      </div>
      {toggleError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center justify-between gap-2">
          <span>{toggleError}</span>
          <button onClick={() => setToggleError(null)} aria-label="Dismiss error" className="text-red-400 hover:text-red-700 font-bold shrink-0">✕</button>
        </div>
      )}
      {gaps.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No compliance gaps recorded yet.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {visible.map((gap) => (
              <li key={gap.id} className={`rounded-xl border px-4 py-3 transition-opacity ${gap.isResolved ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${gap.isResolved ? "line-through text-slate-400" : "text-slate-900"}`}>{gap.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${GAP_SEVERITY_STYLE[gap.severity] ?? GAP_SEVERITY_STYLE.LOW}`}>
                        {gap.severity}
                      </span>
                      {gap.isResolved && <span className="text-[10px] font-medium text-green-600 uppercase tracking-wide">Resolved</span>}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">
                      {gap.description.length > 160 ? `${gap.description.slice(0, 160)}…` : gap.description}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleResolved(gap)}
                    disabled={toggling === gap.id}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                      gap.isResolved
                        ? "border-slate-200 text-slate-500 hover:bg-slate-50"
                        : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                    }`}
                  >
                    {toggling === gap.id ? "…" : gap.isResolved ? "Reopen" : "Resolve"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {usePagination ? (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500">
                Page {clampedPage + 1} of {totalPages} · {gaps.length} gaps
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          ) : gaps.length > 5 && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-3 text-xs text-blue-600 hover:underline"
            >
              {showAll ? "Show less" : `Show all ${gaps.length} gaps`}
            </button>
          )}
        </>
      )}
    </div>
  );
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
  const [submittingReviewDocId, setSubmittingReviewDocId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [togglingMatchId, setTogglingMatchId] = useState<string | null>(null);
  const [batchApproving, setBatchApproving] = useState(false);
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);
  const [regeneratingCvs, setRegeneratingCvs] = useState(false);
  const [deepReasoningReport, setDeepReasoningReport] = useState<{ markdown: string; createdAt: string } | null>(null);
  const [loadingDeepReasoning, setLoadingDeepReasoning] = useState(false);
  const [deepReasoningOpen, setDeepReasoningOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileQueue, setFileQueue] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<{
    ai: boolean;
    fallback: boolean;
    jobId: string | null;
    chunks: { total: number; completed: number; failed: number; skipped: number; isPartial: boolean } | null;
    code: string | null;
    nextAction: string | null;
    extractionWarnings: string[] | null;
    providerDiagnostics: {
      providersCoolingDown: string[];
      perProvider: Array<{ provider: string; configured: boolean; coolingDown: boolean; lastErrorCategory: string | null; cooldownUntil: string | null }>;
    } | null;
  } | null>(null);
  const [approvingFallback, setApprovingFallback] = useState(false);
  const [fallbackNote, setFallbackNote] = useState("");
  const [continueJobId, setContinueJobId] = useState<string | null>(null);
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
      setAnalyzeResult({
        ai: data.ai,
        fallback: data.fallback,
        jobId: data.jobId ?? null,
        chunks: data.chunks ?? null,
        code: data.code ?? null,
        nextAction: data.nextAction ?? null,
        extractionWarnings: Array.isArray(data.extractionWarnings) ? data.extractionWarnings : null,
        providerDiagnostics: data.providerDiagnostics ?? null,
      });
      if (data.jobId) setContinueJobId(data.jobId);
      router.refresh();
    } catch { setError("Analysis failed"); }
    finally { setAnalyzing(false); }
  }

  async function handleContinueAnalysis() {
    if (!continueJobId) return;
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/ai-analyze?continue=${continueJobId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Continue analysis failed"); return; }
      setAnalyzeResult({
        ai: data.ai,
        fallback: data.fallback,
        jobId: data.jobId ?? null,
        chunks: data.chunks ?? null,
        code: data.code ?? null,
        nextAction: data.nextAction ?? null,
        extractionWarnings: Array.isArray(data.extractionWarnings) ? data.extractionWarnings : null,
        providerDiagnostics: data.providerDiagnostics ?? null,
      });
      if (data.jobId) setContinueJobId(data.jobId);
      if (data.tender) setTender((cur) => ({ ...cur, ...data.tender }));
      router.refresh();
    } catch { setError("Continue analysis failed"); }
    finally { setAnalyzing(false); }
  }

  async function handleApproveFallback() {
    setApprovingFallback(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tender.id}/approve-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: fallbackNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Approval failed"); return; }
      setAnalyzeResult((prev) => prev ? { ...prev, fallback: false } : null);
      setFallbackNote("");
      router.refresh();
    } catch { setError("Approval failed"); }
    finally { setApprovingFallback(false); }
  }

  async function handleAIProposal() {
    setGenerating(true);
    setError("");
    // 3-call chunked generation — each call generates one section group in its
    // own 60s Vercel function window, using 2× larger token budgets than the
    // single-call path. Total output: ~22K tokens vs ~10.4K single-call.
    const CHUNK_PHASES = [
      { label: "Generating cover letter and company profile… (1/3)", pct: 20 },
      { label: "Generating technical approach… (2/3)", pct: 60 },
      { label: "Finalizing compliance and declaration… (3/3)", pct: 90 },
    ];
    const chunks: string[] = [];
    try {
      for (let chunk = 1; chunk <= 3; chunk++) {
        setGenerationPhase(CHUNK_PHASES[chunk - 1].label);
        setGenerationProgress(CHUNK_PHASES[chunk - 1].pct);
        // On the final chunk, send accumulated content from chunks 1+2 so
        // the server can persist the full merged proposal to the database
        // (chunk 3 alone only covers the additional-and-declaration section).
        const body: Record<string, unknown> = { chunk };
        if (chunk === 3 && chunks.length >= 2) body.accumulatedProposal = chunks.join("\n\n");
        const res = await fetch(`/api/tenders/${tender.id}/ai-proposal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.status === 429) {
          setError(data.error || "Rate limit — please wait 30–60 seconds and try again.");
          return;
        }
        if (!res.ok) { setError(data.error || "Generation failed"); return; }
        chunks.push(data.proposal || "");
        // Show partial result after each chunk so the user sees progress.
        setAiProposal(chunks.join("\n\n"));
      }
      setGenerationProgress(100);
      const full = chunks.join("\n\n");
      setAiProposal(full);
      setForm((cur) => ({ ...cur, intakeSummary: full || cur.intakeSummary }));
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
  const progressCreepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function startGenerationProgress() {
    const durations = [6000, 14000, 35000, 10000, 5000];
    let cumulative = 0;
    GENERATION_PHASES.forEach((phase, i) => {
      const delay = cumulative;
      setTimeout(() => {
        setGenerationPhase(phase.label);
        setGenerationProgress(phase.pct);
        // After the last timed phase, start creeping from 97 → 99 at 0.1%
        // per second so the bar stays alive during long AI generation calls
        // instead of freezing at 97% for up to 2 minutes.
        if (i === GENERATION_PHASES.length - 1) {
          if (progressCreepRef.current) clearInterval(progressCreepRef.current);
          progressCreepRef.current = setInterval(() => {
            setGenerationProgress((prev) => (prev < 99 ? Math.min(99, prev + 0.1) : prev));
          }, 1000);
        }
      }, delay);
      cumulative += durations[i];
    });
  }
  function stopGenerationProgress() {
    if (progressCreepRef.current) { clearInterval(progressCreepRef.current); progressCreepRef.current = null; }
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
      setToast({ message: "Bid outcome saved", type: "success" });
    } catch { setError("Network error saving bid outcome"); }
    finally { setSavingOutcome(false); }
  }

  async function submitReview(docId: string, reviewStatus: string) {
    setSubmittingReviewDocId(docId);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus, reviewNotes: reviewNote }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setToast({ message: d.error ?? "Failed to save review", type: "error" });
        return;
      }
      setToast({ message: `Review saved: ${reviewStatus.replace(/_/g, " ")}`, type: "success" });
      setReviewingDocId(null);
      setReviewNote("");
      const refreshed = await fetch(`/api/tenders/${tender.id}`);
      if (refreshed.ok) { setTender(await refreshed.json() as Tender); }
    } catch {
      setToast({ message: "Network error saving review", type: "error" });
    } finally {
      setSubmittingReviewDocId(null);
    }
  }

  async function toggleMatchSelection(matchId: string, matchType: "expert" | "project", currentSelected: boolean) {
    setTogglingMatchId(matchId);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected: !currentSelected }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setToast({ message: d.error ?? "Failed to update match selection", type: "error" });
        return;
      }
      const refreshed = await fetch(`/api/tenders/${tender.id}`);
      if (refreshed.ok) { setTender(await refreshed.json() as Tender); }
    } catch {
      setToast({ message: "Network error updating match selection", type: "error" });
    } finally {
      setTogglingMatchId(null);
    }
  }

  async function handleBatchApproveAll() {
    const pending = tender.generatedDocuments.filter((d) => d.reviewStatus !== "READY_FOR_EXPORT" && d.generationStatus === "GENERATED").length;
    if (pending === 0) { setToast({ message: "All generated documents are already ready for export.", type: "success" }); return; }
    setConfirmApproveAll(true);
  }

  async function executeBatchApproveAll() {
    setConfirmApproveAll(false);
    setBatchApproving(true);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/documents/bulk-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: "READY_FOR_EXPORT", skipAlreadyAtTarget: true, reviewNotes: "Batch approved by bid manager." }),
      });
      const data = await res.json().catch(() => ({})) as { updated?: number; error?: string };
      if (!res.ok) { setToast({ message: data.error ?? "Batch approval failed", type: "error" }); return; }
      setToast({ message: `${data.updated ?? 0} document(s) marked Ready for Export.`, type: "success" });
      const refreshed = await fetch(`/api/tenders/${tender.id}`);
      if (refreshed.ok) { setTender(await refreshed.json() as Tender); }
    } catch {
      setToast({ message: "Network error during batch approval", type: "error" });
    } finally {
      setBatchApproving(false);
    }
  }

  async function handleRegenerateCvs() {
    const cvCount = tender.generatedDocuments.filter((d) => d.documentType === "EXPERT_CV_PACKAGE" && d.generationStatus === "GENERATED").length;
    if (cvCount === 0) { setToast({ message: "No Expert CV documents found to regenerate.", type: "error" }); return; }
    if (!confirm(`Regenerate all ${cvCount} Expert CV document(s) to remove any trace artifacts? This overwrites the current CVs.`)) return;
    setRegeneratingCvs(true);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/regenerate-cvs`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as { regenerated?: number; skipped?: number; error?: string };
      if (!res.ok) { setToast({ message: data.error ?? "CV regeneration failed", type: "error" }); return; }
      setToast({ message: `${data.regenerated ?? 0} CV(s) regenerated, ${data.skipped ?? 0} skipped.`, type: "success" });
      const refreshed = await fetch(`/api/tenders/${tender.id}`);
      if (refreshed.ok) { setTender(await refreshed.json() as Tender); }
    } catch {
      setToast({ message: "Network error during CV regeneration", type: "error" });
    } finally {
      setRegeneratingCvs(false);
    }
  }

  async function handleLoadDeepReasoning() {
    if (deepReasoningOpen && deepReasoningReport) { setDeepReasoningOpen(false); return; }
    setDeepReasoningOpen(true);
    if (deepReasoningReport) return;
    setLoadingDeepReasoning(true);
    try {
      const res = await fetch(`/api/tenders/${tender.id}/deep-reasoning-summary`);
      const data = await res.json() as { available?: boolean; reason?: string; markdown?: string; createdAt?: string; error?: string };
      if (!res.ok) { setToast({ message: data.error ?? "Failed to load reasoning report", type: "error" }); setDeepReasoningOpen(false); return; }
      if (!data.available) { setToast({ message: data.reason ?? "No deep-reasoning run recorded yet.", type: "error" }); setDeepReasoningOpen(false); return; }
      setDeepReasoningReport({ markdown: data.markdown ?? "", createdAt: data.createdAt ?? "" });
    } catch {
      setToast({ message: "Network error loading reasoning report", type: "error" });
      setDeepReasoningOpen(false);
    } finally {
      setLoadingDeepReasoning(false);
    }
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
  const expertReqExists = tender.requirements.some((req) => normalizeRequirementType(req.requirementType) === "EXPERT");
  const projectReqExists = tender.requirements.some((req) => normalizeRequirementType(req.requirementType) === "PROJECT_EXPERIENCE");
  const selectedExpertCount = tender.expertMatches?.filter((m) => m.isSelected).length ?? 0;
  const selectedProjectCount = tender.projectMatches?.filter((m) => m.isSelected).length ?? 0;
  // If no matches have been found yet, generation is still allowed — generate-elite.ts
  // will fall back to the company vault and then to the deterministic proposal.
  // Only block when matches EXIST but none are selected (user forgot to select).
  const expertMatchesExist = (tender.expertMatches?.length ?? 0) > 0;
  const projectMatchesExist = (tender.projectMatches?.length ?? 0) > 0;
  const totalExpertMatches = tender.expertMatches?.length ?? 0;
  const totalProjectMatches = tender.projectMatches?.length ?? 0;
  const reviewedExpertMatches = tender.expertMatches?.filter((m) => m.expert?.trustLevel === "REVIEWED").length ?? 0;
  const reviewedProjectMatches = tender.projectMatches?.filter((m) => m.project?.trustLevel === "REVIEWED").length ?? 0;
  const hasRecoverableExpertSelection = reviewedExpertMatches > 0;
  const hasRecoverableProjectSelection = reviewedProjectMatches > 0;
  const hasReviewedExpertPath = !expertReqExists || selectedExpertCount === 0 || reviewedExpertMatches > 0;
  const hasReviewedProjectPath = !projectReqExists || selectedProjectCount === 0 || reviewedProjectMatches > 0;
  // Block generation when analysis came from regex fallback and has not
  // been explicitly approved — the orchestrator enforces this globally and
  // we mirror it here so the button is visually disabled immediately.
  // We must check BOTH the notes field AND whether a resolved
  // ANALYSIS_APPROVAL:REGEX_FALLBACK ComplianceGap exists — the approve-
  // analysis route stores approval as a ComplianceGap row, not in notes.
  const analysisSourceRaw = detectAnalysisSource(tender);
  const hasAnalysisApprovalGap = tender.complianceGaps.some(
    (g) => g.title === "ANALYSIS_APPROVAL:REGEX_FALLBACK" && g.isResolved === true,
  );
  const analysisIsFallbackUnapproved = analysisSourceRaw === "REGEX_FALLBACK_AI_ERROR" && !hasAnalysisApprovalGap;
  // Mirror the server-side generate gate: block when extraction is corrupted or
  // analysis ran on a weak/fallback extraction (client name check below is
  // separate — both must pass before enabling the button).
  const extractionCorrupted =
    tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
    tender.analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
  // Mirror hasRealClientName() from lib/engine/metadata-validators.ts
  const clientNameInvalid = getClientNameStatus(tender.clientName) !== "VALID";
  const metadataContaminatedBlock = tender.metadataContaminated === true;

  const canGenerateDocs = !analysisIsFallbackUnapproved
    && !extractionCorrupted
    && !clientNameInvalid
    && !metadataContaminatedBlock
    && tender.requirements.length > 0
    && (!expertReqExists || selectedExpertCount > 0 || !expertMatchesExist || hasRecoverableExpertSelection)
    && (!projectReqExists || selectedProjectCount > 0 || !projectMatchesExist || hasRecoverableProjectSelection)
    && hasReviewedExpertPath
    && hasReviewedProjectPath
    && !criticalHardBlockExists;
  const generateDisabledReason = extractionCorrupted
    ? "Extraction is corrupted or too weak — run OCR extraction or re-upload a clearer scan before generating"
    : metadataContaminatedBlock
      ? "Tender metadata is contaminated — review and correct the client name and critical fields before generating"
      : clientNameInvalid
        ? "Client/procuring entity name is missing or invalid — run AI Analyze or enter it manually before generating"
        : analysisIsFallbackUnapproved
          ? "Analysis used regex fallback — retry AI Analyze or approve the fallback before generating"
          : tender.requirements.length === 0
            ? "Run AI Analyze or Run Engine first to extract requirements"
            : (expertReqExists && selectedExpertCount === 0 && totalExpertMatches === 0)
              ? "Run Engine first to generate expert matches"
              : (projectReqExists && selectedProjectCount === 0 && totalProjectMatches === 0)
                ? "Run Engine first to generate project matches"
                : (expertReqExists && expertMatchesExist && selectedExpertCount === 0 && !hasRecoverableExpertSelection)
                  ? "Select at least one reviewed expert match before generating"
                  : (projectReqExists && projectMatchesExist && selectedProjectCount === 0 && !hasRecoverableProjectSelection)
                    ? "Select at least one reviewed project match before generating"
                    : (expertReqExists && selectedExpertCount > 0 && reviewedExpertMatches === 0)
                      ? "Review at least one selected expert before generating"
                      : (projectReqExists && selectedProjectCount > 0 && reviewedProjectMatches === 0)
                        ? "Review at least one selected project before generating"
                        : criticalHardBlockExists
                          ? "Resolve critical hard blockers before generating"
                          : "Generate proposal documents";

  // ZIP is only safe when there are generated documents. The canonical
  // export-readiness gate (Export Readiness panel) blocks the final ZIP
  // link — this simpler guard prevents the raw ZIP endpoint from being
  // called when no documents exist at all.
  const hasAnyGeneratedDoc = (tender.generatedDocuments?.length ?? 0) > 0;
  const zipDisabledReason = analysisIsFallbackUnapproved
    ? "Analysis source is unapproved regex fallback — approve or retry AI Analyze first"
    : !hasAnyGeneratedDoc
      ? "No generated documents yet — generate documents before downloading"
      : null;
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
  // Use the canonical client-name validator FIRST so a TOC-fragment
  // extraction (production-screenshot scenario where clientName captured
  // "references (where available) Photos or drawings of completed
  // projects C. Technical Approach...") never gets displayed as if it
  // were a real client. cleanClientName-only falls through to raw
  // tender.clientName when its own heuristic returns "Client", which is
  // what produced the bug.
  const clientStatus = getClientNameStatus(tender.clientName);
  const clientDisplay = clientNameDisplayMessage(tender.clientName);
  const displayClient = clientStatus === "VALID"
    ? cleanClientName(tender.clientName, tender.description)
    : null;
  const displayClientLine = displayClient && displayClient !== "Client" ? ` · ${displayClient}` : "";

  // Browser tab title badge — updates in real-time as gaps are resolved.
  // Critical gaps: 🚨 N critical — <title>
  // Unresolved gaps: (N) <title>
  // All clear: <title>
  // Restores "Tenders" on unmount so navigating back shows the list title.
  useEffect(() => {
    const shortTitle = (tender.title ?? "Tender").slice(0, 50);
    if (criticalGaps > 0) {
      document.title = `🚨 ${criticalGaps} critical — ${shortTitle}`;
    } else if (unresolvedGaps > 0) {
      document.title = `(${unresolvedGaps}) ${shortTitle}`;
    } else {
      document.title = shortTitle;
    }
    return () => { document.title = "Tenders"; };
  }, [criticalGaps, unresolvedGaps, tender.title]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{displayTitle}</h1>
            <StatusBadge status={tender.status} />
            {tender.stage && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                {tender.stage.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {tender.reference ? `Ref ${tender.reference}` : "No reference yet"}
            {displayClientLine}
          </p>
        </div>

        <div id="ai-analyze-section" className="flex flex-wrap gap-2">
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
            disabled={!!zipDisabledReason}
            title={zipDisabledReason ?? "Download the final ZIP package"}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">
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

      {/* Client name missing OR garbage — proposals will use "The Client" as a placeholder.
          Pre-fix: this only said "Client name not set", which was misleading when the
          extraction had captured TOC/section noise (e.g. "references (where available)
          Photos or drawings..."). Now the warning text + colour reflect the canonical
          getClientNameStatus so users know whether to FILL IN the field or RE-EXTRACT
          / CORRECT what was captured. */}
      {clientStatus !== "VALID" && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${clientStatus === "GARBAGE" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {clientStatus === "GARBAGE" ? (
            <>
              <span className="font-medium">Invalid client name extracted.</span>{" "}
              The extraction captured a section heading or table-of-contents fragment, not a real procuring entity. Re-run metadata extraction or edit the tender and correct the Client Name field before generating documents.
            </>
          ) : (
            <>
              <span className="font-medium">Client name not set.</span>{" "}
              Generated proposals will use &ldquo;The Client&rdquo; as a placeholder. Edit the tender and fill in the Client Name field before generating documents.
            </>
          )}
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
            <button onClick={() => setError("")} aria-label="Dismiss error" className="shrink-0 text-red-400 hover:text-red-600 text-xs">✕</button>
          </div>
        </div>
      )}

      {/* Persistent fallback-approval banner — shown whenever the stored
          analysis came from regex fallback and has not been approved. This
          lets the user approve without needing to re-run AI Analyze. */}
      {analysisIsFallbackUnapproved && !analyzeResult?.fallback && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-800">Analysis used regex fallback — AI providers were unavailable.</p>
          <p className="mt-1 text-xs text-amber-700">Document generation is blocked until you either retry AI Analyze (recommended) or approve the fallback analysis with a note.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {aiEnabled && (
              <button
                onClick={handleAIAnalyze}
                disabled={analyzing}
                className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {analyzing ? "Analyzing…" : "✦ Retry AI Analyze"}
              </button>
            )}
            <div className="flex flex-1 min-w-0 gap-1">
              <input
                type="text"
                value={fallbackNote}
                onChange={(e) => setFallbackNote(e.target.value)}
                placeholder="Approval note (required)…"
                className="flex-1 min-w-0 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                maxLength={200}
              />
              <button
                onClick={handleApproveFallback}
                disabled={approvingFallback || !fallbackNote.trim()}
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 shrink-0"
              >
                {approvingFallback ? "Approving…" : "Approve Fallback"}
              </button>
            </div>
          </div>
        </div>
      )}

      {analyzeResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${analyzeResult.fallback ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">Analysis complete</span>
                {analyzeResult.ai && !analyzeResult.chunks?.isPartial && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">AI</span>
                )}
                {analyzeResult.chunks?.isPartial && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Partial AI</span>
                )}
                {analyzeResult.fallback && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Regex Fallback</span>
                )}
              </div>
              {analyzeResult.chunks && (
                <p className="mt-1 text-xs text-slate-600">
                  Chunks: {analyzeResult.chunks.completed}/{analyzeResult.chunks.total} completed
                  {analyzeResult.chunks.failed > 0 && `, ${analyzeResult.chunks.failed} failed`}
                  {analyzeResult.chunks.skipped > 0 && `, ${analyzeResult.chunks.skipped} skipped (deadline)`}
                </p>
              )}
              {analyzeResult.fallback && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-amber-700">AI providers unavailable — regex fallback used. Approve the fallback to unblock document generation, or retry AI Analyze when providers recover.</p>
                  {analyzeResult.providerDiagnostics && (() => {
                    const configured = analyzeResult.providerDiagnostics.perProvider.filter((p) => p.configured);
                    const notConfigured = analyzeResult.providerDiagnostics.perProvider.filter((p) => !p.configured);
                    const cooling = configured.filter((p) => p.coolingDown);
                    if (configured.length === 0 && notConfigured.length > 0) {
                      return <p className="text-xs text-red-700 font-medium">No AI providers configured. Set OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY in Vercel environment variables.</p>;
                    }
                    return (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-amber-700 hover:underline">Provider diagnostics ({cooling.length} cooling down)</summary>
                        <ul className="mt-1 space-y-0.5 pl-2">
                          {configured.map((p) => (
                            <li key={p.provider} className={p.coolingDown ? "text-red-700" : "text-slate-600"}>
                              <span className="font-medium capitalize">{p.provider}</span>:
                              {p.coolingDown ? ` Rate-limited (${p.lastErrorCategory ?? "error"}) — cooling down until ${p.cooldownUntil ? new Date(p.cooldownUntil).toLocaleTimeString() : "?"}` : ` OK (last error: ${p.lastErrorCategory ?? "none"})`}
                            </li>
                          ))}
                          {notConfigured.length > 0 && (
                            <li className="text-slate-400">Not configured: {notConfigured.map((p) => p.provider).join(", ")}</li>
                          )}
                        </ul>
                      </details>
                    );
                  })()}
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      value={fallbackNote}
                      onChange={(e) => setFallbackNote(e.target.value)}
                      placeholder="Optional approval note…"
                      className="flex-1 min-w-0 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                      maxLength={200}
                    />
                    <button
                      onClick={handleApproveFallback}
                      disabled={approvingFallback}
                      className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 shrink-0"
                    >
                      {approvingFallback ? "Approving…" : "Approve Fallback"}
                    </button>
                  </div>
                </div>
              )}
              {analyzeResult.chunks?.isPartial && !analyzeResult.fallback && (
                <div className="mt-2">
                  <button
                    onClick={handleContinueAnalysis}
                    disabled={analyzing}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {analyzing ? "Continuing…" : "Continue Analysis"}
                  </button>
                </div>
              )}
              {analyzeResult.nextAction && (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-medium">Next:</span> {analyzeResult.nextAction.replace(/_/g, " ").toLowerCase()}
                </p>
              )}
              {analyzeResult.extractionWarnings && analyzeResult.extractionWarnings.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-amber-700 hover:underline">
                    {analyzeResult.extractionWarnings.length} extraction warning(s)
                  </summary>
                  <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 space-y-0.5">
                    {analyzeResult.extractionWarnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
            <button onClick={() => setAnalyzeResult(null)} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-600 text-xs">✕</button>
          </div>
        </div>
      )}

      {/* Canonical readiness score (PR audit gates) — replaces the
          misleading "100% readiness" tile when caps apply. The legacy
          DB-stored readiness tile below is retained but is now
          relabelled "Workflow status" so it isn't confused with the
          actual export-readiness score. */}
      {/* Tender Recovery Command Center — single source of truth for
          lifecycle state, primary next action, and global action gating.
          Must appear before all other panels so the user sees one clear
          next action even when multiple panels are visible. */}
      <TenderRecoveryCommandCenter tenderId={tender.id} />

      <CanonicalReadinessScoreWidget tenderId={tender.id} />

      {/* Submission Plan Completeness — answers the "Docs 6/19" question
          by listing every required file with its status and the
          recommended next action. */}
      <SubmissionPlanCompletenessPanel tenderId={tender.id} />

      <RequirementCoveragePanel tenderId={tender.id} />

      <TenderControlsPanel tenderId={tender.id} />

      <ScoreBreakdownPanel tenderId={tender.id} />

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
        <div className="rounded-2xl border bg-white p-5 shadow-sm" title="Workflow progress only — derived from requirements vs critical gaps. NOT the export-readiness score. See the Canonical Readiness Score panel above for the gated number used by the gates and the ZIP route.">
          <p className="text-sm text-slate-500">Workflow status</p>
          <p className={`mt-1 text-3xl font-bold ${readinessScore >= 80 ? "text-green-600" : readinessScore >= 50 ? "text-amber-500" : "text-red-500"}`}>
            {readinessScore}%
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${readinessScore >= 80 ? "bg-green-500" : readinessScore >= 50 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${readinessScore}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Workflow progress only — see canonical score above.</p>
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
          <div id="tender-edit-form" className="rounded-2xl border bg-white p-6 shadow-sm">
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
                <div>
                  <dt className="text-sm text-slate-500">Client</dt>
                  <dd className={`mt-1 font-medium ${clientStatus === "GARBAGE" ? "text-red-700" : "text-slate-900"}`}>
                    {clientStatus === "VALID" && displayClient && displayClient !== "Client"
                      ? displayClient
                      : clientStatus === "GARBAGE"
                        ? clientDisplay.text
                        : "—"}
                    {tender.clientNameSourcePage && (
                      <span className="ml-2 text-xs text-slate-400 font-normal">(p.{tender.clientNameSourcePage})</span>
                    )}
                    {tender.metadataContaminated && (
                      <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">⚠ Contaminated</span>
                    )}
                  </dd>
                  {tender.clientNameSourceQuote && (
                    <p className="mt-0.5 text-xs text-slate-400 italic line-clamp-2">&ldquo;{tender.clientNameSourceQuote}&rdquo;</p>
                  )}
                  {(tender.procuringEntityName || tender.legalClientName || tender.donorAgency || tender.implementingAgency) && (
                    <dl className="mt-1 space-y-0.5 text-xs">
                      {tender.procuringEntityName && (
                        <div><span className="text-slate-400">Procuring entity: </span><span className="text-slate-700">{tender.procuringEntityName}</span></div>
                      )}
                      {tender.legalClientName && (
                        <div><span className="text-slate-400">Legal name: </span><span className="text-slate-700">{tender.legalClientName}</span></div>
                      )}
                      {tender.donorAgency && (
                        <div><span className="text-slate-400">Donor/funder: </span><span className="text-slate-700">{tender.donorAgency}</span></div>
                      )}
                      {tender.implementingAgency && (
                        <div><span className="text-slate-400">Implementing agency: </span><span className="text-slate-700">{tender.implementingAgency}</span></div>
                      )}
                    </dl>
                  )}
                </div>
                {(() => {
                  const src: Record<string, { page: number | null; quote: string | null }> = (() => {
                    try { return tender.contactDetailsSourceJson ? JSON.parse(tender.contactDetailsSourceJson) : {}; } catch { return {}; }
                  })();
                  const contactRows: Array<{ label: string; key: string; value: string | null | undefined }> = [
                    { label: "Country", key: "country", value: tender.country },
                    { label: "City / location", key: "clientCity", value: tender.clientCity },
                    { label: "Client address", key: "clientAddress", value: tender.clientAddress },
                    { label: "Client website / portal", key: "clientWebsite", value: tender.clientWebsite },
                    { label: "Submission address", key: "submissionAddress", value: tender.submissionAddress },
                    { label: "Submission email(s)", key: "submissionEmails", value: tender.submissionEmails },
                    { label: "Submission email subject", key: "submissionEmailSubject", value: tender.submissionEmailSubject },
                    { label: "Pre-bid channel", key: "preBidChannel", value: tender.preBidChannel },
                    { label: "Contact person", key: "clientContactName", value: tender.clientContactName },
                    { label: "Contact title", key: "clientContactTitle", value: tender.clientContactTitle },
                    { label: "Contact email", key: "clientContactEmail", value: tender.clientContactEmail },
                    { label: "Contact phone", key: "clientContactPhone", value: tender.clientContactPhone },
                    { label: "Client representative", key: "clientRepresentative", value: tender.clientRepresentative },
                  ];
                  const populated = contactRows.filter((r) => r.value);
                  // Show MISSING_SOURCE for null fields only after AI Analyze has run
                  // (indicated by an analysis summary or any populated contact field).
                  const aiHasRun = !!tender.analysisSummary || populated.length > 0;
                  const rowsToShow = aiHasRun ? contactRows : populated;
                  if (!rowsToShow.length) return null;
                  return (
                    <div className="md:col-span-2">
                      <dt className="text-sm font-medium text-slate-700 mb-2">Contact &amp; location details</dt>
                      <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                        {rowsToShow.map(({ label, key, value }) => {
                          const s = src[key];
                          const missing = !value;
                          return (
                            <div key={key}>
                              <dt className="text-xs text-slate-400">{label}</dt>
                              {missing ? (
                                <dd className="text-sm font-medium text-amber-700 italic">MISSING_SOURCE — not found in tender document</dd>
                              ) : (
                                <>
                                  <dd className="text-sm font-medium text-slate-900">
                                    {value}
                                    {s?.page && <span className="ml-1.5 text-xs text-slate-400 font-normal">(p.{s.page})</span>}
                                  </dd>
                                  {s?.quote && <p className="mt-0.5 text-xs text-slate-400 italic line-clamp-2">&ldquo;{s.quote}&rdquo;</p>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  );
                })()}
                <div><dt className="text-sm text-slate-500">Deadline</dt><dd className="mt-1 font-medium text-slate-900">{formatDate(tender.deadline)}</dd></div>
                <div><dt className="text-sm text-slate-500">Category</dt><dd className="mt-1 font-medium text-slate-900">{tender.category}</dd></div>
                <div>
                  <dt className="text-sm text-slate-500">Submission Method</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {tender.submissionMethod || "—"}
                    {tender.submissionMethodSourcePage && <span className="ml-2 text-xs text-slate-400 font-normal">(p.{tender.submissionMethodSourcePage})</span>}
                    {tender.submissionMethodSourceQuote && <p className="mt-0.5 text-xs text-slate-400 italic line-clamp-2">&ldquo;{tender.submissionMethodSourceQuote}&rdquo;</p>}
                  </dd>
                </div>
                {(tender.submissionAddress || tender.submissionAddressSourcePage) && (
                  <div className="md:col-span-2">
                    <dt className="text-sm text-slate-500">Submission Address / Portal</dt>
                    <dd className="mt-1 font-medium text-slate-900">
                      {tender.submissionAddress || "—"}
                      {tender.submissionAddressSourcePage && <span className="ml-2 text-xs text-slate-400 font-normal">(p.{tender.submissionAddressSourcePage})</span>}
                      {tender.submissionAddressSourceQuote && <p className="mt-0.5 text-xs text-slate-400 italic line-clamp-2">&ldquo;{tender.submissionAddressSourceQuote}&rdquo;</p>}
                    </dd>
                  </div>
                )}
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

          <div id="tender-files" className="rounded-2xl border bg-white p-6 shadow-sm">
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
                          <ExtractionBadge extractedTextLength={file.extractedTextLength} isScannedPlaceholder={file.isScannedPlaceholder} />
                        </div>
                        {file.isScannedPlaceholder && (
                          <p className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                            ⚠ Scanned PDF — no text layer found. Run OCR or upload a text-based version for AI analysis.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDownloadFile(file.id, file.originalFileName)}
                          aria-label={`Download ${file.originalFileName}`}
                          className="rounded border px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          aria-label={`Delete ${file.originalFileName}`}
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

          <ComplianceGapsPanel tenderId={tender.id} initialGaps={tender.complianceGaps} />

          {(tender.expertMatches?.length ?? 0) > 0 && (
            <div id="expert-matches" className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-slate-900">
                  Expert Matches
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    ({tender.expertMatches!.filter((m) => m.isSelected).length} selected · {reviewedExpertMatches} reviewed)
                  </span>
                </h2>
                {reviewedExpertMatches === 0 && tender.expertMatches!.length > 0 && (
                  <a
                    href="/dashboard/company/review"
                    className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review experts to unblock generation →
                  </a>
                )}
              </div>
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
                        <button
                          onClick={() => toggleMatchSelection(match.id, "expert", match.isSelected)}
                          disabled={togglingMatchId === match.id}
                          className={`mt-1.5 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${match.isSelected ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-green-100 text-green-700 hover:bg-green-200"} disabled:opacity-50`}
                        >
                          {togglingMatchId === match.id ? "…" : match.isSelected ? "Deselect" : "Select"}
                        </button>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(tender.projectMatches?.length ?? 0) > 0 && (
            <div id="project-matches" className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-slate-900">
                  Project Matches
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    ({tender.projectMatches!.filter((m) => m.isSelected).length} selected · {reviewedProjectMatches} reviewed)
                  </span>
                </h2>
                {reviewedProjectMatches === 0 && tender.projectMatches!.length > 0 && (
                  <a
                    href="/dashboard/company/review"
                    className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review projects to unblock generation →
                  </a>
                )}
              </div>
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
                        <button
                          onClick={() => toggleMatchSelection(match.id, "project", match.isSelected)}
                          disabled={togglingMatchId === match.id}
                          className={`mt-1.5 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${match.isSelected ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-blue-100 text-blue-700 hover:bg-blue-200"} disabled:opacity-50`}
                        >
                          {togglingMatchId === match.id ? "…" : match.isSelected ? "Deselect" : "Select"}
                        </button>
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

          <div id="generated-documents" className="rounded-2xl border bg-white p-6 shadow-sm">
            {confirmApproveAll && (
              <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-emerald-800 font-medium">Mark all generated documents as Ready for Export?</span>
                <button
                  onClick={() => void executeBatchApproveAll()}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmApproveAll(false)}
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Generated outputs</h2>
              <div className="flex items-center gap-2">
                {tender.generatedDocuments.some((d) => d.generationStatus === "GENERATED" && d.reviewStatus !== "READY_FOR_EXPORT") && (
                  <button
                    onClick={() => void handleBatchApproveAll()}
                    disabled={batchApproving || confirmApproveAll}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    title="Mark all generated documents as Ready for Export in one action"
                  >
                    {batchApproving ? "Approving…" : "✓ Approve All"}
                  </button>
                )}
                {tender.generatedDocuments.some((d) => d.documentType === "EXPERT_CV_PACKAGE" && d.generationStatus === "GENERATED") && (
                  <button
                    onClick={() => void handleRegenerateCvs()}
                    disabled={regeneratingCvs}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Regenerate Expert CV documents to remove any trace artifacts"
                  >
                    {regeneratingCvs ? "Regenerating…" : "↻ Regen CVs"}
                  </button>
                )}
                <button onClick={() => void handleLoadDeepReasoning()} disabled={loadingDeepReasoning} className="text-xs text-purple-600 hover:underline disabled:opacity-50">
                  {loadingDeepReasoning ? "Loading…" : deepReasoningOpen ? "▲ AI Reasoning" : "▼ AI Reasoning"}
                </button>
                <button onClick={() => downloadDoc("compliance")} className="text-xs text-blue-600 hover:underline">↓ Compliance Report</button>
              </div>
            </div>
            {deepReasoningOpen && deepReasoningReport && (
              <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">AI Reasoning Report</p>
                  <p className="text-[10px] text-purple-500">{deepReasoningReport.createdAt ? new Date(deepReasoningReport.createdAt).toLocaleString() : ""}</p>
                </div>
                <pre className="whitespace-pre-wrap text-xs text-purple-900 font-mono leading-relaxed max-h-64 overflow-y-auto">{deepReasoningReport.markdown}</pre>
              </div>
            )}
            {tender.generatedDocuments.length === 0 ? (
              <p className="text-sm text-slate-400">Run the engine then click &quot;Generate Docs&quot; to create submission-ready files.</p>
            ) : (
              <ul className="space-y-2">
                {tender.generatedDocuments.map((doc) => (
                  <li key={doc.id} className="rounded-xl border px-3 py-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.exactFileName ?? doc.name}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          <span className={`text-xs font-medium ${
                            doc.generationStatus === "GENERATED" ? "text-green-600" :
                            doc.generationStatus === "GENERATED_NEEDS_REVIEW" ? "text-amber-600" :
                            doc.generationStatus === "GENERATED_QUALITY_FAILED" ? "text-red-600" :
                            doc.generationStatus === "REPLACE_WITH_ORIGINAL" ? "text-orange-600" :
                            doc.generationStatus === "SUPERSEDED" ? "text-slate-300" :
                            doc.generationStatus === "PLANNED" ? "text-blue-500" :
                            "text-slate-400"
                          }`}>
                            {doc.generationStatus === "GENERATED" ? "Generated" :
                             doc.generationStatus === "GENERATED_NEEDS_REVIEW" ? "Needs review" :
                             doc.generationStatus === "GENERATED_QUALITY_FAILED" ? "Quality failed" :
                             doc.generationStatus === "REPLACE_WITH_ORIGINAL" ? "Needs official original" :
                             doc.generationStatus === "SUPERSEDED" ? "Superseded" :
                             doc.generationStatus === "PLANNED" ? "Planned (not generated)" :
                             doc.generationStatus}
                          </span>
                          {doc.validationStatus && doc.validationStatus !== "PENDING" && (
                            <span className={`text-xs ${doc.validationStatus === "PASSED" ? "text-green-600" : "text-red-500"}`}>
                              · {doc.validationStatus}
                            </span>
                          )}
                          {doc.reviewStatus && doc.reviewStatus !== "PENDING" && (
                            <span className={`text-xs font-medium ${
                              doc.reviewStatus === "READY_FOR_EXPORT" ? "text-emerald-700" :
                              doc.reviewStatus === "APPROVED" ? "text-green-700" :
                              doc.reviewStatus === "REJECTED" ? "text-red-600" :
                              "text-amber-600"
                            }`}>
                              · {doc.reviewStatus === "READY_FOR_EXPORT" ? "Export ready" : doc.reviewStatus}
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
                        {((doc.reviewedExpertCount ?? 0) > 0 || (doc.reviewedProjectCount ?? 0) > 0 || (doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(doc.reviewedExpertCount ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{doc.reviewedExpertCount} expert{doc.reviewedExpertCount !== 1 ? "s" : ""} reviewed</span>
                            )}
                            {(doc.draftExpertCount ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{doc.draftExpertCount} expert draft{doc.draftExpertCount !== 1 ? "s" : ""}</span>
                            )}
                            {(doc.reviewedProjectCount ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{doc.reviewedProjectCount} project{doc.reviewedProjectCount !== 1 ? "s" : ""} reviewed</span>
                            )}
                            {(doc.draftProjectCount ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{doc.draftProjectCount} project draft{doc.draftProjectCount !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                        )}
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
                            aria-label={`Regenerate ${doc.name}`}
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
                          <button onClick={() => downloadDocById(doc.id)} aria-label={`Download ${doc.name}`} className="text-xs text-blue-600 hover:underline">↓</button>
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
                          <button onClick={() => { void submitReview(doc.id, "APPROVED"); }} disabled={submittingReviewDocId === doc.id} className="rounded bg-green-600 px-2.5 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50">{submittingReviewDocId === doc.id ? "Saving…" : "Approve"}</button>
                          <button onClick={() => { void submitReview(doc.id, "NEEDS_REVISION"); }} disabled={submittingReviewDocId === doc.id} className="rounded bg-amber-500 px-2.5 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50">Needs Revision</button>
                          <button onClick={() => { void submitReview(doc.id, "REJECTED"); }} disabled={submittingReviewDocId === doc.id} className="rounded bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
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
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-lg font-semibold ${validationReport.passed ? "text-green-800" : "text-red-800"}`}>
              {validationReport.passed ? "✓ Validation Passed — Ready for Export" : "✗ Validation Failed"}
            </h2>
            <button onClick={() => setValidationReport(null)} className="text-sm text-slate-400 hover:text-slate-600">Dismiss</button>
          </div>
          {/* ── Blocking issues ───────────────────────────────────────────── */}
          {validationReport.issues.filter((i) => i.severity === "BLOCK").length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                Blockers ({validationReport.issues.filter((i) => i.severity === "BLOCK").length})
              </p>
              <ul className="space-y-1.5">
                {validationReport.issues.filter((i) => i.severity === "BLOCK").map((issue) => (
                  <li key={issue.code} className="rounded-lg border border-red-200 bg-red-100 px-3 py-2 text-sm text-red-800">
                    <span className="font-medium">✗ </span>{issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* ── Warnings ──────────────────────────────────────────────────── */}
          {validationReport.issues.filter((i) => i.severity !== "BLOCK").length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Warnings ({validationReport.issues.filter((i) => i.severity !== "BLOCK").length})
              </p>
              <ul className="space-y-1.5">
                {validationReport.issues.filter((i) => i.severity !== "BLOCK").map((issue) => (
                  <li key={issue.code} className="rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-sm text-amber-800">
                    <span className="font-medium">⚠ </span>{issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* ── Passed checks ─────────────────────────────────────────────── */}
          {validationReport.passed && validationReport.issues.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm text-green-800">
              ✓ All checks passed. This tender package is ready for export.
            </div>
          )}
          {validationReport.passed && validationReport.issues.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm text-green-700">
              ✓ No blocking issues — {validationReport.issues.length} advisory warning(s) only.
            </div>
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
          <button onClick={() => setToast(null)} aria-label="Dismiss notification" className="ml-1 opacity-70 hover:opacity-100">✕</button>
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
