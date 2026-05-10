import { buildTenderFormStrategy, type TenderFormStrategy } from "./tender-form-strategy";
import { buildTenderCriterionGraph, type TenderCriterionGraph, type TenderCriterionGraphNode } from "./tender-criterion-graph";
import { buildTenderResponseBlueprint, type BlueprintEvidenceInput, type TenderResponseBlueprintItem } from "./tender-response-blueprint";
import { classifyUniversalTender, universalProfileSummary } from "./universal-tender-taxonomy";

export type ProposalIntelligenceContractInput = BlueprintEvidenceInput & {
  evaluationCriteria?: string[];
  submissionRules?: string[];
  selectedExpertCount?: number;
  selectedProjectCount?: number;
  reviewedExpertCount?: number;
  reviewedProjectCount?: number;
};

export type ProposalContractEvidenceSummary = {
  expertLines: number;
  projectLines: number;
  companyEvidenceLines: number;
  projectEvidenceLines: number;
  complianceLines: number;
  directBlueprintEvidence: number;
  partialBlueprintEvidence: number;
  missingBlueprintEvidence: number;
};

export type ProposalContractRequirement = {
  id: string;
  requirement: string;
  category: TenderCriterionGraphNode["category"];
  mandatory: boolean;
  riskLevel: TenderCriterionGraphNode["riskLevel"];
  proposalSection: string;
  serviceCapability: string;
  evaluatorConcern: string;
  evidenceSupport: TenderResponseBlueprintItem["evidenceSupport"];
  evidenceLine: string;
  responseStrategy: string;
  responseAction: string;
  validationAction: string;
};

export type ProposalContractSectionPlan = {
  section: string;
  requirementIds: string[];
  strongestEvidenceSupport: TenderResponseBlueprintItem["evidenceSupport"];
  riskLevel: TenderCriterionGraphNode["riskLevel"];
  writingInstruction: string;
};

export type ProposalExportGate = {
  gate: string;
  status: "PASS" | "WARN" | "BLOCK";
  rationale: string;
  action: string;
};

export type ProposalIntelligenceContract = {
  schemaVersion: "PIC-1";
  tender: {
    title: string;
    clientName: string;
    universalProfile: string;
    primaryTenderForm: TenderFormStrategy["primaryForm"];
    isTwoEnvelope: boolean;
  };
  tenderFormStrategy: TenderFormStrategy;
  criterionGraph: TenderCriterionGraph;
  requirements: ProposalContractRequirement[];
  sectionPlan: ProposalContractSectionPlan[];
  evidenceSummary: ProposalContractEvidenceSummary;
  exportGates: ProposalExportGate[];
  writingRules: string[];
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countSupport(blueprint: TenderResponseBlueprintItem[], support: TenderResponseBlueprintItem["evidenceSupport"]): number {
  return blueprint.filter((item) => item.evidenceSupport === support).length;
}

function riskRank(risk: TenderCriterionGraphNode["riskLevel"]): number {
  return risk === "CRITICAL" ? 4 : risk === "HIGH" ? 3 : risk === "MEDIUM" ? 2 : 1;
}

function worseRisk(a: TenderCriterionGraphNode["riskLevel"], b: TenderCriterionGraphNode["riskLevel"]): TenderCriterionGraphNode["riskLevel"] {
  return riskRank(a) >= riskRank(b) ? a : b;
}

function supportRank(support: TenderResponseBlueprintItem["evidenceSupport"]): number {
  return support === "DIRECT" ? 3 : support === "PARTIAL" ? 2 : 1;
}

function bestSupport(a: TenderResponseBlueprintItem["evidenceSupport"], b: TenderResponseBlueprintItem["evidenceSupport"]): TenderResponseBlueprintItem["evidenceSupport"] {
  return supportRank(a) >= supportRank(b) ? a : b;
}

function sectionInstruction(section: string, nodes: ProposalContractRequirement[]): string {
  const critical = nodes.filter((node) => node.riskLevel === "CRITICAL").length;
  const missing = nodes.filter((node) => node.evidenceSupport === "NEEDS_CONFIRMATION").length;
  if (/commercial|financial/i.test(section)) return "Keep commercial/pricing content in the correct envelope or form; technical narrative must remain price-free when required.";
  if (/submission/i.test(section)) return "Write as a submission-control checklist with exact file, format, signature/stamp, recipient, deadline and channel checks.";
  if (/eligibility|forms|compliance/i.test(section)) return "Treat eligibility and prescribed forms as pass/fail controls; verify source documents and expiry/status before export.";
  if (/team|cv|personnel/i.test(section)) return "Map named reviewed experts to tender roles, CV proof, qualifications, licences, availability and comparable assignments.";
  if (/experience|references/i.test(section)) return "Use reviewed comparable project references and separate direct same-scope evidence from transferable evidence.";
  if (critical > 0) return "Do not finalize this section until critical requirement(s) are verified or formally waived by the bid lead.";
  if (missing > 0) return "Write cautiously; convert missing evidence into final bid-team actions instead of unsupported claims.";
  return "Write direct evaluator-facing prose: requirement, response, evidence, deliverable, responsible role and risk control.";
}

function buildSectionPlan(requirements: ProposalContractRequirement[]): ProposalContractSectionPlan[] {
  const bySection = new Map<string, ProposalContractRequirement[]>();
  for (const requirement of requirements) {
    const current = bySection.get(requirement.proposalSection) ?? [];
    current.push(requirement);
    bySection.set(requirement.proposalSection, current);
  }
  return [...bySection.entries()].map(([section, nodes]) => ({
    section,
    requirementIds: nodes.map((node) => node.id),
    strongestEvidenceSupport: nodes.reduce((best, node) => bestSupport(best, node.evidenceSupport), "NEEDS_CONFIRMATION" as TenderResponseBlueprintItem["evidenceSupport"]),
    riskLevel: nodes.reduce((risk, node) => worseRisk(risk, node.riskLevel), "LOW" as TenderCriterionGraphNode["riskLevel"]),
    writingInstruction: sectionInstruction(section, nodes),
  }));
}

function buildExportGates(params: {
  graph: TenderCriterionGraph;
  blueprint: TenderResponseBlueprintItem[];
  tenderFormStrategy: TenderFormStrategy;
  input: ProposalIntelligenceContractInput;
}): ProposalExportGate[] {
  const criticalNodes = params.graph.nodes.filter((node) => node.riskLevel === "CRITICAL");
  const highNodes = params.graph.nodes.filter((node) => node.riskLevel === "HIGH");
  const missingEvidence = params.blueprint.filter((item) => item.evidenceSupport === "NEEDS_CONFIRMATION");
  const reviewedExperts = params.input.reviewedExpertCount ?? params.input.expertLines.length;
  const reviewedProjects = params.input.reviewedProjectCount ?? params.input.projectLines.length;
  const selectedExperts = params.input.selectedExpertCount ?? params.input.expertLines.length;
  const selectedProjects = params.input.selectedProjectCount ?? params.input.projectLines.length;
  const hasPricingRisk = params.tenderFormStrategy.isTwoEnvelope || params.tenderFormStrategy.commercialControls.some((line) => /no price|two-envelope|financial envelope|technical proposal/i.test(line));

  return [
    {
      gate: "Critical criterion control",
      status: criticalNodes.length > 0 ? "BLOCK" : highNodes.length > 0 ? "WARN" : "PASS",
      rationale: `${criticalNodes.length} critical and ${highNodes.length} high-risk criterion graph node(s).`,
      action: criticalNodes.length > 0 ? "Block final export until critical nodes are verified or formally waived." : highNodes.length > 0 ? "Require senior bid review before export." : "No critical criterion blockers detected.",
    },
    {
      gate: "Evidence support control",
      status: missingEvidence.length > 0 ? "WARN" : "PASS",
      rationale: `${missingEvidence.length} blueprint item(s) still need evidence confirmation.`,
      action: missingEvidence.length > 0 ? "Do not overclaim; add reviewed evidence or write as bid-team action." : "All blueprint items have at least partial evidence support.",
    },
    {
      gate: "Reviewed expert/project evidence control",
      status: (selectedExperts > 0 && reviewedExperts === 0) || (selectedProjects > 0 && reviewedProjects === 0) ? "BLOCK" : reviewedExperts < selectedExperts || reviewedProjects < selectedProjects ? "WARN" : "PASS",
      rationale: `${reviewedExperts}/${selectedExperts} selected expert(s) reviewed; ${reviewedProjects}/${selectedProjects} selected project(s) reviewed.`,
      action: "Use reviewed records for hard claims; unreviewed selections must be reviewed or written as pending evidence.",
    },
    {
      gate: "Commercial / technical separation",
      status: hasPricingRisk ? "WARN" : "PASS",
      rationale: hasPricingRisk ? "Tender-form strategy requires commercial-content control." : "No strict two-envelope/technical-only control detected.",
      action: hasPricingRisk ? "Run final price-leakage guard and keep pricing in the financial/commercial envelope only." : "Keep commercial content only where the tender requests it.",
    },
  ];
}

export function buildProposalIntelligenceContract(input: ProposalIntelligenceContractInput): ProposalIntelligenceContract {
  const tenderProfile = classifyUniversalTender(`${input.tenderTitle}\n${input.requirements.join("\n")}`);
  const tenderFormStrategy = buildTenderFormStrategy({
    tenderTitle: input.tenderTitle,
    requirements: input.requirements,
    submissionLines: [...input.complianceLines, ...(input.submissionRules ?? [])],
    extraText: input.clientName,
  });
  const criterionGraph = buildTenderCriterionGraph(input);
  const blueprint = buildTenderResponseBlueprint(input);
  const requirements = criterionGraph.nodes.map((node, index) => {
    const item = blueprint[index] ?? blueprint.find((candidate) => clean(candidate.requirement) === clean(node.requirement));
    const serviceCapability = item?.serviceCapability ?? node.serviceCapabilities.join(", ");
    return {
      id: node.id,
      requirement: node.requirement,
      category: node.category,
      mandatory: node.mandatory,
      riskLevel: node.riskLevel,
      proposalSection: node.proposalSection,
      serviceCapability: serviceCapability || "General tender response capability",
      evaluatorConcern: item?.evaluatorConcern ?? node.category,
      evidenceSupport: item?.evidenceSupport ?? node.evidenceSupport,
      evidenceLine: item?.evidenceLine ?? node.evidenceLine,
      responseStrategy: item?.responseStrategy ?? node.responseAction,
      responseAction: node.responseAction,
      validationAction: node.validationAction,
    } satisfies ProposalContractRequirement;
  });

  return {
    schemaVersion: "PIC-1",
    tender: {
      title: clean(input.tenderTitle),
      clientName: clean(input.clientName),
      universalProfile: universalProfileSummary(tenderProfile),
      primaryTenderForm: tenderFormStrategy.primaryForm,
      isTwoEnvelope: tenderFormStrategy.isTwoEnvelope,
    },
    tenderFormStrategy,
    criterionGraph,
    requirements,
    sectionPlan: buildSectionPlan(requirements),
    evidenceSummary: {
      expertLines: input.expertLines.filter((line) => clean(line)).length,
      projectLines: input.projectLines.filter((line) => clean(line)).length,
      companyEvidenceLines: input.companyEvidenceLines.filter((line) => clean(line)).length,
      projectEvidenceLines: input.projectEvidenceLines.filter((line) => clean(line)).length,
      complianceLines: input.complianceLines.filter((line) => clean(line)).length,
      directBlueprintEvidence: countSupport(blueprint, "DIRECT"),
      partialBlueprintEvidence: countSupport(blueprint, "PARTIAL"),
      missingBlueprintEvidence: countSupport(blueprint, "NEEDS_CONFIRMATION"),
    },
    exportGates: buildExportGates({ graph: criterionGraph, blueprint, tenderFormStrategy, input }),
    writingRules: [
      "Every proposal paragraph must answer a tender requirement, prove a selected evidence point, or control a submission risk.",
      "DIRECT evidence supports confident claims; PARTIAL evidence must be framed as transferable/supporting; NEEDS_CONFIRMATION must become a final review action.",
      "Critical criterion graph nodes block final export until verified or formally waived by the bid lead.",
      "Tender-form strategy controls the proposal shape: EOI/prequalification, RFP, RFQ, ITT, framework and two-envelope responses must not use the same narrative pattern.",
      "Commercial/pricing content must stay out of technical/two-envelope outputs unless the tender explicitly combines envelopes.",
    ],
  };
}

export function renderProposalIntelligenceContract(input: ProposalIntelligenceContractInput): string {
  const contract = buildProposalIntelligenceContract(input);
  const sectionRows = [
    "| Proposal section | Requirement IDs | Strongest evidence | Risk | Writing instruction |",
    "|---|---|---|---|---|",
    ...contract.sectionPlan.map((section) => `| ${section.section} | ${section.requirementIds.join(", ")} | ${section.strongestEvidenceSupport} | ${section.riskLevel} | ${section.writingInstruction} |`),
  ];
  const gateRows = [
    "| Gate | Status | Rationale | Action |",
    "|---|---|---|---|",
    ...contract.exportGates.map((gate) => `| ${gate.gate} | ${gate.status} | ${gate.rationale} | ${gate.action} |`),
  ];
  return [
    "## Proposal Intelligence Contract",
    `Contract: ${contract.schemaVersion}. Tender: ${contract.tender.title}. Client: ${contract.tender.clientName}. Form: ${contract.tender.primaryTenderForm}${contract.tender.isTwoEnvelope ? " / two-envelope" : ""}. Universal profile: ${contract.tender.universalProfile}.`,
    `Evidence summary: ${contract.evidenceSummary.expertLines} expert line(s), ${contract.evidenceSummary.projectLines} project line(s), ${contract.evidenceSummary.companyEvidenceLines} company evidence line(s), ${contract.evidenceSummary.projectEvidenceLines} project evidence attachment line(s), ${contract.evidenceSummary.complianceLines} compliance line(s). Blueprint evidence: ${contract.evidenceSummary.directBlueprintEvidence} DIRECT, ${contract.evidenceSummary.partialBlueprintEvidence} PARTIAL, ${contract.evidenceSummary.missingBlueprintEvidence} NEEDS_CONFIRMATION.`,
    "### Contract Section Plan",
    sectionRows.join("\n"),
    "### Contract Export Gates",
    gateRows.join("\n"),
    "### Contract Writing Rules",
    ...contract.writingRules.map((rule) => `- ${rule}`),
  ].join("\n\n");
}

export function renderProposalIntelligencePromptBlock(input: ProposalIntelligenceContractInput): string {
  const contract = buildProposalIntelligenceContract(input);
  return [
    "PROPOSAL INTELLIGENCE CONTRACT — obey before drafting:",
    `Tender form: ${contract.tender.primaryTenderForm}${contract.tender.isTwoEnvelope ? "; strict two-envelope controls apply" : ""}.`,
    `Criterion graph: ${contract.criterionGraph.summary.totalCriteria} criteria; ${contract.criterionGraph.summary.criticalCount} critical; ${contract.criterionGraph.summary.highCount} high-risk; ${contract.criterionGraph.summary.missingEvidenceCount} missing evidence.`,
    "Section writing plan:",
    ...contract.sectionPlan.map((section) => `- ${section.section}: ${section.requirementIds.join(", ")} | evidence=${section.strongestEvidenceSupport} | risk=${section.riskLevel} | ${section.writingInstruction}`),
    "Export gates:",
    ...contract.exportGates.map((gate) => `- ${gate.status}: ${gate.gate} — ${gate.action}`),
    "Hard writing rules:",
    ...contract.writingRules.map((rule) => `- ${rule}`),
  ].join("\n");
}
