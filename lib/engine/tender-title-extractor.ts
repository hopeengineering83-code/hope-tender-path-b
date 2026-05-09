// Canonical tender title re-extractor (May-7 G1 fix)
//
// THE PROBLEM
// ───────────
// `tender.title` is whatever the user typed at upload time, often a short
// generic label like "PATH Tender" or "Pharo Foundation Tender". The
// engine then propagates that string into:
//   • Cover Letter "Subject:" line
//   • Cover Page assignment-name field
//   • Executive Summary first paragraph
//   • DOCX file name
//
// Result: a real RFP titled "Architectural Consultancy Services for Pharo
// Health Ethiopia Specialty Medical Center, RFP No. 2026-024" surfaces in
// the proposal as "Pharo Foundation Tender" — which costs scored points
// because evaluators expect the exact RFP wording.
//
// THE FIX
// ───────
// Pure-regex extractor, no AI call. Walks the tender file text(s) looking
// for canonical title patterns:
//   • "RFP No. <X> — <title>"  (most common)
//   • "Subject: <title>"
//   • "Tender Title: <title>"
//   • "Tender for <scope>"
//   • "Request for Proposal for <scope>"
//   • "Invitation to Tender for <scope>"
//
// Returns the longest, most specific match. Caller decides whether to
// override `tender.title` (only when stored title is generic — e.g.
// shorter than 30 chars or matches a "<Client> Tender" pattern).

export interface TenderTitleCandidate {
  title: string;
  rfpId?: string;
  source: string; // which pattern matched
  confidence: number; // 0..1
}

const TITLE_PATTERNS: Array<{ rx: RegExp; source: string; confidence: number }> = [
  // "RFP No. 2026-024 — Architectural Design, Floor Plan and Modeling of Office Space"
  // "RFQ#2026-024 / Architectural Design ..."
  { rx: /\b(RF[QPI]|REOI|EOI)\s*(?:No\.?|#|Ref\.?|Reference)?\s*([A-Z0-9\-/.]{3,30})\s*[\-–—:|/]\s*([A-Z][A-Za-z0-9 ,'’()/&\-]{12,160})/i, source: "RFP_NO_DASH_TITLE", confidence: 0.95 },
  // "Tender Title: Architectural Consultancy Services for ..."
  { rx: /\b(?:Tender\s+Title|Project\s+Title|Assignment\s+Title)\s*[:\-]\s*([A-Z][A-Za-z0-9 ,'’()/&\-]{12,180})/i, source: "TENDER_TITLE_LABEL", confidence: 0.92 },
  // "Subject: Architectural Consultancy Services for ..."  (in cover letter sample)
  { rx: /\bSubject\s*[:\-]\s*([A-Z][A-Za-z0-9 ,'’()/&\-]{12,180})/i, source: "SUBJECT_LABEL", confidence: 0.85 },
  // "Request for Proposal for the Provision of <scope>"
  { rx: /\b(?:Request\s+for\s+Proposal|Invitation\s+to\s+(?:Tender|Bid)|Call\s+for\s+Expressions?\s+of\s+Interest)\s+(?:for(?:\s+the)?(?:\s+(?:Provision|Supply|Delivery|Engagement|Procurement)\s+of)?)\s+([A-Z][A-Za-z0-9 ,'’()/&\-]{12,180})/i, source: "RFP_FOR_SCOPE", confidence: 0.88 },
  // "Architectural Consultancy Services for Pharo Health Ethiopia ..."
  // (sentence-start title that mentions Consultancy / Design / Construction Services for ENTITY)
  { rx: /\b((?:Architectural|Engineering|Consultancy|Design|Construction|Supervision|Feasibility|Master\s+Plan(?:ning)?|Geotechnical|Civil|Electrical|Mechanical|Sanitary|Interior)\s+(?:Consultancy\s+)?Services?\s+for\s+[A-Z][A-Za-z0-9 ,'’()/&\-]{8,160})/, source: "SERVICE_FOR_ENTITY", confidence: 0.78 },
];

const RFP_ID_PATTERN = /\b(RF[QPI]|REOI|EOI|TENDER\s*REF|REF)\s*(?:No\.?|#)?\s*([A-Z0-9\-/.]{3,30})/i;

function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[.,;:\-–—\s]+$/, "")
    .trim();
}

function isJunkTitle(s: string): boolean {
  const lower = s.toLowerCase();
  return /\b(headquarters|relationship|full\s+name|references\s+where\s+available|photos\s+or\s+drawings|not\s+specified|please\s+see|attached|above|below)\b/i.test(s)
    || lower.length < 10
    || lower.length > 200
    // Reject titles that are obvious enumerator captures.
    || /^[\d.\s]+/.test(s);
}

/**
 * Extracts the most likely canonical RFP title from tender body text.
 * Returns null when no pattern matched with confidence ≥ 0.5.
 */
export function extractCanonicalTenderTitle(tenderText: string): TenderTitleCandidate | null {
  if (!tenderText || tenderText.length < 50) return null;

  // Look for an RFP / Tender ID anywhere in the text — this becomes the
  // optional `rfpId` we attach to the result.
  const idM = tenderText.match(RFP_ID_PATTERN);
  const rfpId = idM ? `${idM[1].toUpperCase()} ${idM[2]}`.replace(/\s+/g, " ").trim() : undefined;

  // Try every pattern; keep the highest-confidence non-junk match.
  let best: TenderTitleCandidate | null = null;
  for (const { rx, source, confidence } of TITLE_PATTERNS) {
    const m = tenderText.match(rx);
    if (!m) continue;
    // For RFP_NO_DASH_TITLE the captured title is in group 3; otherwise group 1.
    const title = clean(source === "RFP_NO_DASH_TITLE" ? (m[3] ?? "") : (m[1] ?? ""));
    if (!title || isJunkTitle(title)) continue;
    if (!best || confidence > best.confidence) {
      best = { title, rfpId, source, confidence };
    }
  }
  return best;
}

/**
 * Decide whether `extracted` should override the stored title.
 *
 * RULES:
 *   • If stored title is empty → use extracted.
 *   • If stored title is generic (< 30 chars OR matches "<Word> Tender"
 *     OR "Tender Submission") → use extracted IF its confidence ≥ 0.78.
 *   • If stored title looks substantive (≥ 40 chars + no generic suffix)
 *     → keep stored.
 *   • Otherwise → keep stored (conservative default).
 */
export function pickBestTenderTitle(stored: string | null | undefined, extracted: TenderTitleCandidate | null): { title: string; rfpId?: string; source: "STORED" | "EXTRACTED" } {
  const storedClean = (stored ?? "").replace(/\s+/g, " ").trim();
  const isGenericStored = !storedClean
    || storedClean.length < 30
    || /\bTender\s*Submission\b/i.test(storedClean)
    || /^[A-Z][A-Za-z\s]{1,28}\s+Tender$/.test(storedClean);

  if (extracted && (isGenericStored || (storedClean.length === 0))) {
    if (extracted.confidence >= 0.78) {
      return { title: extracted.title, rfpId: extracted.rfpId, source: "EXTRACTED" };
    }
  }
  return { title: storedClean || extracted?.title || "Tender Submission", source: "STORED" };
}
