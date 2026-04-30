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

export function appendBenchmarkQualityReview(markdown: string, input: BenchmarkGuardInput): { markdown: string; score: BenchmarkScore } {
  const score = scoreBenchmarkProposalMarkdown(markdown, input);
  let output = markdown.trim();
  output += "\n\n## Benchmark Quality Review";
  output += `\nBenchmark score: ${score.score}/100 — ${score.passed ? "PASS" : "NEEDS SENIOR REVIEW"}.`;
  if (score.strengths.length > 0) {
    output += "\n\n### Strengths";
    output += "\n" + score.strengths.map((item) => `- ${item}`).join("\n");
  }
  if (score.gaps.length > 0) {
    output += "\n\n### Remaining Gaps to Fix Before Final Submission";
    output += "\n" + score.gaps.map((item) => `- ${item}`).join("\n");
  }
  return { markdown: output, score };
}

export function enforceBenchmarkProposalMarkdown(markdown: string, input: BenchmarkGuardInput): string {
  let output = markdown.trim();
  const missing = benchmarkMissingSections(output);

  if (hasForbiddenWeakness(output)) {
    output = output
      .replace(/\bAs an AI[^.]*\./gi, "")
      .replace(/\bplaceholder\b/gi, "to be confirmed by bid team")
      .replace(/\bTBD\b/gi, "to be confirmed by bid team")
      .replace(/\bTODO\b/gi, "to be confirmed by bid team")
      .replace(/\[insert[^\]]*\]/gi, "to be confirmed by bid team");
  }

  if (missing.length === 0) return output;

  output += "\n\n## Benchmark Completion Addendum";
  output += "\nThis addendum is generated by the proposal quality guard to preserve the full senior-bid benchmark structure when the AI draft omits a required section.";

  for (const section of missing) {
    output += `\n\n### ${section}\n`;
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
      output += "The technical approach should respond directly to the tender scope, risks, deliverables, approval process, staffing plan, reporting method, quality assurance process, and implementation schedule.\n";
    } else if (section === "Compliance and Bid Review Strategy") {
      output += "The proposal proceeds with the strongest reviewed evidence and carries unresolved evidence gaps as senior bid-review actions rather than inventing unsupported claims.\n";
      output += input.complianceLines.slice(0, 8).map((line) => `- ${line}`).join("\n") + "\n";
    } else if (section === "Appendix Register") {
      output += "Appendices should include only verified or bid-team-confirmed items: company registration, tax/legal documents, audited/financial documents, reviewed CVs, project references, certificates, forms, declarations, photos/drawings, and tender-specific schedules.\n";
    } else if (section === "Declaration") {
      output += `We confirm that this technical proposal for ${input.tenderTitle} has been prepared using tender information and reviewed company evidence available in the app, subject to final human bid-team verification before submission.\n`;
    }
  }

  if (input.submissionNotes) {
    output += `\n\n### Submission Control Note\n${input.submissionNotes}\n`;
  }

  return output;
}
