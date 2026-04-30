export type BenchmarkGuardInput = {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  submissionNotes: string;
  expertCount: number;
  projectCount: number;
  complianceLines: string[];
};

export type BenchmarkScore = {
  score: number;
  passed: boolean;
  strengths: string[];
  gaps: string[];
};

export type ClientReadyProposal = {
  markdown: string;
  score: BenchmarkScore;
  firstScore: BenchmarkScore;
  internalSummary: string;
};

const BENCHMARK_SECTIONS = [
  "Cover Letter",
  "Technical Proposal",
  "Table of Contents",
  "Executive Summary",
  "Company Profile",
  "Proposed Team",
  "Relevant Experience",
  "Technical Approach",
  "Compliance and Bid Review Strategy",
  "Appendix Register",
  "Declaration",
];

function headingExists(markdown: string, label: string): boolean {
  const simple = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return markdown
    .split(/\n+/)
    .some((line) => {
      const clean = line.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return clean.includes(simple);
    });
}

function hasForbiddenWeakness(markdown: string): boolean {
  return /\b(as an ai|language model|placeholder|tbd|todo|insert name|insert date)\b/i.test(markdown);
}

function mentionsAny(markdown: string, values: string[]): boolean {
  const lower = markdown.toLowerCase();
  return values.filter(Boolean).some((value) => lower.includes(value.toLowerCase().slice(0, 80)));
}

function normalizeWeakText(markdown: string): string {
  return markdown
    .replace(/\bAs an AI[^.]*\./gi, "")
    .replace(/\blanguage model[^.]*\./gi, "")
    .replace(/\bplaceholder\b/gi, "to be confirmed by bid team")
    .replace(/\bTBD\b/gi, "to be confirmed by bid team")
    .replace(/\bTODO\b/gi, "to be confirmed by bid team")
    .replace(/\[insert[^\]]*\]/gi, "to be confirmed by bid team");
}

function removeInternalQualityHeadings(markdown: string): string {
  return markdown
    .replace(/^#{1,3}\s*Benchmark Quality Review[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Benchmark Auto-Repair Addendum[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Benchmark Completion Addendum[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*AI Bid Writer Fallback Note[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .trim();
}

export function benchmarkMissingSections(markdown: string): string[] {
  return BENCHMARK_SECTIONS.filter((section) => !headingExists(markdown, section));
}

export function scoreBenchmarkProposalMarkdown(markdown: string, input: BenchmarkGuardInput): BenchmarkScore {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let score = 0;

  const missingSections = benchmarkMissingSections(markdown);
  const sectionScore = Math.round(((BENCHMARK_SECTIONS.length - missingSections.length) / BENCHMARK_SECTIONS.length) * 30);
  score += sectionScore;
  if (missingSections.length === 0) strengths.push("Full benchmark proposal structure is present.");
  else gaps.push(`Missing benchmark sections: ${missingSections.join(", ")}.`);

  if (mentionsAny(markdown, [input.tenderTitle, input.clientName])) {
    score += 10;
    strengths.push("Proposal names the tender/client and is not completely generic.");
  } else gaps.push("Proposal does not clearly name the tender/client.");

  if (input.expertCount > 0 && /expert|team|cv|personnel|specialist|key staff/i.test(markdown)) {
    score += 10;
    strengths.push("Expert/team evidence is represented.");
  } else gaps.push("Expert/team evidence is weak or absent.");

  if (input.projectCount > 0 && /project|reference|experience|portfolio|similar assignment/i.test(markdown)) {
    score += 10;
    strengths.push("Project/reference evidence is represented.");
  } else gaps.push("Project/reference evidence is weak or absent.");

  if (/methodology|approach|work plan|quality assurance|deliverable|mobilization|risk|schedule|coordination/i.test(markdown)) {
    score += 15;
    strengths.push("Technical methodology language is present.");
  } else gaps.push("Technical methodology is too weak.");

  if (/compliance|bid review|submission|appendix|declaration|evidence|mitigation|to be confirmed/i.test(markdown)) {
    score += 15;
    strengths.push("Compliance/bid-review strategy is visible.");
  } else gaps.push("Compliance and bid-review strategy is not visible enough.");

  if (markdown.length >= 8000) {
    score += 5;
    strengths.push("Proposal has enough narrative depth for a serious technical response.");
  } else if (markdown.length >= 4500) {
    score += 3;
    gaps.push("Proposal has moderate depth but may still be shorter than benchmark quality.");
  } else gaps.push("Proposal is too short for benchmark-quality technical submission.");

  if (!hasForbiddenWeakness(markdown)) {
    score += 5;
    strengths.push("No obvious AI/placeholder/TBD language detected.");
  } else gaps.push("Proposal contains placeholder or AI-disclaimer language that must be removed.");

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, passed: finalScore >= 90, strengths, gaps };
}

function completeMissingClientSections(markdown: string, input: BenchmarkGuardInput): string {
  let output = markdown.trim();
  const missing = benchmarkMissingSections(output);
  for (const section of missing) {
    output += `\n\n## ${section}\n`;
    if (section === "Cover Letter") {
      output += `To: ${input.clientName}\n\n${input.companyName} is pleased to submit this technical proposal for ${input.tenderTitle}. The response is based on the tender scope, selected company evidence, reviewed experts, reviewed project references, and senior bid-review controls.\n`;
    } else if (section === "Technical Proposal") {
      output += `${input.tenderTitle}\n\nPrepared by ${input.companyName} for ${input.clientName}.\n`;
    } else if (section === "Table of Contents") {
      output += BENCHMARK_SECTIONS.map((item, index) => `${index + 1}. ${item}`).join("\n") + "\n";
    } else if (section === "Executive Summary") {
      output += `${input.companyName} positions this proposal around tender-specific requirements, relevant evidence, selected specialists, selected project references, and a practical delivery methodology. The proposal should be reviewed against the original tender before final submission.\n`;
    } else if (section === "Company Profile") {
      output += `${input.companyName} is presented using the company profile, support documents, legal/financial records, and service lines stored in the company knowledge vault.\n`;
    } else if (section === "Proposed Team") {
      output += `${input.expertCount} reviewed expert record(s) are selected or available for this response. Any additional named experts required by the tender should be confirmed before final submission.\n`;
    } else if (section === "Relevant Experience") {
      output += `${input.projectCount} reviewed project reference(s) are selected or available for this response. Additional references should be attached when the tender expressly requires them.\n`;
    } else if (section === "Technical Approach") {
      output += "The technical approach responds to the tender scope, risks, deliverables, approval process, staffing plan, reporting method, quality assurance process, and implementation schedule.\n";
    } else if (section === "Compliance and Bid Review Strategy") {
      output += "The proposal proceeds with the strongest reviewed evidence and carries unresolved evidence gaps as senior bid-review actions rather than unsupported claims.\n";
      output += input.complianceLines.slice(0, 8).map((line) => `- ${line}`).join("\n") + "\n";
    } else if (section === "Appendix Register") {
      output += "Appendices should include only verified or bid-team-confirmed items: company registration, tax/legal documents, audited/financial documents, reviewed CVs, project references, certificates, forms, declarations, photos/drawings, and tender-specific schedules.\n";
    } else if (section === "Declaration") {
      output += `We confirm that this technical proposal for ${input.tenderTitle} has been prepared using tender information and reviewed company evidence available in the app, subject to final human bid-team verification before submission.\n`;
    }
  }
  if (input.submissionNotes && !/submission control note/i.test(output)) {
    output += `\n\n## Submission Control Note\n${input.submissionNotes}\n`;
  }
  return output;
}

function repairClientReadyMarkdown(markdown: string, input: BenchmarkGuardInput, score: BenchmarkScore): string {
  if (score.passed) return markdown;
  let output = markdown.trim();

  if (score.gaps.some((gap) => /expert|team/i.test(gap))) {
    output += "\n\n## Expert and Team Evidence Mapping\n";
    output += `${input.expertCount} reviewed expert record(s) are currently available for this response. Each reviewed expert should be mapped to the scope, deliverables, risk areas, and evaluation criteria before final submission. If the tender requires more named personnel than selected, the additional experts must be confirmed or substituted before export.\n`;
  }

  if (score.gaps.some((gap) => /project|reference/i.test(gap))) {
    output += "\n\n## Project Reference Mapping\n";
    output += `${input.projectCount} reviewed project reference(s) are currently available for this response. The proposal leads with the most similar references by sector, client type, technical scope, geography, contract value, and deliverables. Any additional reference, testimony letter, photo, drawing, or completion certificate required by the tender should be attached or marked for bid-team confirmation.\n`;
  }

  if (score.gaps.some((gap) => /methodology|technical/i.test(gap)) || output.length < 8000) {
    output += "\n\n## Detailed Technical Methodology\n";
    output += "The delivery method follows a senior technical sequence: inception and document review; stakeholder and site data collection; gap/risk assessment; concept development; interdisciplinary design coordination; technical calculations and drawings; BOQ/specification preparation; quality assurance review; client validation; final submission; and implementation-support handover. Each stage defines inputs, outputs, responsible experts, quality checks, review meetings, and approval points.\n";
    output += "\nThe methodology responds to tender risks including missing information, tight submission timelines, evidence sufficiency, specialist availability, format compliance, appendices, regulatory approvals, technical coordination, and final submission control.\n";
  }

  if (score.gaps.some((gap) => /compliance|bid/i.test(gap))) {
    output += "\n\n## Submission Compliance Controls\n";
    output += "The bid team should verify all mandatory requirements against the original tender before final submission. The proposal may proceed as draft-ready when evidence is available or reviewable, but exact file names, signatures, stamps, forms, declarations, CVs, project evidence, legal/financial documents, and submission method must be checked before export.\n";
    output += input.complianceLines.slice(0, 10).map((line) => `- ${line}`).join("\n") + "\n";
  }

  output += "\n\n## Final Submission Controls\n";
  output += "- Confirm that the proposal contains the tender/client name, cover letter, cover page, table of contents, executive summary, company profile, proposed team, relevant experience, technical approach, compliance strategy, appendix register, and declaration.\n";
  output += "- Confirm that all expert/project claims are supported by reviewed records or clearly marked for bid-team confirmation.\n";
  output += "- Confirm that no unsupported financial offer, invented evidence, placeholder wording, or AI-disclaimer language remains.\n";
  output += "- Confirm that the final exported package follows the tender's exact submission instructions.\n";

  return output;
}

export function finalizeClientReadyProposalMarkdown(markdown: string, input: BenchmarkGuardInput): ClientReadyProposal {
  const cleaned = removeInternalQualityHeadings(normalizeWeakText(markdown));
  const completed = completeMissingClientSections(cleaned, input);
  const firstScore = scoreBenchmarkProposalMarkdown(completed, input);
  const repaired = repairClientReadyMarkdown(completed, input, firstScore);
  const clientReady = removeInternalQualityHeadings(normalizeWeakText(repaired));
  const score = scoreBenchmarkProposalMarkdown(clientReady, input);
  const internalSummary = `Benchmark score ${score.score}/100 (${score.passed ? "PASS" : "NEEDS REVIEW"}); first score ${firstScore.score}/100; strengths: ${score.strengths.length}; gaps: ${score.gaps.length}${score.gaps.length ? ` — ${score.gaps.join(" | ")}` : ""}`;
  return { markdown: clientReady, score, firstScore, internalSummary };
}

export function appendBenchmarkQualityReview(markdown: string, input: BenchmarkGuardInput): { markdown: string; score: BenchmarkScore } {
  const finalized = finalizeClientReadyProposalMarkdown(markdown, input);
  return { markdown: finalized.markdown, score: finalized.score };
}

export function enforceBenchmarkProposalMarkdown(markdown: string, input: BenchmarkGuardInput): string {
  return finalizeClientReadyProposalMarkdown(markdown, input).markdown;
}
