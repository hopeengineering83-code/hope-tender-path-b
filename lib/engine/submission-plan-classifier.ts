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
    shouldBePlannedFile: category === "REQUIRED_OUTPUT_FILE" || category === "FORM_TEMPLATE_TO_COMPLETE" || category === "ORIGINAL_EVIDENCE_ATTACHMENT",
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
  if (officialTemplate.required) {
    return result("FORM_TEMPLATE_TO_COMPLETE", officialTemplate.reason ?? "Official tender-issued form/template detected.");
  }

  if (/financial proposal exclusion|separate envelope|two[-\s]envelope|sealed envelope|technical only|do not include price|do not include financial/.test(value)) {
    return result("COMMERCIAL_SEPARATION_RULE", "Financial/technical separation rule, not a deliverable file.");
  }

  // Submission method / deadline / delivery rules → SUBMISSION_RULE (not TECHNICAL_PROPOSAL)
  if (/email recipients|both contacts|deadline|submit before|submit by|cc both|portal address|submission method|submission deadline|delivery rules|delivery instructions|how to submit|where to submit/.test(value)) {
    return result("SUBMISSION_RULE", "Submission process/timing/recipient rule, not a deliverable file.");
  }

  // Formatting rules → INTERNAL_COMPLIANCE_CONTROL (not TECHNICAL_PROPOSAL)
  if (/document control|formatting rules|labelling rules|file naming|internal checklist|compliance control|page limit|font size|margin requirement|document format/.test(value)) {
    return result("INTERNAL_COMPLIANCE_CONTROL", "Internal format/control rule, not a generated file.");
  }

  // Financial capacity / audited financial statements → ORIGINAL_EVIDENCE_ATTACHMENT (not TECHNICAL_PROPOSAL)
  // Legal eligibility / registration / license → ORIGINAL_EVIDENCE_ATTACHMENT (not TECHNICAL_PROPOSAL)
  if (/business license|trade license|tax clearance|audited\s+(financial\s+)?statements?|financial statements?|financial capacity|turnover statement|bank statement|annual report|registration\s+certificate|certificate\s+of\s+registration|incorporation\s+certificate|certificate\s+of\s+incorporation|tin certificate|vat certificate|grade certificate|good standing certificate|legal eligibility|eligibility certificate|company registration|license to operate|contractor registration|professional license|legal entity certificate/.test(value)) {
    return result("ORIGINAL_EVIDENCE_ATTACHMENT", "Evidence attachment must be uploaded as an original document, not generated.");
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
