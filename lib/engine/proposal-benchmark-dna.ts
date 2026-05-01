export const UPLOADED_BENCHMARK_PROPOSAL_DNA = [
  "Benchmark opening: lead with the strongest 1-2 directly comparable projects by name, value, scale, location, and relevance. Do not open with generic company praise.",
  "Benchmark narrative: the first two pages must make the evaluator feel the firm has already delivered this assignment type before.",
  "Benchmark cover page: include client, bidder, exact submission emails, exact subject line, deadline, and 3-5 headline proof metrics when evidence exists.",
  "Benchmark structure: Cover Letter, Technical Proposal, Table of Contents, Executive Summary, SECTION A Company Profile, SECTION B Relevant Experience, SECTION C Technical Approach, SECTION D Additional Information, Appendix Register, Declaration.",
  "Benchmark Section A: include company background, corporate information, core expertise, proposed team, team-to-project mapping, and specialist/biomedical integration when required.",
  "Benchmark Section B: use client references and project cards with client, location, scale, duration/year, value, testimony/reference when available, services, and relevance to this tender.",
  "Benchmark Section C: write scope-by-scope methodology aligned to the tender, including facility identification, technical assessment, design, MEP coordination, regulatory approvals, renovation oversight, close-out, and QA.",
  "Healthcare benchmark: address Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, clinical zoning, patient/staff/supply flow, IPC, radiation shielding, equipment loads, IT/telehealth, medical gas, and licensing documentation when relevant.",
  "Evidence rule: use only uploaded tender/company/expert/project evidence. If a benchmark-style claim lacks support, write a short bid-team confirmation item rather than inventing it.",
  "Appendix discipline: explicitly name company registration/licence, client references/contracts/testimony, CVs/credentials, project photos/drawings, manuals/audits/certifications, and declarations where relevant."
];

export const PHARO_HEALTHCARE_SCOPE_HEADINGS = [
  "3.1 Facility Identification and Technical Assessment",
  "3.2 Conceptual and Detailed Design",
  "3.3 Engineering / MEP Coordination",
  "3.4 Regulatory Compliance and Approvals",
  "3.5 Renovation Planning and Implementation Oversight",
  "3.6 Project Close-Out Support"
];

export function benchmarkDnaBlock(): string {
  return UPLOADED_BENCHMARK_PROPOSAL_DNA.map((line, index) => `${index + 1}. ${line}`).join("\n");
}
