import { detectOfficialTemplateRequirement } from "./official-template-detector";

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

  // Negative financial instructions are RULES, never deliverables. This must
  // match natural-language variants such as "No Financial Proposal.docx" and
  // "Financial proposal: not required at this stage" before the later positive
  // `financial proposal` deliverable rule sees those words. The retained Pharo
  // Build Plan previously invented a required file literally named
  // "No Financial Proposal.docx", making package convergence impossible even
  // though the tender expressly prohibited/omitted that deliverable.
  if (
    /financial proposal exclusion|separate envelope|two[-\s]envelope|sealed envelope|technical only|do not include price|do not include financial/.test(value) ||
    /\bno\s+financial\s+(?:proposal|offer)\b/.test(value) ||
    /\bfinancial\s+(?:proposal|offer)\s+(?:is\s+)?(?:not\s+required|not\s+requested|not\s+applicable|excluded|omitted)\b/.test(value) ||
    /\b(?:do\s+not|must\s+not|shall\s+not)\s+(?:generate|submit|include)\s+(?:a\s+)?financial\s+(?:proposal|offer)\b/.test(value) ||
    /\bwithout\s+(?:a\s+)?financial\s+(?:proposal|offer)\b/.test(value)
  ) {
    return result("COMMERCIAL_SEPARATION_RULE", "Financial/technical separation or no-financial rule, not a deliverable file.");
  }

  // Submission method / deadline / delivery rules → SUBMISSION_RULE (not TECHNICAL_PROPOSAL)
  if (/email recipients|both contacts|deadline|submit before|submit by|cc both|portal address|submission method|submission deadline|delivery rules|delivery instructions|how to submit|where to submit/.test(value)) {
    return result("SUBMISSION_RULE", "Submission process/timing/recipient rule, not a deliverable file.");
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
  if (/technical proposal|financial proposal|cover letter|executive summary|company profile|methodology|work plan|implementation plan|quality assurance plan|risk management plan|cv package|expert cv|curriculum vitae|personnel cv|key personnel cv|staff cv|project experience|project reference|similar projects|track record|bid bond|power of attorney|joint venture agreement|consortium agreement/.test(value)) {
    return result("REQUIRED_OUTPUT_FILE", "Bidder-produced output file required by the tender.");
  }

  if (isProbablyDeliverable(input)) return result("REQUIRED_OUTPUT_FILE", "Exact file name or requirement type indicates a deliverable.");

  return result("INTERNAL_COMPLIANCE_CONTROL", "No deliverable pattern matched; defaulting to internal compliance row to avoid inventing a file.");
}

export function shouldRowBecomePlannedFile(input: ClassifierInput): boolean {
  return classifySubmissionPlanItem(input).shouldBePlannedFile;
}
