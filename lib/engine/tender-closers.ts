/**
 * Tender Closers (PR M) — Tender-specific obstacles, Commercial
 * Understanding, Ethics & Anti-Bribery declaration.
 *
 * THE PROBLEM (from benchmark gap analysis, items #10, #11, #12):
 *
 *   Item #10: Risk Register is generic. Claude renders a separate
 *   "Potential Obstacles and Mitigation Measures" table tied to
 *   tender-specific issues (floor area discrepancy, file format
 *   mismatch, brand alignment). The app's risks section reads as a
 *   generic boilerplate.
 *
 *   Item #11: Claude closes with a "Commercial Understanding and
 *   Compliance" block that echoes payment terms, validity period,
 *   envelope rules, revision count VERBATIM. The app has nothing
 *   equivalent — looks like the bidder ignored the commercial clauses.
 *
 *   Item #12: The Ethics / Anti-Bribery declaration in the app is
 *   four generic bullets. Claude renders an 8-clause declaration with
 *   the firm's Code of Ethics document reference, an Ethiopian law
 *   citation (Proc. No. 657/2009), and a GM signature block.
 *
 * THE FIX
 * Three deterministic post-pass builders that splice the missing
 * close-out content into Section D / E / Declarations zone of the
 * proposal. Each is idempotent via marker comments.
 *
 *   - tender-specific obstacles: parses tender text for numeric
 *     contradictions (two area numbers, two dates), file format
 *     requirements (DWG, AutoCAD), and brand mentions, then emits
 *     specific obstacle rows tied to those findings.
 *
 *   - commercial understanding: parses tender for payment terms,
 *     validity, envelope rules, revision count, taxes, and emits a
 *     verbatim-echo block confirming bidder's acknowledgement.
 *
 *   - ethics declaration: emits an 8-clause structured declaration
 *     with Code of Ethics reference (vault-aware) and Ethiopian law
 *     citation (proc. no. 657/2009 for default; vault override
 *     possible).
 *
 * Wired in generate-elite.ts after personnel-deep (PR L) and before
 * placeholder-stripper (PR J).
 */

const MARKER_OBSTACLES = "<!-- closers:tender-obstacles -->";
const MARKER_COMMERCIAL = "<!-- closers:commercial-understanding -->";
const MARKER_ETHICS = "<!-- closers:ethics-declaration -->";

const HEADING_PATTERNS_OBSTACLES: RegExp[] = [
  /^##\s+(?:Tender-Specific\s+)?(?:Potential\s+)?Obstacles\s+(?:and|&)\s+Mitigation/im,
  /^##\s+Tender-Specific\s+Risks/im,
  /^##\s+Specific\s+(?:Tender\s+)?Concerns/im,
];

const HEADING_PATTERNS_COMMERCIAL: RegExp[] = [
  /^##\s+Commercial\s+Understanding(?:\s+(?:and|&)\s+Compliance)?/im,
  /^##\s+Commercial\s+Acknowledgement/im,
  /^##\s+Pre-Submission\s+Commercial\s+Note/im,
];

const HEADING_PATTERNS_ETHICS: RegExp[] = [
  /^##\s+(?:Anti-Bribery|Ethics|Anti-?Corruption)(?:\s+Declaration|\s+Code|\s+Statement)?/im,
  /^##\s+Code\s+of\s+Ethics/im,
];

// ─── Tender-specific obstacles ─────────────────────────────────────────

/**
 * All-caps runs that extraction produces but a tender never uses as a name.
 *
 * These fall into three families, all of which have been observed leaking
 * into client-facing text as though they were the procuring entity's brand:
 *
 *   - the extractor's own structural markers (FILE, PAGE, METADATA, PARSED);
 *   - table column labels and cell values (STATUS, MANDATORY, SCORED, YES);
 *   - ordinary tender furniture set in capitals (ANNEX, TOR, LOT, RFP).
 *
 * Anything on this list is a label about the document, not an identity in it.
 */
const NON_BRAND_ALLCAPS_TOKENS = new Set([
  "FILE", "FILES", "PAGE", "PAGES", "TEXT", "METADATA", "PARSED", "SOURCE", "DOCUMENT",
  "TITLE", "STATUS", "TYPE", "NAME", "DATE", "NOTE", "NOTES", "REF", "REFERENCE",
  "MANDATORY", "SCORED", "OPTIONAL", "REQUIRED", "YES", "NO", "N/A", "NIL", "TBD", "TBC",
  "ANNEX", "APPENDIX", "SECTION", "PART", "ITEM", "LOT", "TOR", "RFP", "RFQ", "EOI", "ITB",
  "TOTAL", "SUBTOTAL", "SUM", "QTY", "UNIT", "VAT", "TIN", "ETB", "USD", "EUR",
  "PDF", "DOC", "DOCX", "XLS", "XLSX", "CSV", "ZIP",
  "AND", "THE", "FOR", "ALL", "ANY", "NOT", "SHALL", "MUST",
]);

/**
 * The client's name for the brand-alignment row, taken from the extracted,
 * source-grounded client identity rather than guessed from the tender text.
 *
 * WHY THIS IS NOT A CAPITALISATION HEURISTIC ANY MORE
 * ---------------------------------------------------
 * This used to return the first all-caps run in the parsed tender, filtered
 * against a list of known non-brand tokens. A shipped proposal told the client
 * "Client identity (FILE) implies brand-alignment requirements" because FILE
 * was the first such run; the list grew a FILE entry, and the very next run
 * shipped "Client identity (CLIENT)" instead. That is the whole problem with
 * the approach: CLIENT, CONSULTANT, EMPLOYER, CONTRACTOR and PROCURING ENTITY
 * are the standard capitalised defined terms of a construction tender, so the
 * heuristic's most likely answer is always a defined term, and no blacklist
 * finishes. Capitalisation simply does not distinguish an organisation's name
 * from a word a drafter chose to capitalise.
 *
 * The application already knows the answer: clientName is extracted, grounded
 * to a source page and quote, and gated as an always-critical field. Using it
 * means the row either names the real client or is not built at all.
 */
function brandAlignmentClientName(clientName?: string | null): string | null {
  const trimmed = (clientName ?? "").trim();
  if (trimmed.length < 2) return null;
  // The extractor can hand back a run-on of several labelled fields; the
  // client's name is the part before the first embedded label.
  const firstField = trimmed.split(/\s*(?:Procuring Entity|Legal Client Name|Project Name|Client Name)\s*[:\-]/i)[0].trim();
  const candidate = (firstField.length >= 2 ? firstField : trimmed).replace(/[\s,;:]+$/, "");
  if (candidate.length < 2 || candidate.length > 80) return null;
  // A bare defined term is a role, not an identity.
  if (NON_BRAND_ALLCAPS_TOKENS.has(candidate.toUpperCase())) return null;
  if (/^(?:client|consultant|employer|contractor|procuring entity|bidder|supplier|purchaser)$/i.test(candidate)) return null;
  return candidate;
}

interface ObstacleRow {
  category: string;
  obstacle: string;
  mitigation: string;
}

function detectObstacles(tenderText: string, clientName?: string | null): ObstacleRow[] {
  if (!tenderText || tenderText.length < 200) return [];
  const out: ObstacleRow[] = [];
  const text = tenderText.replace(/\s+/g, " ").slice(0, 12_000);

  // 1. Numeric contradictions — two different area / count values
  // mentioned for the same thing.
  const sqmValues = [...text.matchAll(/\b(\d{2,5})\s*(?:m2|sqm|sq\.?\s*m|square\s+metres?|square\s+meters?)\b/gi)]
    .map((m) => ({ value: parseInt(m[1], 10), full: m[0] }))
    .filter((v) => Number.isFinite(v.value));
  const distinctSqm = [...new Set(sqmValues.map((s) => s.value))];
  if (distinctSqm.length >= 2) {
    distinctSqm.sort((a, b) => a - b);
    out.push({
      category: "Tender data contradiction",
      obstacle: `Two different area figures appear in the tender (${distinctSqm.join(" sqm vs ")} sqm). The bidder will need to confirm which is contractually applicable before issuing detailed designs.`,
      mitigation: "Inception report includes a clarification request to the client confirming the binding floor area before the 30% design gate. Pre-design site visit (within 5 working days of award) measures the actual area for cross-check.",
    });
  }

  // 2. File format / software requirement
  if (/\b(?:DWG|AutoCAD|Revit|BIM|IFC|CAD)\b/i.test(text)) {
    const hint = (text.match(/\bAutoCAD\s+\d{4}\b/) || [])[0] || (text.match(/\b(?:DWG|Revit|BIM|IFC)\b/) || [])[0] || "CAD/BIM file format";
    out.push({
      category: "Deliverable format",
      obstacle: `Tender requires deliverables in a specific software format (${hint}). Cross-version compatibility (e.g., later AutoCAD producing files older releases cannot open) is a recurring delivery issue.`,
      mitigation: `All drawings will be saved in two formats: native (latest) AND a tender-required backwards-compatible version. File-naming convention will follow tender instructions verbatim. Document control register tracks every issued drawing's revision and format.`,
    });
  }

  // 3. Brand / website mention — implies brand-alignment work
  //
  // The brand pattern is /\b[A-Z][A-Z]{2,}.../ — any run of three or more
  // capitals in the extracted tender text. Extracted text is full of such
  // runs that are not brands: the extractor's own structural markers (FILE,
  // PAGE, METADATA, TEXT), table column labels (STATUS, MANDATORY, SCORED),
  // and document furniture (ANNEX, TOR, LOT). A real shipped proposal told
  // the client that "Client identity (FILE) implies brand-alignment
  // requirements", because "FILE" was the first all-caps run in the parsed
  // document. Anything that is a source label rather than a name is rejected
  // here; when nothing brand-like survives, the row is built from the
  // website (a real fact) or skipped entirely rather than naming a token the
  // tender never used as an identity.
  const websiteMatch = text.match(/\b(?:https?:\/\/|www\.)\S+/i);
  const brandLabel = brandAlignmentClientName(clientName);
  if (websiteMatch || brandLabel) {
    const identityClause = brandLabel
      ? `The client's identity (${brandLabel.slice(0, 40)}) implies brand-alignment requirements.`
      : `The tender references the client's own web presence, which implies brand-alignment requirements.`;
    out.push({
      category: "Brand alignment",
      obstacle: `${identityClause} Designs that ignore the client's visual standard are routinely rejected at design-review.`,
      mitigation: `Brand guidelines will be downloaded from the client website / requested at inception. Concept design at 30% gate carries an explicit brand-alignment review item. Revision rounds budgeted into fee for any brand-driven adjustments.`,
    });
  }

  // 4. Tight schedule indicator
  const scheduleMatch = text.match(/\b(\d{1,3})\s+(?:calendar\s+)?days?\b/i);
  if (scheduleMatch) {
    const days = parseInt(scheduleMatch[1], 10);
    if (days > 0 && days <= 45) {
      out.push({
        category: "Schedule risk",
        obstacle: `Engagement duration of ${scheduleMatch[0]} is aggressive for the scope implied by the tender. Slipping any single phase puts the entire critical path at risk.`,
        mitigation: `Inception kicks off within 24 hours of award. Phases overlap where logically possible (e.g., baseline data collection in parallel with design brief confirmation). Daily stand-ups; rolling 3-week look-ahead; client decision SLAs documented and tracked.`,
      });
    }
  }

  // 5. Site visit requirement
  if (/\bsite\s+visit\b/i.test(text)) {
    out.push({
      category: "Site visit logistics",
      obstacle: "Site visit / pre-bid meeting requirement creates a logistic constraint — missing it can disqualify the bid or generate avoidable design assumptions.",
      mitigation: "Site visit attendance confirmed at tender intake. Visit notes filed in the bid archive. All on-site measurements cross-checked against tender drawings; any discrepancy raised in writing through the clarification window.",
    });
  }

  // 6. Revision-rounds clause
  if (/\b\d+\s+(?:revision|round)\b/i.test(text) || /\brevision\s+round\b/i.test(text)) {
    out.push({
      category: "Revision scope",
      obstacle: "Tender specifies a fixed number of revision rounds. Out-of-scope revisions consume budget; in-scope revisions need to be tightly controlled.",
      mitigation: "Each revision round is preceded by a structured client feedback session with consolidated comments. Comments resolution log tracks every comment to closure. Out-of-scope changes flagged in writing before any work begins.",
    });
  }

  return out;
}

export function buildTenderObstaclesBlock(tenderText: string, clientName?: string | null): string {
  const rows = detectObstacles(tenderText, clientName);
  if (rows.length === 0) return "";

  const head = "| # | Category | Tender-Specific Obstacle | Mitigation |";
  const sep = "|---|----------|---------------------------|------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.category} | ${r.obstacle} | ${r.mitigation} |`);

  return [
    MARKER_OBSTACLES,
    "## Tender-Specific Obstacles and Mitigation",
    "",
    "Beyond the generic risk register, the bidder has examined this tender's specific text for issues that recur in similar engagements. The table below lists obstacles directly traceable to clauses in this tender and the mitigation built into the engagement plan.",
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── Commercial Understanding ───────────────────────────────────────────

interface CommercialDetail {
  field: string;
  detected: string;
  acknowledgement: string;
}

/**
 * Turn a required file name or extension into the label a reader expects
 * ("Technical Proposal.pdf" -> "PDF"). Returns null when nothing usable is
 * supplied, so the caller falls back to the tender-text detection.
 */
function normalizeFormatLabel(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const ext = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  const cleaned = ext.replace(/[^A-Za-z0-9/]/g, "").toUpperCase();
  return cleaned.length >= 2 && cleaned.length <= 8 ? cleaned : null;
}

function detectCommercialDetails(
  tenderText: string,
  authoritativeDeliverableFormat?: string | null,
): CommercialDetail[] {
  if (!tenderText || tenderText.length < 200) return [];
  const out: CommercialDetail[] = [];
  const text = tenderText.replace(/\s+/g, " ").slice(0, 12_000);

  // Validity
  const validity = text.match(/\b(?:proposal\s+)?validity\s*[:\-]?\s*(\d{1,3}\s*(?:calendar\s*)?days?)\b/i)
    || text.match(/\bvalid\s+for\s+(?:a\s+period\s+of\s+)?(\d{1,3}\s*(?:calendar\s*)?days?)\b/i);
  if (validity) {
    out.push({
      field: "Proposal Validity",
      detected: validity[1],
      acknowledgement: `The bidder confirms this proposal remains valid for ${validity[1]} from the submission date.`,
    });
  }

  // Payment period
  const payment = text.match(/\b(\d{1,3})[- ]days?\s+payment\b/i)
    || text.match(/\bpayment\s+(?:within\s+)?(\d{1,3})\s+days\b/i)
    || text.match(/\bpayment\s+period\s*[:\-]?\s*(\d{1,3}\s+days)\b/i);
  if (payment) {
    out.push({
      field: "Payment Terms",
      detected: payment[1] + (payment[1].includes("day") ? "" : " days"),
      acknowledgement: `The bidder acknowledges the ${payment[1]}-day payment period for approved invoices and has built this into the cash-flow plan for this engagement.`,
    });
  }

  // Two-envelope rule
  if (/\b(?:two\s+envelopes?|separate\s+(?:technical|financial)\s+envelopes?|technical\s+(?:and|&)\s+financial\s+envelopes?)\b/i.test(text)) {
    out.push({
      field: "Submission Envelopes",
      detected: "Two envelopes (Technical + Financial)",
      acknowledgement: "The technical and financial proposals are submitted in separate sealed envelopes per tender instructions. The financial proposal is opened only for technically responsive bidders.",
    });
  }

  // Tax inclusion
  if (/\b(?:tax(?:es)?\s+included|VAT\s+inclusive|all\s+taxes\s+inclusive)\b/i.test(text)) {
    out.push({
      field: "Tax Treatment",
      detected: "All taxes included",
      acknowledgement: "All applicable Ethiopian taxes (VAT, withholding, and any other government levies) are included in the financial proposal. No additional tax claim will be raised.",
    });
  }

  // Revision rounds
  const revisions = text.match(/\b(\d{1,2})\s+revision\s+rounds?\b/i)
    || text.match(/\bup\s+to\s+(\d{1,2})\s+revisions?\b/i);
  if (revisions) {
    out.push({
      field: "Revision Rounds",
      detected: revisions[1] + " rounds",
      acknowledgement: `The fixed fee includes the deliverable plus up to ${revisions[1]} revision rounds based on consolidated client feedback. Out-of-scope revisions are flagged in writing before any work commences.`,
    });
  }

  // File format
  //
  // This row states, in the client's copy, what format the bidder will submit
  // in. That is a fact the confirmed Build Plan owns — it is the authority for
  // which files are actually produced and delivered. The regex below reads the
  // extracted tender text, which also contains the source document's own file
  // name ("pharo tender document.docx") and any format mentioned in passing, so
  // on a real tender it announced "Deliverable Format | docx" and promised
  // "Final deliverables are issued in DOCX format" while the confirmed Build
  // Plan required exactly one file: Technical Proposal.pdf. A row that
  // contradicts the deliverable actually being submitted is worse than no row,
  // so when an authoritative format is known it wins, and a detected format
  // that disagrees with it is dropped rather than printed.
  const fileFmt = text.match(/\b(AutoCAD|DWG|Revit|PDF\/A|MS\s+Word|DOCX|XLSX)\b/i);
  const authoritative = normalizeFormatLabel(authoritativeDeliverableFormat);
  if (authoritative) {
    out.push({
      field: "Deliverable Format",
      detected: authoritative,
      acknowledgement: `Final deliverables are issued in ${authoritative} format per the tender's submission instructions. File-naming convention is followed verbatim.`,
    });
  } else if (fileFmt) {
    out.push({
      field: "Deliverable Format",
      detected: fileFmt[0],
      acknowledgement: `Final deliverables are issued in ${fileFmt[0]} format per tender instructions, plus any tender-required additional formats. File-naming convention is followed verbatim.`,
    });
  }

  return out;
}

export interface CommercialUnderstandingOptions {
  /**
   * The format the submission is actually delivered in, derived from the
   * confirmed Build Plan (e.g. "PDF"). When set it overrides any format
   * mentioned in the tender text, because the Build Plan — not a regex over
   * extracted prose — is the authority for what is submitted.
   */
  authoritativeDeliverableFormat?: string | null;
  /**
   * False when the tender requires no financial proposal at this stage. The
   * closing paragraph must then not tell the client that commercial clauses
   * are "built into the technical and financial submission", because no
   * financial submission exists.
   */
  financialProposalRequired?: boolean;
}

export function buildCommercialUnderstandingBlock(
  tenderText: string,
  opts: CommercialUnderstandingOptions = {},
): string {
  const rows = detectCommercialDetails(tenderText, opts.authoritativeDeliverableFormat);
  if (rows.length === 0) return "";

  const head = "| Commercial Field | Tender Says | Bidder's Acknowledgement |";
  const sep = "|------------------|-------------|--------------------------|";
  const body = rows.map((r) => `| ${r.field} | ${r.detected} | ${r.acknowledgement} |`);

  // When the tender asks for no financial proposal at this stage, saying the
  // clauses are built into "the technical and financial submission" tells the
  // evaluator a financial submission is enclosed. Nothing about the
  // two-envelope handling changes for tenders that do require one.
  const submissionPhrase = opts.financialProposalRequired === false
    ? "built into this technical submission"
    : "built into the technical and financial submission";

  return [
    MARKER_COMMERCIAL,
    "## Commercial Understanding and Compliance",
    "",
    `The bidder has examined the commercial clauses in the tender and confirms acknowledgement on each below. This is not a separate offer — it is the bidder's written confirmation that every commercial clause is read, understood, and ${submissionPhrase}.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── Ethics & Anti-Bribery Declaration ─────────────────────────────────

export interface EthicsVault {
  companyName: string;
  legalName?: string | null;
  gmName?: string | null;
  gmTitle?: string | null;
  gmLicense?: string | null;
  codeOfEthicsRef?: string | null; // optional: HAEC/125/22 etc.
  countryLegalCitation?: string | null; // optional: Proc. No. 657/2009
}

export function buildEthicsDeclarationBlock(vault: EthicsVault): string {
  const company = vault.legalName?.trim() || vault.companyName;
  // An identified Code of Ethics is a recorded fact; an unidentified one is not.
  // codeOfEthicsRef is null on every production call today, so the old default
  // ("the firm's internal Code of Ethics document") cited a document nothing in
  // the vault names.
  const identifiedCodeRef = vault.codeOfEthicsRef?.trim() || null;
  const law = vault.countryLegalCitation?.trim() || "Federal Ethics and Anti-Corruption Commission Establishment Proclamation No. 433/2005 and Federal Anti-Corruption Special Procedure and Rules of Evidence Proclamation No. 657/2009";
  const gmLine = vault.gmName
    ? `${vault.gmName}${vault.gmTitle ? `, ${vault.gmTitle}` : ", General Manager"}${vault.gmLicense ? ` (${vault.gmLicense})` : ""}`
    : "General Manager";

  return [
    MARKER_ETHICS,
    "## Anti-Bribery, Ethics, and Conflict of Interest Declaration",
    "",
    `${company} ("the Bidder") makes the following declaration in connection with this submission. This declaration is made by the duly authorised representative below and binds the Bidder for the duration of any contract awarded under this tender.`,
    "",
    `1. **No bribery or corrupt practice** — The Bidder has not offered, given, paid, or promised any inducement (financial or otherwise) to any officer, employee, or representative of the Procuring Entity in connection with this submission. The Bidder will not do so during contract performance.`,
    "",
    `2. **No collusive bidding** — The Bidder has prepared this submission independently. There has been no consultation, communication, or agreement with any competing bidder concerning prices, methodology, or any other aspect of this submission.`,
    "",
    `3. **No conflict of interest** — The Bidder has disclosed in writing any actual, potential, or perceived conflict of interest. No principal, director, expert, or sub-consultant on this submission holds a relationship with the Procuring Entity that would materially affect impartiality.`,
    "",
    `4. **No use of confidential information** — The Bidder has not obtained or used confidential information from the Procuring Entity in preparing this submission. Any information supplied during the bid window has been treated as restricted and shared only with personnel directly involved in this submission.`,
    "",
    // Clause 5 used to read: "All personnel proposed for this engagement have
    // signed the Bidder's Code of Ethics (...)". That is a completed act by
    // each named individual, asserted as fact. The company authority records
    // that an ethics framework exists; it holds no per-person signature
    // evidence, and on every production call the cited reference was the
    // generic phrase "the firm's internal Code of Ethics document" — a
    // signature against a document nothing in the vault identifies. A firm
    // policy and a forward commitment are both true and both defensible; a
    // historical claim about individuals is neither.
    identifiedCodeRef
      ? `5. **Compliance with the firm's ethics framework** — Personnel assigned to this engagement work under the Bidder's Code of Ethics (${identifiedCodeRef}). Acceptance of the Code is a condition of assignment, and breach of it is grounds for immediate removal from the engagement.`
      : `5. **Compliance with the firm's ethics framework** — Personnel assigned to this engagement work under the Bidder's ethics and anti-corruption framework. Acceptance of that framework is a condition of assignment, and breach of it is grounds for immediate removal from the engagement.`,
    "",
    `6. **Compliance with applicable law** — The Bidder is subject to ${law} and any other applicable national, regional, or international anti-corruption framework. The Bidder cooperates with any lawful investigation arising from this engagement.`,
    "",
    // Clause 7 used to assert an existing operational control — "The Bidder
    // maintains an internal whistleblowing channel ... confidential and
    // protected" — with nothing in the vault recording one. What the Bidder
    // can commit to for this engagement is a route for raising an integrity
    // concern, so that is what it now says.
    `7. **Raising an integrity concern** — For the duration of this engagement, any team member, sub-contractor, or client representative may raise an integrity concern in confidence with the signatory below, and the Bidder undertakes to investigate it and to protect the person who raises it from retaliation.`,
    "",
    `8. **Right of audit** — The Bidder accepts the Procuring Entity's right to audit any aspect of contract performance relevant to integrity, including expenses, sub-contractor relationships, and on-site practices, on reasonable notice.`,
    "",
    `**Signed for and on behalf of ${company}**`,
    "",
    `Signatory: ${gmLine}`,
    "",
    "Signature: ____________________   Stamp: ____________________   Date: ____________________",
    "",
  ].join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface ClosersResult {
  markdown: string;
  injected: { obstacles: boolean; commercial: boolean; ethics: boolean };
}

export function injectTenderClosers(
  markdown: string,
  opts: {
    tenderText: string;
    ethicsVault: EthicsVault;
    /** Format the submission is actually delivered in, from the confirmed Build Plan. */
    authoritativeDeliverableFormat?: string | null;
    /** False when the tender requires no financial proposal at this stage. */
    financialProposalRequired?: boolean;
    /** Extracted, source-grounded client identity. Names the brand-alignment row. */
    clientName?: string | null;
  },
): ClosersResult {
  const blocks: string[] = [];
  const injected = { obstacles: false, commercial: false, ethics: false };

  const hasObstacles = markdown.includes(MARKER_OBSTACLES) || HEADING_PATTERNS_OBSTACLES.some((p) => p.test(markdown));
  const hasCommercial = markdown.includes(MARKER_COMMERCIAL) || HEADING_PATTERNS_COMMERCIAL.some((p) => p.test(markdown));
  const hasEthics = markdown.includes(MARKER_ETHICS) || HEADING_PATTERNS_ETHICS.some((p) => p.test(markdown));

  if (!hasObstacles) {
    const block = buildTenderObstaclesBlock(opts.tenderText, opts.clientName);
    if (block) {
      blocks.push(block);
      injected.obstacles = true;
    }
  }
  if (!hasCommercial) {
    const block = buildCommercialUnderstandingBlock(opts.tenderText, {
      authoritativeDeliverableFormat: opts.authoritativeDeliverableFormat,
      financialProposalRequired: opts.financialProposalRequired,
    });
    if (block) {
      blocks.push(block);
      injected.commercial = true;
    }
  }
  if (!hasEthics) {
    blocks.push(buildEthicsDeclarationBlock(opts.ethicsVault));
    injected.ethics = true;
  }

  if (blocks.length === 0) return { markdown, injected };

  // Insert before Compliance Matrix / Section E (so the closers sit at
  // end of Section D / pre-compliance), or at end of doc.
  const lines = markdown.split("\n");
  let insertAt = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+E\b/i.test(lines[i]) || /^#\s+Compliance\s+Matrix/i.test(lines[i])) {
      insertAt = i;
      break;
    }
  }

  const out = [
    ...lines.slice(0, insertAt),
    "",
    blocks.join("\n"),
    "",
    ...lines.slice(insertAt),
  ];

  return { markdown: out.join("\n"), injected };
}
