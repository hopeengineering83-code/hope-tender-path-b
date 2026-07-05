import { classifyUniversalTender } from "./universal-tender-taxonomy";
import { buildTenderResponseBlueprint, type BlueprintEvidenceInput } from "./tender-response-blueprint";
import { buildTenderFormStrategy } from "./tender-form-strategy";

export type TenderCriterionCategory =
  | "ELIGIBILITY"
  | "TECHNICAL_SCOPE"
  | "EXPERIENCE"
  | "PERSONNEL"
  | "SUBMISSION"
  | "COMMERCIAL"
  | "EVALUATION"
  | "DISQUALIFICATION"
  | "CONTRACTUAL"
  | "QUALITY_HSE"
  | "GENERAL";

export type TenderCriterionGraphNode = {
  id: string;
  category: TenderCriterionCategory;
  requirement: string;
  mandatory: boolean;
  disqualificationRisk: boolean;
  tenderForm: string;
  serviceCapabilities: string[];
  sectorDomains: string[];
  proposalSection: string;
  evidenceSupport: "DIRECT" | "PARTIAL" | "NEEDS_CONFIRMATION";
  evidenceLine: string;
  dependencies: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  responseAction: string;
  validationAction: string;
};

export type TenderCriterionGraph = {
  summary: {
    totalCriteria: number;
    criticalCount: number;
    highCount: number;
    mandatoryCount: number;
    commercialCount: number;
    submissionCount: number;
    missingEvidenceCount: number;
  };
  nodes: TenderCriterionGraphNode[];
};

function clean(value?: string | null): string {
  return (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function classifyCategory(requirement: string): TenderCriterionCategory {
  const req = clean(requirement).toLowerCase();
  if (/disqualif|non[-\s]?responsive|reject|rejection|shall\s+be\s+rejected|will\s+not\s+be\s+considered|failure\s+to\s+submit/i.test(req)) return "DISQUALIFICATION";
  if (/cv|expert|personnel|staff|team|key\s+professional|key\s+personnel|qualification|availability|professional\s+staff|years\s+of\s+experience/i.test(req)) return "PERSONNEL";
  if (/experience|similar|reference|past\s+project|past\s+assignment|track\s+record|assignment\s+reference|portfolio|client\s+certificate|completion\s+certificate|completion\s+certificates|similar\s+hospital|similar\s+healthcare|project\s+references?/i.test(req)) return "EXPERIENCE";
  if (/eligib|valid\s+registration|business\s+license|licence|tax\s+clearance|vat|tin|certificate|legal|financial\s+capacity|audited\s+accounts|bank\s+statement|bid\s+security/i.test(req)) return "ELIGIBILITY";
  if (/submission|deadline|portal|email|sealed|envelope|file\s+name|format|pdf|hard\s+copy|soft\s+copy|signature|stamp|signed/i.test(req)) return "SUBMISSION";
  if (/financial|price|pricing|commercial|boq|bill\s+of\s+quantit|fee|rate|quotation|currency|tax|vat|validity|discount/i.test(req)) return "COMMERCIAL";
  if (/evaluation|score|scoring|marks|weight|weighted|criteria|technical\s+points|method\s+of\s+award/i.test(req)) return "EVALUATION";
  if (/contract|fidic|condition\s+of\s+contract|liquidated\s+damages|warranty|insurance|liability|claim|variation/i.test(req)) return "CONTRACTUAL";
  if (/quality|qa\/qc|qaqc|hse|safety|environment|risk\s+management|method\s+statement|iso/i.test(req)) return "QUALITY_HSE";
  if (/scope|methodology|approach|work\s+plan|deliverable|design|supervision|contract\s+administration|geotechnical|urban\s+planning|asset\s+management|interior/i.test(req)) return "TECHNICAL_SCOPE";
  return "GENERAL";
}

function isMandatory(requirement: string): boolean {
  return /\bshall\b|\bmust\b|required|mandatory|compulsory|pass\/fail|failure\s+to|non[-\s]?responsive|disqualif|reject/i.test(requirement);
}

function dependencyList(category: TenderCriterionCategory, requirement: string): string[] {
  const deps: string[] = [];
  if (["ELIGIBILITY", "SUBMISSION", "DISQUALIFICATION"].includes(category)) deps.push("Source tender clause must be checked exactly before final submission.");
  if (category === "PERSONNEL") deps.push("Named reviewed expert/CV evidence must be attached and role-mapped.");
  if (category === "EXPERIENCE") deps.push("Reviewed similar project evidence must be attached with client/scope/date proof where available.");
  if (category === "COMMERCIAL") deps.push("Commercial/pricing content must be placed only in the required envelope or form.");
  if (/signature|stamp|signed/i.test(requirement)) deps.push("Signature/stamp authority must be verified.");
  if (/deadline|date|time/i.test(requirement)) deps.push("Deadline/timezone must be verified by bid team.");
  return deps;
}

function riskLevel(params: { category: TenderCriterionCategory; mandatory: boolean; support: TenderCriterionGraphNode["evidenceSupport"]; disqualificationRisk: boolean }): TenderCriterionGraphNode["riskLevel"] {
  if (params.disqualificationRisk) return "CRITICAL";
  if (params.mandatory && params.support === "NEEDS_CONFIRMATION") return "CRITICAL";
  if (["ELIGIBILITY", "SUBMISSION", "COMMERCIAL"].includes(params.category) && params.support !== "DIRECT") return "HIGH";
  if (params.mandatory && params.support === "PARTIAL") return "HIGH";
  if (params.support === "NEEDS_CONFIRMATION") return "HIGH";
  if (params.support === "PARTIAL") return "MEDIUM";
  return "LOW";
}

function responseAction(category: TenderCriterionCategory, support: TenderCriterionGraphNode["evidenceSupport"]): string {
  if (support === "NEEDS_CONFIRMATION") return "Do not overclaim; add reviewed evidence or convert to a final bid-team action before export.";
  if (category === "DISQUALIFICATION") return "Treat as hard blocker; verify exact instruction and prevent non-responsive submission.";
  if (category === "COMMERCIAL") return "Map to commercial/financial envelope or quotation form; keep technical narrative price-free where required.";
  if (category === "SUBMISSION") return "Convert into final submission checklist item and verify file name, format, signature/stamp, deadline and channel.";
  if (category === "ELIGIBILITY") return "Attach eligibility evidence and verify expiry/status before submission.";
  if (category === "PERSONNEL") return "Map named reviewed experts to roles, CVs, qualifications, availability and responsibilities.";
  if (category === "EXPERIENCE") return "Use reviewed comparable project evidence with client, scope, period, value/scale and completion proof where available.";
  return "Answer directly in the proposal and cite reviewed evidence or controlled final action.";
}

function validationAction(node: Omit<TenderCriterionGraphNode, "validationAction">): string {
  if (node.riskLevel === "CRITICAL") return "Block final export until verified or formally waived by bid lead.";
  if (node.riskLevel === "HIGH") return "Require senior bid review before final export.";
  if (node.evidenceSupport === "PARTIAL") return "Strengthen evidence or write as transferable/supporting evidence only.";
  return "Check source evidence and appendix reference before export.";
}

export function buildTenderCriterionGraph(input: BlueprintEvidenceInput): TenderCriterionGraph {
  const tenderForm = buildTenderFormStrategy({ tenderTitle: input.tenderTitle, requirements: input.requirements, submissionLines: input.complianceLines, extraText: input.clientName });
  const blueprint = buildTenderResponseBlueprint(input);
  const nodes = blueprint.map((item, index) => {
    const category = classifyCategory(item.requirement);
    const profile = classifyUniversalTender(item.requirement);
    const mandatory = isMandatory(item.requirement);
    const disqualificationRisk = category === "DISQUALIFICATION" || /non[-\s]?responsive|shall\s+be\s+rejected|will\s+be\s+rejected|disqualif/i.test(item.requirement);
    const base = {
      id: `TCG-${index + 1}`,
      category,
      requirement: item.requirement,
      mandatory,
      disqualificationRisk,
      tenderForm: tenderForm.primaryForm,
      serviceCapabilities: profile.serviceCapabilities,
      sectorDomains: profile.sectorDomains,
      proposalSection: item.responseSection,
      evidenceSupport: item.evidenceSupport,
      evidenceLine: item.evidenceLine,
      dependencies: dependencyList(category, item.requirement),
      riskLevel: riskLevel({ category, mandatory, support: item.evidenceSupport, disqualificationRisk }),
      responseAction: responseAction(category, item.evidenceSupport),
    } satisfies Omit<TenderCriterionGraphNode, "validationAction">;
    return { ...base, validationAction: validationAction(base) };
  });

  return {
    summary: {
      totalCriteria: nodes.length,
      criticalCount: nodes.filter((n) => n.riskLevel === "CRITICAL").length,
      highCount: nodes.filter((n) => n.riskLevel === "HIGH").length,
      mandatoryCount: nodes.filter((n) => n.mandatory).length,
      commercialCount: nodes.filter((n) => n.category === "COMMERCIAL").length,
      submissionCount: nodes.filter((n) => n.category === "SUBMISSION").length,
      missingEvidenceCount: nodes.filter((n) => n.evidenceSupport === "NEEDS_CONFIRMATION").length,
    },
    nodes,
  };
}

export function renderTenderCriterionGraph(input: BlueprintEvidenceInput): string {
  const graph = buildTenderCriterionGraph(input);
  const rows = [
    "| ID | Category | Mandatory | Risk | Proposal section | Evidence support | Response / validation action |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const node of graph.nodes) {
    rows.push(`| ${node.id} | ${node.category} | ${node.mandatory ? "YES" : "NO"} | ${node.riskLevel} | ${node.proposalSection} | ${node.evidenceSupport} | ${node.responseAction}<br>${node.validationAction} |`);
  }
  return [
    "## Tender Criterion Graph",
    `Criterion graph summary: ${graph.summary.totalCriteria} criteria, ${graph.summary.mandatoryCount} mandatory, ${graph.summary.criticalCount} critical, ${graph.summary.highCount} high-risk, ${graph.summary.missingEvidenceCount} missing-evidence item(s).`,
    rows.join("\n"),
  ].join("\n\n");
}
