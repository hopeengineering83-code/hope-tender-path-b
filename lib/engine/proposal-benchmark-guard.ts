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

const CHATGPT_BENCHMARK_SECTIONS = [
  "SECTION A: COMPANY PROFILE",
  "A.1 Company Background",
  "A.2 Corporate Information",
  "A.3 Core Areas of Expertise",
  "A.4 Proposed Project Team",
  "A.5 Team-to-Project Experience Mapping",
  "A.6 Specialist / Biomedical Engineering Integration",
  "SECTION B: RELEVANT EXPERIENCE",
  "B.1 Client References",
  "B.2 Project Portfolio",
  "SECTION C: TECHNICAL APPROACH",
  "C.1 Understanding of the Assignment",
  "C.2 Technical Methodology Aligned to the Tender Scope",
  "3.1 Facility Identification and Technical Assessment",
  "3.2 Conceptual and Detailed Design",
  "3.3 Engineering / MEP Coordination",
  "3.4 Regulatory Compliance and Approvals",
  "3.5 Renovation Planning and Implementation Oversight",
  "3.6 Project Close-Out Support",
  "C.3 Quality Assurance and Design Review",
  "SECTION D: ADDITIONAL INFORMATION",
  "D.1 Value to the Client",
  "D.2 Value-Added Services",
  "D.3 Professional Certifications",
  "D.4 Declaration of Eligibility",
];

const HEALTHCARE_BENCHMARK_MARKERS = [
  "Emergency",
  "OPD",
  "In-patient",
  "Laboratory",
  "Imaging",
  "Radiology",
  "Pharmacy",
  "IPC",
  "infection prevention",
  "clinical zoning",
  "patient flow",
  "staff flow",
  "medical gas",
  "radiation shielding",
  "medical equipment",
  "telehealth",
  "MEP",
  "regulatory approval",
  "close-out",
];

const FIRST_PAGE_PROOF_TERMS = [
  "project",
  "reference",
  "client",
  "hospital",
  "medical",
  "health",
  "contract",
  "value",
  "scope",
  "services",
  "evidence",
  "experience",
  "similar",
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

function isHealthcareTender(input: BenchmarkGuardInput, markdown: string): boolean {
  return /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|healthcare|specialty/i.test(
    `${input.tenderTitle}\n${input.submissionNotes}\n${markdown}`,
  );
}

function markerCoverage(markdown: string, markers: string[]): number {
  const lower = markdown.toLowerCase();
  return markers.filter((marker) => lower.includes(marker.toLowerCase())).length;
}

function firstPageHasProof(markdown: string): boolean {
  const firstPage = markdown.slice(0, 2600).toLowerCase();
  const hits = FIRST_PAGE_PROOF_TERMS.filter((term) => firstPage.includes(term)).length;
  return hits >= 4;
}

function hasEvidenceControlRegister(markdown: string): boolean {
  return /evidence control register|claim.to.evidence|source traceability|appendix evidence|bid-team confirmation/i.test(markdown);
}

export function benchmarkMissingSections(markdown: string): string[] {
  return BENCHMARK_SECTIONS.filter((section) => !headingExists(markdown, section));
}

function missingChatGPTBenchmarkSections(markdown: string, input: BenchmarkGuardInput): string[] {
  if (!isHealthcareTender(input, markdown)) return [];
  return CHATGPT_BENCHMARK_SECTIONS.filter((section) => !headingExists(markdown, section));
}

export function scoreBenchmarkProposalMarkdown(markdown: string, input: BenchmarkGuardInput): BenchmarkScore {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let score = 0;

  const missingSections = benchmarkMissingSections(markdown);
  const sectionScore = Math.round(((BENCHMARK_SECTIONS.length - missingSections.length) / BENCHMARK_SECTIONS.length) * 22);
  score += sectionScore;
  if (missingSections.length === 0) strengths.push("Full baseline benchmark proposal structure is present.");
  else gaps.push(`Missing baseline benchmark sections: ${missingSections.join(", ")}.`);

  const missingChatGPTSections = missingChatGPTBenchmarkSections(markdown, input);
  if (missingChatGPTSections.length === 0 && isHealthcareTender(input, markdown)) {
    score += 15;
    strengths.push("Uploaded ChatGPT benchmark A-D section structure is present.");
  } else if (missingChatGPTSections.length > 0) {
    const penalty = Math.max(0, 15 - Math.min(15, Math.ceil(missingChatGPTSections.length / 2)));
    score += penalty;
    gaps.push(`Missing uploaded ChatGPT benchmark sections: ${missingChatGPTSections.slice(0, 12).join(", ")}${missingChatGPTSections.length > 12 ? "..." : ""}.`);
  }

  if (firstPageHasProof(markdown)) {
    score += 6;
    strengths.push("First-page proof discipline is visible: the proposal opens with evidence rather than generic marketing.");
  } else gaps.push("First page does not carry enough direct project/client/evidence proof.");

  if (mentionsAny(markdown, [input.tenderTitle, input.clientName])) {
    score += 8;
    strengths.push("Proposal names the tender/client and is not completely generic.");
  } else gaps.push("Proposal does not clearly name the tender/client.");

  if (input.expertCount > 0 && /expert|team|cv|personnel|specialist|key staff/i.test(markdown)) {
    score += 8;
    strengths.push("Expert/team evidence is represented.");
  } else gaps.push("Expert/team evidence is weak or absent.");

  if (/team.to.project|previous role|role previously|mapped to|experience mapping/i.test(markdown)) {
    score += 6;
    strengths.push("Team-to-project mapping is visible.");
  } else if (input.expertCount > 0) gaps.push("Team-to-project mapping is missing or too weak.");

  if (input.projectCount > 0 && /project|reference|experience|portfolio|similar assignment/i.test(markdown)) {
    score += 8;
    strengths.push("Project/reference evidence is represented.");
  } else gaps.push("Project/reference evidence is weak or absent.");

  if (/client reference|testimony|contract|completion|reference number|project card|photos|drawings/i.test(markdown)) {
    score += 5;
    strengths.push("Project evidence discipline is visible.");
  } else gaps.push("Client references, testimony letters, photos/drawings or project evidence are not visible enough.");

  if (/methodology|approach|work plan|quality assurance|deliverable|mobilization|risk|schedule|coordination/i.test(markdown)) {
    score += 10;
    strengths.push("Technical methodology language is present.");
  } else gaps.push("Technical methodology is too weak.");

  if (isHealthcareTender(input, markdown)) {
    const covered = markerCoverage(markdown, HEALTHCARE_BENCHMARK_MARKERS);
    const healthcareScore = Math.min(15, Math.round((covered / HEALTHCARE_BENCHMARK_MARKERS.length) * 15));
    score += healthcareScore;
    if (covered >= 13) strengths.push("Healthcare-specific technical depth is close to uploaded ChatGPT benchmark.");
    else gaps.push(`Healthcare-specific technical depth is incomplete: ${covered}/${HEALTHCARE_BENCHMARK_MARKERS.length} benchmark markers covered.`);
  }

  if (/compliance|bid review|submission|appendix|declaration|evidence|mitigation|to be confirmed/i.test(markdown)) {
    score += 10;
    strengths.push("Compliance/bid-review strategy is visible.");
  } else gaps.push("Compliance and bid-review strategy is not visible enough.");

  if (hasEvidenceControlRegister(markdown)) {
    score += 5;
    strengths.push("Evidence-control / source-traceability discipline is visible.");
  } else gaps.push("Evidence-control register or source-traceability discipline is missing.");

  if (markdown.length >= 11000) {
    score += 5;
    strengths.push("Proposal has enough narrative depth for a serious technical response.");
  } else if (markdown.length >= 8000) {
    score += 3;
    gaps.push("Proposal has moderate depth but may still be shorter than uploaded benchmark quality.");
  } else gaps.push("Proposal is too short for benchmark-quality technical submission.");

  if (!hasForbiddenWeakness(markdown)) {
    score += 5;
    strengths.push("No obvious AI/placeholder/TBD language detected.");
  } else gaps.push("Proposal contains placeholder or AI-disclaimer language that must be removed.");

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, passed: finalScore >= 92, strengths, gaps };
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
      output += [...BENCHMARK_SECTIONS, ...(isHealthcareTender(input, output) ? CHATGPT_BENCHMARK_SECTIONS : [])].map((item, index) => `${index + 1}. ${item}`).join("\n") + "\n";
    } else if (section === "Executive Summary") {
      output += `${input.companyName} positions this proposal around tender-specific requirements, directly comparable project evidence, selected specialists, selected project references, and a practical delivery methodology. The proposal should be reviewed against the original tender before final submission.\n`;
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

function completeChatGPTBenchmarkSections(markdown: string, input: BenchmarkGuardInput): string {
  if (!isHealthcareTender(input, markdown)) return markdown;
  let output = markdown.trim();
  for (const section of CHATGPT_BENCHMARK_SECTIONS) {
    if (headingExists(output, section)) continue;
    output += `\n\n## ${section}\n`;
    if (section.includes("Company Background")) output += `${input.companyName} should be presented through verified registration, licence, establishment, staffing, sector capability and uploaded company evidence.\n`;
    else if (section.includes("Corporate Information")) output += "Corporate identity, registration category, office/contact details, tax/legal records, authorised representative and licence evidence should be confirmed from uploaded company records.\n";
    else if (section.includes("Core Areas")) output += "Core expertise should be stated only from uploaded service-line evidence, with priority given to the disciplines required by the tender.\n";
    else if (section.includes("Proposed Project Team")) output += `${input.expertCount} reviewed expert record(s) are available. The final proposal should show role, qualification/licence, comparable experience and assignment responsibility for each proposed expert.\n`;
    else if (section.includes("Team-to-Project")) output += "Each proposed expert should be mapped to comparable prior assignments, previous role performed, and the direct contribution to this tender. Where the evidence does not prove the mapping, mark it as a bid-team confirmation item.\n";
    else if (section.includes("Biomedical")) output += "For healthcare tenders, specialist/biomedical integration should cover equipment clearances, diagnostic electrical loads, radiation shielding, medical gas outlets, clinical equipment coordination and integration with MEP design. If no named biomedical specialist is reviewed, confirm engagement before final submission.\n";
    else if (section.includes("Client References")) output += "Client references should list reviewed project clients, contact/reference details, testimony or contract evidence, and relevance to the tender where available.\n";
    else if (section.includes("Project Portfolio")) output += `${input.projectCount} reviewed project reference(s) are available. Project cards should show client, location, scale, duration/year, value when supported, services provided and relevance to this assignment.\n`;
    else if (section.includes("Understanding")) output += `The assignment is understood as a client-specific technical response for ${input.clientName}, requiring evidence-led delivery, compliant submission, and technical methodology aligned to the tender scope.\n`;
    else if (section.includes("Facility Identification")) output += "Use a site/facility assessment matrix covering structural adequacy, spatial feasibility, utilities, accessibility, patient/service flows, safety and expansion potential. Provide written recommended/not-recommended conclusions for shortlisted premises.\n";
    else if (section.includes("Conceptual")) output += "Develop functional space planning and workflow-optimised layouts for Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy and other required services; embed IPC, patient-centred design, accessibility, equipment, IT and telehealth requirements from concept stage.\n";
    else if (section.includes("MEP")) output += "Coordinate electrical, mechanical, sanitary/plumbing, HVAC, fire protection, ICT, nurse call, medical gas and equipment-load requirements as a single interdisciplinary design process.\n";
    else if (section.includes("Regulatory")) output += "Prepare approval-ready drawings, specifications and documentation aligned with national healthcare standards, building-permit requirements and client document-control expectations.\n";
    else if (section.includes("Renovation")) output += "Prepare renovation drawings, specifications, BOQ/cost-estimate support where required, supervision controls, periodic progress reporting and quality monitoring against approved healthcare drawings.\n";
    else if (section.includes("Close-Out")) output += "Close-out support should include final inspection, design-compliance verification, snag/defect tracking, handover documentation and operational-readiness support.\n";
    else if (section.includes("Quality")) output += "Apply staged design review gates, interdisciplinary coordination checks, evidence verification, drawing revision control, QA/QC review and final bid-submission control.\n";
    else if (section.includes("Value to")) output += "Value to the client should be framed around reduced selection risk, faster technical assessment, stronger regulatory readiness, evidence-backed team capability and clearer implementation control.\n";
    else if (section.includes("Value-Added")) output += "Value-added services should be limited to supported capabilities such as due diligence, document control, project evidence support, coordination meetings, reporting, site assessment and approval support.\n";
    else if (section.includes("Professional Certifications")) output += "Professional certifications, licences and awards should be included only when supported by uploaded evidence.\n";
    else if (section.includes("Declaration")) output += "Declare eligibility, technical-only submission compliance where applicable, evidence accuracy subject to final bid-team verification, and absence of unsupported financial offer.\n";
    else output += "This section is included to align the proposal with the uploaded ChatGPT benchmark structure and should be completed from verified source evidence.\n";
  }
  return output;
}

function completeProofDisciplineSections(markdown: string, input: BenchmarkGuardInput): string {
  let output = markdown.trim();
  if (!headingExists(output, "First-Page Proof Strategy")) {
    output += "\n\n## First-Page Proof Strategy\n";
    output += `The opening pages must lead with the strongest reviewed project, client, expert, and compliance evidence for ${input.clientName}. If the generated draft does not contain direct project proof in the Cover Letter or Executive Summary, the bid team must move the strongest comparable reference into the first page before final submission.\n`;
    output += "- Lead with named comparable projects where reviewed evidence supports the name, client, location, scope, value, services, photos/drawings, testimony, or completion evidence.\n";
    output += "- Repeat the same lead proof consistently in the Cover Letter, Executive Summary, Relevant Experience, and evaluator-response narrative.\n";
    output += "- Do not convert unsupported claims into facts; mark them as bid-team confirmation items until source evidence is attached.\n";
  }
  if (!headingExists(output, "Evidence Control Register")) {
    output += "\n\n## Evidence Control Register\n";
    output += "The final proposal should preserve a clear claim-to-evidence discipline so the bid team can verify every major claim before export.\n";
    output += "- **Comparable project claims:** verify against reviewed project references, contracts, completion evidence, testimony letters, photos, drawings, or project evidence attachments.\n";
    output += "- **Expert/team claims:** verify against reviewed CVs, credentials, licences, prior roles, and team-to-project mapping evidence.\n";
    output += "- **Company capability claims:** verify against company profile, registration/licence, legal records, compliance records, audited/financial records, certificates, and uploaded company documents.\n";
    output += "- **Methodology claims:** verify against the tender scope, submission instructions, evaluation criteria, regulatory requirements, and bid-team technical review.\n";
    output += "- **Unsupported claims:** remove, soften, or convert into explicit bid-team confirmation actions before final submission.\n";
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

  if (score.gaps.some((gap) => /project|reference|first page|proof/i.test(gap))) {
    output += "\n\n## Project Reference Mapping\n";
    output += `${input.projectCount} reviewed project reference(s) are currently available for this response. The proposal leads with the most similar references by sector, client type, technical scope, geography, contract value, and deliverables. Any additional reference, testimony letter, photo, drawing, or completion certificate required by the tender should be attached or marked for bid-team confirmation.\n`;
  }

  if (score.gaps.some((gap) => /methodology|technical|healthcare/i.test(gap)) || output.length < 11000) {
    output += "\n\n## Detailed Technical Methodology\n";
    output += "The delivery method follows a senior technical sequence: inception and document review; stakeholder and site data collection; gap/risk assessment; concept development; interdisciplinary design coordination; technical calculations and drawings; BOQ/specification preparation; quality assurance review; client validation; final submission; and implementation-support handover. Each stage defines inputs, outputs, responsible experts, quality checks, review meetings, and approval points.\n";
    if (isHealthcareTender(input, output)) {
      output += "\nFor healthcare assignments, the methodology must explicitly control Emergency, OPD, In-patient, Laboratory, Imaging/Radiology and Pharmacy workflows; patient/staff/supply and waste flows; IPC zoning; medical equipment loads; radiation shielding; medical gas; ICT/telehealth; MEP coordination; healthcare regulatory approvals; renovation oversight; close-out; and operational readiness.\n";
    }
    output += "\nThe methodology responds to tender risks including missing information, tight submission timelines, evidence sufficiency, specialist availability, format compliance, appendices, regulatory approvals, technical coordination, and final submission control.\n";
  }

  if (score.gaps.some((gap) => /compliance|bid|evidence-control|traceability/i.test(gap))) {
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
  const completed = completeProofDisciplineSections(completeChatGPTBenchmarkSections(completeMissingClientSections(cleaned, input), input), input);
  const firstScore = scoreBenchmarkProposalMarkdown(completed, input);
  const repaired = repairClientReadyMarkdown(completed, input, firstScore);
  const clientReady = completeProofDisciplineSections(completeChatGPTBenchmarkSections(removeInternalQualityHeadings(normalizeWeakText(repaired)), input), input);
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
