// lib/engine/source-driven-tender-text-parser.ts
//
// Generic, source-driven tender intelligence parser.
//
// The tender document is the authority. This module reads the FULL extracted
// tender content (active TenderFile.extractedText, intakeSummary,
// analysisSummary, description, evaluationMethodology) and derives a complete
// TenderDocumentIntelligence object that drives document generation.
//
// It does NOT depend on predesigned metadata formats or stale scalar fields.
// Scalar fields are used ONLY as fallback when the source text lacks a fact.
//
// Supported tender types: EOI, RFP, RFQ, Request for Technical Proposal,
// Invitation for Bid, Prequalification, Vendor/Supplier Registration,
// Framework Agreement, Technical-only, Financial-only, Technical+financial,
// Single-envelope, Two-envelope.
//
// Supported submission methods: Email, Portal, Physical, Hybrid.
//
// Supported HAEC work streams: architectural design, engineering design,
// urban planning, supervision, consultancy, geotechnical investigation,
// soil investigation, interior design, contract administration,
// project management, construction management, feasibility study,
// environmental/social study, road/infrastructure consultancy,
// water/sanitation consultancy, building consultancy.
//
// All tenders handled by Hope Urban Planning Architectural and Engineering
// Consultancy (HAEC) are supported — not just the Pharo regression fixture.

// ─── Types ───────────────────────────────────────────────────────────────────

export type TenderType =
  | "Expression of Interest"
  | "Request for Proposal"
  | "Request for Technical Proposal"
  | "Request for Quotation"
  | "Invitation for Bid"
  | "Prequalification"
  | "Vendor Registration"
  | "Supplier Registration"
  | "Framework Agreement"
  | "Technical Proposal Only"
  | "Financial Proposal Only"
  | "Technical and Financial Proposal"
  | "Single Envelope"
  | "Two Envelope"
  | "Unknown";

export type SubmissionMethod = "Email" | "Portal" | "Physical" | "Hybrid" | "Unknown";

export type ServiceStream =
  | "architectural design"
  | "engineering design"
  | "urban planning"
  | "supervision"
  | "consultancy"
  | "geotechnical investigation"
  | "soil investigation"
  | "interior design"
  | "contract administration"
  | "project management"
  | "construction management"
  | "feasibility study"
  | "environmental study"
  | "social study"
  | "road consultancy"
  | "infrastructure consultancy"
  | "water consultancy"
  | "sanitation consultancy"
  | "building consultancy";

export type SubmissionInstructionSet = {
  method: SubmissionMethod;
  format: string | null;
  deadlineDisplay: string | null;
  deadlineIso: string | null;
  emails: string[];
  emailSubject: string | null;
  portalUrl: string | null;
  physicalAddress: string | null;
  physicalSubmissionRequired: boolean;
  portalSubmissionRequired: boolean;
  note: string | null;
};

export type RequiredTenderDocument = {
  name: string;
  required: boolean;
  envelope: "technical" | "financial" | "common" | "unknown";
  note?: string | null;
  /**
   * Verbatim clause the obligation was read from. Present for documents the
   * source named itself (which have no catalogue entry to describe them), so
   * an unrecognised requirement still carries its own evidence.
   */
  sourceQuote?: string | null;
};

export type TenderCriterion = {
  category: string;
  text: string;
  weight?: number | null;
  mandatory: boolean;
};

export type TenderEvaluationMethodology = {
  technicalWeight: number | null;
  financialWeight: number | null;
  methodology: string | null;
  passFail: boolean;
};

export type RequiredExpert = {
  role: string;
  count: number;
  qualifications: string[];
  note?: string | null;
};

export type RequiredProjectReference = {
  count: number;
  similarTo: string | null;
  note: string | null;
};

export type RequiredLegalDocument = {
  name: string;
  required: boolean;
  note: string | null;
};

export type RequiredFinancialDocument = {
  name: string;
  required: boolean;
  note: string | null;
};

export type TenderFormOrAnnex = {
  name: string;
  mandatory: boolean;
  note: string | null;
};

export type TenderGenerationPlan = {
  generate: string[];
  exclude: string[];
  notes: string[];
};

export type TenderDocumentIntelligence = {
  tenderType: TenderType;
  serviceStreams: ServiceStream[];
  projectTitle: string | null;
  clientOrProcuringEntity: string | null;
  submissionInstructions: SubmissionInstructionSet;
  requiredDocuments: RequiredTenderDocument[];
  eligibilityCriteria: TenderCriterion[];
  technicalCriteria: TenderCriterion[];
  financialCriteria: TenderCriterion[];
  evaluationMethodology: TenderEvaluationMethodology | null;
  scopeOfServices: string[];
  deliverables: string[];
  requiredExperts: RequiredExpert[];
  requiredProjectReferences: RequiredProjectReference[];
  requiredLegalDocuments: RequiredLegalDocument[];
  requiredFinancialDocuments: RequiredFinancialDocument[];
  formsAndAnnexes: TenderFormOrAnnex[];
  generationPlan: TenderGenerationPlan;
  financialProposalRequired: boolean;
  /**
   * Three-state source answer: true / false / null (source silent).
   * `financialProposalRequired` above is `state === true`, kept so existing
   * consumers are unchanged; anything that must distinguish "the source said
   * no" from "the source said nothing" reads this.
   */
  financialProposalRequiredState: boolean | null;
  proposalValidity: string | null;
  budget: string | null;
  bidBond: string | null;
  mandatorySiteVisit: boolean;
  preBidMeeting: { date: string | null; location: string | null } | null;
  pageLimit: string | null;
  copiesRequired: string | null;
  fileNamingRequirements: string[];
  warnings: string[];
  /** Raw source-text excerpts that drove each derived fact, for audit */
  sourceExcerpts: Record<string, string>;
};

export type ParseTenderDocumentIntelligenceOptions = {
  /** Tender title (used as fallback for project title) */
  tenderTitle?: string | null;
  /** Tender reference (used as fallback) */
  tenderReference?: string | null;
  /** Tender clientName (used as fallback for client) */
  tenderClientName?: string | null;
  /** Tender submissionMethod (used as fallback) */
  tenderSubmissionMethod?: string | null;
  /** Tender deadline (used as fallback) */
  tenderDeadline?: Date | string | null;
  /** Tender submissionEmails (used as fallback) */
  tenderSubmissionEmails?: string | null;
  /** Tender submissionAddress (used as fallback) */
  tenderSubmissionAddress?: string | null;
};

// ─── Email normalization ─────────────────────────────────────────────────────

/**
 * Normalize a raw submission-emails value into a clean array of valid emails.
 * Splits on |, ;, comma, "and", whitespace/newlines. Returns only valid emails.
 */
export function normalizeEmailList(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  // Split on | ; , or whitespace, and the word "and"
  const parts = value
    .replace(/\s+and\s+/gi, " ")
    .split(/[|;,]|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return parts.filter((p) => emailRe.test(p));
}

// ─── Source-text builder ─────────────────────────────────────────────────────

export type TenderFactSourceInput = {
  extractedText?: string | null;
  intakeSummary?: string | null;
  analysisSummary?: string | null;
  description?: string | null;
  evaluationMethodology?: string | null;
};

/**
 * Build the full tender fact source text from the available content.
 * Priority: extractedText → intakeSummary → analysisSummary → description → evaluationMethodology.
 * The source text is the authority for all fact derivation.
 */
export function buildTenderFactSourceText(input: TenderFactSourceInput): string {
  const parts: string[] = [];
  if (input.extractedText && input.extractedText.trim()) {
    parts.push(input.extractedText.trim());
  }
  if (input.intakeSummary && input.intakeSummary.trim()) {
    parts.push(input.intakeSummary.trim());
  }
  if (input.analysisSummary && input.analysisSummary.trim()) {
    parts.push(input.analysisSummary.trim());
  }
  if (input.description && input.description.trim()) {
    parts.push(input.description.trim());
  }
  if (input.evaluationMethodology && input.evaluationMethodology.trim()) {
    parts.push(input.evaluationMethodology.trim());
  }
  return parts.join("\n\n---\n\n");
}

// ─── Tender-type classifier ──────────────────────────────────────────────────

const TENDER_TYPE_PATTERNS: Array<{ type: TenderType; patterns: RegExp[] }> = [
  {
    type: "Request for Technical Proposal",
    patterns: [
      /request\s+for\s+technical\s+proposal/i,
      /technical\s+proposal\s+for\b/i,
      /RTP\b/i,
    ],
  },
  {
    type: "Expression of Interest",
    patterns: [
      /expression\s+of\s+interest/i,
      /\bEOI\b/i,
    ],
  },
  {
    type: "Request for Quotation",
    patterns: [
      /request\s+for\s+quotation/i,
      /\bRFQ\b/i,
      /quotation\s+(?:request|invite)/i,
    ],
  },
  {
    type: "Request for Proposal",
    patterns: [
      /request\s+for\s+proposal/i,
      /\bRFP\b/i,
    ],
  },
  {
    type: "Invitation for Bid",
    patterns: [
      /invitation\s+for\s+bids?/i,
      /\bIFB\b/i,
      /invitation\s+to\s+tender/i,
    ],
  },
  {
    type: "Prequalification",
    patterns: [
      /prequalification/i,
      /pre-qualification/i,
    ],
  },
  {
    type: "Vendor Registration",
    patterns: [/vendor\s+registration/i],
  },
  {
    type: "Supplier Registration",
    patterns: [/supplier\s+registration/i],
  },
  {
    type: "Framework Agreement",
    patterns: [/framework\s+agreement/i],
  },
];

function classifyTenderType(text: string): TenderType {
  // Two-envelope / single-envelope detection (envelope structure)
  const twoEnvelope = /two[\s-]*envelope|double[\s-]*envelope|technical.*financial.*separate/i.test(text);
  const singleEnvelope = /single[\s-]*envelope|one[\s-]*envelope/i.test(text);

  // Detect primary tender type.
  // Note: "Technical Proposal Only" and "Financial Proposal Only" are NOT
  // tender types — they describe whether a financial proposal is required.
  // That information is captured separately in `financialProposalRequired`.
  // The tender type remains the primary classification (RFP, RTP, EOI, etc.).
  let primary: TenderType = "Unknown";
  for (const { type, patterns } of TENDER_TYPE_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      primary = type;
      break;
    }
  }

  // Envelope structure overrides primary type only when explicitly stated
  if (twoEnvelope) return "Two Envelope";
  if (singleEnvelope) return "Single Envelope";
  if (primary !== "Unknown") return primary;
  // Default: if proposal language exists but no specific type, treat as RFP
  if (/technical\s+and\s+financial\s+proposal|technical\s*\+\s*financial/i.test(text)) {
    return "Technical and Financial Proposal";
  }
  return "Unknown";
}

// ─── Service-stream classifier ───────────────────────────────────────────────

const SERVICE_STREAM_PATTERNS: Array<{ stream: ServiceStream; patterns: RegExp[] }> = [
  { stream: "architectural design", patterns: [/architectur/i] },
  { stream: "engineering design", patterns: [/engineering\s+design|structural\s+design|mechanical\s+design|electrical\s+design|civil\s+design/i] },
  { stream: "urban planning", patterns: [/urban\s+planning|master\s+planning|city\s+planning/i] },
  { stream: "supervision", patterns: [/supervision|construction\s+supervision/i] },
  { stream: "consultancy", patterns: [/consultancy|consulting\s+services?/i] },
  { stream: "geotechnical investigation", patterns: [/geotechnical\s+investigation|geotechnical\s+study/i] },
  { stream: "soil investigation", patterns: [/soil\s+investigation|soil\s+survey/i] },
  { stream: "interior design", patterns: [/interior\s+design/i] },
  { stream: "contract administration", patterns: [/contract\s+administration/i] },
  { stream: "project management", patterns: [/project\s+management/i] },
  { stream: "construction management", patterns: [/construction\s+management/i] },
  { stream: "feasibility study", patterns: [/feasibility\s+study/i] },
  { stream: "environmental study", patterns: [/environmental\s+(?:impact\s+)?(?:assessment|study)/i] },
  { stream: "social study", patterns: [/social\s+(?:impact\s+)?(?:assessment|study)/i] },
  { stream: "road consultancy", patterns: [/road\b|highway|pavement/i] },
  { stream: "infrastructure consultancy", patterns: [/infrastructure/i] },
  { stream: "water consultancy", patterns: [/\bwater\s+(?:supply|system|network)\b/i] },
  { stream: "sanitation consultancy", patterns: [/sanitation|sewerage|wastewater/i] },
  { stream: "building consultancy", patterns: [/\bbuilding\b|G\+\d|\bG\s*\+\s*\d/i] },
];

function classifyServiceStreams(text: string): ServiceStream[] {
  const streams = new Set<ServiceStream>();
  for (const { stream, patterns } of SERVICE_STREAM_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      streams.add(stream);
    }
  }
  return Array.from(streams);
}

// ─── Submission-instruction extractor ────────────────────────────────────────

function extractSubmissionInstructions(
  text: string,
  fallbacks: ParseTenderDocumentIntelligenceOptions,
): SubmissionInstructionSet {
  const lower = text.toLowerCase();
  const warnings: string[] = [];

  // Method
  let method: SubmissionMethod = "Unknown";
  const emailMethod = /email\s+submission|submit\s+by\s+email|submission\s+method:?\s*email/i.test(text);
  const portalMethod = /portal\s+submission|e-procurement|upload\s+through\s+(?:the\s+)?portal/i.test(text);
  const physicalMethod = /physical\s+submission|sealed\s+envelope|by\s+hand|courier|in[\s-]person|drop[\s-]?off/i.test(text);
  const hybridMethod = /hybrid\s+submission|email\s+or\s+(?:physical|sealed)|physical\s+or\s+email/i.test(text);

  if (hybridMethod) method = "Hybrid";
  else if (portalMethod) method = "Portal";
  else if (emailMethod) method = "Email";
  else if (physicalMethod) method = "Physical";
  else if (fallbacks.tenderSubmissionMethod) {
    const fb = fallbacks.tenderSubmissionMethod.toLowerCase();
    if (fb.includes("email")) method = "Email";
    else if (fb.includes("portal") || fb.includes("e-procurement")) method = "Portal";
    else if (fb.includes("physical") || fb.includes("sealed") || fb.includes("hand") || fb.includes("courier")) method = "Physical";
    else if (fb.includes("hybrid")) method = "Hybrid";
  }

  // Format
  let format: string | null = null;
  const formatMatch = text.match(/submission\s+format:?\s*([^\n\r]{3,80})/i);
  if (formatMatch) format = formatMatch[1].trim();
  else if (/pdf\s+electronic\s+submission/i.test(text)) format = "PDF electronic submission only";

  // Deadline
  let deadlineDisplay: string | null = null;
  let deadlineIso: string | null = null;
  const deadlineMatch = text.match(/(?:submission\s+)?deadline:?\s*([^\n\r]{5,80})/i)
    || text.match(/submit(?:ted)?\s+(?:by|before)\s*([^\n\r]{5,80})/i)
    || text.match(/\b(?:by|before)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}[^\n\r]{0,40})/i);
  if (deadlineMatch) {
    deadlineDisplay = deadlineMatch[1].trim();
    deadlineIso = tryParseDateToIso(deadlineDisplay);
    // If the regex matched but the parsed date is invalid (e.g. "deadline in text"
    // captured non-date words), clear the display and fall through to the fallback.
    if (!deadlineIso) {
      deadlineDisplay = null;
    }
  }
  if (!deadlineDisplay && fallbacks.tenderDeadline) {
    const d = typeof fallbacks.tenderDeadline === "string"
      ? new Date(fallbacks.tenderDeadline)
      : fallbacks.tenderDeadline;
    if (!isNaN(d.getTime())) {
      deadlineIso = d.toISOString();
      deadlineDisplay = d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
    }
  }
  if (!deadlineDisplay) warnings.push("Submission deadline not detected in tender source text");

  // Emails
  let emails: string[] = [];
  const emailBlockMatch = text.match(/submission\s+email[s]?:?\s*([^\n\r]{5,300})/i)
    || text.match(/email(?:s)?\s+(?:to|address:?)\s*([^\n\r]{5,300})/i);
  if (emailBlockMatch) {
    emails = normalizeEmailList(emailBlockMatch[1]);
  }
  if (emails.length === 0) {
    // Fallback: extract any email addresses from the whole text
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const found = text.match(emailRe) ?? [];
    emails = Array.from(new Set(found));
  }
  if (emails.length === 0 && fallbacks.tenderSubmissionEmails) {
    emails = normalizeEmailList(fallbacks.tenderSubmissionEmails);
  }
  if (emails.length === 0 && method === "Email") {
    warnings.push("Email submission method detected but no submission email addresses found in source text");
  }

  // Email subject
  let emailSubject: string | null = null;
  const subjectMatch = text.match(/(?:required\s+)?email\s+subject:?\s*([^\n\r]{3,150})/i)
    || text.match(/subject\s+line:?\s*([^\n\r]{3,150})/i);
  if (subjectMatch) emailSubject = subjectMatch[1].trim();

  // Portal URL
  let portalUrl: string | null = null;
  const portalMatch = text.match(/(?:portal\s+(?:url|link|address):?|submit\s+at)\s*(https?:\/\/[^\s\n\r]{5,200})/i)
    || text.match(/(https?:\/\/\S*(?:procurement|portal|tender)\S*)/i);
  if (portalMatch) portalUrl = portalMatch[1].trim();

  // Physical address
  let physicalAddress: string | null = null;
  const addressMatch = text.match(/(?:submission\s+address|physical\s+address|deliver\s+to|address):?\s*([^\n\r]{10,300})/i);
  if (addressMatch) physicalAddress = addressMatch[1].trim();
  else if (fallbacks.tenderSubmissionAddress) physicalAddress = fallbacks.tenderSubmissionAddress;

  // Absence of physical / portal
  const noPhysical = /no\s+physical\s+address|no\s+physical\s+submission|email\s+submission\s+only/i.test(text);
  const noPortal = /no\s+portal|no\s+online\s+submission/i.test(text);

  const physicalSubmissionRequired = method === "Physical" || method === "Hybrid";
  const portalSubmissionRequired = method === "Portal" || method === "Hybrid";

  let note: string | null = null;
  if (noPhysical && method === "Email") {
    note = "Email submission only. No physical address or portal provided.";
  } else if (noPortal && method === "Physical") {
    note = "Physical submission only. No portal provided.";
  }

  return {
    method,
    format,
    deadlineDisplay,
    deadlineIso,
    emails,
    emailSubject,
    portalUrl,
    physicalAddress: noPhysical ? null : physicalAddress,
    physicalSubmissionRequired,
    portalSubmissionRequired,
    note,
  };
}

function tryParseDateToIso(display: string): string | null {
  // Try parsing common date formats. Returns ISO string with timezone if possible.
  // Handles: "August 25, 2026, 5:00 PM Addis Ababa Time"
  const cleaned = display.replace(/\s+/g, " ").trim();
  // Map common timezone names to offsets
  const tzMap: Record<string, string> = {
    "addis ababa time": "+03:00",
    "eastafrica time": "+03:00",
    "eat": "+03:00",
    "utc": "+00:00",
    "gmt": "+00:00",
  };
  let tzOffset = "";
  for (const [name, offset] of Object.entries(tzMap)) {
    if (cleaned.toLowerCase().includes(name)) {
      tzOffset = offset;
      break;
    }
  }
  // Strip the timezone name for Date parsing
  const stripped = cleaned.replace(/addis\s+ababa\s+time|eastafrica\s+time|\beat\b|\butc\b|\bgmt\b/i, "").trim();
  const d = new Date(stripped);
  if (isNaN(d.getTime())) return null;
  // Apply timezone offset if we have one
  if (tzOffset) {
    // Build a manual ISO with offset
    const iso = d.toISOString().replace(/\.\d{3}Z$/, "") + tzOffset;
    return iso;
  }
  return d.toISOString();
}

// ─── Denial detection ────────────────────────────────────────────────────────
//
// A tender that MENTIONS a document is not necessarily a tender that REQUIRES
// it. "No bid security is required", "a cover letter is not required at this
// stage", "financial proposal: not applicable" all name the thing in order to
// rule it out. Reading the mention as an obligation invents work the client
// never asked for, and on the export side it becomes a blocker for a document
// the tender explicitly said to omit.
//
// One rule, used by every consumer below, so the negation logic cannot diverge
// between the bid-security reader and the required-documents extractor.

/** The one bid-security pattern, shared by both readers below. */
const BID_SECURITY_PATTERN = /bid\s+bond|bid\s+security/i;

/** True when this clause names something in order to say it is NOT needed. */
function clauseDeniesRequirement(clause: string): boolean {
  const text = clause.trim();
  return (
    /\b(?:not|no longer|neither)\s+(?:be\s+)?(?:required|applicable|requested|needed|necessary|expected|submitted)\b/i.test(text) ||
    /\b(?:no|without)\s+(?:[a-z-]+\s+){0,3}(?:bond|security|proposal|letter|certificate|document|form|annex|schedule|submission)\b/i.test(text) ||
    /:\s*(?:none|nil|no|n\/a|not\s+applicable|not\s+required)\b/i.test(text) ||
    /\bexempt(?:ed)?\s+from\b/i.test(text) ||
    /\bwaived\b/i.test(text) ||
    // Prohibition stated as an instruction rather than a description:
    // "Do not generate a financial proposal", "Bidders shall not submit a bid
    // security". The obligation verbs are the same ones the open-ended document
    // reader keys on, negated.
    /\b(?:do|does|shall|must|should|will|may)\s+not\s+(?:be\s+)?(?:generate|include|submit|provide|furnish|attach|enclose|send|prepare|produce|supply|present)\b/i.test(text) ||
    // Addenda and revisions cancel obligations rather than negating them. An
    // addendum says a requirement is "withdrawn", "deleted" or "shall not
    // apply" — it does not say "not required". Without these, an addendum that
    // removed an obligation read as one that imposed it, which is the worse of
    // the two errors: the bidder is sent to buy a bid security the client
    // already withdrew. Scoping keeps this safe — a clause like "bids may be
    // withdrawn before the deadline" denies only itself, and any genuine
    // obligation stated in another clause still wins.
    /\b(?:withdrawn|withdraws|rescinded|revoked|cancell?ed|deleted|struck\s+out)\b/i.test(text) ||
    /\b(?:shall|will|does|do|is|are)\s+not\s+apply\b/i.test(text) ||
    /\bno\s+longer\s+(?:applies|apply)\b/i.test(text)
  );
}

/**
 * Clause-sized units. Obligation and denial live at sentence/line scale — and
 * also on either side of a contrast.
 *
 * "Bid security is not required at EOI stage, but shortlisted firms shall
 * provide bid security with the RFP submission" is ONE sentence carrying a
 * scoped denial AND a real obligation. Judging it as a single unit let the
 * denial cancel the obligation, so a shortlisted firm would have submitted with
 * no bid security. Splitting on the contrast keeps each half answerable on its
 * own terms.
 */
function clausesOf(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|[\n\r]+|,?\s+(?:but|however|although|though|whereas|except\s+that)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * True when at least one occurrence of `pattern` sits in a clause that is NOT a
 * denial. A document mentioned only inside denials is mentioned, not required.
 */
function hasAffirmativeMention(text: string, pattern: RegExp): boolean {
  const matching = clausesOf(text).filter((clause) => pattern.test(clause));
  if (matching.length === 0) return pattern.test(text) ? !clauseDeniesRequirement(text) : false;
  return matching.some((clause) => !clauseDeniesRequirement(clause));
}

// ─── Required-documents extractor ────────────────────────────────────────────

const DOCUMENT_PATTERNS: Array<{ name: string; patterns: RegExp[]; envelope: "technical" | "financial" | "common" }> = [
  { name: "Technical Proposal", patterns: [/technical\s+proposal/i], envelope: "technical" },
  { name: "Financial Proposal", patterns: [/financial\s+proposal|price\s+schedule/i], envelope: "financial" },
  { name: "Cover Letter", patterns: [/cover\s+letter/i], envelope: "common" },
  { name: "Company Profile", patterns: [/company\s+profile/i], envelope: "common" },
  { name: "Compliance Matrix", patterns: [/compliance\s+matrix/i], envelope: "technical" },
  { name: "Methodology", patterns: [/\bmethodology\b/i], envelope: "technical" },
  { name: "Work Plan", patterns: [/work\s+plan/i], envelope: "technical" },
  { name: "Team Composition", patterns: [/team\s+composition|staffing\s+plan/i], envelope: "technical" },
  { name: "CV Summary", patterns: [/\bCVs?\b|curriculum\s+vitae/i], envelope: "technical" },
  { name: "Project References", patterns: [/project\s+references?|relevant\s+experience/i], envelope: "technical" },
  { name: "Submission Checklist", patterns: [/submission\s+checklist/i], envelope: "common" },
  { name: "Bid Bond", patterns: [/bid\s+bond|bid\s+security/i], envelope: "financial" },
  { name: "Tax Certificate", patterns: [/tax\s+certificate|tax\s+clearance/i], envelope: "common" },
  { name: "Business License", patterns: [/business\s+license|trade\s+license/i], envelope: "common" },
  { name: "Audit Report", patterns: [/audit\s+report|audited\s+financial\s+statements/i], envelope: "financial" },
  { name: "Bank Statement", patterns: [/bank\s+statement/i], envelope: "financial" },
  { name: "Expression of Interest Document", patterns: [/expression\s+of\s+interest\s+document/i], envelope: "common" },
  { name: "Quotation", patterns: [/\bquotation\b|price\s+quote/i], envelope: "financial" },
];

/**
 * Is a financial submission required? — the single source-driven answer.
 *
 * Three states, because a tender has three things it can do: require one, rule
 * one out, or say nothing. The last is not the first. Two readers used to
 * decide this independently — this one and detectFinancialProposalRequired() in
 * tender-document-context.ts — with different denial vocabularies and a shared
 * habit of returning true when in doubt. They disagreed on real wording in both
 * directions ("Technical proposal only." → this said required, that said not;
 * "Financial Proposal: No" → the reverse), and on silence both invented an
 * obligation the source never stated.
 *
 * Evidence decides it in both directions now, and UNKNOWN (null) is a real
 * answer that callers must handle rather than a synonym for yes.
 */
const FINANCIAL_CONCEPT =
  /financial\s+proposal|financial\s+offer|financial\s+bid|financial\s+submission|financial\s+envelope|fee\s+proposal|fee\s+schedule|fee\s+breakdown|price\s+schedule|priced\s+schedule|schedule\s+of\s+(?:prices|rates)|price\s+proposal|price\s+breakdown|price\s+quote|commercial\s+proposal|commercial\s+offer|commercial\s+submission|\bquotation\b|bill\s+of\s+quantities|cost\s+breakdown|cost\s+proposal|lump\s+sum\s+(?:price|fee)|remuneration/i;

const TECHNICAL_ONLY = /technical\s+(?:proposal|submission|offer)\s+only|only\s+a\s+technical\s+(?:proposal|submission)/i;

const TWO_ENVELOPE = /two[-\s]envelopes?|separate\s+envelopes?|second\s+envelope|envelope\s+(?:1|2|i|ii|one|two)\b/i;

/**
 * true  — the source requires a financial submission.
 * false — the source rules one out.
 * null  — the source is silent. NOT an obligation, and not a denial either.
 */
export function readFinancialProposalRequirement(text: string): boolean | null {
  if (!text || !text.trim()) return null;

  // An explicit scope statement settles it even when no financial noun appears.
  if (TECHNICAL_ONLY.test(text)) return false;

  const clauses = clausesOf(text);
  const mentioning = clauses.filter((clause) => FINANCIAL_CONCEPT.test(clause));

  if (mentioning.length === 0) {
    // A two-envelope structure implies a financial envelope even when the
    // source never names one, but only structure says so — not a default.
    if (TWO_ENVELOPE.test(text)) return true;
    return null;
  }

  // Same rule as every other obligation: a mention is not an obligation, and a
  // denial rules out only its own clause.
  if (mentioning.some((clause) => !clauseDeniesRequirement(clause))) return true;
  return false;
}

/**
 * Documents the SOURCE names, which no catalogue can enumerate in advance.
 *
 * DOCUMENT_PATTERNS above recognises eighteen common types. That is useful for
 * normalising them into canonical categories, and useless for the thing tenders
 * actually do: name their own instruments. "Power of Attorney", "Declaration of
 * Independent Bid Determination", "Manufacturer's Authorization", "Beneficial
 * Ownership Form" and any client-invented schedule are all explicitly required
 * by their tenders and all absent from the list. Growing the list to thirty or
 * a hundred names does not fix that — the next tender writes a name that is not
 * on it either.
 *
 * So this reads the OBLIGATION rather than the noun: a submission verb governing
 * a document-like object. The name is whatever the source called it. The
 * envelope is "unknown" because guessing it would be inventing a fact the
 * source did not state, and the clause is kept verbatim as its evidence.
 *
 * Denial is decided by the same shared predicate every other reader uses, so
 * "a Power of Attorney is not required" cannot become an obligation here while
 * meaning the opposite three lines away.
 */

// Adjectives a tender puts in front of an instrument's name. They qualify the
// document; they are not part of what it is called.
const DOCUMENT_QUALIFIERS =
  /^(?:(?:a|an|the|its|their|his|her|one|two|three|duly|completed|signed|notarized|notarised|certified|original|valid|current|sealed|stamped|attested|legalized|legalised|authenticated|scanned|recent|separate|complete|full)\s+|copies?\s+of\s+(?:the\s+)?)+/i;

// Nouns that make a phrase a document rather than an action or an abstraction.
const DOCUMENT_NOUN =
  /\b(?:form|forms|declaration|declarations|certificate|certificates|letter|letters|statement|statements|agreement|agreements|authoriz(?:ation|ations)|authoris(?:ation|ations)|undertaking|undertakings|attorney|affidavit|affidavits|guarantee|guarantees|bond|bonds|licen[cs]e|licen[cs]es|profile|profiles|schedule|schedules|annex|annexe|annexes|appendix|appendices|questionnaire|questionnaires|matrix|register|registration|mandate|deed|deeds|resolution|resolutions|charter|policy|proposal|proposals|report|reports|plan|plans|list|lists|statement\s+of\s+\w+|power\s+of\s+attorney)\b/i;

// Where a document's name stops and the sentence's explanation begins.
const NAME_TERMINATORS =
  // Verb forms only. Matching the stem "authoriz" would also truncate a real
  // name — "Manufacturer's Authorization Letter" — down to "Manufacturer's",
  // which then fails to read as a document and is dropped entirely.
  /\s+(?:authoris(?:ing|ed|es)|authoriz(?:ing|ed|es)|confirming|stating|certifying|declaring|issued|signed\s+by|which|who|that\s+|to\s+the\s+effect|in\s+the\s+form|as\s+per|in\s+accordance|together\s+with|along\s+with|and\s+a\b|and\s+an\b|and\s+the\b|from\s+the\b|for\s+the\b|of\s+not\s+less|valid\s+for|dated\b|no\s+later|before\b|by\s+the\s+closing).*/i;

const OBLIGATION_ACTIVE =
  /\b(?:shall|must|should|will|is\s+required\s+to|are\s+required\s+to|is\s+expected\s+to|are\s+expected\s+to|is\s+requested\s+to|are\s+requested\s+to)\s+(?:also\s+)?(?:submit|provide|furnish|include|attach|enclose|present|produce|supply)\s+(.{3,160})/i;

const OBLIGATION_PASSIVE =
  /\b(.{3,120}?)\s+(?:shall|must|is|are)\s+(?:also\s+)?be\s+(?:submitted|provided|furnished|attached|enclosed|included|presented)\b/i;

/** Normalise a name for duplicate detection only — never for display. */
function documentNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Turn a captured object phrase into the document name the source used. */
function documentNameFrom(phrase: string): string | null {
  let name = phrase.trim()
    .replace(/^[\s"\u2018\u2019\u201c\u201d(\[-]+/, "")
    .replace(NAME_TERMINATORS, "")
    .replace(DOCUMENT_QUALIFIERS, "")
    .replace(/[)\].,;:"\u2018\u2019\u201c\u201d\s]+$/, "")
    .trim();

  // A trailing conjunction means we captured into the next item; cut it.
  name = name.replace(/\s+(?:and|or)$/i, "").trim();

  if (name.length < 3 || name.length > 90) return null;
  if (/^(?:the|a|an|it|them|this|these|those|all|any|such|following)$/i.test(name)) return null;

  // It must read as a document: either it carries a document noun, or the
  // source Title-Cased it, which is how tenders name their bespoke instruments.
  const titleCased = /^(?:[A-Z][\w'&./-]*)(?:\s+(?:of|for|and|the|to|in|on|de|du)?\s*[A-Z][\w'&./-]*)+$/.test(name);
  if (!DOCUMENT_NOUN.test(name) && !titleCased) return null;

  return name;
}

/**
 * Read every document obligation the source states in its own words. Catalogue
 * hits are excluded by the caller so a recognised type is reported once, under
 * its canonical name.
 */
function extractSourceNamedDocuments(text: string, alreadyNamed: Set<string>): RequiredTenderDocument[] {
  const found: RequiredTenderDocument[] = [];
  const seen = new Set<string>(alreadyNamed);

  for (const clause of clausesOf(text)) {
    // The shared denial predicate. A clause that rules a document out must not
    // produce one here either.
    if (clauseDeniesRequirement(clause)) continue;

    const candidates: string[] = [];
    const active = clause.match(OBLIGATION_ACTIVE);
    if (active?.[1]) candidates.push(active[1]);
    const passive = clause.match(OBLIGATION_PASSIVE);
    if (passive?.[1]) candidates.push(passive[1]);

    for (const candidate of candidates) {
      // One clause can list several instruments: "... a Power of Attorney and a
      // Declaration of Undertaking". Split on list separators and read each.
      for (const part of candidate.split(/\s*(?:,|;|\band\b|\bas\s+well\s+as\b|\btogether\s+with\b|\balong\s+with\b)\s*/i)) {
        const name = documentNameFrom(part);
        if (!name) continue;
        const key = documentNameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        found.push({
          name,
          required: true,
          // Not stated by the source. Guessing it would invent a fact.
          envelope: "unknown",
          sourceQuote: clause.trim().slice(0, 300),
        });
      }
    }
  }

  return found;
}

/**
 * Does this text state a document obligation?
 *
 * Exported for consumers that hold canonical requirement rows rather than raw
 * tender text and need to know which of them are required-document
 * requirements. Reading the obligation beats keyword-matching the name: a
 * filter for /document|annex|attachment|form/ drops "Power of Attorney" and
 * "Declaration of Independent Bid Determination", which are exactly the kind of
 * instrument a tender names itself.
 */
export function statesDocumentObligation(text: string): boolean {
  if (!text || !text.trim()) return false;
  return extractSourceNamedDocuments(text, new Set<string>()).length > 0;
}

function extractRequiredDocuments(text: string, financialProposalRequired: boolean): RequiredTenderDocument[] {
  const docs: RequiredTenderDocument[] = [];
  const seen = new Set<string>();
  for (const { name, patterns, envelope } of DOCUMENT_PATTERNS) {
    if (seen.has(name)) continue;
    if (!patterns.some((p) => p.test(text))) continue;
    seen.add(name);

    // Mentioned only to be ruled out. Previously ANY mention became
    // `required: true`, so "No bid security is required" produced a required
    // Bid Bond. The two hard-coded exceptions below show the authors already
    // knew a mention is not an obligation — this applies that same truth to
    // every document type instead of two named ones.
    if (!patterns.some((p) => hasAffirmativeMention(text, p))) {
      docs.push({ name, required: false, envelope, note: "Source states this is not required" });
      continue;
    }

    // Skip Financial Proposal if not required
    if (name === "Financial Proposal" && !financialProposalRequired) {
      docs.push({ name, required: false, envelope, note: "Not required at this stage" });
    } else if (name === "Quotation" && !financialProposalRequired) {
      docs.push({ name, required: false, envelope, note: "Not required at this stage" });
    } else {
      docs.push({ name, required: true, envelope });
    }
  }

  // The catalogue has now said everything it can. Whatever the source required
  // under a name the catalogue does not know is read next, so an obligation is
  // not lost merely because nobody anticipated its name.
  const canonicalKeys = new Set(docs.map((d) => documentNameKey(d.name)));
  docs.push(...extractSourceNamedDocuments(text, canonicalKeys));

  return docs;
}

// ─── Generation-plan builder ─────────────────────────────────────────────────

function buildGenerationPlan(
  tenderType: TenderType,
  requiredDocuments: RequiredTenderDocument[],
  financialProposalRequired: boolean,
): TenderGenerationPlan {
  const generate: string[] = [];
  const exclude: string[] = [];
  const notes: string[] = [];

  // Default generation set by tender type
  if (tenderType === "Expression of Interest") {
    generate.push("EOI Cover Letter", "Expression of Interest Document", "Company Profile Summary", "Relevant Experience", "Submission Checklist");
    notes.push("EOI: do not generate a full technical methodology unless requested");
  } else if (tenderType === "Request for Quotation" || tenderType === "Financial Proposal Only") {
    generate.push("Quotation Cover Letter", "Financial Quotation", "Price Schedule", "Technical Compliance Statement", "Company Eligibility Documents", "Submission Checklist");
    notes.push("RFQ: do not generate a long technical proposal unless requested");
  } else if (
    tenderType === "Request for Proposal"
    || tenderType === "Request for Technical Proposal"
    || tenderType === "Technical Proposal Only"
    || tenderType === "Technical and Financial Proposal"
  ) {
    generate.push("Technical Proposal", "Cover Letter", "Methodology", "Understanding of Assignment", "Work Plan", "Team Composition", "CV Summary", "Relevant Project References", "Compliance Matrix", "Submission Checklist");
    if (tenderType === "Technical Proposal Only") {
      notes.push("Technical-only tender: financial proposal excluded from generation and final ZIP");
    }
  } else if (tenderType === "Two Envelope") {
    generate.push("Technical Proposal Package", "Financial Proposal Package", "Technical Cover Letter", "Financial Cover Letter", "Technical Checklist", "Financial Checklist");
    notes.push("Two-envelope: technical and financial proposals generated as separate packages with separate filenames");
  } else if (tenderType === "Single Envelope") {
    generate.push("Technical Proposal", "Financial Proposal", "Cover Letter", "Submission Checklist");
  } else {
    // Unknown — default to RFP-style
    generate.push("Technical Proposal", "Cover Letter", "Methodology", "Submission Checklist");
  }

  // Add required documents from source text that aren't already in the list
  for (const doc of requiredDocuments) {
    if (doc.required && !generate.some((g) => g.toLowerCase().includes(doc.name.toLowerCase()) || doc.name.toLowerCase().includes(g.toLowerCase()))) {
      generate.push(doc.name);
    }
  }

  // Exclude financial proposal if not required
  if (!financialProposalRequired) {
    exclude.push("Financial Proposal");
    if (!notes.some((n) => n.includes("financial proposal excluded"))) {
      notes.push("Financial proposal not required at this stage — excluded from generation and final ZIP");
    }
  }

  // For two-envelope, never mix financial content into technical
  if (tenderType === "Two Envelope") {
    notes.push("Two-envelope: do not mix financial price content into the technical proposal");
  }

  return { generate, exclude, notes };
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse the full tender source text and derive a complete
 * TenderDocumentIntelligence object that drives document generation.
 *
 * The source text is the authority. Scalar fields are used ONLY as fallback
 * when the source text lacks a fact.
 */
export function parseTenderDocumentIntelligence(
  text: string,
  options: ParseTenderDocumentIntelligenceOptions = {},
): TenderDocumentIntelligence {
  const warnings: string[] = [];
  const sourceExcerpts: Record<string, string> = {};

  if (!text || !text.trim()) {
    warnings.push("Empty tender source text — cannot derive intelligence");
    return {
      tenderType: "Unknown",
      serviceStreams: [],
      projectTitle: options.tenderTitle ?? null,
      clientOrProcuringEntity: options.tenderClientName ?? null,
      submissionInstructions: {
        method: "Unknown",
        format: null,
        deadlineDisplay: null,
        deadlineIso: null,
        emails: normalizeEmailList(options.tenderSubmissionEmails),
        emailSubject: null,
        portalUrl: null,
        physicalAddress: options.tenderSubmissionAddress ?? null,
        physicalSubmissionRequired: false,
        portalSubmissionRequired: false,
        note: null,
      },
      requiredDocuments: [],
      eligibilityCriteria: [],
      technicalCriteria: [],
      financialCriteria: [],
      evaluationMethodology: null,
      scopeOfServices: [],
      deliverables: [],
      requiredExperts: [],
      requiredProjectReferences: [],
      requiredLegalDocuments: [],
      requiredFinancialDocuments: [],
      formsAndAnnexes: [],
      generationPlan: { generate: [], exclude: [], notes: ["Empty source text"] },
      financialProposalRequired: false,
      financialProposalRequiredState: null,
      proposalValidity: null,
      budget: null,
      bidBond: null,
      mandatorySiteVisit: false,
      preBidMeeting: null,
      pageLimit: null,
      copiesRequired: null,
      fileNamingRequirements: [],
      warnings,
      sourceExcerpts,
    };
  }

  // Tender type
  const tenderType = classifyTenderType(text);
  if (tenderType === "Unknown") {
    warnings.push("Tender type not detected in source text — defaulting to RFP-style generation");
  }

  // Service streams
  const serviceStreams = classifyServiceStreams(text);
  if (serviceStreams.length === 0) {
    warnings.push("No HAEC service stream detected in source text");
  }

  // Project title
  let projectTitle: string | null = options.tenderTitle ?? null;
  const titleMatch = text.match(/project\s+name:?\s*([^\n\r]{5,150})/i)
    || text.match(/project\s+title:?\s*([^\n\r]{5,150})/i)
    || text.match(/for\s+([A-Z][^\n\r]{5,150})/);
  if (titleMatch) {
    projectTitle = titleMatch[1].trim();
    sourceExcerpts.projectTitle = titleMatch[0];
  }

  // Client / procuring entity
  let clientOrProcuringEntity: string | null = options.tenderClientName ?? null;
  // Try specific patterns first (avoid bare "for" which matches "Request for...")
  const clientMatch = text.match(/(?:client|procuring\s+entity)\s*:?\s*([^\n\r]{3,100})/i)
    || text.match(/Technical\s+Proposal\s+for\s+([A-Z][^\n\r]{3,100})/i)
    || text.match(/Proposal\s+for\s+([A-Z][^\n\r]{3,100})/i);
  if (clientMatch) {
    clientOrProcuringEntity = clientMatch[1].trim();
    sourceExcerpts.clientOrProcuringEntity = clientMatch[0];
  }

  // Financial proposal required? One reader, three states. Silence is UNKNOWN
  // and must not become an obligation — see readFinancialProposalRequirement().
  const financialProposalRequiredState = readFinancialProposalRequirement(text);
  const financialProposalRequired = financialProposalRequiredState === true;
  if (financialProposalRequiredState === false) {
    sourceExcerpts.financialProposalRequired = "Financial proposal not required at this stage";
  } else if (financialProposalRequiredState === null) {
    // Surfaced, not silently resolved. A reviewer needs to know the source did
    // not answer this rather than be shown a confident "no".
    warnings.push(
      "Source does not state whether a financial proposal is required — treated as UNKNOWN. No financial document is generated on an unstated obligation; confirm before final submission.",
    );
  }

  // Submission instructions
  const submissionInstructions = extractSubmissionInstructions(text, options);

  // Required documents
  const requiredDocuments = extractRequiredDocuments(text, financialProposalRequired);

  // Evaluation methodology
  let evaluationMethodology: TenderEvaluationMethodology | null = null;
  // Match "Technical weight: 70%" or "Technical 70%" or "Technical weightage 70%"
  const techWeightMatch = text.match(/technical\s+(?:weight(?:age)?\s*:?)?\s*(\d{1,3})\s*%/i)
    || text.match(/technical\s+(\d{1,3})\s*%/i);
  const finWeightMatch = text.match(/financial\s+(?:weight(?:age)?\s*:?)?\s*(\d{1,3})\s*%/i)
    || text.match(/financial\s+(\d{1,3})\s*%/i);
  if (techWeightMatch || finWeightMatch || /evaluation\s+methodology/i.test(text)) {
    evaluationMethodology = {
      technicalWeight: techWeightMatch ? parseInt(techWeightMatch[1], 10) : null,
      financialWeight: finWeightMatch ? parseInt(finWeightMatch[1], 10) : null,
      methodology: "Detected evaluation methodology section",
      passFail: /pass\/fail|pass-fail|compliance\s+only/i.test(text),
    };
  }

  // Generation plan
  const generationPlan = buildGenerationPlan(tenderType, requiredDocuments, financialProposalRequired);

  // Proposal validity
  let proposalValidity: string | null = null;
  const validityMatch = text.match(/proposal\s+validity:?\s*([^\n\r]{3,80})/i)
    || text.match(/validity\s+period:?\s*([^\n\r]{3,80})/i);
  if (validityMatch) proposalValidity = validityMatch[1].trim();

  // Budget
  let budget: string | null = null;
  const budgetMatch = text.match(/(?:budget|estimated\s+cost|contract\s+value):?\s*([^\n\r]{3,100})/i);
  if (budgetMatch) budget = budgetMatch[1].trim();

  // Bid bond
  //
  // A DENIAL is not an obligation. The previous pattern matched the phrase
  // anywhere and captured the rest of the line with no awareness of what came
  // before it, so a tender that explicitly ruled bid security out was recorded
  // as requiring one, with the negation stripped off:
  //
  //   "No bid security is required at this stage."  ->  "is required at this stage."
  //   "No bid bond shall be required."              ->  "shall be required."
  //
  // Tenders that state no bid security is needed are common — most EOIs and
  // many consultancy RFPs say exactly that — so this turned an explicit absence
  // into a phantom commercial obligation on an ordinary class of tender.
  // Presence and absence must both survive parsing.
  //
  // Scanned over the SAME clause units the required-documents extractor uses.
  // Reading only the first regex match in the document made the two disagree:
  // a source that denied bid security in one sentence and required it in the
  // next produced bidBond=null alongside a required "Bid Bond" document. One
  // clause set, one denial rule, so the two readers cannot diverge.
  let bidBond: string | null = null;
  for (const clause of clausesOf(text)) {
    if (!BID_SECURITY_PATTERN.test(clause)) continue;
    if (clauseDeniesRequirement(clause)) continue;
    const detail = clause.match(/(?:bid\s+bond|bid\s+security)\b:?\s*(.{0,100})/i);
    const after = (detail?.[1] ?? "").trim();
    if (after.length >= 3) {
      bidBond = after;
      break;
    }
  }

  // Mandatory site visit
  const mandatorySiteVisit = /mandatory\s+site\s+visit|site\s+visit\s+(?:is\s+)?mandatory|pre-bid\s+site\s+visit\s+(?:is\s+)?mandatory/i.test(text);

  // Pre-bid meeting
  let preBidMeeting: { date: string | null; location: string | null } | null = null;
  const preBidDateMatch = text.match(/pre-bid\s+meeting\s+(?:date)?:?\s*([^\n\r]{5,80})/i);
  const preBidLocMatch = text.match(/pre-bid\s+meeting\s+(?:location|venue)?:?\s*([^\n\r]{5,120})/i);
  if (preBidDateMatch || preBidLocMatch || /pre-bid\s+meeting/i.test(text)) {
    preBidMeeting = {
      date: preBidDateMatch ? preBidDateMatch[1].trim() : null,
      location: preBidLocMatch ? preBidLocMatch[1].trim() : null,
    };
  }

  // Page limit
  let pageLimit: string | null = null;
  const pageLimitMatch = text.match(/page\s+limit:?\s*([^\n\r]{3,40})/i)
    || text.match(/maximum\s+(?:of\s+)?(\d+)\s+pages/i);
  if (pageLimitMatch) pageLimit = pageLimitMatch[1].trim();

  // Copies required
  let copiesRequired: string | null = null;
  const copiesMatch = text.match(/(?:number\s+of\s+)?copies(?:\s+required)?:?\s*([^\n\r]{3,40})/i)
    || text.match(/(\d+)\s+(?:hard\s+)?copies/i);
  if (copiesMatch) copiesRequired = copiesMatch[1].trim();

  // File naming requirements
  const fileNamingRequirements: string[] = [];
  const namingMatch = text.match(/file\s+naming(?:\s+requirement)?:?\s*([^\n\r]{5,200})/i)
    || text.match(/name\s+your\s+file:?\s*([^\n\r]{5,200})/i);
  if (namingMatch) fileNamingRequirements.push(namingMatch[1].trim());

  // Required experts
  const requiredExperts: RequiredExpert[] = [];
  const expertMatches = text.matchAll(/(?:key\s+)?(?:expert|specialist|professional|consultant)\s*:?\s*([^\n\r]{5,120})/gi);
  for (const m of expertMatches) {
    const role = m[1].trim();
    if (role.length > 3 && role.length < 120) {
      requiredExperts.push({ role, count: 1, qualifications: [] });
    }
  }

  // Project references
  const requiredProjectReferences: RequiredProjectReference[] = [];
  const refMatch = text.match(/(\d+)\s+(?:relevant\s+)?project\s+references?/i)
    || text.match(/(\d+)\s+(?:similar\s+)?(?:projects?|assignments?)/i);
  if (refMatch) {
    requiredProjectReferences.push({
      count: parseInt(refMatch[1], 10),
      similarTo: projectTitle,
      note: "Similar project references required",
    });
  }

  // Legal documents
  const requiredLegalDocuments: RequiredLegalDocument[] = [];
  if (/tax\s+clearance|tax\s+certificate/i.test(text)) {
    requiredLegalDocuments.push({ name: "Tax Clearance Certificate", required: true, note: "Required by source text" });
  }
  if (/business\s+license|trade\s+license/i.test(text)) {
    requiredLegalDocuments.push({ name: "Business License", required: true, note: "Required by source text" });
  }
  if (/registration\s+certificate/i.test(text)) {
    requiredLegalDocuments.push({ name: "Registration Certificate", required: true, note: "Required by source text" });
  }

  // Financial documents
  const requiredFinancialDocuments: RequiredFinancialDocument[] = [];
  if (/audited\s+financial\s+statements?|audit\s+report/i.test(text)) {
    requiredFinancialDocuments.push({ name: "Audited Financial Statements", required: true, note: "Required by source text" });
  }
  if (/bank\s+statement/i.test(text)) {
    requiredFinancialDocuments.push({ name: "Bank Statement", required: true, note: "Required by source text" });
  }

  // Forms and annexes
  const formsAndAnnexes: TenderFormOrAnnex[] = [];
  const formMatches = text.matchAll(/(?:form|annex)\s+([A-Z0-9][^\n\r]{1,80})/gi);
  for (const m of formMatches) {
    const name = `Form/Annex ${m[1].trim()}`;
    if (!formsAndAnnexes.some((f) => f.name === name)) {
      formsAndAnnexes.push({ name, mandatory: true, note: "Detected in source text" });
    }
  }

  // Scope of services
  const scopeOfServices: string[] = [];
  const scopeMatch = text.match(/scope\s+of\s+(?:services?|work):?\s*([^\n\r]{10,500})/i);
  if (scopeMatch) scopeOfServices.push(scopeMatch[1].trim());

  // Deliverables
  const deliverables: string[] = [];
  const deliverableMatches = text.matchAll(/deliverable\s*\d*:?\s*([^\n\r]{5,200})/gi);
  for (const m of deliverableMatches) {
    deliverables.push(m[1].trim());
  }

  return {
    tenderType,
    serviceStreams,
    projectTitle,
    clientOrProcuringEntity,
    submissionInstructions,
    requiredDocuments,
    eligibilityCriteria: [],
    technicalCriteria: [],
    financialCriteria: [],
    evaluationMethodology,
    scopeOfServices,
    deliverables,
    requiredExperts,
    requiredProjectReferences,
    requiredLegalDocuments,
    requiredFinancialDocuments,
    formsAndAnnexes,
    generationPlan,
    financialProposalRequired,
    financialProposalRequiredState,
    proposalValidity,
    budget,
    bidBond,
    mandatorySiteVisit,
    preBidMeeting,
    pageLimit,
    copiesRequired,
    fileNamingRequirements,
    warnings,
    sourceExcerpts,
  };
}
