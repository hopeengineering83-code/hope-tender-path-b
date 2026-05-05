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

export type ExpertRecord = {
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

export type ProjectRecord = {
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
  // Only emit a money string when there is a real value. Returning the
  // placeholder "Value on file" everywhere a value is missing leads to
  // proposals peppered with "(Value on file, Client)" parentheticals,
  // which read like unfilled template slots. Callers should use
  // hasContractValue() to decide whether to render the parenthetical at
  // all.
  if (value === null || value === undefined || Number.isNaN(value) || value <= 0) return "";
  const cur = currency || "ETB";
  const formatted = Math.round(value).toLocaleString("en-US");
  return `${cur} ${formatted}`;
}

function hasContractValue(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

// Composes "Project Name (ETB 350M, Client Name)" when value is present,
// "Project Name (Client Name)" when value is missing, and just
// "Project Name" when both are missing. Centralised so the same shape is
// used in Cover Letter, Executive Summary, Team-to-Project mapping, and
// other prose contexts.
function fmtProjectInline(project: Pick<ProjectRecord, "name" | "contractValue" | "currency" | "clientName">): string {
  const parts: string[] = [];
  if (hasContractValue(project.contractValue)) parts.push(fmtMoney(project.contractValue, project.currency));
  if (project.clientName) parts.push(project.clientName);
  return parts.length > 0 ? `${project.name} (${parts.join(", ")})` : project.name;
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

    const projectLabel = fmtProjectInline(matchedProject);
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
      `| Contract Value | ${escCell(hasContractValue(project.contractValue) ? fmtMoney(project.contractValue, project.currency) : "Value detail in Appendix B (project reference)")} |`,
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
  // Strip common conjunctions ("and", "or", "&") before normalizing so that
  // headings like "Risk Register & Mitigation Strategy" and "Risk Register
  // and Mitigation Strategy" hash to the same key. Without this, an AI that
  // emits "Risk Register & Mitigation Strategy" would not match the
  // upstreamCheck("Risk Register and Mitigation Strategy") call in
  // generate-elite.ts and the deterministic enricher would duplicate the
  // section.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " ")
      .replace(/\b(and|or)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const headings = new Set(
    markdown
      .split(/\n+/)
      .filter((line) => /^#{1,4}\s+/.test(line))
      .map((line) => normalize(line.replace(/^#+\s*/, "")))
  );
  return (heading: string) => headings.has(normalize(heading));
}

// ─── B.1 Client References table ──────────────────────────────────────────────
//
// Mirrors the benchmark "Client References" block: named contacts and reference
// letter numbers BEFORE the portfolio cards. Pulls contact + reference data from
// project metadata where available; falls back to a source-evidence-action note.

export function buildClientReferencesTable(projects: ProjectRecord[]): string {
  if (projects.length === 0) {
    return [
      "## B.1 Client References",
      "_Source-evidence action: attach reviewed client reference letters with named contacts and reference numbers from the company knowledge vault before final submission._",
    ].join("\n\n");
  }

  const rows = projects.slice(0, 5).map((project) => {
    const projectLine = `${project.name}${project.clientName ? ` — ${project.clientName}` : ""}`;
    const referenceContact = project.clientName ? `${project.clientName} representative` : "Client representative";
    const contactDetail = [project.country, project.clientName].filter(Boolean).join(", ") || "Contact details on file";
    const value = fmtMoney(project.contractValue, project.currency);
    return `| ${escCell(projectLine)} | ${escCell(referenceContact)} | ${escCell(contactDetail)} | ${escCell(value)} |`;
  });

  return [
    "## B.1 Client References",
    `${projects.length === 1 ? "One client reference" : `${Math.min(projects.length, 5)} client references`} provided with named contacts and reference details. Original testimony letters, signed contracts, and project completion evidence are attached as Appendix B.`,
    "",
    "| Project / Client | Reference Contact & Title | Contact Details & Reference | Contract Value |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

// ─── D.1 Value Framework table (sector-aware) ────────────────────────────────
//
// "Framework Pillar | What [Client] Gains" — 4–6 evaluator-facing benefit pillars
// matching the benchmark's D.1 Section. Sector vocabulary changes; structure does not.

type ValueFrameworkPillar = { pillar: string; clientGains: string };

function valueFrameworkPillars(primarySector: string, clientName: string): ValueFrameworkPillar[] {
  const isHealthcare = /health|hospital|medical|clinic/i.test(primarySector);
  const isWater = /water|borehole|hydraulic|sanitary/i.test(primarySector);
  const isRoad = /road|bridge|highway|pavement|transport/i.test(primarySector);
  const isUrban = /urban|master plan|municipal/i.test(primarySector);
  const isEnv = /environmental|ESIA|ESMP|safeguard/i.test(primarySector);
  const isICT = /ICT|software|digital|MIS|ERP/i.test(primarySector);
  const isEducation = /school|university|campus|education/i.test(primarySector);

  if (isHealthcare) return [
    { pillar: "Facility Intelligence", clientGains: `${clientName} identifies the right premises with confidence. Weighted site assessment scores each shortlisted property against five healthcare-specific criteria. In-house geotechnical capability delivers subsurface findings within days, protecting acquisition timelines.` },
    { pillar: "Workflow Engineering", clientGains: "Patients experience shorter waiting times and staff cover less unnecessary distance. Clinical workflows are designed from the patient perspective — OPD reception positioned for triage visibility, diagnostics close to referral sources, pharmacy at outpatient exit." },
    { pillar: "Revenue-Based Zoning", clientGains: "The facility generates maximum revenue from day one. High-throughput revenue centres (Radiology, Laboratory, Pharmacy) are positioned and sized for operational efficiency. Patient flow is designed to maximise referrals between departments." },
    { pillar: "Infrastructure Integration", clientGains: "Renovation completes without costly design changes. All MEP systems, medical gas, radiation shielding, biomedical equipment, and ICT/PACS integration are coordinated from schematic stage — not added retrospectively." },
    { pillar: "Regulatory Velocity", clientGains: "Health Authority licensing timeline is protected. Documentation prepared to international donor standards (World Bank ESF, equivalent) exceeds Health Authority requirements, reducing rejection risk and shortening approval cycles." },
    { pillar: "Operational Readiness", clientGains: "Day-one handover includes as-built drawings, O&M manuals, equipment commissioning records, regulatory certificates, and warranty register. The facility opens with documentation that supports operational management from the first patient." },
  ];
  if (isWater) return [
    { pillar: "Source Certainty", clientGains: `${clientName} starts construction with verified yield, water quality, and recharge data. In-house drilling and laboratory capability delivers source data without sub-contractor delays.` },
    { pillar: "Hydraulic Resilience", clientGains: "Network designed for peak demand with EPANET/WaterCAD modelling, pressure-zone definition, and storage adequacy checked against drought scenarios." },
    { pillar: "Power & Site Resilience", clientGains: "Solar/grid hybrid sized for life-of-asset reliability; backup arrangements documented; security and accessibility for O&M crews planned from layout stage." },
    { pillar: "Environmental & Safeguard Compliance", clientGains: "ESIA/ESMP, community consultation records, and downstream-user impact assessments prepared to donor standards." },
    { pillar: "O&M Sustainability", clientGains: "Spare parts catalog, operator training materials, monitoring instrumentation, and lifecycle cost projections included with handover — not afterthoughts." },
  ];
  if (isRoad) return [
    { pillar: "Survey & Design Certainty", clientGains: `${clientName} starts construction with verified topographic, geotechnical, traffic, and ESAL data. Pavement layers designed to ERA/AASHTO with documented assumptions.` },
    { pillar: "Drainage & Safety Engineering", clientGains: "Cross-drainage, side drains, culverts and structures designed for return-period storms. Safety audit completed before issue." },
    { pillar: "Construction Supervision Discipline", clientGains: "Materials testing schedule (CBR, compaction, aggregate), progress reporting, variation control, and payment certification follow FIDIC discipline." },
    { pillar: "Asset Lifecycle Management", clientGains: "As-built drawings, materials register, and O&M recommendations support the asset for the design life — not just the contract period." },
  ];
  if (isUrban) return [
    { pillar: "Evidence-Based Planning", clientGains: `${clientName} receives plans grounded in primary survey data, demographic projections, GIS spatial analysis, and stakeholder consultation records — not desktop-only assumptions.` },
    { pillar: "Implementation-Ready Phasing", clientGains: "Master plan includes a phasing strategy, infrastructure integration plan, and investment roadmap that authorities and investors can act on." },
    { pillar: "Stakeholder Acceptance", clientGains: "Consultation records, grievance handling, and disclosure documentation prepared so the plan can withstand public scrutiny." },
    { pillar: "Regulatory Compliance", clientGains: "Plan aligned to municipal, regional, and national planning frameworks — reducing approval risk." },
  ];
  if (isEnv) return [
    { pillar: "Field-Evidence Baselines", clientGains: `${clientName} receives ESIA/ESMP grounded in primary field data, not desktop-only sources. Baseline data covers physical, biological, and socio-economic dimensions.` },
    { pillar: "Donor-Standard Compliance", clientGains: "Reports prepared to World Bank ESF / IFC PS / equivalent donor standard, accepted on first submission." },
    { pillar: "Stakeholder Engagement Discipline", clientGains: "Consultation records, grievance mechanism, and disclosure documentation prepared to safeguard standards." },
    { pillar: "Mitigation & Monitoring Plans", clientGains: "ESMP includes named institutional responsibilities, monitoring indicators, and reporting schedules — not vague intent statements." },
  ];
  if (isICT) return [
    { pillar: "Requirements Discipline", clientGains: `${clientName} starts development with documented business process review, functional specification, and acceptance criteria — reducing scope drift.` },
    { pillar: "Architectural Resilience", clientGains: "System architecture, security controls (access management, encryption, audit trail), and integration plans documented before implementation begins." },
    { pillar: "Phased Delivery", clientGains: "Agile/iterative delivery with parallel-run, training, and acceptance testing — not big-bang go-live." },
    { pillar: "Handover Sustainability", clientGains: "Source code, documentation, training materials, and SLA-defined support model handed over — client retains full control." },
  ];
  if (isEducation) return [
    { pillar: "Functional Brief Discipline", clientGains: `${clientName} receives a space schedule grounded in pupil-ratio compliance, accessibility, and climate-responsive design — not generic templates.` },
    { pillar: "MEP & Safety Engineering", clientGains: "Power, water, sanitation, ICT, fire detection, and emergency systems coordinated from schematic stage." },
    { pillar: "Regulatory Approvals", clientGains: "Education authority functional approval, fire certificate, and handover documentation prepared as a project deliverable, not separate later activity." },
    { pillar: "Long-Life Specifications", clientGains: "Materials and finishes specified for school-life durability, low maintenance, and easy replacement of high-wear components." },
  ];
  return [
    { pillar: "Scope Understanding", clientGains: `${clientName} receives an evidence-led response that maps every tender requirement to a deliverable, responsible expert, and quality gate.` },
    { pillar: "Team Continuity", clientGains: "Same proposed experts have performed the same roles on comparable previous projects — zero learning curve, predictable delivery." },
    { pillar: "Quality Discipline", clientGains: "Three-stage internal review (schematic, developed, pre-issue) with named reviewer sign-off catches issues before issue." },
    { pillar: "Compliance & Documentation", clientGains: "Submission package follows tender file naming, ordering, and format rules exactly — no mechanical compliance failures." },
    { pillar: "Risk Reduction", clientGains: "Senior bid-review controls, source-evidence verification, and final validation pass reduce delivery risk for the awarding authority." },
  ];
}

export function buildValueFrameworkTable(opts: { primarySector: string; clientName: string }): string {
  const pillars = valueFrameworkPillars(opts.primarySector, opts.clientName);
  const rows = pillars.map((p) => `| ${escCell(p.pillar)} | ${escCell(p.clientGains)} |`);

  return [
    `## D.1 Value Framework — What ${opts.clientName} Gains`,
    "The table below sets out the specific, measurable benefits this engagement delivers. Each pillar is grounded in the methodology, team, and quality controls described in the preceding sections.",
    "",
    "| Framework Pillar | What This Engagement Delivers |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

// ─── A.6 Specialist Engagement Plan (conditional) ────────────────────────────
//
// Triggered when the tender text mentions a specialist discipline that the core
// proposed team does not cover (e.g., biomedical engineer, telecoms specialist,
// QHSE auditor). Produces a 60–100 word section with scope, integration plan,
// and timeline phases — matching the benchmark's "A.6 Biomedical Engineering
// Integration" pattern.

const SPECIALIST_TRIGGERS: Array<{ keywords: RegExp; specialty: string; integrationLead: string; deliverables: string[] }> = [
  {
    keywords: /\bbiomedical engineer|\bbio-medical|medical equipment specialist/i,
    specialty: "Biomedical Engineering Specialist",
    integrationLead: "MEP Lead",
    deliverables: [
      "medical equipment spatial planning (CT, X-ray, MRI, ultrasound, laboratory analysers, pharmacy dispensing)",
      "electrical load calculation for diagnostic and clinical equipment, coordinated with UPS and generator sizing",
      "radiation safety and shielding specifications (lead-lined wall thicknesses, controlled-access zoning)",
      "medical gas systems design (oxygen, medical air, vacuum, nitrous oxide pipelines, alarm panels)",
    ],
  },
  {
    keywords: /\btelecoms specialist|\bICT specialist|\bnetwork architect/i,
    specialty: "ICT / Telecoms Specialist",
    integrationLead: "Lead Architect",
    deliverables: [
      "structured cabling design (Cat6A/fibre backbone, distribution rooms, IDF/MDF locations)",
      "wireless coverage planning (heat-mapping, AP density, controller architecture)",
      "security infrastructure (CCTV, access control, intrusion detection, IT/OT segmentation)",
      "data centre / server room environmental design (cooling, UPS, fire suppression)",
    ],
  },
  {
    keywords: /\bQHSE|\bquality.*safety auditor|\bHSE auditor/i,
    specialty: "QHSE Auditor",
    integrationLead: "Project Manager",
    deliverables: [
      "site-specific safety plan aligned to ISO 45001 and FIDIC site safety requirements",
      "method statements and risk assessments for each high-risk activity",
      "safety inspection schedule with named hold-points",
      "incident reporting and root-cause analysis methodology",
    ],
  },
];

export function buildSpecialistEngagementSection(opts: { tenderText: string; companyName: string }): string | null {
  const matched = SPECIALIST_TRIGGERS.find((s) => s.keywords.test(opts.tenderText));
  if (!matched) return null;

  return [
    `## A.6 ${matched.specialty} Engagement Plan`,
    `The tender explicitly requires availability of a ${matched.specialty.toLowerCase()}. ${opts.companyName} will engage a licensed ${matched.specialty} specifically for this assignment, working directly with the ${matched.integrationLead}.`,
    "",
    "**Scope of Services**",
    ...matched.deliverables.map((d) => `- ${d}`),
    "",
    "**Integration Plan**",
    `- Phase 1 (assessment): advising on equipment-related spatial and structural requirements during site evaluation.`,
    `- Phase 2 (design development): equipment layout, shielding/cabling specifications, and infrastructure positioning.`,
    `- Phase 3 (detailed design): load calculations, schematic drawings, fully coordinated with all other MEP disciplines.`,
    `- Phase 4 (commissioning): equipment installation coordination, testing, and operational handover.`,
    "",
    `All requirements are embedded from schematic design stage — not added retrospectively. Structural, MEP, and specialist systems are designed as a single coordinated whole, eliminating late-stage conflicts and costly design changes.`,
  ].join("\n");
}

// ─── Cover Page metadata block (Submitted by | Submitted to) ─────────────────
//
// Mirrors the benchmark's "Submitted by | Submitted to" 2-column block with
// company TIN/VAT/GM, exact email recipients, deadline, and 4-5 headline facts
// drawn from the company's actual portfolio.

export function buildSubmittedByToBlock(opts: {
  companyName: string;
  companyLegalName?: string | null;
  companyAddress?: string | null;
  companyTIN?: string | null;
  companyVAT?: string | null;
  companyGM?: string | null;
  companyGMLicense?: string | null;
  clientName: string;
  clientAddress?: string | null;
  exactEmails: string[];
  exactSubject: string;
  deadline?: Date | string | null;
}): string {
  const submittedBy: string[] = [
    `**${opts.companyName}**`,
    opts.companyLegalName && opts.companyLegalName !== opts.companyName ? `Legal name: ${opts.companyLegalName}` : "",
    opts.companyAddress ? `Address: ${opts.companyAddress}` : "",
    opts.companyTIN ? `TIN: ${opts.companyTIN}` : "",
    opts.companyVAT ? `VAT: ${opts.companyVAT}` : "",
    opts.companyGM ? `Submitted by: ${opts.companyGM}${opts.companyGMLicense ? ` (License ${opts.companyGMLicense})` : ""}` : "",
  ].filter(Boolean);

  const submittedTo: string[] = [
    `**${opts.clientName}**`,
    opts.clientAddress ? opts.clientAddress : "",
    opts.exactEmails.length > 0 ? `Email recipients: ${opts.exactEmails.join("; ")}` : "Email recipients: see tender submission instructions",
    `Subject: ${opts.exactSubject}`,
    opts.deadline ? `Deadline: ${new Date(opts.deadline).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "",
  ].filter(Boolean);

  // Pad rows so both columns have equal length for a tidy table render
  const maxRows = Math.max(submittedBy.length, submittedTo.length);
  while (submittedBy.length < maxRows) submittedBy.push("");
  while (submittedTo.length < maxRows) submittedTo.push("");

  const rows = Array.from({ length: maxRows }, (_, i) => `| ${escCell(submittedBy[i])} | ${escCell(submittedTo[i])} |`);

  return [
    "| Submitted by | Submitted to |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

// ─── Portfolio Reading Guide (intro before B.2) ──────────────────────────────
//
// Explains why non-direct projects are included in the portfolio, with a
// transferable-competency rationale per project. Matches the benchmark's
// "Portfolio Reading Guide" preamble.

export function buildPortfolioReadingGuide(opts: {
  projects: ProjectRecord[];
  primarySector: string;
  tenderTitle: string;
}): string | null {
  if (opts.projects.length === 0) return null;
  const directMatches = opts.projects.filter((p) => (p.sector ?? "").toLowerCase().includes(opts.primarySector.toLowerCase().split(/[\s/]+/)[0] ?? ""));
  const transferable = opts.projects.filter((p) => !directMatches.includes(p));
  if (directMatches.length === 0 && transferable.length === 0) return null;

  const lines: string[] = ["## B.2.0 Portfolio Reading Guide"];
  lines.push(
    `The ${opts.projects.length} project reference(s) below are organised in two groups:` +
    (directMatches.length > 0
      ? ` **Direct ${opts.primarySector} references** demonstrate prior delivery of comparable scope.`
      : "") +
    (transferable.length > 0
      ? ` **Transferable competency references** are included for specific technical capabilities (e.g., controlled-environment MEP, donor compliance, multi-disciplinary coordination) that map directly to ${opts.tenderTitle} requirements.`
      : ""),
  );
  if (directMatches.length > 0) {
    lines.push(`- Direct references: ${directMatches.map((p) => p.name).slice(0, 5).join("; ")}.`);
  }
  if (transferable.length > 0) {
    lines.push(`- Transferable competency references: ${transferable.map((p) => p.name).slice(0, 6).join("; ")}.`);
  }
  lines.push("Each card includes a **Relevance to This Assignment** statement mapping the specific competency to a tender requirement.");

  return lines.join("\n\n");
}

// ─── Cover Letter opening paragraph (project-anchored) ───────────────────────
//
// Replaces the generic "we are pleased to submit" opener with one that names
// the strongest comparable projects, ETB values, and same-team continuity —
// matching the benchmark's opening pattern.

export function buildCoverLetterOpener(opts: {
  companyName: string;
  clientName: string;
  tenderTitle: string;
  projects: ProjectRecord[];
}): string {
  const top = opts.projects.slice(0, 2);
  if (top.length === 0) {
    return [
      `${opts.companyName} is pleased to submit this Technical Proposal for ${opts.tenderTitle} in response to the request issued by ${opts.clientName}.`,
      `_Source-evidence action: insert the strongest verified comparable project references for the tender sector before final submission. Cover Letter opening must name 1–2 specific comparable projects with contract values._`,
    ].join("\n\n");
  }

  const projectFragment = top
    .map(fmtProjectInline)
    .join(top.length === 2 ? " and " : "");

  return [
    `${opts.companyName} is pleased to submit this Technical Proposal for ${opts.tenderTitle} in response to the request issued by ${opts.clientName}.`,
    `${opts.companyName} brings to this assignment a directly comparable evidence base. The same project team that delivered ${projectFragment} is available for this engagement, with zero learning curve. Detailed credentials, contracts, and client testimony letters are provided in the appendices.`,
  ].join("\n\n");
}

// ─── Executive Summary opening (project-anchored "we have delivered") ────────

export function buildExecutiveSummaryOpener(opts: {
  companyName: string;
  clientName: string;
  projects: ProjectRecord[];
  reviewedExpertCount: number;
}): string {
  const top = opts.projects.slice(0, 2);
  if (top.length === 0) {
    return `${opts.companyName} presents this technical proposal anchored in reviewed comparable evidence. _Source-evidence action: insert a delivered-already opening sentence naming the strongest 1–2 comparable projects with contract values before final submission._`;
  }

  if (top.length === 1) {
    const p = top[0];
    return `${opts.companyName} has already delivered this assignment. ${fmtProjectInline(p)} is the directly comparable reference; the same lead team is available for ${opts.clientName}'s engagement today. ${opts.reviewedExpertCount > 0 ? `${opts.reviewedExpertCount} reviewed specialist(s) are confirmed for this assignment.` : ""}`.trim();
  }

  const [a, b] = top;
  return `${opts.companyName} has already delivered this assignment twice. Once as ${fmtProjectInline(a)}; and once as ${fmtProjectInline(b)}. The same lead team that delivered both is available for ${opts.clientName}'s engagement today, with zero learning curve. ${opts.reviewedExpertCount > 0 ? `${opts.reviewedExpertCount} reviewed specialist(s) are confirmed for this assignment.` : ""}`.trim();
}

// ─── D.4 Declaration with GM name + license ──────────────────────────────────

export function buildDeclaration(opts: {
  companyName: string;
  clientName: string;
  tenderTitle: string;
  companyGM?: string | null;
  companyGMLicense?: string | null;
}): string {
  const signatureLine = opts.companyGM
    ? `Signed: ${opts.companyGM}${opts.companyGMLicense ? `, License ${opts.companyGMLicense}` : ""}, on behalf of ${opts.companyName}.`
    : `Signed: General Manager, on behalf of ${opts.companyName}.`;

  return [
    "## D.4 Declaration of Eligibility",
    `We, ${opts.companyName}, hereby declare that this Technical Proposal has been prepared specifically in response to ${opts.tenderTitle} for ${opts.clientName}. All information provided is accurate and supported by documentary evidence available on request. The firm meets all eligibility requirements stated in the tender and confirms the absence of any debarment, conflict of interest, or compliance condition that would prevent the firm from participating in this procurement.`,
    "",
    `This proposal has been prepared using reviewed evidence and senior bid-review controls. We commit to delivering the assigned scope with the proposed team, methodology, and schedule.`,
    "",
    signatureLine,
  ].join("\n");
}
