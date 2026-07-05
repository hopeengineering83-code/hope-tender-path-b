export type WinningBenchmarkPrinciple = {
  code: string;
  principle: string;
  genericApplication: string;
};

export const WINNING_PROPOSAL_BENCHMARK_PROFILE: WinningBenchmarkPrinciple[] = [
  {
    code: "PROOF_FIRST_OPENING",
    principle: "The winning benchmark opens with concrete comparable-project proof before generic company description.",
    genericApplication: "For every future tender, the first page should identify the strongest reviewed comparable projects, clients, scope, values, services and relevance where evidence exists.",
  },
  {
    code: "EVIDENCE_CONTINUITY",
    principle: "The same lead proof points appear consistently in the cover letter, executive summary, relevant experience and evaluator-response narrative.",
    genericApplication: "The app should carry the top one or two evidence items throughout the proposal instead of mentioning them once in a portfolio section.",
  },
  {
    code: "TENDER_NATIVE_STRUCTURE",
    principle: "The proposal follows the buyer's expected response structure instead of forcing a generic template.",
    genericApplication: "If a tender implies Section A/B/C/D, forms, schedules, annexes or specific headings, generated content should mirror that structure.",
  },
  {
    code: "TEAM_TO_PROJECT_MAPPING",
    principle: "Named experts are mapped to prior comparable work and to their role on the current assignment.",
    genericApplication: "For every selected CV, the app should explain role, qualification, previous comparable project and contribution to the tender risk.",
  },
  {
    code: "METHOD_SCOPE_ALIGNMENT",
    principle: "The methodology is written scope-by-scope and evaluator-facing, not as a generic project-management process.",
    genericApplication: "Every major tender scope item should become a methodology subsection with inputs, activities, outputs, responsible experts, QA gates and client decisions.",
  },
  {
    code: "SECTOR_TECHNICAL_DEPTH",
    principle: "Healthcare proposals need sector-specific depth: clinical workflow, functional departments, MEP/biomedical coordination, IPC, approvals and close-out.",
    genericApplication: "For each sector, the app should inject domain-specific technical risks and delivery controls only when the tender/evidence supports them.",
  },
  {
    code: "APPENDIX_DISCIPLINE",
    principle: "The winning benchmark treats appendices as proof assets, not as an afterthought.",
    genericApplication: "The app should name required supporting evidence categories and connect them to claims: registration, licences, CVs, project photos/drawings, testimony, completion certificates and declarations.",
  },
  {
    code: "NO_UNSUPPORTED_CLAIMS",
    principle: "Claims are either supported by source evidence or marked as bid-team confirmation actions.",
    genericApplication: "Generated proposals must never invent awards, projects, experts, licences, values or client names; unsupported content becomes a review action.",
  },
];

export function winningBenchmarkProfileText(): string {
  return WINNING_PROPOSAL_BENCHMARK_PROFILE
    .map((item, index) => `${index + 1}. ${item.principle} Application: ${item.genericApplication}`)
    .join("\n");
}
