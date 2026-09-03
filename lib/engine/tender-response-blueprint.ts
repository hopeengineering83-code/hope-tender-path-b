import { clientSafeComplianceNote } from "./automatic-requirement-coverage";
import { filterCleanLines } from "./pattern-filter";
import { truncateDisplayLine } from "./proposal-labels";
import { classifyUniversalTender, universalProfileSummary } from "./universal-tender-taxonomy";

export type BlueprintEvidenceInput = {
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

export type TenderResponseBlueprintItem = {
  id: string;
  requirement: string;
  responseSection: string;
  serviceCapability: string;
  evaluatorConcern: string;
  responseStrategy: string;
  evidenceLine: string;
  evidenceSupport: "DIRECT" | "PARTIAL" | "NEEDS_CONFIRMATION";
  riskControl: string;
  finalAction: string;
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/\bBid[-\s]?team\b/gi, "Proposal team")
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
  return clean(value).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !/^(shall|must|required|requirement|proposal|tender|client|consultant|service|services|including|provide|submit|section|document|technical|financial)$/.test(w));
}

function evidencePool(input: BlueprintEvidenceInput): string[] {
  // Sanitise once, here, rather than at each consumer. Compliance and evidence
  // lines are built from ComplianceMatrix.notes, which carries the engine's
  // serialized automatic-evidence record; every blueprint reader — the
  // compliance matrix addendum, the deep-reasoning table — would otherwise
  // print that internal key, UUID and all, into a client deliverable.
  return [
    ...take(input.projectLines, 14, 340),
    ...take(input.expertLines, 14, 300),
    ...take(input.companyEvidenceLines, 14, 340),
    ...take(input.projectEvidenceLines, 12, 340),
    ...take(input.complianceLines, 10, 280),
  ]
    .map((line) => clientSafeComplianceNote(line))
    .filter((line) => line.length > 0);
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
  const evidenceBonus = /reviewed|client|contract|completion|certificate|cv|years|license|licence|registration|audit|reference|value|etb|usd|project|expert|scope|deliverable/i.test(line) ? 2 : 0;
  return lexical + capabilityOverlap * 5 + sectorOverlap * 3 + formOverlap * 2 + evidenceBonus;
}

function pickEvidence(requirement: string, input: BlueprintEvidenceInput, index: number): { line: string; support: TenderResponseBlueprintItem["evidenceSupport"] } {
  const pool = evidencePool(input);
  if (pool.length === 0) return { line: "No reviewed evidence is mapped yet. Add reviewed project, expert, company, legal, financial or compliance evidence before final submission.", support: "NEEDS_CONFIRMATION" };
  const scored = pool.map((line) => ({ line, score: scoreEvidence(requirement, line) })).sort((a, b) => b.score - a.score);
  const best = scored[0] ?? { line: pool[index % pool.length], score: 0 };
  if (best.score >= 8) return { line: best.line, support: "DIRECT" };
  if (best.score >= 3) return { line: best.line, support: "PARTIAL" };
  return { line: pool[index % pool.length], support: "NEEDS_CONFIRMATION" };
}

function responseSection(requirement: string): string {
  const req = requirement.toLowerCase();
  if (/cv|expert|personnel|staff|team|key professional/.test(req)) return "Proposed Team and CV Evidence";
  if (/experience|reference|past|similar|project|portfolio/.test(req)) return "Relevant Experience and Project References";
  if (/methodology|approach|work plan|schedule|deliverable|scope/.test(req)) return "Technical Methodology and Work Plan";
  if (/financial|price|commercial|boq|cost|fee|rate/.test(req)) return "Commercial / Financial Proposal Controls";
  if (/form|declaration|annex|appendix|certificate|registration|licen[cs]e|tax|vat|tin/.test(req)) return "Compliance Forms and Eligibility Documents";
  if (/deadline|submission|email|portal|file name|format|envelope/.test(req)) return "Submission Control";
  return "Technical Proposal Response";
}

function serviceCapability(requirement: string): string {
  const profile = classifyUniversalTender(requirement);
  if (profile.serviceCapabilities.length > 0) return profile.serviceCapabilities.slice(0, 4).join(", ");
  if (profile.tenderForms.length > 0) return `Tender form: ${profile.tenderForms.slice(0, 3).join(", ")}`;
  if (profile.sectorDomains.length > 0) return `Sector: ${profile.sectorDomains.slice(0, 3).join(", ")}`;
  return "General tender response capability";
}

function evaluatorConcern(requirement: string): string {
  const req = requirement.toLowerCase();
  if (/mandatory|shall|must|required|eligib|pass.fail|disqualif/.test(req)) return "Pass/fail compliance risk";
  if (/score|evaluation|marks|weight|technical criteria/.test(req)) return "Evaluator scoring risk";
  if (/cv|expert|personnel|staff/.test(req)) return "Personnel credibility risk";
  if (/experience|reference|similar/.test(req)) return "Comparable evidence risk";
  if (/financial|price|commercial/.test(req)) return "Commercial compliance and envelope-separation risk";
  if (/deadline|submission|format|file name|portal|email/.test(req)) return "Submission rejection risk";
  return "Technical adequacy and evidence-support risk";
}

function responseStrategy(requirement: string): string {
  const profile = classifyUniversalTender(requirement);
  const req = requirement.toLowerCase();
  if (profile.serviceCapabilities.includes("GEOTECHNICAL_INVESTIGATION")) return "Present investigation plan, borehole/testing methodology, laboratory QA/QC, reporting outputs and geotechnical risk controls.";
  if (profile.serviceCapabilities.includes("URBAN_PLANNING")) return "Present spatial analysis, stakeholder engagement, land-use/zoning logic, implementation phasing and approval controls.";
  if (profile.serviceCapabilities.includes("ASSET_MANAGEMENT")) return "Present asset inventory, condition assessment, lifecycle costing, maintenance planning, data handover and operational-risk controls.";
  if (profile.serviceCapabilities.includes("CONTRACT_ADMINISTRATION")) return "Present contract controls, variation/claim management, payment certification, reporting cadence and dispute-prevention controls.";
  if (profile.serviceCapabilities.includes("SUPERVISION")) return "Present site supervision structure, QA/QC inspections, HSE coordination, progress reporting, non-conformance control and handover management.";
  if (profile.serviceCapabilities.includes("INTERIOR_DESIGN")) return "Present space planning, finish/material selection, user requirements, MEP/architectural coordination, mock-up review and deliverable quality gates.";
  if (profile.serviceCapabilities.includes("ARCHITECTURAL_DESIGN") || profile.serviceCapabilities.includes("ENGINEERING_DESIGN")) return "Present design stages, discipline coordination, codes/standards, design reviews, drawings/specifications/BOQ deliverables and constructability controls.";
  if (/cv|expert|personnel|staff|team/.test(req)) return "Map named reviewed experts to roles, qualifications, years of experience, CV appendix and comparable assignments.";
  if (/experience|reference|past|similar|project/.test(req)) return "Map reviewed comparable projects to client, scope similarity, value/scale, period, completion evidence and reference attachments.";
  if (/financial|price|commercial|cost|boq/.test(req)) return "Keep technical narrative price-free unless allowed, and map all pricing content to the commercial envelope/forms.";
  return "Answer the requirement directly, cite the strongest reviewed evidence, define deliverables, assign responsibility and state QA/QC or compliance controls.";
}

function riskControl(requirement: string, support: TenderResponseBlueprintItem["evidenceSupport"]): string {
  if (support === "NEEDS_CONFIRMATION") return "Do not make a hard claim. Add reviewed source evidence or soften the statement before final submission.";
  if (support === "PARTIAL") return "Use as transferable/supporting evidence only; add stronger same-scope proof if available.";
  const req = requirement.toLowerCase();
  if (/financial|price|commercial/.test(req)) return "Verify envelope separation and remove all pricing from the technical proposal unless explicitly permitted.";
  if (/deadline|submission|format|file name|portal|email/.test(req)) return "Verify exact submission instruction, file name, format, deadline and recipient from the tender before export.";
  return "Use as proposal proof and cross-check against source documents before final export.";
}

function finalAction(support: TenderResponseBlueprintItem["evidenceSupport"]): string {
  if (support === "DIRECT") return "Write confidently with source-backed claim and include appendix/reference control.";
  if (support === "PARTIAL") return "Write carefully as relevant/transferable evidence and strengthen with direct proof if possible.";
  return "Flag for final evidence review; avoid unsupported claims.";
}

export function buildTenderResponseBlueprint(input: BlueprintEvidenceInput): TenderResponseBlueprintItem[] {
  // 420, not the original 320: formatRequirementLine's title+description alone
  // can reach 380 chars before its [p.N]/(§ …)/(quote: "…") tags are even
  // appended, so 320 truncated (via take -> truncateDisplayLine) more requirement
  // lines than it needed to — dropping their tags even when the requirement
  // itself was short enough that the FULL tagged line would have fit
  // comfortably with a little more room. 420 covers a short/medium real-world
  // requirement (title + one-sentence description + all three tags) without
  // truncation; a genuinely long one (see the real Pharo tender's 506-char
  // "Specialized Healthcare Design Experience" line) still safely drops its
  // tags rather than being cut mid-tag — truncateDisplayLine's job, not this
  // budget's.
  const reqs = take(input.requirements, 16, 420);
  const finalReqs = reqs.length > 0 ? reqs : ["Technical understanding and methodology", "Relevant company experience", "Professional team and CV strength", "Compliance with submission requirements"];
  return finalReqs.map((requirement, index) => {
    const evidence = pickEvidence(requirement, input, index);
    return {
      id: `TRB-${index + 1}`,
      requirement,
      responseSection: responseSection(requirement),
      serviceCapability: serviceCapability(requirement),
      evaluatorConcern: evaluatorConcern(requirement),
      responseStrategy: responseStrategy(requirement),
      evidenceLine: evidence.line,
      evidenceSupport: evidence.support,
      riskControl: riskControl(requirement, evidence.support),
      finalAction: finalAction(evidence.support),
    };
  });
}

export function renderTenderResponseBlueprint(input: BlueprintEvidenceInput): string {
  const profile = classifyUniversalTender(`${input.tenderTitle}\n${input.requirements.join("\n")}`);
  const rows = [
    "| ID | Requirement | Proposal section | Capability / angle | Evidence support | Evidence to use | Risk control |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const item of buildTenderResponseBlueprint(input)) {
    rows.push(`| ${item.id} | ${clean(item.requirement)} | ${item.responseSection} | ${item.serviceCapability}<br>${item.evaluatorConcern} | ${item.evidenceSupport} | ${clean(item.evidenceLine)} | ${item.riskControl} |`);
  }
  return [
    "## Tender Response Blueprint",
    `This blueprint converts the tender into a response plan before final review. Client: ${clean(input.clientName)}. Tender: ${clean(input.tenderTitle)}. Universal profile: ${universalProfileSummary(profile)}.`,
    rows.join("\n"),
    "### Blueprint Writing Rules",
    "- Each proposal section must answer a tender requirement, not generic marketing text.",
    "- DIRECT evidence can support confident claims; PARTIAL evidence must be written as relevant or transferable evidence; NEEDS_CONFIRMATION must not be overclaimed.",
    "- Commercial/pricing requirements must remain separated from the technical proposal unless the tender explicitly combines them.",
    "- Submission instructions are treated as rejection risks and must be verified before export.",
  ].join("\n\n");
}
