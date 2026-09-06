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
  } else if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a power-systems partner who brings load-flow analytical rigour, grid-code compliance depth, protection relay coordination expertise, and SCADA integration capability — not only civil and structural design. Yield estimates must use validated multi-year resource data; protection settings must survive utility interconnection review; and commissioning must be managed through FAT/SAT protocols to get the facility energised on time.`;
  } else if (/agri|irrigation|wua|command.*area|rural.*develop/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires an irrigation and rural development partner who combines hydrological rigour, agronomic field knowledge, community mobilisation capability, and water-user association (WUA) governance expertise. A scheme designed without primary hydrological data or without a viable WUA governance model risks under-use or failure after handover — regardless of civil engineering quality.`;
  } else if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a mining consultancy partner who brings JORC-compliant resource reporting, geotechnical rigour for pit and underground design, TSF engineering to MAC/ANCOLD standards, and a closure plan with financial provision. Resource estimates that fail independent competent-person review, or TSF designs that don't meet dam safety criteria, expose the project to regulatory delay, investor withdrawal, and safety risk.`;
  } else if (/port|berth|quay|maritime|dredging|harbour/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a port engineering partner who can integrate met-ocean analysis, nautical simulation, geotechnical investigation, berth structural design, dredge management, and ISPS compliance into a single coherent delivery. A berth designed without validated met-ocean data or without a nautical simulation confirming safe vessel manoeuvring will fail at the pre-operations safety review — delaying commercial operations and triggering redesign costs.`;
  } else if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a process engineering partner who brings HAZOP facilitation capability, P&ID development rigour, pipeline stress analysis, and pipeline integrity management planning — not only civil and structural design. Outstanding HAZOP actions, undocumented P&IDs, and under-specified cathodic protection are the three most common causes of late-stage safety incidents and regulatory enforcement actions in this sector.`;
  } else if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a financial-services advisory partner who combines regulatory gap analysis reviewed by licensed local legal counsel, system architecture aligned to applicable standards (KYC/AML, Basel, IFRS), and a disciplined parallel-run cutover methodology. Systems that go live before regulatory compliance is confirmed, or without a validated rollback plan, create audit findings, regulatory enforcement risk, and reputational damage that outweigh the cost of the implementation itself.`;
  } else if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(sector)) {
    sectorParagraph =
      `${opts.clientName} requires a telecoms engineering partner who brings spectrum licensing expertise, calibrated RF coverage simulation, backhaul design rigour, and a site-acceptance test protocol that gives commercial confidence before launch. Coverage that underperforms against simulation, backhaul that saturates at peak load, or spectrum not licensed in time to support the rollout date are the three most common value-destroying outcomes in broadband network programmes.`;
  } else {
    sectorParagraph =
      `${opts.clientName} requires a disciplined consultancy partner who maps each scope item to a deliverable, a responsible expert, and a quality gate. This proposal therefore demonstrates scope understanding through evidence rather than generic capability statements.`;
  }

  // "The winning proposal must demonstrate..." is the bid desk telling itself
  // what it takes to win, written in the second person about a document the
  // reader is already holding. The commitment underneath it — every criterion
  // answered with a named, checkable evidence anchor — is exactly what an
  // evaluator wants to read, so it is now stated as what this proposal does.
  const evaluatorAnchor = opts.evaluationCriteria.length > 0
    ? `For each evaluation criterion, this proposal gives a specific evidence anchor (named project, expert, license, certification, or institutional capability). The evaluation criteria stated for this assignment are addressed below in Section C.2 (Technical Methodology), Section A.4 (Proposed Project Team), Section B (Relevant Experience), and Section D.1 (Value Framework).`
    : `For each scope item, this proposal gives a specific evidence anchor (named project, expert, license, certification, or institutional capability) drawn from the firm's reviewed records.`;

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
  else if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(sector)) bullets = [
    `**HOMER / SAM energy-yield model handed to client** — client retains the validated yield model for future tariff negotiations, extension planning, and lender reporting without re-engaging the designer.`,
    `**Grid-code compliance pre-check** — review of protection relay settings against utility interconnection requirements before submission, reducing rejection risk.`,
    `**Operator training programme** — structured training for client operators covering SCADA operation, protection relay maintenance, and emergency shutdown procedures, included at handover.`,
    `**Remote SCADA commissioning support** — remote diagnostics available during the defects-liability period to resolve operational faults without on-site mobilisation.`,
    `**Climate-resilience yield sensitivity analysis** — yield estimates tested against 30-year climate-scenario projections to confirm design-life performance.`,
  ];
  else if (/agri|irrigation|wua|command.*area|rural.*develop/.test(sector)) bullets = [
    `**WUA governance toolkit** — constitution template, water-allocation rule book, and fee-collection record system handed to the water-user association at commissioning.`,
    `**Farmer training programme** — structured on-farm training covering irrigation scheduling, field application efficiency, and crop-calendar alignment, included as a handover deliverable.`,
    `**Agronomy productivity baseline** — pre-scheme baseline recorded for lender and grant-reporting purposes; post-handover monitoring framework included.`,
    `**Operation and maintenance cost model** — annual O&M cost estimate handed to WUA to support fee-setting and maintenance planning without returning to designer.`,
    `**Digital soil-moisture advisory** — low-cost IoT soil-moisture monitoring option proposed for WUA to support evidence-based irrigation scheduling.`,
  ];
  else if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(sector)) bullets = [
    `**3-D geological block model in open-source format** — client retains the full resource model (Leapfrog / QGIS) for future exploration cycles without re-engaging the geologist.`,
    `**Geotechnical instrumentation programme** — slope and TSF monitoring instruments specified and installed with data-management handover to mine operator.`,
    `**Closure plan with financial provision estimate** — prepared at feasibility stage, not deferred; supports environmental permitting and lender due diligence from the outset.`,
    `**JORC competent-person peer review** — independent competent-person review of resource estimate included before report issue; reduces investor scrutiny risk.`,
    `**Environmental permit application package** — regulatory submission package prepared as a project deliverable, reducing permitting timeline.`,
  ];
  else if (/port|berth|quay|maritime|dredging|harbour/.test(sector)) bullets = [
    `**Fast-time nautical simulation report included in handover** — port authority retains safety evidence for future vessel-class upgrades without commissioning a new study.`,
    `**ISPS certification support** — ISPS compliance documentation prepared and pre-certification audit conducted, with port security officer training included.`,
    `**O&M and emergency procedures manual** — berth O&M, fender-maintenance schedule, and emergency response plan handed over at commissioning.`,
    `**Marine ecology monitoring protocol** — turbidity and benthic monitoring protocol handed to the environmental team, meeting permit requirements without re-engaging consultants.`,
    `**Dredge material characterisation database** — sediment characterisation records retained by client for future dredge campaigns without re-testing.`,
  ];
  else if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(sector)) bullets = [
    `**Digital P&ID database handed to client** — intelligent P&ID (SmartPlant / AVEVA or equivalent) for future HAZOP revalidation, management of change, and maintenance planning.`,
    `**Pipeline integrity management plan pre-populated** — ILI baseline run schedule and inspection intervals calculated; client asset team enters the integrity lifecycle immediately at handover.`,
    `**HAZOP action register with full close-out evidence** — all HAZOP actions tracked to documented close-out; client retains the risk-reduction evidence for regulator and insurer reviews.`,
    `**Cathodic protection commissioning data pack** — close-interval potential survey (CIPS) baseline records retained by client for future corrosion risk assessments.`,
    `**Emergency shutdown system (ESD) test protocol** — pre-commissioning ESD test records handed over as part of the safety-case documentation.`,
  ];
  else if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(sector)) bullets = [
    `**Regulatory compliance knowledge base** — searchable wiki of applicable regulations, mapped to system controls, handed over as part of the training package.`,
    `**Automated regulatory reporting templates** — Basel, IFRS, or AML return templates pre-validated against regulator's published format; reduces manual reporting effort.`,
    `**Source code escrow** — third-party source code escrow available during warranty period; protects client from vendor lock-in at no additional cost.`,
    `**Penetration test report and remediation evidence** — pre-go-live security review with full remediation evidence; supports regulatory and audit submission.`,
    `**90-day post-go-live hypercare** — named support contact with SLA-defined response times for 90 days after go-live; included in the engagement scope.`,
  ];
  else if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(sector)) bullets = [
    `**Frequency planning tool handed to spectrum team** — reduces spectrum re-planning cycle from weeks to hours; supports future technology upgrade (LTE → 5G NR) without re-engaging the frequency planner.`,
    `**Drive-test data archive** — post-commissioning drive-test data handed to the network operations team as a coverage baseline for future comparative measurement campaigns.`,
    `**Site acquisition checklist and permit tracker** — town-planning, landlord, and environmental permit tracker handed to client's rollout team to manage the remaining site acquisition pipeline.`,
    `**Live network KPI dashboard** — operational dashboard covering coverage, capacity, and fault KPIs, integrated with client NOC from commissioning day.`,
    `**EMR certificate registry** — all site EMR certificates filed in a structured registry; supports regulator and public-interest queries without re-measurement.`,
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

export interface CompanyRecordForCertification {
  title?: string | null;
  recordType?: string | null;
  complianceType?: string | null;
  authority?: string | null;
  referenceNumber?: string | null;
  status?: string | null;
}

export function buildCertificationsSection(opts: {
  experts: ExpertRecord[];
  companyName: string;
  legalRecords?: CompanyRecordForCertification[];
  complianceRecords?: CompanyRecordForCertification[];
}): string {
  const allCerts = new Set<string>();
  for (const expert of opts.experts) {
    safeArr(expert.certifications).forEach((c) => {
      if (c.length > 2) allCerts.add(c);
    });
  }
  const sortedCerts = Array.from(allCerts).sort();

  if (sortedCerts.length > 0) {
    return [
      "## D.3 Professional Certifications and Affiliations",
      `${opts.companyName} maintains documented professional certifications and registrations across the proposed team. Original certificates are attached as Appendix C alongside the curricula vitae.`,
      "",
      "| Certification / License / Registration |",
      "|---|",
      ...sortedCerts.map((c) => `| ${c.replace(/\|/g, "/")} |`),
    ].join("\n");
  }

  // No expert record carries certifications. This used to emit the heading over
  // an internal "Source-evidence action: ensure each reviewed expert record
  // carries …" note; the internal-content stripper removed the note, the
  // structure seal then dropped the heading with nothing under it, and the
  // delivered proposal had no certifications section at all — a gap an
  // evaluator scoring compliance notices immediately.
  //
  // The firm's own certifications are held as reviewed legal and compliance
  // records — PPA supplier registration, tax clearance, competency certificate,
  // quality-management manual — and A.3 already prints them. D.3 is where an
  // evaluator looks for them, so the section is composed from the same records
  // rather than left absent. Nothing is invented: each row is one reviewed
  // record, with the reference number it carries.
  const corporate = [...(opts.legalRecords ?? []), ...(opts.complianceRecords ?? [])]
    .filter((record) => (record.title ?? "").trim().length > 2)
    .slice(0, 12);

  if (corporate.length === 0) return "";

  return [
    "## D.3 Professional Certifications and Affiliations",
    `${opts.companyName} holds the following registrations, certifications and compliance records. Copies are attached as Appendix A alongside the company registration documents.`,
    "",
    "| Certification / License / Registration | Type | Reference | Status |",
    "|---|---|---|---|",
    ...corporate.map((record) => {
      const cell = (value?: string | null) => (value ?? "").replace(/\|/g, "/").trim() || "—";
      return `| ${cell(record.title)} | ${cell(record.recordType ?? record.complianceType)} | ${cell(record.referenceNumber)} | ${cell(record.status)} |`;
    }),
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
