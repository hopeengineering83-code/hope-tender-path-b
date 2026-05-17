/**
 * Five evaluator-facing additions packaged into one module:
 *
 * - C.1 Understanding of the Assignment (sector-aware)
 * - D.2 Value-Added Services (sector-aware bullets)
 * - D.3 Professional Certifications and Affiliations (aggregated)
 * - A.7 In-House Capabilities (drawn from company assets/evidence)
 * - D.5 Conflict of Interest Declaration
 *
 * All sector-aware and idempotent — they are appended only when no
 * equivalent heading exists in the upstream output.
 */

import type { ExpertRecord } from "./benchmark-tables";

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch { /* fall through */ }
  }
  return trimmed.split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean);
}

// ───────────────────────────────────────────────────────────────────────────
// C.1 Understanding of the Assignment (sector-aware)
// ───────────────────────────────────────────────────────────────────────────

export function buildUnderstandingSection(opts: {
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  evaluationCriteria: string[];
}): string {
  const sector = opts.primarySector.toLowerCase();
  let sectorParagraph: string;

  if (/health|hospital|medical|clinic/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires an end-to-end consultancy partner who brings not only design capability but strategic healthcare thinking: advising on suitable premises before a building is selected, designing a complete facility to Health Authority standards and international quality benchmarks, coordinating all MEP disciplines including medical gas and radiation safety, managing regulatory approvals, and supervising works through to operational readiness. The clinical departments each carry specific spatial, MEP, IPC, and regulatory requirements; a generic building consultancy is not sufficient.`;
  } else if (/water|borehole|hydraulic|sanitary/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a technically integrated water-infrastructure partner: source investigation through hydraulic design, distribution system, treatment, and operational handover. Engineering judgment must balance demand projection, hydraulic resilience, water quality, power and site resilience, environmental safeguards, and long-term operability — not just isolated component sizing.`;
  } else if (/road|bridge|highway|pavement|transport/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a transport-infrastructure partner with disciplined survey, design, supervision, and contract administration capability. Pavement design must respond to actual ESAL traffic loads and CBR-tested subgrade; drainage must withstand the design storm; safety auditing must precede issue. FIDIC contract discipline through construction is essential to control cost and time.`;
  } else if (/environmental|esia|esmp|safeguard/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires safeguard documentation that will be accepted on first submission to the lender or regulator. This means primary-data baselines (not desktop summaries), structured impact assessment with the mitigation hierarchy applied, an ESMP with named institutional responsibilities, a working grievance mechanism, and consultation records that withstand external scrutiny.`;
  } else if (/ict|software|digital|mis|erp/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a delivery partner with disciplined requirements analysis, secure architecture, phased implementation, documented testing and acceptance, and SLA-defined post-deployment support. Without disciplined process, system development drifts in scope, exceeds budget, and fails to land in active use.`;
  } else if (/urban|master plan|municipal/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a planning partner who produces evidence-grounded scenarios, executes multi-stakeholder consultation, and delivers an implementation roadmap that authorities and investors can act on. Without phasing tied to fundable horizons, plans become shelf documents rather than operational frameworks.`;
  } else if (/school|university|campus|education/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a design partner who can balance pupil-ratio compliance, accessibility, climate-responsive design, life-safety, and long-life material specification — within budget. Generic building design without education-specific space programming and pupil-ratio audits creates future operational and regulatory risk.`;
  } else if (/energy|power|solar|wind|grid|generation|transmission/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a power-systems partner who can validate the load forecast, select the optimal generation/transmission configuration, design to grid-code, and supervise construction through to energisation. Under-designed or grid-code non-compliant infrastructure cannot be connected to the national grid without costly retrofit — getting the single-line diagram and protection coordination right at design stage is the critical delivery discipline.`;
  } else if (/agri|irrigation|farm|crop|livestock|rural develop/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a partner who integrates agronomic, hydrological, civil, and community-development expertise into one coherent scheme. Irrigation without an agronomic baseline risks over-application and soil salinity; schemes without water-user association support fail to achieve their productivity potential. Technical design and community capacity-building must be delivered in parallel, not sequentially.`;
  } else if (/mining|mineral|quarry|extracti/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a mining-study partner who can deliver JORC-compliant resource estimation, rigorous geotechnical investigation, and a bankable feasibility study that withstands independent competent-person review. The most common failure mode in mining studies is insufficient geotechnical confidence at pre-feasibility stage, which cascades into slope-instability events and tailings failures at construction — the geotechnical programme must be scoped for the required confidence level from the outset.`;
  } else if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a port-design partner who integrates vessel-simulation, structural engineering, dredging, environmental assessment, and ISPS compliance into a single coordinated deliverable. Port infrastructure designed without proper nautical simulation and met-ocean analysis generates costly post-construction dredging, suboptimal throughput, and vessel incident liability — these risks are designed out at the concept stage, not the construction stage.`;
  } else if (/oil|gas|petroleum|pipeline|refinery|petrochemical/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires an engineering partner who applies rigorous process-safety methodology from FEED through commissioning. HAZOP must precede detailed engineering, not follow it; P&ID freeze discipline is essential to avoid engineering rework; and pipeline integrity management starts at the design specification stage, not after first oil or gas. Regulatory compliance (API, local petroleum authority) must be designed in, not checked at the end.`;
  } else if (/finance|bank|micro.?finance|insurance|credit|lending|investment fund/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a financial-systems partner who can translate regulatory requirements (KYC/AML, Basel, IFRS) into operational frameworks and technology specifications that the supervisory authority will approve. The most common failure is designing policies without corresponding system controls — or configuring systems without aligned policies. Both domains must be developed in lockstep with regulatory validation at each stage.`;
  } else if (/telecom|broadband|spectrum|mobile network|isp/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a telecoms-infrastructure partner who integrates spectrum licensing, RF planning, site acquisition, backhaul dimensioning, and quality-of-service management into a coherent rollout plan. Networks that are licensed but under-designed for backhaul, or that meet coverage targets but fail QoS SLAs, generate regulatory penalty risk and subscriber churn — the engineering must be end-to-end, not piecemeal.`;
  } else {
    sectorParagraph =
      `${opts.clientName} requires a disciplined consultancy partner who maps each scope item to a deliverable, a responsible expert, and a quality gate. The winning proposal must demonstrate scope understanding through evidence, not generic capability statements.`;
  }

  const evaluatorAnchor = opts.evaluationCriteria.length > 0
    ? `The winning proposal must demonstrate, for each evaluation criterion, a specific evidence anchor (named project, expert, license, certification, or institutional capability). The evaluation criteria detected for this assignment are addressed below in Section C.2 (Technical Methodology), Section A.4 (Proposed Project Team), Section B (Relevant Experience), and Section D.1 (Value Framework).`
    : `The winning proposal must demonstrate, for each scope item, a specific evidence anchor (named project, expert, license, certification, or institutional capability) drawn from the firm's reviewed knowledge vault.`;

  return [
    "## C.1 Understanding of the Assignment",
    sectorParagraph,
    "",
    evaluatorAnchor,
  ].join("\n\n");
}

// ───────────────────────────────────────────────────────────────────────────
// D.2 Value-Added Services (sector-aware bullets)
// ───────────────────────────────────────────────────────────────────────────

export function buildValueAddedServices(opts: { primarySector: string; companyName: string }): string {
  const sector = opts.primarySector.toLowerCase();
  let bullets: string[];

  if (/health|hospital|medical|clinic/.test(sector)) bullets = [
    `**Clinical workflow audit** — patient, staff, supply, and waste flow mapping with bottleneck analysis. Provided as a free input to facility design even when not explicitly requested.`,
    `**Medical equipment readiness review** — coordination with biomedical specialist on equipment-power, shielding, and gas requirements before procurement decisions are taken, reducing late-stage retrofit costs.`,
    `**Health Authority licensing pre-check** — pre-submission internal review of design package against current Health Authority licensing checklist, included as a project deliverable.`,
    `**O&M training pack** — facility operator training materials provided at handover, including HVAC operation, medical-gas system operation, and IPC protocol enforcement.`,
    `**Post-occupancy evaluation** — six-month post-occupancy audit (workflow, IPC compliance, HVAC performance) offered as an optional extension for continuous improvement.`,
  ];
  else if (/water|borehole|hydraulic|sanitary/.test(sector)) bullets = [
    `**Source protection plan** — sanitary protection zone establishment with monitoring and land-use restriction recommendations beyond the minimum regulatory requirement.`,
    `**Operator training and capacity-building** — train-the-trainer programme, operator manuals, and refresher training schedule included with handover.`,
    `**Community engagement** — willingness-to-pay survey, tariff-design support, and community water-management committee setup included where relevant.`,
    `**Lifecycle cost analysis** — present-value comparison of design alternatives, helping the client choose long-life rather than lowest-first-cost options.`,
    `**Performance monitoring framework** — leakage, pressure, and water-quality monitoring with flag thresholds and escalation paths.`,
  ];
  else if (/road|bridge|highway|pavement|transport/.test(sector)) bullets = [
    `**Road safety audit** — independent road safety audit before issue of working drawings, beyond the minimum regulatory requirement.`,
    `**Maintenance manual** — pavement and structures maintenance manual handed over at completion, with monitoring frequencies and rehabilitation triggers.`,
    `**Drone-based progress monitoring** — periodic drone surveys for as-built verification and progress reporting.`,
    `**Lifecycle cost analysis** — pavement-alternative comparison over the design life to support the cost-effective option, not just the lowest first cost.`,
    `**Climate resilience review** — design assumptions checked against projected climate-change impacts on rainfall and temperature.`,
  ];
  else if (/environmental|esia|esmp|safeguard/.test(sector)) bullets = [
    `**Stakeholder digital disclosure** — public-facing disclosure portal for ESIA, ESMP, and grievance records, beyond the minimum regulatory requirement.`,
    `**ESMP audit-readiness pack** — pre-built audit response template covering monitoring evidence, corrective actions, and grievance log.`,
    `**Capacity-building for client institution** — training for the client's environmental and social safeguard officers on ESMP implementation.`,
    `**Climate vulnerability screening** — integrated into baseline assessment without additional cost.`,
    `**Independent peer review** — pre-submission peer review by a second senior ESIA practitioner.`,
  ];
  else if (/ict|software|digital|mis|erp/.test(sector)) bullets = [
    `**API contract documentation** — versioned, machine-readable API contracts (OpenAPI / equivalent) handed over with the system.`,
    `**Source-code escrow** — third-party source-code escrow available at no extra cost during the warranty period.`,
    `**Cybersecurity baseline** — pre-go-live penetration test and remediation report included.`,
    `**Knowledge-transfer programme** — train-the-trainer programme plus a 90-day post-go-live mentoring window.`,
    `**Performance-monitoring dashboards** — operational dashboards covering uptime, response time, and incident throughput, included from go-live.`,
  ];
  else if (/urban|master plan|municipal/.test(sector)) bullets = [
    `**Implementation funding strategy** — municipal funding-source mapping (own revenue, donor, PPP) tied to phasing strategy.`,
    `**Stakeholder digital disclosure portal** — public-facing portal for plan, consultation records, and grievance submissions.`,
    `**Capacity-building for municipal counterpart** — operational training for the municipality's planning office on plan implementation, monitoring, and revision cycles.`,
    `**Climate adaptation overlay** — resilience scenarios overlaid on the master plan at no extra cost.`,
    `**Investment-pipeline summary** — bankable-project summary aimed at supporting donor and PPP outreach.`,
  ];
  else if (/school|university|campus|education/.test(sector)) bullets = [
    `**Operations and maintenance manual** — building-O&M plus user-facing facilities-management guide handed over at completion.`,
    `**Stakeholder workshops** — design workshops with educators, students, and parents during conceptual stage.`,
    `**Climate-responsive performance monitoring** — six-month post-occupancy monitoring of thermal comfort, daylighting, and ventilation performance.`,
    `**Accessibility audit** — independent accessibility audit at design and at handover stage.`,
    `**Lifecycle cost analysis** — long-life-versus-low-cost alternative comparison.`,
  ];
  else if (/energy|power|solar|wind|grid|generation|transmission/.test(sector)) bullets = [
    `**Grid-code compliance pre-check** — in-house protection-coordination review against the national grid code before energisation, at no extra cost.`,
    `**SCADA configuration support** — commissioning of the SCADA monitoring dashboard and KPI baseline measurement at handover.`,
    `**Energy audit** — post-commissioning energy-audit of generation and distribution efficiency included, identifying losses for operational improvement.`,
    `**Lifecycle cost analysis** — present-value comparison of technology options (e.g., diesel vs. solar-hybrid vs. grid extension) to support the most cost-effective decision.`,
    `**O&M manual and operator training** — structured operator training programme and O&M manual in the operating language of the client's technical staff.`,
  ];
  else if (/agri|irrigation|farm|crop|livestock|rural develop/.test(sector)) bullets = [
    `**Agronomic monitoring plan** — crop-yield and soil-quality monitoring schedule for two growing seasons post-commissioning, included in handover package.`,
    `**Water-user association handbook** — WUA constitution, governance procedures, fee-collection guide, and maintenance responsibility matrix.`,
    `**Value-chain linkage support** — market-linkage identification for priority crops; buyers and off-take agreement templates included.`,
    `**Climate-adaptive crop calendar** — adjusted planting calendar with drought-resilient variety recommendations based on local climate projections.`,
    `**Photo-monitoring protocol** — standardised photo-monitoring schedule for evidence of scheme performance; supports donor reporting.`,
  ];
  else if (/mining|mineral|quarry|extracti/.test(sector)) bullets = [
    `**Independent competent-person review** — JORC CP sign-off on the resource estimate included as part of the feasibility package.`,
    `**Geotechnical monitoring programme** — slope-monitoring instrument specification and threshold-alert protocol for ongoing operations.`,
    `**Community liaison framework** — community engagement plan, local-employment strategy, and grievance mechanism design included.`,
    `**Closure liability estimate** — indicative financial provisioning for mine closure and rehabilitation, prepared to ANCOLD / IFC standards.`,
    `**Regulatory-submission-ready package** — licence application documents formatted for the national mining authority's submission template.`,
  ];
  else if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(sector)) bullets = [
    `**Nautical simulation report** — vessel-manoeuvring simulation at design stage; findings fed into berth geometry and pilotage procedures.`,
    `**Environmental monitoring plan** — dredging turbidity monitoring and spill-response protocol, included as construction-phase deliverable.`,
    `**Port operations manual** — vessel scheduling, gate procedures, and emergency-response plan prepared and handed over at commissioning.`,
    `**ISPS compliance audit** — pre-opening International Ship and Port Facility Security Code audit, with action register.`,
    `**Throughput sensitivity analysis** — three-scenario throughput model (base, optimistic, stressed) to test infrastructure adequacy.`,
  ];
  else if (/oil|gas|petroleum|pipeline|refinery|petrochemical/.test(sector)) bullets = [
    `**HAZOP action register** — all HAZOP actions tracked to close-out and included in the safety case handed over at commissioning.`,
    `**Pipeline integrity management plan** — ILI run planning, cathodic protection monitoring, and anomaly-response protocol included at handover.`,
    `**HSE statistics baseline** — pre-commissioning safety-performance baseline established, with KPI monitoring protocol for the operator.`,
    `**Commissioning and start-up procedure** — step-by-step commissioning procedures, pre-start-up safety review (PSSR) checklist, and emergency shutdown drill protocol.`,
    `**As-built P&ID set** — fully updated P&IDs at IFC-as-built status handed over with material certificates and inspection data books.`,
  ];
  else if (/finance|bank|micro.?finance|insurance|credit|lending|investment fund/.test(sector)) bullets = [
    `**Regulatory sandbox engagement** — facilitated engagement with the supervisory authority during the pilot phase to resolve ambiguities before full deployment.`,
    `**AML transaction-monitoring tuning** — rule-set calibration workshop post-go-live to reduce false-positive rates and maintain detection effectiveness.`,
    `**Data migration reconciliation report** — signed reconciliation between source-system balances and migrated data, provided before go-live.`,
    `**Staff e-learning modules** — digital compliance training modules (KYC, AML, credit policy) hosted on the client's LMS at no extra cost.`,
    `**Post-implementation compliance audit** — 90-day post-go-live audit against the supervisory authority's examination checklist.`,
  ];
  else if (/telecom|broadband|spectrum|mobile network|isp/.test(sector)) bullets = [
    `**Coverage and capacity dashboard** — live coverage heat-map and KPI dashboard handed over at go-live for ongoing network management.`,
    `**Frequency coordination report** — documented interference analysis and mitigation plan submitted to the regulator as part of the licence application.`,
    `**Network-sharing feasibility note** — assessment of infrastructure-sharing opportunities (tower, backhaul, spectrum) that could reduce capital costs.`,
    `**QoS SLA baseline measurement** — independent KPI baseline measurement at go-live, establishing the benchmark for SLA compliance monitoring.`,
    `**Optimisation roadmap** — post-launch 12-month network-optimisation roadmap covering coverage gaps, capacity hot-spots, and handover parameter tuning.`,
  ];
  else bullets = [
    `**Three-stage internal review** — schematic, developed, pre-issue review by named senior reviewers, beyond the contractual deliverable scope.`,
    `**Source-evidence verification on every claim** — every named project, expert, certification, or capability is verified against original source evidence in the firm's vault before publication.`,
    `**Final compliance pass** — pre-submission compliance audit against the tender's exact file naming, ordering, and format rules.`,
    `**Documented institutional knowledge** — handover documentation including process maps, decision records, and lessons learned.`,
    `**Post-handover advisory** — 30-day post-handover advisory window at no extra cost.`,
  ];

  return [
    "## D.2 Value-Added Services",
    `Beyond the minimum scope, ${opts.companyName} brings the following capabilities at no additional charge:`,
    "",
    ...bullets.map((b) => `- ${b}`),
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// D.3 Professional Certifications and Affiliations (aggregated from experts)
// ───────────────────────────────────────────────────────────────────────────

export function buildCertificationsSection(opts: { experts: ExpertRecord[]; companyName: string }): string {
  const allCerts = new Set<string>();
  for (const expert of opts.experts) {
    safeArr(expert.certifications).forEach((c) => {
      if (c.length > 2) allCerts.add(c);
    });
  }
  const sortedCerts = Array.from(allCerts).sort();

  if (sortedCerts.length === 0) {
    return [
      "## D.3 Professional Certifications and Affiliations",
      `_Source-evidence action: ensure each reviewed expert record carries the full list of professional certifications, licenses, and registrations before final submission._`,
    ].join("\n\n");
  }

  return [
    "## D.3 Professional Certifications and Affiliations",
    `${opts.companyName} maintains documented professional certifications and registrations across the proposed team. Original certificates are attached as Appendix C alongside the curricula vitae.`,
    "",
    "| Certification / License / Registration |",
    "|---|",
    ...sortedCerts.map((c) => `| ${c.replace(/\|/g, "/")} |`),
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// A.7 In-House Capabilities (from company evidence)
// ───────────────────────────────────────────────────────────────────────────

export function buildInHouseCapabilitiesSection(opts: {
  companyName: string;
  serviceLines: string[];
  sectors: string[];
  evidenceLines: string[];
}): string {
  const capabilities: string[] = [];
  const allText = opts.evidenceLines.join("\n").toLowerCase();

  // Detect capability signals from evidence text
  if (/drilling rig|drill.*depth|geotechnical.*lab/i.test(allText)) {
    capabilities.push("**In-house geotechnical capability** — drilling rigs and laboratory testing, eliminating sub-contractor coordination delays at site assessment stage.");
  }
  if (/iso 9001|iso 45001|quality management system|qms/i.test(allText)) {
    capabilities.push("**Quality Management System** — ISO 9001:2015-aligned QMS with documented design-review gates, document control, and audit trail.");
  }
  if (/environmental.*management|ems|iso 14001/i.test(allText)) {
    capabilities.push("**Environmental Management System** — ISO 14001-aligned EMS or equivalent, supporting donor-grade environmental compliance.");
  }
  if (/fidic|world bank|undp|usaid|british council/i.test(allText)) {
    capabilities.push("**International institutional delivery track record** — projects delivered to FIDIC and donor-standard documentation rules.");
  }
  if (/proprietary|in-house.*platform|custom.*platform|project management.*platform/i.test(allText)) {
    capabilities.push("**Proprietary project management platform** — drawing register, approval workflow tracking, and progress reporting in client-compatible formats.");
  }
  if (/permanent.*staff|employees|in-house.*team/i.test(allText)) {
    capabilities.push("**Permanent in-house team** — proposed experts are permanent staff, not sub-consultants — ensuring continuity from feasibility to handover.");
  }
  // Service-line capabilities
  if (opts.serviceLines.length > 0) {
    capabilities.push(`**Multi-disciplinary service line coverage** — ${opts.serviceLines.slice(0, 6).join(", ")}.`);
  }
  // Sector capabilities
  if (opts.sectors.length > 0) {
    capabilities.push(`**Sector experience breadth** — ${opts.sectors.slice(0, 6).join(", ")}.`);
  }

  if (capabilities.length === 0) {
    return [
      "## A.7 In-House Capabilities",
      "_Source-evidence action: complete the company profile and evidence vault (service lines, sectors, certifications, in-house equipment) before final submission so this section can be fully populated._",
    ].join("\n\n");
  }

  return [
    "## A.7 In-House Capabilities",
    `${opts.companyName} brings the following in-house capabilities to this assignment, eliminating sub-contractor delay risk and supporting institutional documentation discipline.`,
    "",
    ...capabilities.map((c) => `- ${c}`),
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// D.5 Conflict of Interest Declaration
// ───────────────────────────────────────────────────────────────────────────

export function buildConflictOfInterestSection(opts: { companyName: string; clientName: string; tenderTitle: string }): string {
  return [
    "## D.5 Declaration of No Conflict of Interest",
    `${opts.companyName} declares that, as of the submission date of this proposal for ${opts.tenderTitle}:`,
    "",
    `- The firm has no current contractual or commercial relationship with ${opts.clientName} that would constitute a conflict of interest with the impartial delivery of this assignment.`,
    `- The proposed team members have not participated in the drafting of this tender's specifications, evaluation criteria, or terms of reference.`,
    `- The firm and its proposed team members are not under any current debarment, suspension, sanction, or compliance condition imposed by any government, multilateral institution, or industry regulator.`,
    `- The firm will disclose, immediately and in writing, any change to the above during the course of this engagement.`,
    "",
    `This declaration is made in good faith and is supported by documentary evidence available on request.`,
  ].join("\n");
}
