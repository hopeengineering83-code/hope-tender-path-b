import { detectOfficialTemplateRequirement } from "./official-template-detector";
import { statesFinancialSeparation } from "./financial-separation-rule";

export type SubmissionPlanCategory =
  | "REQUIRED_OUTPUT_FILE"
  | "FORM_TEMPLATE_TO_COMPLETE"
  | "ORIGINAL_EVIDENCE_ATTACHMENT"
  | "INTERNAL_COMPLIANCE_CONTROL"
  | "SUBMISSION_RULE"
  | "COMMERCIAL_SEPARATION_RULE";

export type ClassifierInput = {
  title?: string | null;
  description?: string | null;
  requirementType?: string | null;
  exactFileName?: string | null;
};

export type ClassifierResult = {
  category: SubmissionPlanCategory;
  rationale: string;
  shouldBePlannedFile: boolean;
};

function text(input: ClassifierInput): string {
  return `${input.title ?? ""} ${input.description ?? ""} ${input.exactFileName ?? ""}`.toLowerCase();
}

function result(category: SubmissionPlanCategory, rationale: string): ClassifierResult {
  return {
    category,
    rationale,
    shouldBePlannedFile: category === "REQUIRED_OUTPUT_FILE" || category === "FORM_TEMPLATE_TO_COMPLETE",
  };
}

function isProbablyDeliverable(input: ClassifierInput): boolean {
  if ((input.exactFileName ?? "").trim().length > 0) return true;
  const t = (input.requirementType ?? "").toUpperCase();
  return ["FORM", "ANNEX", "SCHEDULE", "DECLARATION"].includes(t);
}

const DELIVERY_CHANNEL = String.raw`(?:e-?mail(?:ed)?|electronic(?:ally)?|online|web|(?:e-?)?portal|e-?procurement|e-?tender(?:ing)?|hard[\s-]?cop(?:y|ies)|physical|paper|postal|post|courier|hand[\s-]?deliver(?:y|ed)?|in[\s-]person|sealed[\s-]envelope)`;
const CHANNEL_SUBMISSION = new RegExp(
  String.raw`\b${DELIVERY_CHANNEL}\s+(?:bid\s+|tender\s+|proposal\s+)?submission\b`
  + String.raw`|\bsubmission\s+(?:by|via|through|using|in)\s+(?:an?\s+|the\s+)?${DELIVERY_CHANNEL}\b`,
);
const DELIVERABLE_NOUN = /\b(?:form|letter|proposal|sheet|schedule|template|annex(?:ure)?|appendix|declaration|certificate|profile|cv|statement|report|plan|matrix|checklist)\b/;

/** True when the row names a submission delivery channel and nothing that is itself a document. */
export function namesOnlyADeliveryChannel(value: string): boolean {
  const v = value.toLowerCase();
  return CHANNEL_SUBMISSION.test(v) && !DELIVERABLE_NOUN.test(v);
}

export function classifySubmissionPlanItem(input: ClassifierInput): ClassifierResult {
  const value = text(input);
  if (!value.trim()) return result("INTERNAL_COMPLIANCE_CONTROL", "Empty row — not a generated file.");

  const officialTemplate = detectOfficialTemplateRequirement({
    title: input.title,
    description: input.description,
    exactFileName: input.exactFileName,
    documentType: input.requirementType,
  });

  // An explicit tender-issued form/template wins outright: those must be
  // obtained and completed, never invented, so they stay fail-closed.
  if (officialTemplate.required && officialTemplate.confidence === "HIGH") {
    return result("FORM_TEMPLATE_TO_COMPLETE", officialTemplate.reason ?? "Official tender-issued form/template detected.");
  }

  // A MEDIUM template signal does NOT outrank explicit rule language below.
  //
  // MEDIUM_SIGNALS includes a bare file extension (/\.(xls|xlsx|pdf)\b/), so
  // any row carrying a filename was being read as "possible official
  // form/template" before the rule checks ever ran. A file extension describes
  // a format, not a fact about who issues the document.

  // A row whose EXACT FILE NAME positively names a non-financial bidder
  // deliverable is that deliverable, whatever its description or
  // restrictions say about the financial proposal or how to send it. A
  // tender's single file requirement -- exactFileName "Technical
  // Proposal.pdf", restrictions "PDF electronic submission only. Financial
  // proposal is excluded." -- was read below as a no-financial rule, so the
  // Build Plan confirmation dropped the one file the tender asked for and Run
  // Engine failed BUILD_PLAN_AUTOMATION_BLOCKED. Names that are themselves
  // financial or separation statements ("No Financial Proposal.docx",
  // "Financial Proposal.pdf") are not covered and keep the checks below.
  if (namesNonFinancialBidderDeliverable(input.exactFileName)) {
    return result("REQUIRED_OUTPUT_FILE", "The tender names this bidder-produced file exactly.");
  }

  // Negative financial instructions are RULES, never deliverables. This must
  // match natural-language variants such as "No Financial Proposal.docx" and
  // "Financial proposal: not required at this stage" before the later positive
  // `financial proposal` deliverable rule sees those words. The retained Pharo
  // Build Plan previously invented a required file literally named
  // "No Financial Proposal.docx", making package convergence impossible even
  // though the tender expressly prohibited/omitted that deliverable.
  // The phrasing list lives in lib/engine/financial-separation-rule.ts, shared
  // with proposal-price-leakage-guard.ts, which ENFORCES the same rule on the
  // generated narrative. The two used to carry separate lists and disagreed:
  // "technical proposal only" armed the guard but not this classifier, and
  // "Financial Proposal Omission" — the live tender's actual wording — armed
  // neither, so the Build Plan required a file named
  // "Financial Proposal Omission.docx" invented from a prohibition.
  // A row TITLED as the financial proposal, that tells the bidder to submit
  // it, is that deliverable — even when it adds "in a separate envelope".
  // "Financial Proposal: the Financial Proposal shall be submitted in a
  // separate envelope, priced in Birr inclusive of VAT" was read as a
  // separation rule, so a tender that required priced output got a Build Plan
  // with no financial file at all (2026-10-06 tender-type matrix). The
  // separation still holds — the file goes to the FINANCIAL envelope — and
  // every negative wording ("no financial proposal", "technical only",
  // "omitted", "not required") stays a rule.
  if (requiresSubmittedFinancialProposal(input.title, value)) {
    return result("REQUIRED_OUTPUT_FILE", "The tender requires a priced financial proposal, submitted in its own envelope.");
  }
  if (statesFinancialSeparation(value)) {
    return result("COMMERCIAL_SEPARATION_RULE", "Financial/technical separation or no-financial rule, not a deliverable file.");
  }

  // Submission method / deadline / delivery rules → SUBMISSION_RULE (not TECHNICAL_PROPOSAL)
  //
  // The email SUBJECT LINE belongs here and was missing. A tender line such as
  // "Required Email Subject: Technical Proposal for Pharo Ventures" describes
  // how to address the submission email; it is not something the bidder hands
  // over. Without these patterns the row fell through to the deliverable branch
  // and the Build Plan invented a mandatory file literally named
  // "Required Email Subject.docx" — which automatic generation can never
  // produce, so the package could never converge and the owner was told a
  // required submission document was permanently missing.
  //
  // Same failure shape as the "No Financial Proposal.docx" rule above: an
  // instruction about the submission was read as a thing to submit.
  if (
    /email recipients|both contacts|deadline|submit before|submit by|cc both|portal address|submission method|submission deadline|delivery rules|delivery instructions|how to submit|where to submit/.test(value) ||
    /\b(?:required\s+)?(?:e-?mail\s+)?subject\s*(?:line|title|header)?\s*[:\-–—]/.test(value) ||
    /\bemail\s+subject\b|\bsubject\s+line\b|\bsubject\s+of\s+the\s+e-?mail\b|\bmark\s+the\s+(?:e-?mail|envelope)\b|\bemail\s+body\b|\bcovering\s+e-?mail\b/.test(value)
  ) {
    return result("SUBMISSION_RULE", "Submission process/timing/recipient/subject rule, not a deliverable file.");
  }

  // A delivery CHANNEL named as if it were a document: "Email Submission",
  // "Online Portal Submission", "Hard Copy Submission", "Submission via
  // e-mail". These say HOW the package travels, not WHAT is in it. On
  // 2026-09-23 the Preview Build Plan carried a required file named
  // "Email Submission.docx", so AUTO_FINALIZE could never converge
  // (UNGENERATED_PLANNED_DOCUMENTS / SUBMISSION_PLAN_DOCUMENTS_MISSING) for a
  // file no bidder could ever produce. A row that also names a deliverable
  // ("Email Submission Form", "Online Submission Cover Letter") is left to the
  // deliverable and template branches below.
  if (namesOnlyADeliveryChannel(value)) {
    return result("SUBMISSION_RULE", "Submission delivery channel (how the package is sent), not a deliverable file.");
  }

  // How proposals are evaluated is not something the bidder hands over.
  // "Technical proposals will be evaluated on a 60% weight" and "Proposals
  // must score 40% or above on the technical proposal to be considered for
  // financial evaluation" name the technical proposal, so they fell through
  // to the deliverable pattern below and a feasibility-study ToR's Build Plan
  // required a file called "Technical Pass Gate.docx" (2026-10-06). A row
  // that also tells the bidder to submit or provide something keeps the
  // branches below.
  // A row titled as a deliverable ("Technical Proposal: … subject to the
  // evaluation criteria in Annex 2") is that deliverable.
  if (!BIDDER_OUTPUT_FILE.test(String(input.title ?? "").toLowerCase()) && statesOnlyHowProposalsAreEvaluated(value)) {
    return result("INTERNAL_COMPLIANCE_CONTROL", "How proposals are evaluated or scored — answered by the proposal, not a file.");
  }
  // The client's payment terms ("Payment will be made upon … approval of
  // deliverables: 20% … 25% …") are a contract term, not a schedule the
  // bidder completes. A row asking the bidder to propose one keeps the
  // branches below.
  if (PAYMENT_TERMS.test(value) && !BIDDER_DIRECTIVE.test(value)) {
    return result("INTERNAL_COMPLIANCE_CONTROL", "The client's payment terms — a contract term, not a file.");
  }

  // Formatting rules → INTERNAL_COMPLIANCE_CONTROL (not TECHNICAL_PROPOSAL)
  if (
    /document control|formatting rules|labelling rules|file naming|internal checklist|compliance control|page limit|font size|margin requirement|document format/.test(value) ||
    /\b(formatting|packaging|labell?ing|naming|numbering|binding|collation)\b[^.;]{0,60}\b(rules?|instructions?|requirements?|conventions?)\b/.test(value) ||
    /\b(rules?|instructions?)\b[^.;]{0,60}\b(formatting|packaging|labell?ing|file naming)\b/.test(value)
  ) {
    return result("INTERNAL_COMPLIANCE_CONTROL", "Internal format/control rule, not a generated file.");
  }

  // A generic bidder-assembled supporting-document annex is not the same thing
  // as an official Annex form. An explicit attached/provided/prescribed Annex
  // would already have matched the HIGH official-template detector above and
  // remains fail-closed. This narrower form is a bidder-produced package/index.
  if (/\bannex(?:es)?\s+(?:for|of)\s+(?:supporting\s+(?:documents?|evidence)|company\s+documents?|credentials?)\b/.test(value)) {
    return result("REQUIRED_OUTPUT_FILE", "Bidder-assembled supporting-document annex/package.");
  }

  // Copies of documents the bidder already holds are attachments the owner
  // provides, not files the app writes. "Submit scanned copies of Supplier
  // declaration form, Renewed trade license, and VAT registration
  // certificate" was read as a form to complete ("declaration form") and the
  // plan required "Submission Documents.docx", which no generator can
  // produce (2026-10-06). The owner attaches these (Annex Schedule); an
  // explicit tender-issued form has already matched the HIGH template check.
  if (asksForCopiesOfDocuments(value)) {
    return result("ORIGINAL_EVIDENCE_ATTACHMENT", "Copies of documents the bidder holds — attached by the owner, not generated.");
  }

  // Explicit rule language has now had its say, so a weaker template signal
  // (including a bare file extension) may take the row.
  if (officialTemplate.required) {
    return result("FORM_TEMPLATE_TO_COMPLETE", officialTemplate.reason ?? "Official tender-issued form/template detected.");
  }

  // Financial capacity / audited financial statements → ORIGINAL_EVIDENCE_ATTACHMENT (not TECHNICAL_PROPOSAL)
  // Legal eligibility / registration / license → ORIGINAL_EVIDENCE_ATTACHMENT (not TECHNICAL_PROPOSAL)
  if (/business license|trade license|tax clearance|audited\s+(financial\s+)?statements?|financial statements?|financial capacity|turnover statement|bank statement|annual report|registration\s+certificate|certificate\s+of\s+registration|incorporation\s+certificate|certificate\s+of\s+incorporation|tin certificate|vat certificate|grade certificate|good standing certificate|legal eligibility|eligibility certificate|company registration|license to operate|contractor registration|professional license|legal entity certificate/.test(value)) {
    return result("ORIGINAL_EVIDENCE_ATTACHMENT", "Evidence attachment must be sourced from Company Vault, not generated.");
  }

  if (/bid form|tender form|declaration form|undertaking form|integrity pact|price schedule|rate card|boq|bill of quantities|annex|annexure|appendix|attachment|template/.test(value)) {
    return result("FORM_TEMPLATE_TO_COMPLETE", "Tender form, annex, schedule or template must be completed from the original.");
  }

  // Expert CV package and project references → REQUIRED_OUTPUT_FILE (bidder-produced)
  if (BIDDER_OUTPUT_FILE.test(value)) {
    return result("REQUIRED_OUTPUT_FILE", "Bidder-produced output file required by the tender.");
  }

  if (isProbablyDeliverable(input)) return result("REQUIRED_OUTPUT_FILE", "Exact file name or requirement type indicates a deliverable.");

  return result("INTERNAL_COMPLIANCE_CONTROL", "No deliverable pattern matched; defaulting to internal compliance row to avoid inventing a file.");
}

const EVALUATION_STATEMENT = /\b(?:will\s+be\s+(?:evaluated|scored|assessed|weighted|ranked)|evaluation\s+(?:criteria|weight(?:ing)?|method(?:ology)?|score|process)|weight(?:ed|ing)?\s+(?:of\s+)?\d{1,3}\s*%|\d{1,3}\s*%\s+weight|pass(?:ing)?\s+mark|minimum\s+(?:technical\s+)?score|(?:must|shall|should)\s+score|considered\s+for\s+(?:further|financial)\s+evaluation|qualifying\s+score)/;
const BIDDER_DIRECTIVE = /\b(?:submit(?:ted)?|provide[ds]?|prepare[ds]?|attach(?:ed)?|enclose[ds]?|furnish(?:ed)?|include[ds]?|fill\s+in|complete\s+and\s+(?:sign|return))\b/;

/** The row states how proposals are evaluated, and asks the bidder for nothing. */
export function statesOnlyHowProposalsAreEvaluated(value: string): boolean {
  const v = value.toLowerCase();
  return EVALUATION_STATEMENT.test(v) && !BIDDER_DIRECTIVE.test(v);
}

const PAYMENT_TERMS = /\bpayments?\s+(?:will|shall)\s+be\s+(?:made|effected|released|paid)\b|\b(?:indicative\s+)?payment\s+(?:schedule|terms)\s+(?:is|are|will|shall)\b/;

const COPIES_OF_DOCUMENTS = /\b(?:scanned|certified|notari[sz]ed|attested|photo)\s*cop(?:y|ies)\s+of\b|\bcop(?:y|ies)\s+of\s+(?:the\s+|your\s+|a\s+|an\s+|valid\s+|renewed\s+|current\s+)?(?:[\w/-]+\s+){0,3}(?:licen[cs]es?|certificates?|registrations?|permits?|ids?|passports?)\b/;

/** The row asks for copies of documents the bidder already holds. */
export function asksForCopiesOfDocuments(value: string): boolean {
  return COPIES_OF_DOCUMENTS.test(value.toLowerCase());
}

/** Names that identify a bidder-produced deliverable on their own. */
const BIDDER_OUTPUT_FILE = /technical proposal|financial proposal|cover letter|executive summary|company profile|methodology|work plan|implementation plan|quality assurance plan|risk management plan|cv package|expert cv|curriculum vitae|personnel cv|key personnel cv|staff cv|project experience|project reference|similar projects|track record|bid bond|power of attorney|joint venture agreement|consortium agreement/;

/** An exact file name that is itself a non-financial bidder deliverable. */
function namesNonFinancialBidderDeliverable(exactFileName: string | null | undefined): boolean {
  const name = String(exactFileName ?? "").trim().toLowerCase();
  if (!name) return false;
  if (/financial|commercial|price|pricing|cost|fee|bid bond/.test(name)) return false;
  if (statesFinancialSeparation(name)) return false;
  return BIDDER_OUTPUT_FILE.test(name);
}

export function shouldRowBecomePlannedFile(input: ClassifierInput): boolean {
  return classifySubmissionPlanItem(input).shouldBePlannedFile;
}

/**
 * The ONE test for "this planned file is really a rule".
 *
 * Shared by the plan builder (submission-plan.ts) and the stale-plan detector
 * (build-plan.ts findNonDeliverablePlanItems). They used to ask the classifier
 * different questions: the builder passed the requirement's full description,
 * the detector only the planned file name and its notes. On 2026-09-23 the
 * requirement "Email Submission" (type SUBMISSION_RULE) had a description that
 * mentions the proposal, so the builder kept "Email Submission.docx" while the
 * detector rejected it — every Run Engine confirmed a plan the next read called
 * stale, and generation never started. Asking the same question of the same
 * planned-file fields in both places makes a freshly built plan non-stale by
 * construction.
 */
export function plannedFileIsARule(file: { exactFileName?: string | null; notes?: string | null; documentType?: string | null }): { rule: boolean; rationale: string } {
  const exactFileName = String(file.exactFileName ?? "").trim();
  if (!exactFileName) return { rule: false, rationale: "" };
  const classification = classifySubmissionPlanItem({
    title: exactFileName,
    description: file.notes ?? null,
    requirementType: file.documentType ?? null,
    exactFileName,
  });
  const rule = classification.category === "COMMERCIAL_SEPARATION_RULE" || classification.category === "SUBMISSION_RULE";
  return { rule, rationale: classification.rationale };
}


const FINANCIAL_PROPOSAL_TITLE = /^\s*(?:\d+[.)]\s*)?(?:the\s+)?(?:financial|commercial|price)\s+(?:proposal|offer|bid)\b/i;
const FINANCIAL_ABSENCE = /\b(?:no|without|omit(?:ted)?|omission|exclu(?:de|ded|sion)|waive[d]?|not\s+(?:required|requested|applicable|to\s+be\s+submitted|be\s+submitted|included)|later\s+stage|technical\s+(?:proposal\s+|submission\s+|offer\s+)?only|only\s+the\s+technical|do\s+not|shall\s+not|must\s+not|price[-\s]?free)\b/i;
const SUBMISSION_VERB = /\b(?:shall|must|should|is\s+to|are\s+to|will)\s+(?:be\s+)?(?:submit(?:ted)?|provide[d]?|include[d]?|prepare[d]?|state)\b|\bsubmit\b|\bprovide\b|\bpriced\b/i;

/**
 * The deliverable a financial-proposal row names, as its title writes it:
 * "Financial Proposal Content" → "Financial Proposal". Null when the title
 * does not name one.
 */
export function financialProposalNameInTitle(title: string | null | undefined): string | null {
  const m = /^\s*(?:\d+[.)]\s*)?(?:the\s+)?((?:financial|commercial|price)\s+(?:proposal|offer|bid))\b/i.exec(String(title ?? ""));
  return m ? m[1]!.replace(/\s+/g, " ") : null;
}

/** The row's own title names the financial proposal and the row requires it to be submitted. */
export function requiresSubmittedFinancialProposal(title: string | null | undefined, text: string | null | undefined): boolean {
  const t = String(title ?? "");
  const body = String(text ?? "");
  // A prescribed form, template or bill of quantities is the tender's own
  // document to complete, never one the app writes.
  if (/\b(?:form|template|prescribed|bill\s+of\s+quantities|boq|schedule\s+of\s+(?:prices|rates))\b/i.test(`${t} ${body}`)) return false;
  return FINANCIAL_PROPOSAL_TITLE.test(t) && SUBMISSION_VERB.test(body) && !FINANCIAL_ABSENCE.test(`${t} ${body}`);
}
