import { filterCleanLines } from "./pattern-filter";
import { truncateDisplayLine } from "./proposal-labels";
import type { EvaluatorMatrixInput } from "./proposal-evaluator-matrix";
import { buildTenderResponseBlueprint } from "./tender-response-blueprint";

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function take(lines: string[], count: number, maxLen = 220): string[] {
  return lines
    .map(clean)
    .filter(Boolean)
    .filter((line) => filterCleanLines([line]).length > 0)
    .slice(0, count)
    .map((line) => truncateDisplayLine(line, maxLen));
}

function hasHeading(markdown: string, pattern: RegExp): boolean {
  return pattern.test(markdown);
}

function statusForRequirement(requirement: string, support: string): "FULLY MET" | "PARTIALLY MET" | "NOT MET" {
  if (support === "DIRECT") return "FULLY MET";
  if (support === "PARTIAL") return "PARTIALLY MET";
  if (/mandatory|shall|must|required|eligib/i.test(requirement)) return "NOT MET";
  return "PARTIALLY MET";
}

function sectionE(input: EvaluatorMatrixInput): string {
  const blueprint = buildTenderResponseBlueprint(input).slice(0, 12);
  // The "Final action" column carried finalAction(), which is guidance to our
  // own writer — "Write confidently with source-backed claim", "Flag for final
  // evidence review" — and it was being printed to the client. A compliance
  // matrix is legitimate client content; instructions to the bid team are not.
  const rows = [
    "| Tender requirement | Compliance status | Where addressed | Supporting evidence |",
    "|---|---|---|---|",
  ];
  for (const item of blueprint) {
    rows.push(`| ${clean(item.requirement)} | ${statusForRequirement(item.requirement, item.evidenceSupport)} | ${item.responseSection} | ${clean(item.evidenceLine)} |`);
  }
  return [
    "## Section E: Compliance Matrix",
    "This matrix maps each requirement of the tender to the section of this proposal that answers it and the evidence supporting that answer.",
    rows.join("\n"),
  ].join("\n\n");
}

function sectionF(input: EvaluatorMatrixInput): string {
  const blueprint = buildTenderResponseBlueprint(input).slice(0, 12);
  const rows = [
    "| Evaluation criterion | Weight / priority | Where this proposal answers it | Evidence strength |",
    "|---|---|---|---|",
  ];
  for (const item of blueprint) {
    // The weight column used to print `100 - index * 5` as an "N% relative
    // attention" figure. That number came from the requirement's position in
    // this list, not from the tender: a real proposal told the evaluator that
    // one of their own criteria carried "100% relative attention" and another
    // "65%", weights the tender never stated. An invented weight in the column
    // an evaluator uses to check their own scoring is a fabricated fact, so
    // where the tender states no weight this now says so.
    const priority = /mandatory|shall|must|required|eligib/i.test(item.requirement)
      ? "Mandatory / pass-fail"
      : "Scored criterion (no weight stated in tender)";
    // "TRB-1" was an internal trace label with no meaning to the reader.
    rows.push(`| ${clean(item.requirement)} | ${priority} | Section ${item.responseSection} | ${item.evidenceSupport} |`);
  }
  return [
    "## Section F: Evaluation Criteria Response Mirror",
    "This mirror helps the evaluator see where each criterion is answered and prevents generic proposal sections from hiding scoring gaps.",
    rows.join("\n"),
  ].join("\n\n");
}

function sectionG(input: EvaluatorMatrixInput): string {
  const differentiators = take(input.differentiators, 5, 220);
  const fallback = [
    "Evidence-led response based on reviewed company, project and expert records.",
    "Multidisciplinary capability across design, interior design, supervision, contract administration, geotechnical investigation, urban planning and asset management.",
    "Evaluator-first proposal structure that maps scope, criteria, evidence and submission controls.",
  ];
  const finalItems = differentiators.length > 0 ? differentiators : fallback;
  const rows = [
    "| Discriminator | Linked evaluation criterion | Proof / control |",
    "|---|---|---|",
  ];
  const requirements = take(input.requirements, finalItems.length, 180);
  finalItems.forEach((item, index) => {
    rows.push(`| ${clean(item)} | ${requirements[index] ?? "Technical quality and evidence strength"} | Use reviewed evidence and remove unsupported claims before export. |`);
  });
  return [
    "## Section G: Win Themes & Discriminators",
    "The win themes below are only valid when supported by reviewed evidence. They are written as evaluator-facing discriminators, not generic marketing claims.",
    rows.join("\n"),
  ].join("\n\n");
}

function sectionH(input: EvaluatorMatrixInput): string {
  const blueprint = buildTenderResponseBlueprint(input).slice(0, 8);
  const direct = blueprint.filter((item) => item.evidenceSupport === "DIRECT").length;
  const partial = blueprint.filter((item) => item.evidenceSupport === "PARTIAL").length;
  const missing = blueprint.filter((item) => item.evidenceSupport === "NEEDS_CONFIRMATION").length;
  const predicted = Math.max(45, Math.min(92, Math.round((direct * 10 + partial * 6 + Math.max(0, 8 - missing) * 4) / Math.max(blueprint.length || 1, 1))));
  const rows = [
    "| Self-score axis | Score | Rationale |",
    "|---|---:|---|",
    `| Tender requirement coverage | ${missing === 0 ? "9/10" : missing <= 2 ? "7/10" : "5/10"} | ${direct} DIRECT, ${partial} PARTIAL, ${missing} NEEDS_CONFIRMATION evidence mappings. |`,
    `| Evidence strength | ${direct >= partial + missing ? "8/10" : partial > 0 ? "6/10" : "4/10"} | Claims are controlled by evidence support levels and final bid-team actions. |`,
    "| Evaluator readability | 8/10 | Proposal now includes blueprint, compliance matrix, criteria mirror, win themes and appendix controls. |",
    "| Submission risk control | 7/10 | Final submission still requires file-name, deadline, signature/stamp, appendix and commercial-envelope verification. |",
  ];
  return [
    "## Section H: Proposal Self-Score",
    "This self-score is a pre-submission quality control, not a guarantee of award. It identifies remaining evidence and compliance risks before export.",
    rows.join("\n"),
    `Predicted overall technical score: ${predicted}/100. Top three risks: unsupported claims, partial evidence for mandatory criteria, and submission-format non-compliance.`,
  ].join("\n\n");
}

export function applyProposalQualityRepairAddenda(markdown: string, input: EvaluatorMatrixInput): string {
  let output = markdown.trim();
  const repairs: string[] = [];
  if (!hasHeading(output, /(^|\n)\s*#{1,4}\s*(?:section\s*[E:.\-\s]*)?\s*compliance\s+matrix/i)) repairs.push(sectionE(input));
  if (!hasHeading(output, /(^|\n)\s*#{1,4}\s*(?:section\s*[F:.\-\s]*)?\s*(?:evaluation\s+criteria\s+response\s+mirror|evaluation\s+(?:criteria\s+)?response|evaluator(?:'s)?\s+mirror|evaluation\s+mirror)/i)) repairs.push(sectionF(input));
  if (!hasHeading(output, /(^|\n)\s*#{1,4}\s*(?:section\s*[G:.\-\s]*)?\s*(?:win\s+themes?|themes?\s+(?:and|&)\s+discriminators?)/i)) repairs.push(sectionG(input));
  if (!hasHeading(output, /(^|\n)\s*#{1,4}\s*(?:section\s*[H:.\-\s]*)?\s*(?:proposal\s+)?self.score/i)) repairs.push(sectionH(input));
  if (repairs.length === 0) return output;
  // No engine self-narration in the deliverable. This block used to open with
  // "Deterministic Proposal Quality Repair Addenda" followed by "The following
  // sections were inserted by the proposal engine because evaluator-critical
  // quality controls were missing or not detectable in the generated draft" —
  // shipped verbatim to the procuring entity. The sections themselves are
  // genuine client content (compliance matrix, evaluation mirror, win themes,
  // self-assessment); only the commentary about why the engine added them was
  // internal. That the engine repaired the draft belongs in the job record, not
  // in the proposal.
  output += "\n\n" + repairs.join("\n\n");
  return output;
}
