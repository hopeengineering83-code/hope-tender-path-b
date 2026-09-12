import { buildTenderFormStrategy, type TenderFormStrategy } from "./tender-form-strategy";
import { buildTenderCriterionGraph, type TenderCriterionGraph, type TenderCriterionGraphNode } from "./tender-criterion-graph";
import { buildTenderResponseBlueprint, type BlueprintEvidenceInput, type TenderResponseBlueprintItem } from "./tender-response-blueprint";
import { classifyUniversalTender, universalProfileSummary } from "./universal-tender-taxonomy";
import { buildSourceGroundedRequirementMap, renderSourceGroundedRequirementMap, type SourceGroundedRequirement, type TenderSourceDocument } from "./source-grounded-requirement-map";
import { buildEvidenceGraph, renderEvidenceGraph, type EvidenceGraph } from "./evidence-graph";

export type ProposalIntelligenceContractInput = BlueprintEvidenceInput & {
  evaluationCriteria?: string[];
  submissionRules?: string[];
  selectedExpertCount?: number;
  selectedProjectCount?: number;
  reviewedExpertCount?: number;
  reviewedProjectCount?: number;
  tenderSources?: TenderSourceDocument[];
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
  groundedRequirements: number;
  ungroundedRequirements: number;
  directProjectEvidence: number;
  directExpertEvidence: number;
  transferableProjectEvidence: number;
  transferableExpertEvidence: number;
  unfitProjectEvidence: number;
  unfitExpertEvidence: number;
  unsafeEvidenceMismatches: number;
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
  sourceGrounding: SourceGroundedRequirement | null;
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
  schemaVersion: "PIC-3";
  tender: {
    title: string;
    clientName: string;
    universalProfile: string;
    primaryTenderForm: TenderFormStrategy["primaryForm"];
    isTwoEnvelope: boolean;
  };
  tenderFormStrategy: TenderFormStrategy;
  criterionGraph: TenderCriterionGraph;
  sourceGrounding: SourceGroundedRequirement[];
  evidenceGraph: EvidenceGraph;
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
  const ungrounded = nodes.filter((node) => node.sourceGrounding && !node.sourceGrounding.grounded).length;
  if (/commercial|financial/i.test(section)) return "Keep commercial/pricing content in the correct envelope or form; technical narrative must remain price-free when required.";
  if (/submission/i.test(section)) return "Write as a submission-control checklist with exact file, format, signature/stamp, recipient, deadline and channel checks.";
  if (/eligibility|forms|compliance/i.test(section)) return "Treat eligibility and prescribed forms as pass/fail controls; verify source documents and expiry/status before export.";
  if (/team|cv|personnel/i.test(section)) return "Map named reviewed experts to tender roles, CV proof, qualifications, licences, availability and comparable assignments.";
  if (/experience|references/i.test(section)) return "Use reviewed comparable project references and separate direct same-scope evidence from transferable evidence.";
  if (critical > 0) return "Do not finalize this section until critical requirement(s) are verified or formally waived by the bid lead.";
  if (ungrounded > 0) return "Confirm tender source quotes before making strong claims for this section.";
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
  sourceMap: SourceGroundedRequirement[];
  evidenceGraph: EvidenceGraph;
  input: ProposalIntelligenceContractInput;
}): ProposalExportGate[] {
  const criticalNodes = params.graph.nodes.filter((node) => node.riskLevel === "CRITICAL");
  const highNodes = params.graph.nodes.filter((node) => node.riskLevel === "HIGH");
  const missingEvidence = params.blueprint.filter((item) => item.evidenceSupport === "NEEDS_CONFIRMATION");
  const ungroundedMandatory = params.sourceMap.filter((item) => !item.grounded && /\bshall\b|\bmust\b|required|mandatory|failure\s+to|reject|disqualif/i.test(item.requirement));
  const reviewedExperts = params.input.reviewedExpertCount ?? params.input.expertLines.length;
  const reviewedProjects = params.input.reviewedProjectCount ?? params.input.projectLines.length;
  const selectedExperts = params.input.selectedExpertCount ?? params.input.expertLines.length;
  const selectedProjects = params.input.selectedProjectCount ?? params.input.projectLines.length;
  const hasPricingRisk = params.tenderFormStrategy.isTwoEnvelope || params.tenderFormStrategy.commercialControls.some((line) => /no price|two-envelope|financial envelope|technical proposal/i.test(line));
  const hasNoUsableProject = params.input.projectLines.length > 0 && params.evidenceGraph.summary.directProjects + params.evidenceGraph.summary.transferableProjects === 0;
  const hasNoUsableExpert = params.input.expertLines.length > 0 && params.evidenceGraph.summary.directExperts + params.evidenceGraph.summary.transferableExperts === 0;

  return [
    {
      gate: "Critical criterion control",
      status: criticalNodes.length > 0 ? "BLOCK" : highNodes.length > 0 ? "WARN" : "PASS",
      rationale: `${criticalNodes.length} critical and ${highNodes.length} high-risk criterion graph node(s).`,
      action: criticalNodes.length > 0 ? "Block final export until critical nodes are verified or formally waived." : highNodes.length > 0 ? "Require senior bid review before export." : "No critical criterion blockers detected.",
    },
    {
      gate: "Tender source grounding control",
      status: ungroundedMandatory.length > 0 ? "BLOCK" : params.sourceMap.some((item) => !item.grounded) ? "WARN" : "PASS",
      rationale: `${params.sourceMap.filter((item) => item.grounded).length}/${params.sourceMap.length} requirement(s) have source quote grounding; ${ungroundedMandatory.length} mandatory item(s) are ungrounded.`,
      action: ungroundedMandatory.length > 0 ? "Block final export until mandatory requirements are traced to tender source quotes or formally waived." : "Confirm low-confidence/untraced source mappings during senior review.",
    },
    {
      gate: "Evidence graph fit control",
      status: params.evidenceGraph.summary.unsafeMismatchCount > 0 || hasNoUsableProject || hasNoUsableExpert ? "BLOCK" : params.evidenceGraph.summary.unfitProjects + params.evidenceGraph.summary.unfitExperts > 0 ? "WARN" : "PASS",
      rationale: `${params.evidenceGraph.summary.unsafeMismatchCount} unsafe mismatch(es); ${params.evidenceGraph.summary.directProjects} direct project(s), ${params.evidenceGraph.summary.transferableProjects} transferable project(s), ${params.evidenceGraph.summary.directExperts} direct expert(s), ${params.evidenceGraph.summary.transferableExperts} transferable expert(s).`,
      action: params.evidenceGraph.summary.unsafeMismatchCount > 0 ? "Remove unsafe project/expert evidence from primary proposal claims before final export." : hasNoUsableProject || hasNoUsableExpert ? "Add usable direct or transferable project/expert evidence before final export." : "Use DIRECT evidence for primary claims and TRANSFERABLE evidence only with explicit caveats.",
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
  const sourceMap = buildSourceGroundedRequirementMap({ requirements: input.requirements, tenderSources: input.tenderSources ?? [] });
  const evidenceGraph = buildEvidenceGraph({ tenderTitle: input.tenderTitle, requirements: input.requirements, projectLines: input.projectLines, expertLines: input.expertLines });
  const sourceByRequirement = new Map(sourceMap.map((source) => [clean(source.requirement), source]));
  const requirements = criterionGraph.nodes.map((node, index) => {
    const item = blueprint[index] ?? blueprint.find((candidate) => clean(candidate.requirement) === clean(node.requirement));
    const serviceCapability = item?.serviceCapability ?? node.serviceCapabilities.join(", ");
    const sourceGrounding = sourceByRequirement.get(clean(node.requirement)) ?? null;
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
      validationAction: sourceGrounding && !sourceGrounding.grounded ? `${node.validationAction} ${sourceGrounding.validationAction}` : node.validationAction,
      sourceGrounding,
    } satisfies ProposalContractRequirement;
  });

  return {
    schemaVersion: "PIC-3",
    tender: {
      title: clean(input.tenderTitle),
      clientName: clean(input.clientName),
      universalProfile: universalProfileSummary(tenderProfile),
      primaryTenderForm: tenderFormStrategy.primaryForm,
      isTwoEnvelope: tenderFormStrategy.isTwoEnvelope,
    },
    tenderFormStrategy,
    criterionGraph,
    sourceGrounding: sourceMap,
    evidenceGraph,
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
      groundedRequirements: sourceMap.filter((source) => source.grounded).length,
      ungroundedRequirements: sourceMap.filter((source) => !source.grounded).length,
      directProjectEvidence: evidenceGraph.summary.directProjects,
      directExpertEvidence: evidenceGraph.summary.directExperts,
      transferableProjectEvidence: evidenceGraph.summary.transferableProjects,
      transferableExpertEvidence: evidenceGraph.summary.transferableExperts,
      unfitProjectEvidence: evidenceGraph.summary.unfitProjects,
      unfitExpertEvidence: evidenceGraph.summary.unfitExperts,
      unsafeEvidenceMismatches: evidenceGraph.summary.unsafeMismatchCount,
    },
    exportGates: buildExportGates({ graph: criterionGraph, blueprint, tenderFormStrategy, sourceMap, evidenceGraph, input }),
    writingRules: [
      "Every proposal paragraph must answer a tender requirement, prove a selected evidence point, or control a submission risk.",
      "DIRECT evidence supports confident claims; PARTIAL evidence must be framed as transferable/supporting; NEEDS_CONFIRMATION must become a final review action.",
      "Evidence Graph DIRECT nodes are primary proof; TRANSFERABLE nodes require explicit caveats; UNFIT nodes must not be used as main proposal evidence.",
      "Critical criterion graph nodes block final export until verified or formally waived by the bid lead.",
      "Tender-source quotes/page references are authoritative; ungrounded mandatory requirements must be traced or formally waived before final export.",
      "Tender-form strategy controls the proposal shape: EOI/prequalification, RFP, RFQ, ITT, framework and two-envelope responses must not use the same narrative pattern.",
      "Commercial/pricing content must stay out of technical/two-envelope outputs unless the tender explicitly combines envelopes.",
      // Per Pillar 4: source-citation enforcement — every factual claim must
      // trace to a source document. Never invent facts, experts, projects,
      // legal facts, financial facts, required documents, or standard
      // proposal sections that are not grounded in the uploaded tender files.
      "NEVER invent facts, experts, projects, legal facts, financial facts, required documents, or standard proposal sections. Every factual claim must trace to a source document with a valid sourceDocumentId, page/sheet/slide number, and quotation. If no source exists for a claim, omit the claim entirely — do not fabricate.",
      "Do not generate generic legal, financial, annex, declaration, or methodology sections unless the tender explicitly requires them. If the tender does not mention a document type, do not create it.",
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
    `Evidence summary: ${contract.evidenceSummary.expertLines} expert line(s), ${contract.evidenceSummary.projectLines} project line(s), ${contract.evidenceSummary.companyEvidenceLines} company evidence line(s), ${contract.evidenceSummary.projectEvidenceLines} project evidence attachment line(s), ${contract.evidenceSummary.complianceLines} compliance line(s). Blueprint evidence: ${contract.evidenceSummary.directBlueprintEvidence} DIRECT, ${contract.evidenceSummary.partialBlueprintEvidence} PARTIAL, ${contract.evidenceSummary.missingBlueprintEvidence} NEEDS_CONFIRMATION. Source grounding: ${contract.evidenceSummary.groundedRequirements} grounded, ${contract.evidenceSummary.ungroundedRequirements} ungrounded. Evidence graph: ${contract.evidenceSummary.directProjectEvidence} direct project(s), ${contract.evidenceSummary.directExpertEvidence} direct expert(s), ${contract.evidenceSummary.unsafeEvidenceMismatches} unsafe mismatch(es).`,
    contract.sourceGrounding.length > 0 ? renderSourceGroundedRequirementMap({ sourceMap: contract.sourceGrounding }) : "## Source-Grounded Requirement Map\n\nNo tender source documents were provided to this contract. Requirements remain ungrounded until source text is supplied.",
    renderEvidenceGraph({ graph: contract.evidenceGraph }),
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
    `Source grounding: ${contract.evidenceSummary.groundedRequirements} grounded; ${contract.evidenceSummary.ungroundedRequirements} ungrounded.`,
    `Evidence graph: directProjects=${contract.evidenceSummary.directProjectEvidence}; transferableProjects=${contract.evidenceSummary.transferableProjectEvidence}; directExperts=${contract.evidenceSummary.directExpertEvidence}; transferableExperts=${contract.evidenceSummary.transferableExpertEvidence}; unsafeMismatches=${contract.evidenceSummary.unsafeEvidenceMismatches}.`,
    "Section writing plan:",
    ...contract.sectionPlan.map((section) => `- ${section.section}: ${section.requirementIds.join(", ")} | evidence=${section.strongestEvidenceSupport} | risk=${section.riskLevel} | ${section.writingInstruction}`),
    "Export gates:",
    ...contract.exportGates.map((gate) => `- ${gate.status}: ${gate.gate} — ${gate.action}`),
    "Hard writing rules:",
    ...contract.writingRules.map((rule) => `- ${rule}`),
  ].join("\n");
}
