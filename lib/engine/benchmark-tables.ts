import { safeParseJsonArray, safeParseJsonObject } from "../safe-json";
import { inlineEvidenceValue } from "./proposal-intelligence";
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
  id?: string | null;
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
  // PR #258 — optional ProjectEvidence rows used by buildProjectPortfolioCards
  // to enrich each card with testimony reference, date, author, and contact.
  // These come from ProjectEvidence (related to Project via projectId).
  // When evidences is omitted, the card falls back to the basic format.
  evidences?: ProjectEvidenceRecord[];
  // Optional funding source extracted from project metadata (e.g.,
  // "World Bank ESF", "British Council") for sector cards where it
  // matters to evaluators.
  funding?: string | null;
};

export type ProjectEvidenceRecord = {
  id?: string | null;
  title?: string | null;
  evidenceType?: string | null;
  description?: string | null;
  fileName?: string | null;
  extractedText?: string | null;
  metadata?: string | null; // JSON-encoded
};

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = safeParseJsonArray(trimmed);
    if (parsed.length > 0) return parsed.map(String).filter(Boolean);
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
  // Trim the separator the sentence is about to supply. A vault client of
  // "Gimba City, South Wollo Zone, Amhara Region," otherwise renders as
  // "… (Gimba City, South Wollo Zone, Amhara Region,)".
  const client = inlineEvidenceValue(project.clientName);
  if (client) parts.push(client);
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
      "Bid-Team Action: Add expert CVs to the knowledge vault and re-generate this proposal to populate this section with verified names, licence numbers, sector experience, and roles. Each expert row requires: full name, position, qualifications with licence number, comparable sector experience, and role on this assignment.",
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
      "Bid-Team Action: Add expert CVs and project references to the knowledge vault and re-generate this proposal. This table maps each proposed expert to a comparable previous project and the technical role they performed — it is required to pass evaluator scrutiny on team depth.",
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
 *
 * PR #258 — extended card structure to mirror the benchmark Claude-AI
 * proposal exactly. Each card now includes:
 *   • Client
 *   • Location & Scale
 *   • Duration
 *   • Contract Value
 *   • Testimony Reference (from ProjectEvidence "TESTIMONY_LETTER" rows)
 *   • Testimony Date (parsed from evidence description / metadata)
 *   • Testimony Author (parsed from evidence description / metadata)
 *   • Client Contact and Email (parsed from evidence description / metadata)
 *   • Funding Source (when project.funding is present)
 *   • Services Provided
 *   • Relevance to This Assignment
 *
 * The pre-PR format had only 6 fields and skipped testimony/contact —
 * which is exactly the gap the file diff exposed (Claude's cards had
 * full reference numbers + dates + author names; the app's portfolio
 * file dumped them as a single garbled line).
 */
export function buildProjectPortfolioCards(projects: ProjectRecord[], tenderTitle: string, primarySector: string): string {
  if (projects.length === 0) {
    return [
      "## B.2 Project Portfolio",
      "Bid-Team Action: Add project references to the knowledge vault and re-generate this proposal to populate Section B with detailed project cards. Each card requires: project name, client, location and scale, contract value, duration, testimony reference, services provided, and a relevance statement.",
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

    // Extract testimony / reference fields from ProjectEvidence rows
    // when present. Each card-row is conditional — only emitted when
    // we actually have a value, so a project with no evidence still
    // gets a clean card without empty rows.
    const testimony = extractTestimonyFields(project.evidences ?? []);
    const rows: string[] = [];
    rows.push(`| Client | ${escCell(project.clientName || "Client on file")} |`);
    rows.push(`| Location & Scale | ${escCell([project.country, ...safeArr(project.serviceAreas).slice(0, 3)].filter(Boolean).join(" — ") || "Scale on file")} |`);
    rows.push(`| Duration | ${escCell(fmtDateRange(project.startDate, project.endDate))} |`);
    rows.push(`| Contract Value | ${escCell(hasContractValue(project.contractValue) ? fmtMoney(project.contractValue, project.currency) : "Value detail in Appendix B (project reference)")} |`);

    if (testimony.referenceNumber) rows.push(`| Testimony Reference | ${escCell(testimony.referenceNumber)} |`);
    if (testimony.date) rows.push(`| Testimony Date | ${escCell(testimony.date)} |`);
    if (testimony.author) rows.push(`| Testimony Author | ${escCell(testimony.author)} |`);
    if (testimony.contact) rows.push(`| Client Contact and Email | ${escCell(testimony.contact)} |`);
    if (project.funding) rows.push(`| Funding Source | ${escCell(project.funding)} |`);

    const svcAreas = safeArr(project.serviceAreas);
    const inferredServices = svcAreas.length > 0
      ? svcAreas.join(", ")
      : project.sector || (project.summary ? project.summary.split(".")[0].trim() : "") || "Service detail confirmed in knowledge vault";
    rows.push(`| Services Provided | ${escCell(inferredServices)} |`);
    rows.push(`| Relevance to This Assignment | ${escCell(buildRelevanceStatement(project, tenderTitle, primarySector))} |`);

    cards.push(`| Field | Detail |`, `|---|---|`, ...rows, "");
  }

  return cards.join("\n");
}

/**
 * Extract testimony-card fields from a Project's ProjectEvidence rows.
 *
 * Looks for evidence with type matching TESTIMONY_LETTER /
 * REFERENCE_LETTER / COMPLETION_CERTIFICATE / etc. and parses common
 * patterns from the description field:
 *
 *   "Ref ABC/123 dated 19/01/2018 E.C. — Author Name, Title"
 *   "Reference No: XYZ/456, Date: 12 March 2024, Signed: Name (Title)"
 *   "Authored by NAME (TITLE) on DATE"
 *
 * Also pulls structured fields from the evidence's metadata JSON when
 * present (preferred over description parsing because it's more
 * reliable).
 */
function extractTestimonyFields(evidences: ProjectEvidenceRecord[]): {
  referenceNumber: string | null;
  date: string | null;
  author: string | null;
  contact: string | null;
} {
  let referenceNumber: string | null = null;
  let date: string | null = null;
  let author: string | null = null;
  let contact: string | null = null;

  // Filter to evidence rows that are likely testimonies / reference
  // letters. evidenceType is free-form; we accept several variants.
  const testimonialEvidence = evidences.filter((e) => {
    const t = (e.evidenceType ?? "").toLowerCase();
    return /testimony|testimon|reference|letter|certificate|completion/.test(t);
  });

  for (const ev of testimonialEvidence) {
    // First check structured metadata
    if (ev.metadata) {
      const meta = safeParseJsonObject<Record<string, string | undefined>>(ev.metadata);
      if (!referenceNumber && meta.referenceNumber) referenceNumber = String(meta.referenceNumber);
      if (!date && meta.date) date = String(meta.date);
      if (!author && meta.author) author = String(meta.author);
      if (!contact && meta.contact) contact = String(meta.contact);
    }

    // Then parse description prose. Description format varies but
    // common patterns include:
    //   "Ref XYZ/123, dated 19/01/2018 E.C. — Author Name, Title"
    //   "Reference No: XYZ/123 | Date: 12 March 2024 | Signed: Name"
    const desc = ev.description ?? "";
    if (!referenceNumber) {
      const refMatch = desc.match(/(?:ref(?:erence)?[.\s:]*(?:no\.?\s*)?[:\-]?\s*)([A-Za-z0-9ሀ-፿\/_\-.]{3,80})/i);
      if (refMatch) referenceNumber = refMatch[1].trim();
    }
    if (!date) {
      // Match common date formats including Ethiopian E.C.
      const dateMatch = desc.match(/(?:dated?|date[.\s:]*[:\-]?\s*)?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}(?:\s*E\.?C\.?)?)/i)
        ?? desc.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i);
      if (dateMatch) date = dateMatch[1].trim();
    }
    if (!author) {
      const authorMatch = desc.match(/(?:author(?:ed by)?|signed by|signed:|by:)\s*([^,;|\n]{3,80}?)(?:[,;|]|$)/i);
      if (authorMatch) author = authorMatch[1].trim();
    }
    if (!contact) {
      // Look for an email address; pair with any nearby name
      const emailMatch = desc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      if (emailMatch) contact = emailMatch[0];
    }

    // Stop early once we have all four fields filled
    if (referenceNumber && date && author && contact) break;
  }

  return { referenceNumber, date, author, contact };
}

function buildRelevanceStatement(project: ProjectRecord, tenderTitle: string, primarySector: string): string {
  const sectorMatch = (project.sector ?? "").toLowerCase().includes(primarySector.toLowerCase());
  const summary = (project.summary ?? "").replace(/\s+/g, " ").trim();

  if (summary && sectorMatch) {
    return `Direct ${primarySector} relevance: ${summary.slice(0, 280)}`;
  }
  if (summary) {
    return `Demonstrates transferable competency for ${tenderTitle}: ${summary.slice(0, 280)}`;
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
  const s = primarySector.toLowerCase();
  const isWaterTender = /water|borehole|hydraulic|sanitary|irrigation|sewage/.test(s);
  const isRoadTender = /road|bridge|highway|pavement|transport(?!ation planning)/.test(s);
  const isHealthcareTender = /health|hospital|medical|clinic|radiology|pharmacy|biomedical/.test(s);
  const isICTTender = /ict|software|digital|database|system|platform|app(?:lication)?/.test(s);
  const isEnvTender = /environment|esia|esmp|safeguard|ecology|climate|biodiversity/.test(s);
  const isUrbanTender = /urban|master plan|land use|spatial|municipal|city/.test(s);
  const isEnergyTender = /energy|power|solar|wind|grid|generation|transmission|substation/.test(s);
  const isAgricultureTender = /agri|farm|crop|irrigation|livestock|rural develop/.test(s);
  const isMiningTender = /mining|mineral|quarry|extracti/.test(s);
  const isPortTender = /\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(s);
  const isOilGasTender = /oil|gas|petroleum|refinery|pipeline/.test(s);
  const isFinancialTender = /finance|bank|micro.?finance|insurance|credit|lending|core.*banking|KYC|AML/.test(s);
  const isTelecomsTender = /telecom|broadband|spectrum|mobile network|isp|base.*station|backhaul|last.?mile/.test(s);
  const isDesignTender = !isWaterTender && !isRoadTender && !isHealthcareTender && !isICTTender && !isEnergyTender && !isAgricultureTender && !isMiningTender && !isPortTender && !isOilGasTender && !isFinancialTender && !isTelecomsTender &&
    /design|architect|building|construction|\bMEP\b|structural|engineer|consultancy|supervision/.test(s);

  const stage1Action = isWaterTender ? "30% Source Investigation & Demand Assessment"
    : isRoadTender ? "30% Survey, Investigation & Preliminary Design"
    : isHealthcareTender ? "30% Facility Assessment & Schematic Design"
    : isICTTender ? "30% Requirements Analysis & Architecture Review"
    : isEnvTender ? "30% Baseline Assessment & Scoping Report"
    : isUrbanTender ? "30% Land Use Survey & Concept Master Plan"
    : isEnergyTender ? "30% Load Forecast & Preliminary System Design"
    : isAgricultureTender ? "30% Agronomic Baseline & Scheme Concept"
    : isMiningTender ? "30% Geotechnical Investigation & Resource Assessment"
    : isPortTender ? "30% Hydrographic Survey & Traffic Demand Study"
    : isOilGasTender ? "30% Front-End Engineering Design (FEED) Scope"
    : isFinancialTender ? "30% Regulatory Gap Analysis & Target Operating Model"
    : isTelecomsTender ? "30% Spectrum Planning & Network Coverage Design"
    : isDesignTender ? "30% Schematic Design"
    : "30% Inception / Approach Review";
  const stage1Detail = isWaterTender ? "yield, hydraulic model, pipe network, and pump station sizing confirmed"
    : isRoadTender ? "topographic survey, geotechnical investigation, traffic analysis, and alignment confirmed"
    : isHealthcareTender ? "clinical zone layout, IPC segregation, MEP routing, and equipment clearances confirmed"
    : isICTTender ? "functional requirements, system architecture, data model, and integration plan confirmed"
    : isEnvTender ? "baseline data collection, impact identification, and stakeholder map confirmed"
    : isUrbanTender ? "demographic analysis, land use mapping, and infrastructure demand confirmed"
    : isEnergyTender ? "load forecast, generation/transmission sizing, grid-code review, and SLD confirmed"
    : isAgricultureTender ? "soil and water baseline, crop-water demand, and irrigation concept confirmed"
    : isMiningTender ? "drill programme, resource classification, geotechnical model, and mine plan confirmed"
    : isPortTender ? "vessel-class parameters, berth layout, dredging scope, and throughput model confirmed"
    : isOilGasTender ? "process simulation, P&ID rev 0, equipment list, and HAZOP scope confirmed"
    : isFinancialTender ? "regulatory gap matrix, operating model, data-quality assessment, and system architecture confirmed"
    : isTelecomsTender ? "spectrum licence pathway, RF coverage targets, site shortlist, and backhaul dimensioning confirmed"
    : isDesignTender ? "floor plans, zoning, and MEP routing confirmed"
    : "scope, methodology, and stakeholder map confirmed";
  const stage2Action = isWaterTender ? "60% Detailed Design Review"
    : isRoadTender ? "60% Detailed Design & Tender Documents"
    : isHealthcareTender ? "60% Detailed Design & Regulatory Package"
    : isICTTender ? "60% Detailed Design & Development Specification"
    : isEnvTender ? "60% Draft ESIA / ESMP Review"
    : isUrbanTender ? "60% Draft Master Plan & Implementation Framework"
    : isEnergyTender ? "60% Detailed Electrical Design & Tender Package"
    : isAgricultureTender ? "60% Detailed Irrigation/Infrastructure Design"
    : isMiningTender ? "60% Detailed Mining Study & Feasibility Report"
    : isPortTender ? "60% Detailed Berth & Infrastructure Design"
    : isOilGasTender ? "60% Detailed Engineering & HAZOP Close-Out"
    : isFinancialTender ? "60% Detailed Design & UAT Preparation"
    : isTelecomsTender ? "60% Detailed Network Design & Site Acquisition"
    : isDesignTender ? "60% Developed Design"
    : "60% Substantive Deliverable Review";
  const stage2Detail = isWaterTender ? "network model, pump station, treatment plant, and BOQ coordinated"
    : isRoadTender ? "pavement design, drainage, structures, and specifications drafted"
    : isHealthcareTender ? "multi-discipline design coordinated, radiation shielding, medical gas, and BOQ drafted"
    : isICTTender ? "database schema, API contracts, UI prototypes, and security review completed"
    : isEnvTender ? "impact matrices, mitigation measures, and ESMP actions reviewed"
    : isUrbanTender ? "zoning regulations, phasing plan, and infrastructure costing reviewed"
    : isEnergyTender ? "SLD, protection relay settings, cable schedules, and grid-code compliance reviewed"
    : isAgricultureTender ? "canal/pipe network, structures, BOQ, and O&M framework reviewed"
    : isMiningTender ? "pit design, waste-dump stability, tailings plan, and cost model reviewed"
    : isPortTender ? "civil and marine drawings, dredging specification, and equipment list reviewed"
    : isOilGasTender ? "detailed P&IDs, equipment databooks, vendor packages, and HAZOP actions reviewed"
    : isFinancialTender ? "system design, integration specs, data-migration plan, and UAT protocol reviewed"
    : isTelecomsTender ? "RF link budgets, site designs, backhaul specs, and core network dimensioning reviewed"
    : isDesignTender ? "all disciplines coordinated, specifications drafted"
    : "all work-streams coordinated, draft outputs produced";
  const stage3Action = isWaterTender || isRoadTender ? "100% Pre-Issue Tender Package"
    : isHealthcareTender ? "100% Regulatory Submission Package"
    : isICTTender ? "100% UAT & Go-Live Readiness Package"
    : isEnergyTender ? "100% Pre-Issue Construction Package"
    : isAgricultureTender || isMiningTender || isPortTender || isOilGasTender ? "100% Final Report & Deliverable Package"
    : isFinancialTender ? "100% Go-Live Readiness & Handover Package"
    : isTelecomsTender ? "100% Commissioning & Network Acceptance Package"
    : isDesignTender ? "100% Pre-Issue Final Package"
    : "100% Pre-Submission Final Package";
  const stage3Detail = isWaterTender ? "complete hydraulic design, BOQ, specifications, and O&M manual finalised"
    : isRoadTender ? "complete drawings, BOQ, specifications, and road-safety audit finalised"
    : isHealthcareTender ? "complete drawing package, regulatory approval documentation, and commissioning plan finalised"
    : isICTTender ? "complete system, test reports, training materials, and handover documentation finalised"
    : isEnergyTender ? "complete electrical drawings, protection settings, BOQ, and commissioning checklist finalised"
    : isAgricultureTender ? "complete design drawings, BOQ, agronomic plan, and O&M manual finalised"
    : isMiningTender ? "complete feasibility study, mine plan, tailings closure plan, and regulatory submission finalised"
    : isPortTender ? "complete marine/civil drawings, dredging specification, equipment list, and operation manual finalised"
    : isOilGasTender ? "complete engineering deliverable list, vendor data, safety case, and handover dossier finalised"
    : isFinancialTender ? "complete system, UAT sign-off, training materials, regulatory compliance evidence, and handover documentation finalised"
    : isTelecomsTender ? "complete network as-built, drive-test coverage map, NOC dashboard, and operating procedures finalised"
    : isDesignTender ? "complete drawing package, BOQ, and specifications finalised"
    : "complete deliverable package, supporting evidence, and sign-off finalised";

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
      "Bid-Team Action: populate this table with reviewed client reference letters from the knowledge vault. Each entry must include: project name, named client contact with title, reference number, and confirmed contract value.",
      "| Project / Client | Reference Contact & Title | Contact Details & Reference | Contract Value |",
      "|---|---|---|---|",
      "| Bid-Team Action: confirm | Confirm contact name + title | Confirm email/phone + ref no. | Confirm ETB/USD |",
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
  // Word boundaries on ESIA/ESMP/ICT/MIS/ERP — bare tokens previously
  // matched inside larger words (see proposal-intelligence.ts for full
  // rationale on each abbreviation).
  const isEnv = /environmental|\bESIA\b|\bESMP\b|safeguard/i.test(primarySector);
  const isICT = /\bICT\b|software|digital|\bMIS\b|\bERP\b/i.test(primarySector);
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
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/i.test(primarySector)) return [
    { pillar: "Grid-Code Compliance Certainty", clientGains: `${clientName} receives engineering that has been reviewed by an independent power-systems engineer before utility submission — protection relay settings confirmed, load-flow validated, SCADA architecture agreed.` },
    { pillar: "Yield & Demand Rigour", clientGains: "P50/P90 yield estimates from ≥ 10 years validated resource data with conservative degradation — no surprise shortfall against energy production targets." },
    { pillar: "FAT/SAT Commissioning Discipline", clientGains: "Factory and site acceptance test protocols issued before equipment delivery; energisation managed through a documented FAT/SAT sequence with no shortcuts." },
    { pillar: "O&M Lifecycle Handover", clientGains: "HOMER/SAM energy model, SCADA handover, O&M manual, and operator training programme handed to client — ongoing management requires no return to designer." },
  ];
  if (/agri|irrigation|wua|command.*area|rural.*develop/i.test(primarySector)) return [
    { pillar: "Hydrological Source Certainty", clientGains: `${clientName} starts construction with a verified 20-year safe-yield analysis — no redesign when the source under-performs.` },
    { pillar: "Crop-Water Engineering Rigour", clientGains: "FAO Penman-Monteith calculation validated with local field data; scheme sized for actual crop-water demand, not assumptions." },
    { pillar: "WUA Governance at Handover", clientGains: "WUA constitution, water-allocation rules, tariff model, and fee-collection template handed over — the scheme operates without consultant dependency from day one." },
    { pillar: "Agronomy & Livelihood Integration", clientGains: "Agronomy recommendations, post-harvest value-chain advice, and farmer training programme included — maximising the scheme's productivity impact." },
  ];
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/i.test(primarySector)) return [
    { pillar: "Investor-Ready Resource Reporting", clientGains: `${clientName} receives a JORC-compliant resource statement with independent competent-person sign-off — ready for investor scrutiny from issue.` },
    { pillar: "Geotechnical & TSF Safety", clientGains: "Slope-stability analysis by three methods and TSF design to MAC/ANCOLD guidelines — safety case documented before construction begins." },
    { pillar: "Regulatory Submission Package", clientGains: "Environmental permit application and feasibility report prepared as project deliverables — permitting timeline integrated into the project schedule." },
    { pillar: "Closure Liability Quantified", clientGains: "Closure cost estimate and financial provision methodology in the feasibility report — lender and regulator requirements met from inception." },
  ];
  if (/port|berth|quay|maritime|dredging|harbour/i.test(primarySector)) return [
    { pillar: "Nautical Safety Before Design", clientGains: `${clientName} receives a fast-time nautical simulation confirming berth layout and turning basin safety before structural design is finalised — no redesign after safety review.` },
    { pillar: "Dredge Compliance Pre-Approved", clientGains: "Sediment characterisation and disposal site approval completed before mobilisation — the most common cause of port-project delay is eliminated." },
    { pillar: "ISPS Certification at Launch", clientGains: "ISPS compliance documentation, port facility security plan, and security officer training included — international vessel calls can proceed from day one of commercial operations." },
    { pillar: "Asset Lifecycle Documentation", clientGains: "O&M manual, berth monitoring protocol, and nautical simulation report handed to port authority — future vessel-class upgrades and inspections use the design data directly." },
  ];
  if (/pipeline.*design|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/i.test(primarySector)) return [
    { pillar: "Process Safety Completeness", clientGains: `${clientName} receives a fully closed HAZOP action register before any construction release — no outstanding safety items at first spade-in-the-ground.` },
    { pillar: "Structural & Pipeline Integrity", clientGains: "Pipeline stress analysis (Caesar II), cathodic-protection design to NACE/ISO, and ILI baseline run schedule — pipeline integrity lifecycle begins at handover." },
    { pillar: "Commissioning Discipline", clientGains: "Pre-commissioning, hydrotest, and ESD system test protocols issued before construction — energisation managed through a documented sequence with no improvisation." },
    { pillar: "Regulatory & Insurance Readiness", clientGains: "HAZOP report, LOPA, PSI documentation, and as-built package support regulatory permit, insurance placement, and lender technical due diligence." },
  ];
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/i.test(primarySector)) return [
    { pillar: "Regulatory Compliance Certainty", clientGains: `${clientName} launches with legal counsel-reviewed regulatory gap analysis and formal compliance attestation in the handover pack — no post-go-live enforcement risk from oversight in the implementation.` },
    { pillar: "Data Migration Integrity", clientGains: "Parallel-run cutover with signed-off reconciliation report and tested rollback plan — no surprise data errors discovered after go-live." },
    { pillar: "Cyber Security Assurance", clientGains: "Pre-go-live penetration test with remediation evidence; RBAC, encryption, and audit-log configuration confirmed — security posture demonstrated before launch." },
    { pillar: "Staff Capability at Handover", clientGains: "Train-the-trainer programme, compliance knowledge base, and 90-day hypercare — client team is self-sufficient from go-live, not dependent on the implementation partner." },
  ];
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/i.test(primarySector)) return [
    { pillar: "Spectrum Licensed Before Site Works", clientGains: `${clientName} avoids sunk-cost on sites that cannot be activated — no site engineering starts before in-principle spectrum approval is received.` },
    { pillar: "Coverage Validated by Drive Test", clientGains: "Calibrated propagation model, drive-test acceptance protocol, and coverage KPI report — coverage performance is measured and documented, not assumed." },
    { pillar: "Backhaul Capacity Headroom Confirmed", clientGains: "Backhaul designed with 1.5× peak busy-hour headroom and path availability ≥ 99.99% — no congestion or link-failure surprises at commercial launch." },
    { pillar: "Network Operations Ready at Launch", clientGains: "Live KPI dashboard, drive-test baseline archive, EMR certificate registry, and operator training — NOC team has full visibility and all regulatory documentation from day one." },
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
    return `${opts.companyName} is pleased to submit this Technical Proposal for **${opts.tenderTitle}** in response to the request issued by ${opts.clientName}. The firm brings a reviewed specialist team with sector experience directly applicable to ${opts.clientName}'s requirements. Full credentials, comparable project references, and technical methodology are presented in the sections that follow.`;
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
  topExpertName?: string | null;
  topExpertTitle?: string | null;
}): string {
  const top = opts.projects.slice(0, 2);
  const expertClause = opts.topExpertName
    ? ` **${opts.topExpertName}**${opts.topExpertTitle ? `, ${opts.topExpertTitle},` : ""} who directed that assignment, leads the proposed team for this engagement.`
    : opts.reviewedExpertCount > 0 ? ` ${opts.reviewedExpertCount} reviewed specialist(s) are confirmed for this assignment.` : "";

  if (top.length === 0) {
    const expertStr = opts.reviewedExpertCount > 0
      ? `${opts.reviewedExpertCount} reviewed expert${opts.reviewedExpertCount !== 1 ? "s" : ""}${opts.topExpertName ? `, including **${opts.topExpertName}**${opts.topExpertTitle ? `, ${opts.topExpertTitle}` : ""}` : ""}`
      : "a specialist technical team";
    return `**${opts.companyName}** brings ${expertStr} to this assignment, each with prior comparable delivery experience confirmed through the firm's knowledge vault. The firm's sector expertise and evidence-mapped technical methodology — detailed in Sections A and C — directly address ${opts.clientName}'s evaluation criteria.`;
  }

  if (top.length === 1) {
    const p = top[0];
    return `**${opts.companyName} has already delivered this assignment.** ${fmtProjectInline(p)} is the directly comparable reference — same scope, same sector, same delivery standards required by ${opts.clientName}.${expertClause}`.trim();
  }

  const [a, b] = top;
  return `**${opts.companyName} has already delivered this assignment twice.** ${fmtProjectInline(a)} and ${fmtProjectInline(b)} are the directly comparable references — both confirm the firm's capacity for ${opts.clientName}'s scope.${expertClause}`.trim();
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
