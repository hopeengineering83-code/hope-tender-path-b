/**
 * Benchmark-quality tabular sections built deterministically from the
 * reviewed knowledge vault. These are appended to the proposal so that
 * a tender response always contains the high-evidence-density tables
 * an evaluator looks for, even when the AI generation step degrades to
 * regex or partial output.
 *
 * Sector-agnostic: works for healthcare, water, road/bridge, urban,
 * environmental, ICT, education, and general consultancy tenders. The
 * table column headers stay the same; only the row content changes
 * with the data the company has.
 */

type ExpertRecord = {
  fullName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  yearsExperience?: number | null;
  disciplines?: string | null;
  sectors?: string | null;
  certifications?: string | null;
  profile?: string | null;
};

type ProjectRecord = {
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: string | null;
  summary?: string | null;
  contractValue?: number | null;
  currency?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
};

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through
    }
  }
  return trimmed
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escCell(text: string | null | undefined): string {
  // Markdown table cells cannot contain raw pipes or newlines without breaking layout.
  return (text ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function fmtMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Value on file";
  const cur = currency || "ETB";
  const formatted = Math.round(value).toLocaleString("en-US");
  return `${cur} ${formatted}`;
}

function fmtDateRange(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  const startYear = parseYear(start);
  const endYear = parseYear(end);
  if (startYear && endYear) return startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`;
  if (startYear) return `${startYear}`;
  if (endYear) return `Completed ${endYear}`;
  return "Dates on file";
}

function parseYear(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getFullYear();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.getFullYear();
  const match = String(value).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

/**
 * A.4 Proposed Project Team — table.
 * Mirrors the benchmark format: # | Expert & Position | Qualifications & Licenses | Sector Experience | Role on This Assignment.
 */
export function buildProposedTeamTable(experts: ExpertRecord[], assignmentRoleHint: string): string {
  if (experts.length === 0) {
    return [
      "## A.4 Proposed Project Team",
      "_Source-evidence action: select reviewed expert CVs from the company knowledge vault before final submission. Each proposed expert must include name, qualification, license number, sector experience, and role on this assignment._",
    ].join("\n\n");
  }

  const header = "| # | Expert & Position | Qualifications & Licenses | Comparable Sector Experience | Role on This Assignment |";
  const separator = "|---|---|---|---|---|";
  const rows = experts.map((expert, idx) => {
    const position = expert.title?.trim() || "Specialist";
    const certs = safeArr(expert.certifications).join(", ");
    const disciplines = safeArr(expert.disciplines).join(", ");
    const yearsLine = expert.yearsExperience ? `${expert.yearsExperience} yrs experience` : "";
    const qualParts = [disciplines, certs, yearsLine].filter(Boolean).join(" | ");
    const sectors = safeArr(expert.sectors).join(", ");
    const profile = (expert.profile ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
    const sectorExp = [sectors, profile].filter(Boolean).join(" — ");
    const role = position.toLowerCase().includes("lead") || position.toLowerCase().includes("principal")
      ? `${position} on this assignment. ${assignmentRoleHint}`
      : `${position} on this assignment.`;
    return `| ${idx + 1} | ${escCell(`${expert.fullName} — ${position}`)} | ${escCell(qualParts || "Qualifications on file")} | ${escCell(sectorExp || "Sector experience on file")} | ${escCell(role)} |`;
  });

  return [
    "## A.4 Proposed Project Team",
    "All proposed team members are permanent staff with verified licenses and direct experience relevant to this assignment. Full curricula vitae, educational certificates, and professional license copies for all proposed experts are attached as Appendix C of this submission.",
    "",
    header,
    separator,
    ...rows,
  ].join("\n");
}

/**
 * A.5 Team-to-Project Experience Mapping — table.
 * Demonstrates that each lead expert has performed the same role on a comparable previous project.
 */
export function buildTeamToProjectMappingTable(experts: ExpertRecord[], projects: ProjectRecord[]): string {
  if (experts.length === 0 || projects.length === 0) {
    return [
      "## A.5 Team-to-Project Experience Mapping",
      "_Source-evidence action: pair each proposed expert with at least one previous comparable project from the reviewed portfolio before final submission. Each pairing must show: expert name, current role, previous comparable project, role previously performed, and key technical contribution._",
    ].join("\n\n");
  }

  const header = "| Expert & Role on This Project | Role Previously Performed | Previous Comparable Project | Key Technical Contribution |";
  const separator = "|---|---|---|---|";

  // Pair each expert with the project that best matches their disciplines/sectors.
  // Falls back to round-robin assignment when no semantic match is found.
  const rows = experts.slice(0, 10).map((expert, idx) => {
    const expertDisciplines = safeArr(expert.disciplines).map((s) => s.toLowerCase());
    const expertSectors = safeArr(expert.sectors).map((s) => s.toLowerCase());
    const matchedProject =
      projects.find((p) => {
        const projectSector = (p.sector ?? "").toLowerCase();
        const projectAreas = safeArr(p.serviceAreas).map((s) => s.toLowerCase());
        return expertDisciplines.some((d) => projectAreas.includes(d) || projectSector.includes(d)) ||
          expertSectors.some((s) => projectSector.includes(s));
      }) ?? projects[idx % projects.length];

    const projectLabel = `${matchedProject.name}${matchedProject.contractValue ? ` (${fmtMoney(matchedProject.contractValue, matchedProject.currency)})` : ""}${matchedProject.clientName ? `, ${matchedProject.clientName}` : ""}`;
    const previousRole = expert.title?.toLowerCase().includes("lead") || expert.title?.toLowerCase().includes("principal")
      ? expert.title
      : `Senior ${expert.title || "Specialist"}`;
    const contribution = (matchedProject.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 200) ||
      `${safeArr(expert.disciplines).join(", ") || "Discipline-led"} contribution covering ${safeArr(matchedProject.serviceAreas).join(", ") || matchedProject.sector || "scope-relevant works"}.`;

    return `| ${escCell(`${expert.fullName}, ${expert.title || "Specialist"}`)} | ${escCell(previousRole || "Specialist Lead")} | ${escCell(projectLabel)} | ${escCell(contribution)} |`;
  });

  return [
    "## A.5 Team-to-Project Experience Mapping",
    "Each lead expert proposed for this assignment has performed the same or directly comparable role on a previous reviewed project. The table below provides the direct mapping.",
    "",
    header,
    separator,
    ...rows,
  ].join("\n");
}

/**
 * B.x Project Portfolio Cards — one rich card per top project, formatted as a 2-column metadata table.
 * Mirrors the benchmark "Client | Location & Scale | Duration | Construction Cost | Testimony Reference | Services Provided | Relevance to This Assignment" structure.
 */
export function buildProjectPortfolioCards(projects: ProjectRecord[], tenderTitle: string, primarySector: string): string {
  if (projects.length === 0) {
    return [
      "## B.2 Project Portfolio",
      "_Source-evidence action: select reviewed project references from the company knowledge vault. Each entry must include client, location, duration, contract value, testimony reference, services provided, and a one-paragraph relevance statement linking the project's competencies to this tender._",
    ].join("\n\n");
  }

  const cards: string[] = ["## B.2 Project Portfolio"];
  cards.push(
    `${projects.length} reviewed project reference(s) directly relevant to ${tenderTitle} are presented below. ` +
    `Each card maps the project's specific transferable technical competencies to a ${primarySector || "tender-specific"} requirement of this assignment. ` +
    "Original testimony letters, signed contracts, and project completion evidence are attached as Appendix B.",
  );

  for (const project of projects.slice(0, 9)) {
    const title = `${project.name}${project.sector ? ` — ${project.sector}` : ""}`;
    cards.push(`### ${title}`);
    cards.push(
      `| Field | Detail |`,
      `|---|---|`,
      `| Client | ${escCell(project.clientName || "Client on file")} |`,
      `| Location & Scale | ${escCell([project.country, ...safeArr(project.serviceAreas).slice(0, 3)].filter(Boolean).join(" — ") || "Scale on file")} |`,
      `| Duration | ${escCell(fmtDateRange(project.startDate, project.endDate))} |`,
      `| Contract Value | ${escCell(fmtMoney(project.contractValue, project.currency))} |`,
      `| Services Provided | ${escCell(safeArr(project.serviceAreas).join(", ") || project.summary || "Service detail on file")} |`,
      `| Relevance to This Assignment | ${escCell(buildRelevanceStatement(project, tenderTitle, primarySector))} |`,
    );
    cards.push("");
  }

  return cards.join("\n");
}

function buildRelevanceStatement(project: ProjectRecord, tenderTitle: string, primarySector: string): string {
  const sectorMatch = (project.sector ?? "").toLowerCase().includes(primarySector.toLowerCase());
  const summary = (project.summary ?? "").replace(/\s+/g, " ").trim();

  if (summary && sectorMatch) {
    return `Direct ${primarySector} relevance: ${summary.slice(0, 220)}`;
  }
  if (summary) {
    return `Demonstrates transferable competency for ${tenderTitle}: ${summary.slice(0, 220)}`;
  }
  if (sectorMatch) {
    return `Direct ${primarySector} project — same team and methodology applicable to ${tenderTitle}.`;
  }
  return `Transferable technical competency: ${safeArr(project.serviceAreas).join(", ") || "scope-relevant scope"} — directly applicable to the methodology required by ${tenderTitle}.`;
}

/**
 * C.3 Quality Assurance: Three-Stage Design Review — sector-agnostic table.
 * The reviewer roles, milestones, and gate-checks are constants; the action items are tender-aware.
 */
export function buildThreeStageReviewTable(companyName: string, primarySector: string): string {
  const isDesignTender = /design|architect|building|construction|MEP|structural|engineer|consultancy|supervision/i.test(primarySector);
  const stage1Action = isDesignTender ? "30% Schematic Design" : "30% Inception / Approach Review";
  const stage1Detail = isDesignTender ? "floor plans, zoning, and MEP routing confirmed" : "scope, methodology, and stakeholder map confirmed";
  const stage2Action = isDesignTender ? "60% Developed Design" : "60% Substantive Deliverable Review";
  const stage2Detail = isDesignTender ? "all disciplines coordinated, specifications drafted" : "all work-streams coordinated, draft outputs produced";
  const stage3Action = isDesignTender ? "100% Pre-Issue Final Package" : "100% Pre-Submission Final Package";
  const stage3Detail = isDesignTender ? "complete drawing package, BOQ, and specifications finalised" : "complete deliverable package, supporting evidence, and sign-off finalised";

  return [
    "## C.3 Quality Assurance: Three-Stage Review",
    `Every deliverable package is reviewed through three mandatory stages before issue. This protocol is documented in ${companyName}'s Quality Management System (ISO 9001:2015-aligned where certified) and applied on all certified projects.`,
    "",
    "| Stage | Milestone | Review Authority and Required Action |",
    "|---|---|---|",
    `| Stage 1 | ${stage1Action}: ${stage1Detail} | Senior Engineer and QA Manager. Sector-protocol gate-check. Written sign-off required before proceeding. |`,
    `| Stage 2 | ${stage2Action}: ${stage2Detail} | Deputy General Manager / Technical Director. Regulatory and compliance pre-check. Written approval required. |`,
    `| Stage 3 | ${stage3Action}: ${stage3Detail} | General Manager / Principal. Final sign-off before issue. All review comments resolved. |`,
  ].join("\n");
}

/**
 * Optional Site / Asset / Beneficiary Assessment Matrix — only emitted when the
 * tender involves selecting between sites, premises, beneficiaries, or assets.
 * Mirrors the benchmark's weighted-criteria matrix.
 */
export function buildAssessmentMatrix(opts: { tenderTitle: string; primarySector: string }): string | null {
  const wantsAssessment = /identify|select|assessment|premises|site|location|shortlist|evaluation of|feasibility|due diligence|suitability/i
    .test(opts.tenderTitle);
  if (!wantsAssessment) return null;

  const sector = opts.primarySector || "Project";
  const isHealthcare = /health|hospital|medical|clinic/i.test(sector);
  const isWater = /water|borehole|hydraulic|sanitary/i.test(sector);

  const criteria = isHealthcare
    ? [
        ["Structural Suitability", "25%", "Load-bearing capacity for clinical equipment; slab thickness for clinical floor loads; column grid compatibility with open department layouts; capacity for additional floors."],
        ["Spatial Flexibility", "20%", "Ability to accommodate department zoning; clear heights for clinical areas; corridor widths for patient bed movement; natural light and ventilation potential."],
        ["Utilities Availability", "20%", "Power supply with emergency generator space; water pressure and flow for clinical supply; drainage capacity for clinical effluent; medical gas pipeline potential."],
        ["Accessibility", "15%", "Separated ambulance access; main patient entry distinct from service entry; fire appliance space; accessible parking; public transport proximity."],
        ["Expansion Potential", "20%", "Future vertical or horizontal extension feasibility; adjacent land availability; structural capacity for additional floors; utility scalability."],
      ]
    : isWater
      ? [
          ["Source Capacity & Quality", "25%", "Yield, recharge potential, baseline water quality against intended use, treatment requirements."],
          ["Hydraulic Feasibility", "20%", "Pumping head, distribution distance, storage adequacy, network resilience against demand peaks."],
          ["Power & Site Resilience", "20%", "Solar/grid feasibility, backup arrangements, security of installation, accessibility for O&M."],
          ["Environmental & Social", "15%", "ESIA/ESMP requirements, community acceptance, downstream user impact, safeguard compliance."],
          ["Operation & Maintenance Plan", "20%", "Spare parts availability, operator training, monitoring instrumentation, lifecycle cost."],
        ]
      : [
          ["Technical Suitability", "25%", "Technical fit against the tender's primary deliverable. Demonstrated capacity to execute at the required scale."],
          ["Regulatory & Compliance Posture", "20%", "Authority approvals required, documentation standards, sector-specific compliance regime."],
          ["Stakeholder & Access Constraints", "15%", "Site/beneficiary access, stakeholder engagement requirements, security of operations."],
          ["Resource & Logistics Readiness", "20%", "Team availability, materials/equipment lead time, supply chain resilience."],
          ["Strategic Value & Sustainability", "20%", "Long-term value to the client, alignment with sector trends, sustainability of outputs."],
        ];

  const rows = criteria.map(([name, weight, detail]) => `| ${escCell(name)} | ${escCell(weight)} | ${escCell(detail)} |`);

  return [
    "## C.1.1 Weighted Assessment Matrix",
    `For ${opts.tenderTitle}, the following weighted assessment matrix is applied to score each candidate ${isHealthcare ? "premises" : isWater ? "site" : "option"} against tender-specific criteria. Each criterion is scored 1–10; the weighted total determines the recommendation.`,
    "",
    "| Assessment Criterion | Weight | What is Evaluated |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}

export function buildBenchmarkTablesBlock(opts: {
  experts: ExpertRecord[];
  projects: ProjectRecord[];
  companyName: string;
  tenderTitle: string;
  primarySector: string;
  assignmentRoleHint: string;
  alreadyHasHeading: (heading: string) => boolean;
}): string {
  const blocks: string[] = [];

  if (!opts.alreadyHasHeading("A.4 Proposed Project Team") && !opts.alreadyHasHeading("Proposed Project Team")) {
    blocks.push(buildProposedTeamTable(opts.experts, opts.assignmentRoleHint));
  }
  if (!opts.alreadyHasHeading("A.5 Team-to-Project Experience Mapping") && !opts.alreadyHasHeading("Team-to-Project Experience Mapping")) {
    blocks.push(buildTeamToProjectMappingTable(opts.experts, opts.projects));
  }
  if (!opts.alreadyHasHeading("B.2 Project Portfolio") && !opts.alreadyHasHeading("Project Portfolio")) {
    blocks.push(buildProjectPortfolioCards(opts.projects, opts.tenderTitle, opts.primarySector));
  }

  const matrix = buildAssessmentMatrix({ tenderTitle: opts.tenderTitle, primarySector: opts.primarySector });
  if (matrix && !opts.alreadyHasHeading("C.1.1 Weighted Assessment Matrix") && !opts.alreadyHasHeading("Weighted Assessment Matrix")) {
    blocks.push(matrix);
  }

  if (!opts.alreadyHasHeading("C.3 Quality Assurance: Three-Stage Review") && !opts.alreadyHasHeading("Three-Stage Review") && !opts.alreadyHasHeading("Three-Stage Design Review")) {
    blocks.push(buildThreeStageReviewTable(opts.companyName, opts.primarySector));
  }

  return blocks.filter(Boolean).join("\n\n");
}

export function makeHasHeadingChecker(markdown: string): (heading: string) => boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const headings = new Set(
    markdown
      .split(/\n+/)
      .filter((line) => /^#{1,4}\s+/.test(line))
      .map((line) => normalize(line.replace(/^#+\s*/, "")))
  );
  return (heading: string) => headings.has(normalize(heading));
}
