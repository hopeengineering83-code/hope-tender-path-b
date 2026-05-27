// lib/engine/document-type-normalizer.ts
//
// Canonical document-type normalization for generated documents.
// Called when creating plan rows, during auto-finalize, and in reclassify.
//
// Rules (in order of confidence):
// 1. If name/filename matches financial evidence patterns → FINANCIAL_EVIDENCE
// 2. If name/filename matches legal evidence patterns → LEGAL_EVIDENCE
// 3. If name/filename matches bid form patterns → BID_FORM
// 4. If name/filename matches submission rules patterns → SUBMISSION_RULES
// 5. If name/filename matches financial proposal patterns → FINANCIAL_PROPOSAL
// 6. Otherwise keep existing type (do not silently reclassify legitimate TECHNICAL_PROPOSAL)

export type NormalizedDocumentType =
  | "TECHNICAL_PROPOSAL"
  | "METHODOLOGY"
  | "FINANCIAL_EVIDENCE"
  | "LEGAL_EVIDENCE"
  | "BID_FORM"
  | "SUBMISSION_RULES"
  | "FINANCIAL_PROPOSAL"
  | "EXPERT_CV_PACKAGE"
  | "PROJECT_REFERENCE_PACKAGE"
  | "COMPLIANCE_MATRIX"
  | "OTHER";

const FINANCIAL_EVIDENCE_PATTERNS = [
  /audited\s+financial/i,
  /financial\s+capacity/i,
  /financial\s+evidence/i,
  /bank\s+statement/i,
  /bank\s+guarantee/i,
  /turnover\s+evidence/i,
  /annual\s+(?:report|accounts?)/i,
  /income\s+statement/i,
  /balance\s+sheet/i,
];

const LEGAL_EVIDENCE_PATTERNS = [
  /trade\s+licen/i,
  /business\s+licen/i,
  /registration\s+cert/i,
  /certificate\s+of\s+incorporation/i,
  /tax\s+clearance/i,
  /tin\s+cert/i,
  /vat\s+cert/i,
  /company\s+registration/i,
  /statutory\s+declaration/i,
];

const BID_FORM_PATTERNS = [
  /\bbid\s+form\b/i,
  /\btender\s+form\b/i,
  /\bdeclaration\s+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity\s+pact\b/i,
  /\bbid\s+bond\b/i,
  /\bbid\s+security\b/i,
];

const SUBMISSION_RULES_PATTERNS = [
  /submission\s+(method|rules?|format|deadline|packaging|delivery|instruction)/i,
  /packaging\s+rules?/i,
  /file\s+(?:naming|format|packaging)\s+rules?/i,
  /delivery\s+(?:rules?|instruction)/i,
];

const FINANCIAL_PROPOSAL_PATTERNS = [
  /financial\s+proposal/i,
  /commercial\s+proposal/i,
  /price\s+schedule/i,
  /rate\s+card/i,
  /bill\s+of\s+quantities?/i,
  /\bboq\b/i,
];

const CV_PATTERNS = [
  /\bcv\s+package\b/i,
  /expert\s+cv/i,
  /personnel\s+cv/i,
];

const PROJECT_REF_PATTERNS = [
  /project\s+reference\s+package/i,
  /project\s+experience\s+package/i,
];

export function normalizeDocumentType(
  name: string,
  exactFileName?: string | null,
  currentType?: string | null,
): NormalizedDocumentType {
  const label = `${name} ${exactFileName ?? ""}`.toLowerCase();

  // Do not reclassify if already correctly typed
  const ct = (currentType ?? "").toUpperCase();
  if (ct === "FINANCIAL_EVIDENCE" || ct === "OFFICIAL_FINANCIAL_EVIDENCE") return "FINANCIAL_EVIDENCE";
  if (ct === "LEGAL_EVIDENCE" || ct === "OFFICIAL_LEGAL_EVIDENCE") return "LEGAL_EVIDENCE";
  if (ct === "BID_FORM" || ct === "TENDER_FORM") return "BID_FORM";
  if (ct === "SUBMISSION_RULES") return "SUBMISSION_RULES";
  if (ct === "FINANCIAL_PROPOSAL" || ct === "COMMERCIAL_PROPOSAL") return "FINANCIAL_PROPOSAL";
  if (ct === "EXPERT_CV_PACKAGE" || ct === "CV_PACKAGE") return "EXPERT_CV_PACKAGE";
  if (ct === "PROJECT_REFERENCE_PACKAGE") return "PROJECT_REFERENCE_PACKAGE";
  if (ct === "COMPLIANCE_MATRIX") return "COMPLIANCE_MATRIX";
  if (ct === "METHODOLOGY") return "METHODOLOGY";

  // Pattern-based detection (only reclassify TECHNICAL_PROPOSAL or null types)
  const shouldReclassify = !currentType || ct === "TECHNICAL_PROPOSAL" || ct === "PROPOSAL";

  if (shouldReclassify) {
    if (FINANCIAL_EVIDENCE_PATTERNS.some((rx) => rx.test(label))) return "FINANCIAL_EVIDENCE";
    if (LEGAL_EVIDENCE_PATTERNS.some((rx) => rx.test(label))) return "LEGAL_EVIDENCE";
    if (BID_FORM_PATTERNS.some((rx) => rx.test(label))) return "BID_FORM";
    if (SUBMISSION_RULES_PATTERNS.some((rx) => rx.test(label))) return "SUBMISSION_RULES";
    if (FINANCIAL_PROPOSAL_PATTERNS.some((rx) => rx.test(label))) return "FINANCIAL_PROPOSAL";
    if (CV_PATTERNS.some((rx) => rx.test(label))) return "EXPERT_CV_PACKAGE";
    if (PROJECT_REF_PATTERNS.some((rx) => rx.test(label))) return "PROJECT_REFERENCE_PACKAGE";
  }

  return (ct === "TECHNICAL_PROPOSAL" ? "TECHNICAL_PROPOSAL" : currentType ? (currentType as NormalizedDocumentType) : "OTHER");
}

/** Returns true when the document type means "attach official original, don't generate narrative" */
export function requiresOfficialOriginal(normalizedType: NormalizedDocumentType): boolean {
  return normalizedType === "FINANCIAL_EVIDENCE" || normalizedType === "LEGAL_EVIDENCE" || normalizedType === "BID_FORM";
}

/** Returns true when the document is a control/internal row, not exported */
export function isControlDocument(normalizedType: NormalizedDocumentType): boolean {
  return normalizedType === "SUBMISSION_RULES";
}
