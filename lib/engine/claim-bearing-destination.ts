/**
 * Where an evidence anchor may attach, and whether the evidence supports it.
 *
 * THE DELIVERED DEFECT
 * --------------------
 * A submitted Technical Proposal's A.1 Company Overview read:
 *
 *   "Address: Addis Ababa, Sarbet - NOC Building, 1st Floor; branch offices at
 *    Hayahulet (Addis Ababa) and Kombolcha (Fikir Building, 1st Floor). G+6
 *    General Hospital – Dr Abdul Seid (…) demonstrates the firm's prior
 *    delivery of this exact scope element."
 *
 * A project citation was appended to the firm's postal address. The injector's
 * skip list understood structure — headings, bullets, table rows, code fences —
 * but not *meaning*, so an address block looked like an ordinary paragraph: over
 * eighty characters, no bullet, no pipe, no evidence marker yet.
 *
 * TWO CONDITIONS, BOTH REQUIRED
 * -----------------------------
 * An anchor may attach only where:
 *
 *   A. the destination is a claim-bearing sentence — real prose or a factual
 *      table cell — rather than metadata, contact details, page furniture, a
 *      signature block or a bare date; and
 *
 *   B. the evidence actually bears on the proposition being made.
 *
 * Condition B is what stops evidence being sprayed at paragraphs purely to lift
 * an evidence-density score. A project record earns its place in a paragraph
 * only when the paragraph is about something that project is evidence for.
 *
 * This module is the one place both questions are answered, so the injector,
 * the throughline enforcer and the Section C amplifier cannot drift apart.
 */

/** Label-value metadata that reads as a form field rather than a claim. */
const METADATA_LABEL_RX =
  /^\s*(?:\*\*)?(?:address|tel|telephone|phone|mobile|fax|e-?mail|email|website|web|url|subject|deadline|submitted\s+(?:to|by)|submission\s+(?:date|address|method|email)|attn|attention|ref(?:erence)?|date|signatory|signed|sector|client|contact|recipient|prepared\s+(?:by|for)|issued\s+(?:by|on)|revision|version|page)\b\s*(?:\*\*)?\s*[:\-–—]/i;

/**
 * A contact footer or letterhead strip: pipe-separated contact fragments, the
 * shape the proposal's own running footer uses.
 */
const PAGE_FURNITURE_RX = /\|[^|\n]{0,60}\|/;

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RX = /\+\d[\d\s()\-]{7,}/;

/** Sign-off and signature furniture. */
const SIGNATURE_RX =
  /^\s*(?:sincerely|yours\s+(?:faithfully|sincerely|truly)|signed\s+for\s+and\s+on\s+behalf|signatory\s*[:\-]|for\s+and\s+on\s+behalf\s+of|authorised\s+signatory)\b/i;

/** A line that is only a date, or only a date plus a label. */
const BARE_DATE_RX =
  /^\s*(?:date\s*[:\-–—]\s*)?(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)?\s*\d{0,2},?\s*(?:19|20)\d{2}\s*(?:[A-Za-z ]{0,24})?\s*$/i;

/** Structural blocks that were never prose to begin with. */
const NON_PROSE_RX: RegExp[] = [
  /^>\s/,          // blockquote
  /^\s*-\s/,       // bullet
  /^\s*\*\s/,      // bullet
  /^\s*\d+[.)]\s/, // numbered list
  /^\s*#/,         // heading
  /^\s*\|/,        // table row
  /^\s*```/,       // code fence
  /^_[A-Z]/,       // italic editorial note
];

/** Internal notes that exist to flag a gap, not to carry a claim. */
const INTERNAL_NOTE_RX = /\b(?:bid-?team\s+action|source-?evidence\s+action)\b/i;

export interface DestinationVerdict {
  eligible: boolean;
  /** Why it was refused — useful in logs and in test failure messages. */
  reason?: string;
}

/**
 * Condition A: may an evidence anchor attach to this block at all?
 *
 * Deliberately conservative. A block that cannot be shown to be prose is
 * refused, because a wrongly-placed citation reads worse to an evaluator than
 * an un-cited paragraph.
 */
export function isClaimBearingDestination(block: string, minLength = 80): DestinationVerdict {
  const text = block.trim();
  if (text.length < minLength) return { eligible: false, reason: "too short to carry a claim" };
  if (NON_PROSE_RX.some((rx) => rx.test(text))) return { eligible: false, reason: "not prose" };
  if (INTERNAL_NOTE_RX.test(text)) return { eligible: false, reason: "internal note" };
  if (SIGNATURE_RX.test(text)) return { eligible: false, reason: "signature block" };
  if (BARE_DATE_RX.test(text)) return { eligible: false, reason: "bare date" };
  if (METADATA_LABEL_RX.test(text)) return { eligible: false, reason: "metadata label line" };
  if (EMAIL_RX.test(text)) return { eligible: false, reason: "contains an email address" };
  if (PHONE_RX.test(text)) return { eligible: false, reason: "contains a phone number" };
  if (PAGE_FURNITURE_RX.test(text)) return { eligible: false, reason: "page furniture" };

  // A paragraph that is mostly "Label: value; Label: value" is an
  // administrative block even when no single pattern above caught it.
  const labelPairs = (text.match(/\b[A-Z][A-Za-z ]{2,24}\s*:/g) ?? []).length;
  const sentenceEnds = (text.match(/[.!?](?:\s|$)/g) ?? []).length;
  if (labelPairs >= 2 && labelPairs > sentenceEnds) {
    return { eligible: false, reason: "administrative label block" };
  }
  // Real prose has at least one finished sentence.
  if (sentenceEnds === 0) return { eligible: false, reason: "no complete sentence" };

  return { eligible: true };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "their", "there",
  "which", "where", "when", "will", "shall", "must", "have", "has", "been",
  "are", "was", "were", "our", "its", "his", "her", "they", "them", "these",
  "those", "than", "then", "each", "every", "any", "all", "such", "other",
  "under", "over", "between", "within", "across", "through", "during", "after",
  "before", "above", "below", "also", "both", "more", "most", "some", "only",
  "project", "projects", "proposal", "tender", "client", "firm", "company",
  "services", "service", "work", "works", "assignment", "delivery", "approach",
]);

function salientTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [])) {
    const word = raw.replace(/-+$/, "");
    if (word.length < 5) continue;
    if (STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

export interface EvidenceLike {
  name?: string | null;
  sector?: string | null;
  serviceAreas?: string | null | string[];
  summary?: string | null;
}

function evidenceTerms(evidence: EvidenceLike): Set<string> {
  const areas = Array.isArray(evidence.serviceAreas)
    ? evidence.serviceAreas.join(" ")
    : (evidence.serviceAreas ?? "");
  return salientTerms([evidence.name ?? "", evidence.sector ?? "", areas, evidence.summary ?? ""].join(" "));
}

/**
 * Condition B: does this evidence bear on what the paragraph actually claims?
 *
 * An anchor is allowed when the destination and the evidence record share at
 * least one substantive domain term. That is a low bar on purpose — it is not
 * trying to judge argument quality, only to refuse the case the defect showed:
 * a citation attached to text it has nothing to do with. Where relatedness
 * cannot be established, the paragraph is left un-cited rather than padded.
 */
export function evidenceSupportsProposition(block: string, evidence: EvidenceLike): boolean {
  const destination = salientTerms(block);
  if (destination.size === 0) return false;
  const source = evidenceTerms(evidence);
  if (source.size === 0) return false;
  for (const term of source) {
    if (destination.has(term)) return true;
  }
  return false;
}

/** Both conditions, which is what every caller actually wants to ask. */
export function mayAttachEvidence(block: string, evidence: EvidenceLike, minLength = 80): DestinationVerdict {
  const destination = isClaimBearingDestination(block, minLength);
  if (!destination.eligible) return destination;
  if (!evidenceSupportsProposition(block, evidence)) {
    return { eligible: false, reason: "evidence does not bear on this proposition" };
  }
  return { eligible: true };
}
