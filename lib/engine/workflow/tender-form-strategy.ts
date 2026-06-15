import { classifyUniversalTender, type TenderForm } from "../metadata/universal-tender-taxonomy";

export type TenderFormStrategy = {
  primaryForm: TenderForm | "UNKNOWN";
  isTwoEnvelope: boolean;
  proposalObjective: string;
  requiredEmphasis: string[];
  requiredOutputs: string[];
  evaluatorRisks: string[];
  commercialControls: string[];
  writingInstructions: string[];
};

function clean(value?: string | null): string {
  return (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function detectPrimaryForm(forms: TenderForm[], text: string): TenderForm | "UNKNOWN" {
  if (/expression\s+of\s+interest|\beoi\b/i.test(text)) return "EOI";
  if (/pre[-\s]?qualification|registration\s+of\s+consultants/i.test(text)) return "PREQUALIFICATION";
  if (/request\s+for\s+proposals?|\brfp\b/i.test(text)) return "RFP";
  if (/request\s+for\s+quotations?|\brfq\b/i.test(text)) return "RFQ";
  if (/invitation\s+to\s+tender|invitation\s+for\s+bids?|\bitt\b/i.test(text)) return "ITT";
  if (/framework\s+agreement|call[-\s]?off|multiple\s+award/i.test(text)) return "FRAMEWORK";
  const priority: TenderForm[] = ["EOI", "PREQUALIFICATION", "RFP", "RFQ", "ITT", "FRAMEWORK", "TECHNICAL_PROPOSAL", "FINANCIAL_PROPOSAL", "CONSULTANCY"];
  for (const form of priority) if (forms.includes(form)) return form;
  return forms[0] ?? "UNKNOWN";
}

function isTwoEnvelopeSubmission(text: string): boolean {
  return includesAny(text, [
    /two[-\s]?envelope/i,
    /separate\s+(?:technical|financial)\s+(?:and|&)\s+(?:technical|financial)/i,
    /technical\s+proposal\s+.*financial\s+proposal/i,
    /financial\s+proposal\s+.*technical\s+proposal/i,
    /technical\s+offer\s+.*commercial\s+offer/i,
  ]);
}

function strategyFor(primaryForm: TenderForm | "UNKNOWN", twoEnvelope: boolean): TenderFormStrategy {
  const technicalCommercialControls = twoEnvelope
    ? [
        "Maintain strict two-envelope separation: no price, fee, rate, BOQ amount, tax amount or commercial discount in the technical proposal.",
        "Financial proposal, BOQ, rate cards, tax/VAT, commercial assumptions and validity belong only in the financial/commercial envelope.",
        "Before export, run a price-leakage review on every technical document.",
      ]
    : [
        "Keep pricing content only where the tender explicitly requests it.",
        "If technical and financial content are combined, label commercial assumptions and exclusions clearly.",
      ];

  const commonRisks = [
    "Unsupported claim risk: do not invent projects, experts, values, dates, certificates or client approvals.",
    "Submission rejection risk: verify exact file names, format, signatures/stamps, deadline and delivery method before export.",
  ];

  switch (primaryForm) {
    case "EOI":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Get shortlisted by proving eligibility, relevant capability, comparable assignments, team availability and corporate readiness.",
        requiredEmphasis: ["eligibility", "shortlisting criteria", "company capability", "similar assignments", "key experts", "licenses and registrations"],
        requiredOutputs: ["EOI cover letter", "capability statement", "similar assignment register", "expert summary table", "eligibility/compliance documents", "appendix evidence register"],
        evaluatorRisks: ["Weak shortlist proof", "Too much methodology where capability evidence is required", ...commonRisks],
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Write concise shortlist-focused evidence, not a full methodology unless requested.", "Prioritise reviewed company/project/expert facts and eligibility documents.", "Use tables for similar assignments and key experts."],
      };
    case "PREQUALIFICATION":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Pass eligibility and prequalification screening by proving legal, financial, technical and experience capacity.",
        requiredEmphasis: ["mandatory eligibility", "legal status", "financial capacity", "similar experience", "staff capacity", "certificates and declarations"],
        requiredOutputs: ["prequalification checklist", "eligibility matrix", "legal/financial evidence register", "similar projects table", "key personnel table", "signed declarations"],
        evaluatorRisks: ["Pass/fail non-compliance", "Expired certificates", "Missing original forms", ...commonRisks],
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Treat every mandatory item as pass/fail.", "Do not over-write marketing; focus on evidence completeness and attachment control.", "Flag missing/expired documents as final review actions."],
      };
    case "RFP":
    case "TECHNICAL_PROPOSAL":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Win technical evaluation by answering scope, methodology, work plan, team, experience, QA/QC, risks and deliverables against the evaluator criteria.",
        requiredEmphasis: ["technical understanding", "methodology", "work plan", "team roles", "similar projects", "QA/QC", "risk controls", "deliverables"],
        requiredOutputs: ["technical proposal", "methodology", "work plan", "team/CV package", "project references", "compliance matrix", "appendix register"],
        evaluatorRisks: ["Generic methodology", "Weak evidence-to-criterion mapping", "Price leakage into technical proposal", ...commonRisks],
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Write scope-by-scope methodology and evaluator-facing response tables.", "Map every major criterion to evidence and responsible experts.", "Use the tender response blueprint as the writing plan."],
      };
    case "RFQ":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Submit a compliant quotation with clear scope, deliverables, assumptions, delivery schedule, validity and commercial completeness.",
        requiredEmphasis: ["scope compliance", "quotation completeness", "delivery schedule", "assumptions and exclusions", "validity", "tax/VAT treatment"],
        requiredOutputs: ["quotation response", "priced schedule/BOQ where required", "technical compliance note", "delivery schedule", "commercial assumptions", "signed forms"],
        evaluatorRisks: ["Incomplete quotation", "Ambiguous assumptions", "Missing validity/tax treatment", ...commonRisks],
        commercialControls: ["Commercial content is expected only in the quotation/pricing response.", "Ensure totals, taxes, currency, validity, assumptions and exclusions match tender forms.", ...technicalCommercialControls],
        writingInstructions: ["Be concise and compliance-first.", "Do not add unnecessary long methodology unless the RFQ requires it.", "Make commercial assumptions explicit and aligned to the RFQ."],
      };
    case "ITT":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Submit a compliant tender offer that meets instructions to tenderers, technical requirements, forms, pricing rules and contract conditions.",
        requiredEmphasis: ["instructions to tenderers", "technical compliance", "forms", "contract conditions", "priced BOQ", "bid security", "signatures/stamps"],
        requiredOutputs: ["tender offer", "technical schedule", "priced BOQ", "forms/declarations", "bid security if required", "submission checklist"],
        evaluatorRisks: ["Non-responsive tender", "Wrong form or file", "Unsigned/unstamped offer", "Price/BOQ inconsistency", ...commonRisks],
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Follow the exact ITT structure and forms.", "Prioritise responsiveness and mandatory instructions over marketing language.", "Treat missing bid security or forms as hard blockers."],
      };
    case "FRAMEWORK":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Prove capacity for repeated call-off assignments, coverage, responsiveness, quality control, team depth and commercial consistency.",
        requiredEmphasis: ["capacity", "coverage", "call-off method", "response time", "quality consistency", "resource depth", "rates/terms where required"],
        requiredOutputs: ["framework capability proposal", "call-off delivery method", "resource pool", "quality management plan", "rate schedule where required", "governance/escalation process"],
        evaluatorRisks: ["Insufficient capacity proof", "Unclear call-off process", "Weak continuity controls", ...commonRisks],
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Write for repeatable delivery, not only one project.", "Show governance, mobilization, resource depth and escalation controls.", "Keep rate/commercial details in the correct envelope."],
      };
    case "FINANCIAL_PROPOSAL":
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Produce a compliant commercial offer that matches the tender pricing forms and avoids technical-envelope contamination.",
        requiredEmphasis: ["priced forms", "currency", "tax/VAT", "validity", "assumptions", "exclusions", "signature/stamp"],
        requiredOutputs: ["financial proposal", "priced BOQ/rate card", "commercial assumptions", "tax/VAT statement", "validity statement", "signed financial forms"],
        evaluatorRisks: ["Arithmetic inconsistency", "Wrong currency/tax treatment", "Missing signed commercial form", ...commonRisks],
        commercialControls: ["Financial proposal must be separate when the tender requires two envelopes.", "Check all totals, taxes, currencies and assumptions against issued forms."],
        writingInstructions: ["Do not add technical methodology here unless the tender explicitly requests it.", "Use the exact tender pricing structure and file names.", "Make assumptions/exclusions precise and non-contradictory."],
      };
    default:
      return {
        primaryForm,
        isTwoEnvelope: twoEnvelope,
        proposalObjective: "Produce a compliant, evidence-led tender response mapped to scope, criteria, evidence and submission rules.",
        requiredEmphasis: ["scope compliance", "evidence mapping", "team", "project references", "methodology", "submission controls"],
        requiredOutputs: ["proposal response", "compliance matrix", "evidence register", "team/project sections", "submission checklist"],
        evaluatorRisks: commonRisks,
        commercialControls: technicalCommercialControls,
        writingInstructions: ["Use the tender response blueprint as the controlling plan.", "Map claims to reviewed evidence.", "Separate commercial content unless explicitly combined."],
      };
  }
}

export function buildTenderFormStrategy(params: {
  tenderTitle?: string | null;
  requirements?: string[];
  submissionLines?: string[];
  extraText?: string | null;
}): TenderFormStrategy {
  const text = clean([params.tenderTitle, ...(params.requirements ?? []), ...(params.submissionLines ?? []), params.extraText].filter(Boolean).join("\n"));
  const profile = classifyUniversalTender(text);
  const primaryForm = detectPrimaryForm(profile.tenderForms, text);
  return strategyFor(primaryForm, isTwoEnvelopeSubmission(text));
}

export function renderTenderFormStrategy(strategy: TenderFormStrategy): string {
  return [
    "## Tender Form Strategy",
    `Primary tender form: ${strategy.primaryForm}${strategy.isTwoEnvelope ? " (two-envelope controls detected)" : ""}.`,
    `Proposal objective: ${strategy.proposalObjective}`,
    "### Required emphasis",
    ...strategy.requiredEmphasis.map((item) => `- ${item}`),
    "### Required outputs",
    ...strategy.requiredOutputs.map((item) => `- ${item}`),
    "### Evaluator / submission risks",
    ...strategy.evaluatorRisks.map((item) => `- ${item}`),
    "### Commercial controls",
    ...strategy.commercialControls.map((item) => `- ${item}`),
    "### Writing instructions",
    ...strategy.writingInstructions.map((item) => `- ${item}`),
  ].join("\n");
}
