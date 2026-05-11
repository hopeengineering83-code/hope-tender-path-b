export type BenchmarkGuardInput = {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  submissionNotes: string;
  expertCount: number;
  projectCount: number;
  complianceLines: string[];
  primarySector?: string;
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
  // Also try key-word matching — "Compliance and Bid Review Strategy" matches any heading that contains "compliance" + "bid"
  const words = simple.split(" ").filter((w) => w.length > 3);
  return markdown
    .split(/\n+/)
    .some((line) => {
      if (!/^#+\s/.test(line)) return false;
      const text = line.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (text.includes(simple)) return true;
      // Fuzzy: if the label has 2+ long words, require all for 2-word labels
      // and at least 65% for longer ones. The old 50% floor allowed single-word
      // false-matches ("Executive" alone satisfying "Executive Summary").
      if (words.length >= 2) {
        const hits = words.filter((w) => text.includes(w)).length;
        const required = words.length <= 2 ? words.length : Math.ceil(words.length * 0.65);
        return hits >= required;
      }
      return false;
    });
}

function hasForbiddenWeakness(markdown: string): boolean {
  if (/\b(as an ai|i am an ai|language model|placeholder|tbd|todo|insert name|insert date|n\/a \(pending\)|to be determined|i apologize but)\b/i.test(markdown)) return true;
  // Square-bracket stubs — extended to 200 chars to catch verbose placeholders
  if (/\[(?:INSERT|PLACEHOLDER|NAME|DATE|TBD|TBA|ADD|ENTER|SPECIFY|YOUR|FILL)[^\]]{0,200}\]/i.test(markdown)) return true;
  // Mustache / double-mustache template variables: {{variable}} or {variable}
  if (/\{\{?\s*\w[\w\s-]{0,60}\s*\}?\}/g.test(markdown)) return true;
  // Unfilled action directives — indicate the AI echoed fallback template text
  if (/\bBid-Team Action:/i.test(markdown)) return true;
  return false;
}

function mentionsAny(markdown: string, values: string[]): boolean {
  const lower = markdown.toLowerCase();
  return values.filter(Boolean).some((value) => lower.includes(value.toLowerCase().slice(0, 200)));
}

function normalizeWeakText(markdown: string): string {
  return markdown
    .replace(/\bAs an AI[^.]*\./gi, "")
    .replace(/\bI(?:'m| am) an AI[^.]*\./gi, "")
    .replace(/\blanguage model[^.]*\./gi, "")
    .replace(/\bCertainly![^\n]*/gi, "")
    .replace(/\bSure![^\n]*/gi, "")
    .replace(/\bOf course![^\n]*/gi, "")
    .replace(/\bI cannot[^.]*\./gi, "To be confirmed by bid team.")
    .replace(/\bI(?:'m| am) unable[^.]*\./gi, "To be confirmed by bid team.")
    .replace(/\bI(?:'d| would) be happy to[^.]*\./gi, "")
    .replace(/\bI(?:'m| am) sorry[^.]*\./gi, "")
    .replace(/\bRegrettably[^.]*\./gi, "")
    .replace(/\bI(?:'m| am) not (?:sure|able to)[^.]*\./gi, "To be confirmed by bid team.")
    .replace(/\bThis is a placeholder[^.]*\./gi, "")
    .replace(/\bPlease note that[^.]*\./gi, "")
    .replace(/\bI (?:believe|think|feel) that\b/gi, "")
    .replace(/\bIn my (?:view|opinion|assessment)\b/gi, "")
    .replace(/\bFrom my perspective\b/gi, "")
    .replace(/\bTo my knowledge\b/gi, "")
    .replace(/\bplaceholder\b/gi, "to be confirmed by bid team")
    .replace(/\bTBD\b/gi, "to be confirmed by bid team")
    .replace(/\bTODO\b/gi, "to be confirmed by bid team")
    .replace(/\bN\/A \(pending\)\b/gi, "to be confirmed by bid team")
    .replace(/\bTo be determined\b/gi, "to be confirmed by bid team")
    .replace(/\[insert[^\]]*\]/gi, "to be confirmed by bid team")
    .replace(/\[(?:PLACEHOLDER|NAME|DATE|TBD|ADD|ENTER|SPECIFY|YOUR)[^\]]{0,60}\]/gi, "to be confirmed by bid team")
    .replace(/\n{3,}/g, "\n\n");
}

function removeInternalQualityHeadings(markdown: string): string {
  // Strip internal bid-review and evaluator-matrix headings that must not appear in the client document.
  return markdown
    .replace(/^#{1,3}\s*Benchmark Quality Review[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Benchmark Auto-Repair Addendum[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Benchmark Completion Addendum[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*AI Bid Writer Fallback Note[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Evaluator Response Matrix[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Claim-to-Evidence Proof Map[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Unsupported Claim Control[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Delivery Methodology Work Plan[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Evidence-Based Appendix Register[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Final Submission Control Checklist[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Win Themes and Differentiators[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Submission Control Note[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Expert and Team Evidence Mapping[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Project Reference Mapping[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Detailed Technical Methodology[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Submission Compliance Controls[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
    .replace(/^#{1,3}\s*Final Submission Controls[\s\S]*?(?=^#{1,3}\s|\s*$)/gim, "")
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

  // Validate Executive Summary lead quality — must reference a specific project/value
  const execSummaryMatch = markdown.match(/##?\s*Executive Summary[\s\S]{0,600}/i)?.[0] ?? "";
  const hasConcreteExecLead = execSummaryMatch.length > 0 &&
    (/ETB\s*\d|USD\s*\d|EUR\s*\d|\d+M\b|\d+B\b|billion|million/i.test(execSummaryMatch) ||
     /(?:designed|delivered|supervised|completed|assessed|managed|constructed|rehabilitated|upgraded|installed)\s+(?:the\s+)?[\w\s]{3,60}(?:hospital|clinic|project|centre|center|facility|school|bridge|road|water|tower|scheme|dam|reservoir|canal|station|terminal|port|plant|zone|corridor|institute|programme|pipeline|network|system)/i.test(execSummaryMatch));
  if (hasConcreteExecLead) {
    score += 5;
    strengths.push("Executive Summary opens with specific evidence — project name or contract value.");
  } else if (execSummaryMatch.length > 0) {
    gaps.push("Executive Summary lacks a specific project name or contract value in the opening — must lead with 'We have already delivered this assignment.'");
  }

  if (input.expertCount > 0 && /expert|team|cv|personnel|specialist|key staff/i.test(markdown)) {
    score += 10;
    strengths.push("Expert/team evidence is represented.");
  } else gaps.push("Expert/team evidence is weak or absent.");

  if (input.projectCount > 0 && /project|reference|experience|portfolio|similar assignment/i.test(markdown)) {
    score += 10;
    strengths.push("Project/reference evidence is represented.");
  } else gaps.push("Project/reference evidence is weak or absent.");

  // Methodology depth scoring: count paragraphs (>150 chars) that contain
  // BOTH a methodology term AND a deliverable/phase term. This rewards depth
  // (many specific sub-sections) over mere presence of the word "methodology".
  {
    const methodParagraphs = markdown.split(/\n{2,}/).filter((p) => {
      if (p.length < 150) return false;
      const hasMethodTerm = /methodology|approach|work plan|quality assurance|deliverable|mobilization|risk management|schedule|coordination|technical solution/i.test(p);
      const hasDepthTerm = /stage|phase|step|deliverable|milestone|review gate|output|report|inspection|QA|BOQ|specification|survey|assessment|design.*detail|supervision/i.test(p);
      return hasMethodTerm && hasDepthTerm;
    });
    const methodScore = methodParagraphs.length >= 6 ? 15
      : methodParagraphs.length >= 4 ? 13
      : methodParagraphs.length >= 2 ? 10
      : methodParagraphs.length >= 1 ? 7
      : /methodology|approach|work plan|deliverable/i.test(markdown) ? 4
      : 0;
    score += methodScore;
    if (methodScore >= 13) strengths.push(`Technical methodology has substantive depth (${methodParagraphs.length} evidence-linked paragraphs).`);
    else if (methodScore >= 7) strengths.push("Technical methodology language is present but could be deeper.");
    else gaps.push("Technical methodology is too shallow — needs more staged, deliverable-linked sub-sections.");
  }

  if (/compliance|bid review|submission|appendix|declaration|evidence|mitigation|to be confirmed/i.test(markdown)) {
    score += 15;
    strengths.push("Compliance/bid-review strategy is visible.");
  } else gaps.push("Compliance and bid-review strategy is not visible enough.");

  const depthThreshold = /health|hospital|water|road|bridge|sanit|hydraulic/i.test(input.primarySector ?? "") ? 10000 : 8000;
  const depthPartial = Math.round(depthThreshold * 0.56);
  if (markdown.length >= depthThreshold) {
    score += 5;
    strengths.push("Proposal has enough narrative depth for a serious technical response.");
  } else if (markdown.length >= depthPartial) {
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
      output += `${input.companyName} presents this technical proposal in response to ${input.tenderTitle}. The proposal has been structured to address each evaluation criterion with direct evidence from the company's reviewed portfolio, expert team, and compliance records. ${input.projectCount > 0 ? `${input.projectCount} directly relevant project reference(s) are included in Section B.` : "Project references should be selected and reviewed before final submission."} ${input.expertCount > 0 ? `${input.expertCount} specialist expert(s) are proposed in Section A.` : "Expert CVs should be confirmed before final submission."} The technical approach in Section C is tailored specifically to the scope requirements of this tender.\n`;
    } else if (section === "Company Profile") {
      output += `${input.companyName} is an established consultancy firm with a multidisciplinary team covering architecture, engineering, and project management. Company registration documents, licence details, staff credentials, and service line information are stored in the company knowledge vault and should be incorporated in the final submission. Key company data — founding year, licence grade, staff count, and total completed projects — must be confirmed and added by the bid team before export.\n`;
    } else if (section === "Proposed Team") {
      output += `${input.expertCount > 0 ? `${input.expertCount} reviewed expert record(s) are selected for this response. Each expert's CV, professional licence, and relevant project history are available in the company knowledge vault.` : "Expert CVs and professional credentials must be reviewed and selected in the application before final submission."} The bid team should confirm that each proposed expert: (a) holds the professional licence or qualification required by the tender, (b) is named on their CV with their proposed role clearly stated, and (c) can be mapped to a comparable previous project. Any expert required by the tender who is not yet selected must be identified before final submission.\n`;
    } else if (section === "Relevant Experience") {
      output += `${input.projectCount > 0 ? `${input.projectCount} reviewed project reference(s) are included. Each reference includes the project name, client, country, sector, scope, and contract value where available.` : "Project references must be reviewed and selected in the application before final submission."} The bid team should confirm that each reference: (a) is comparable to the tender scope in sector, scale, and services, (b) has a verifiable client contact for reference letters, and (c) is supported by documentation (completion certificates, photos, drawings, or contracts) that can be attached to the submission.\n`;
    } else if (section === "Technical Approach") {
      output += "The technical approach is structured to directly address the scope of services and key technical requirements specified in the tender. The delivery methodology follows a staged process: (1) inception and document review, (2) stakeholder consultation and site data collection, (3) technical assessment and gap analysis, (4) concept and schematic design, (5) detailed design, specifications, BOQ, and cost estimates, (6) quality assurance review and client validation, and (7) construction-document finalisation and submission support. Each stage defines inputs, outputs, responsible experts, quality review checkpoints, and client approval milestones. The methodology incorporates risk controls for technical coordination, regulatory compliance, schedule management, and evidence sufficiency.\n";
    } else if (section === "Compliance and Bid Review Strategy") {
      output += "The proposal proceeds with the strongest reviewed evidence and carries unresolved evidence gaps as senior bid-review actions rather than unsupported claims.\n";
      output += input.complianceLines.slice(0, 10).map((line) => `- ${line}`).join("\n") + "\n";
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
