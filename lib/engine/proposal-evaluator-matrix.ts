import { filterCleanLines } from "./pattern-filter";
import { truncateDisplayLine, withoutProvenanceTags } from "./proposal-labels";
import { classifyUniversalTender, universalProfileSummary } from "./universal-tender-taxonomy";
import { renderTenderResponseBlueprint } from "./tender-response-blueprint";
import { applyProposalQualityRepairAddenda } from "./proposal-quality-repair";
import { buildTenderFormStrategy, renderTenderFormStrategy } from "./tender-form-strategy";
import { enforceTechnicalPriceSeparation } from "./proposal-price-leakage-guard";
import { renderTenderCriterionGraph } from "./tender-criterion-graph";
import { renderProposalIntelligenceContract } from "./proposal-intelligence-contract";
import { applyProposalEvaluatorLoop } from "./proposal-evaluator-loop";

export type EvaluatorMatrixInput = {
  tenderTitle: string;
  clientName: string;
  requirements: string[];
  expertLines: string[];
  projectLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  complianceLines: string[];
  differentiators: string[];
};

type EvidencePick = {
  line: string;
  supportLevel: "DIRECT" | "PARTIAL" | "NEEDS_CONFIRMATION";
  score: number;
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/\bSenior-level requirement bundle consolidating \d+ extracted tender instruction\(s\)\.?/gi, "")
    .replace(/\bKey evidence interpreted:\s*/gi, "")
    .replace(/\bCompany evidence available:\s*/gi, "")
    .replace(/\bProject evidence available:\s*/gi, "")
    .replace(/\bBid-team confirmation:\s*/gi, "")
    .replace(/\bBid team\b/gi, "Proposal team")
    .replace(/\s+/g, " ")
    .trim();
}

function take(lines: string[], count: number, maxLen = 260): string[] {
  return lines
    .map(clean)
    .filter(Boolean)
    .filter((line) => filterCleanLines([line]).length > 0)
    .slice(0, count)
    .map((line) => truncateDisplayLine(line, maxLen));
}

function tokenize(value: string): string[] {
  return clean(value).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !/^(shall|must|required|requirement|proposal|tender|client|consultant|service|services|including|provide|submit|section|document)$/.test(w));
}

function evidencePool(input: EvaluatorMatrixInput): string[] {
  return [
    ...take(input.projectLines, 12, 320),
    ...take(input.expertLines, 12, 280),
    ...take(input.companyEvidenceLines, 12, 300),
    ...take(input.projectEvidenceLines, 12, 320),
    ...take(input.complianceLines, 10, 260),
  ];
}

function scoreEvidence(requirement: string, line: string): number {
  const reqWords = tokenize(requirement);
  const lower = clean(line).toLowerCase();
  const lexical = reqWords.filter((w) => lower.includes(w)).length;
  const reqProfile = classifyUniversalTender(requirement);
  const lineProfile = classifyUniversalTender(line);
  const capabilityOverlap = reqProfile.serviceCapabilities.filter((capability) => lineProfile.serviceCapabilities.includes(capability)).length;
  const sectorOverlap = reqProfile.sectorDomains.filter((sector) => lineProfile.sectorDomains.includes(sector)).length;
  const formOverlap = reqProfile.tenderForms.filter((form) => lineProfile.tenderForms.includes(form)).length;
  const evidenceBonus = /reviewed|client|contract|completion|certificate|cv|years|license|licence|registration|audit|reference|value|etb|usd|project|expert/i.test(line) ? 2 : 0;
  return lexical + capabilityOverlap * 4 + sectorOverlap * 3 + formOverlap * 2 + evidenceBonus;
}

function pickEvidence(requirement: string, input: EvaluatorMatrixInput, index: number): EvidencePick {
  const pool = evidencePool(input);
  if (pool.length === 0) return { line: "No reviewed evidence line is currently mapped. Add reviewed company/project/expert evidence before final submission.", supportLevel: "NEEDS_CONFIRMATION", score: 0 };
  const scored = pool.map((line) => ({ line, score: scoreEvidence(requirement, line) })).sort((a, b) => b.score - a.score);
  const best = scored[0] ?? { line: pool[index % pool.length], score: 0 };
  if (best.score >= 7) return { ...best, supportLevel: "DIRECT" };
  if (best.score >= 3) return { ...best, supportLevel: "PARTIAL" };
  return { line: pool[index % pool.length], score: best.score, supportLevel: "NEEDS_CONFIRMATION" };
}

function responseStrategy(requirement: string): string {
  const profile = classifyUniversalTender(requirement);
  const req = requirement.toLowerCase();
  if (profile.serviceCapabilities.includes("GEOTECHNICAL_INVESTIGATION")) return "Respond with investigation methodology, borehole/testing plan, laboratory quality controls, reporting deliverables, and geotechnical risk controls.";
  if (profile.serviceCapabilities.includes("URBAN_PLANNING")) return "Respond with spatial analysis, stakeholder engagement, land-use/zoning logic, scenario development, approval pathway, and implementation controls.";
  if (profile.serviceCapabilities.includes("ASSET_MANAGEMENT")) return "Respond with asset inventory, condition assessment, lifecycle costing, maintenance planning, data handover, and operational risk reduction.";
  if (profile.serviceCapabilities.includes("CONTRACT_ADMINISTRATION")) return "Respond with contract controls, variation/claim handling, payment certification, FIDIC or equivalent administration, reporting cadence, and dispute prevention.";
  if (profile.serviceCapabilities.includes("SUPERVISION")) return "Respond with site supervision structure, QA/QC inspections, HSE coordination, progress reporting, non-conformance control, and handover management.";
  if (profile.serviceCapabilities.includes("INTERIOR_DESIGN")) return "Respond with space planning, finish/material selection, user requirements, coordination with MEP/architecture, mock-up review, and quality-controlled deliverables.";
  if (profile.serviceCapabilities.includes("ARCHITECTURAL_DESIGN") || profile.serviceCapabilities.includes("ENGINEERING_DESIGN")) return "Respond with design stages, discipline coordination, codes/standards, design review gates, drawings/specifications/BOQ deliverables, and constructability controls.";
  if (/cv|expert|personnel|staff|team/i.test(req)) return "Respond with named reviewed experts, role mapping, qualifications, years of experience, comparable assignments, availability, and CV appendix control.";
  if (/experience|reference|past|similar|project/i.test(req)) return "Respond with reviewed comparable projects, client names, scope similarity, value/scale where available, completion evidence, and attachment references.";
  if (/financial|price|commercial|cost|boq/i.test(req)) return "Respond only in the commercial envelope where required; keep the technical proposal price-free and map the pricing workbook to the financial criteria.";
  return "Respond directly to the requirement, explain the method, identify responsible evidence, state deliverables, and show evaluator-risk controls.";
}

function evaluatorAngle(requirement: string): string {
  const profile = classifyUniversalTender(requirement);
  const req = requirement.toLowerCase();
  if (/mandatory|shall|must|required|eligib/i.test(req)) return "Mandatory compliance / pass-fail risk";
  if (/score|evaluation|marks|technical/i.test(req)) return "Technical scoring / evaluator marks";
  if (profile.serviceCapabilities.length > 0) return `Service capability fit — ${profile.serviceCapabilities.slice(0, 3).join(", ")}`;
  if (profile.sectorDomains.length > 0) return `Sector relevance — ${profile.sectorDomains.slice(0, 3).join(", ")}`;
  return "General evaluator concern";
}

function proofItems(input: EvaluatorMatrixInput): string[] {
  return [
    ...take(input.expertLines, 10, 260).map((line) => `Expert/CV evidence: ${line}`),
    ...take(input.projectLines, 10, 320).map((line) => `Project reference evidence: ${line}`),
    ...take(input.companyEvidenceLines, 12, 360).map((line) => `Company record evidence: ${line}`),
    ...take(input.projectEvidenceLines, 8, 360).map((line) => `Project attachment evidence: ${line}`),
  ];
}

function matrixTable(requirements: string[], input: EvaluatorMatrixInput): string {
  const rows = ["| # | Tender criterion / evaluator angle | Response strategy | Best mapped evidence | Support | Final action |", "|---|---|---|---|---|---|"];
  requirements.forEach((requirement, index) => {
    const evidence = pickEvidence(requirement, input, index);
    const action = evidence.supportLevel === "DIRECT" ? "Use as proposal proof and attach/source-check before final export." : evidence.supportLevel === "PARTIAL" ? "Strengthen narrative with more direct document evidence before submission." : "Do not overclaim; add reviewed evidence or soften the claim.";
    rows.push(`| ${index + 1} | ${withoutProvenanceTags(clean(requirement))}<br>${evaluatorAngle(requirement)} | ${responseStrategy(requirement)} | ${clean(evidence.line)} | ${evidence.supportLevel} | ${action} |`);
  });
  return rows.join("\n");
}

export function appendEvaluatorResponseMatrix(markdown: string, input: EvaluatorMatrixInput): string {
  let output = markdown.trim();
  const tenderProfile = classifyUniversalTender(`${input.tenderTitle}\n${input.requirements.join("\n")}`);
  const tenderFormStrategy = buildTenderFormStrategy({ tenderTitle: input.tenderTitle, requirements: input.requirements, submissionLines: input.complianceLines, extraText: input.clientName });

  output += "\n\n" + renderProposalIntelligenceContract(input);
  output += "\n\n" + renderTenderFormStrategy(tenderFormStrategy);
  output += "\n\n" + renderTenderCriterionGraph(input);
  output += "\n\n" + renderTenderResponseBlueprint(input);

  output += "\n\n## Tender Criteria Response Matrix";
  output += `\nThis section maps the proposal response to the evaluator's criteria for ${clean(input.clientName)} / ${clean(input.tenderTitle)}. Universal tender profile: ${universalProfileSummary(tenderProfile)}.`;

  const reqs = take(input.requirements, 14, 260);
  const finalReqs = reqs.length > 0 ? reqs : ["Technical understanding and methodology", "Relevant company experience", "Professional team and CV strength", "Compliance with submission requirements"];
  output += "\n\n" + matrixTable(finalReqs, input);

  output += "\n\n## Multi-Angle Proposal Quality Check";
  output += "\nThe final proposal is checked from the following evaluator angles before submission:";
  for (const angle of [
    "Proposal Intelligence Contract: one controlling plan connects tender form, criterion graph, response blueprint, evidence summary, section plan and export gates.",
    `Tender-form fit: ${tenderFormStrategy.primaryForm} response logic is applied, including ${tenderFormStrategy.isTwoEnvelope ? "strict two-envelope controls" : "commercial-content controls where applicable"}.`,
    "Criterion graph control: eligibility, scope, experience, personnel, submission, commercial, evaluation and disqualification criteria are separated before final export.",
    "Scope compliance: every major tender requirement has a direct response or a controlled evidence action.",
    "Service-capability fit: design, supervision, contract administration, geotechnical, urban planning, asset management and other service lines are matched by capability, not by loose keywords.",
    "Sector relevance: sector-specific evidence is preferred, while transferable service evidence is allowed only when capability fit is strong.",
    "Expert credibility: named experts must be reviewed and mapped to roles, qualifications, CVs and responsibilities.",
    "Project comparability: project references must show service similarity, scale/context, client evidence and attachment readiness.",
    "Commercial separation: technical proposals must remain price-free unless the tender explicitly requires commercial content in the same envelope.",
    "Submission control: file names, document order, signatures/stamps, deadline, method and appendices remain controlled through final export readiness.",
  ]) output += `\n- ${angle}`;

  output += "\n\n## Claim-to-Evidence Proof Map";
  output += "\nThe proposal claims below must remain backed by reviewed records. Unsupported claims should be removed, softened, or converted into final evidence actions.";
  const proof = proofItems(input);
  if (proof.length > 0) for (const line of proof.slice(0, 30)) output += `\n- ${line}`;
  else output += "\n- Source proof must be confirmed before final submission.";

  output += "\n\n## Evidence Gaps and Anti-Hallucination Controls";
  output += "\n- Do not invent staff, project roles, certificates, contract values, completion dates, sector experience, licences, financial capacity, photos, drawings, or client approvals.";
  output += "\n- If the evidence is partial, present it as transferable or supporting evidence, not as exact same-scope experience.";
  output += "\n- If the evidence is missing, add a final review action instead of making an unsupported claim.";
  output += "\n- If the criterion graph marks an item CRITICAL, block final export until verified or formally waived by the bid lead.";
  output += `\n- Tender-form rule: ${tenderFormStrategy.proposalObjective}`;
  for (const instruction of tenderFormStrategy.writingInstructions.slice(0, 4)) output += `\n- ${instruction}`;
  for (const control of tenderFormStrategy.commercialControls.slice(0, 4)) output += `\n- ${control}`;

  output += "\n\n## Win Themes and Differentiators";
  const differentiators = take(input.differentiators, 6, 280);
  const finalDifferentiators = differentiators.length > 0 ? differentiators : ["Evidence-led proposal built from reviewed company records.", "Multidisciplinary engineering, design, supervision, contract administration and planning capability matched to tender scope.", "Senior bid-review approach that separates hard blockers from manageable evidence actions.", "Technical methodology aligned to tender risks, deliverables, QA/QC, coordination and submission controls."];
  for (const item of finalDifferentiators) output += `\n- ${item}`;

  output += "\n\n## Delivery Methodology Work Plan";
  const phases = tenderFormStrategy.primaryForm === "EOI" || tenderFormStrategy.primaryForm === "PREQUALIFICATION"
    ? ["Eligibility and shortlist requirement confirmation.", "Company capability, similar assignment and key expert evidence mapping.", "Legal, financial, registration and declaration evidence control.", "Senior review against pass/fail and shortlist criteria.", "Final verification of signatures, forms, file names, submission method and deadline."]
    : tenderFormStrategy.primaryForm === "RFQ"
      ? ["RFQ scope and quotation-form confirmation.", "Technical compliance note and delivery schedule preparation.", "Pricing/BOQ/rate-card completion where required.", "Commercial assumptions, exclusions, validity and tax/VAT check.", "Final verification of signed quotation, file names, format and deadline."]
      : ["Inception, tender confirmation and document-control setup.", "Requirement review, evidence mapping and scope-by-scope response planning.", "Technical methodology development with discipline coordination, deliverables, QA/QC and risk controls.", "Senior review against evaluator logic, compliance matrix, appendix register and submission rules.", "Final verification of signatures, stamps, CVs, references, file names, submission method and deadline."];
  for (const phase of phases) output += `\n- ${phase}`;

  output += "\n\n## Evidence-Based Appendix Register";
  const appendixLines = [...take(input.companyEvidenceLines, 5, 240), ...take(input.projectEvidenceLines, 5, 240), ...take(input.expertLines, 5, 220).map((line) => `CV / Expert evidence: ${line}`), ...take(input.projectLines, 5, 240).map((line) => `Project reference evidence: ${line}`)];
  if (appendixLines.length > 0) for (const line of appendixLines.slice(0, 16)) output += `\n- ${line}`;
  else output += "\n- Appendix evidence to be confirmed before final submission.";

  output += "\n\n## Final Submission Control Checklist";
  const checklist = take(input.complianceLines, 8, 260);
  for (const line of checklist) output += `\n- ${line}`;
  for (const outputName of tenderFormStrategy.requiredOutputs.slice(0, 8)) output += `\n- Confirm required output is prepared/reconciled: ${outputName}.`;
  output += "\n- Confirm no unsupported claim, placeholder text, AI disclaimer, prohibited financial content or wrong file name remains in the final package.";

  output = applyProposalEvaluatorLoop(output, input);

  return enforceTechnicalPriceSeparation(applyProposalQualityRepairAddenda(output, input), input);
}
