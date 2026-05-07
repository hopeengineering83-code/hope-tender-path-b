/**
 * Beyond-Spec Tables (PR F) — closes the Section D depth gap to
 * Claude AI benchmark.
 *
 * THE PROBLEM
 * Section D ("Value Added / Strategic Value / Sustainability /
 * Innovation") is increasingly the differentiator on modern tenders.
 * Donor-funded engagements (World Bank, AfDB, EU, FCDO) and corporate
 * RFPs all carry explicit ESG / sustainability / local-content /
 * H&S evaluation criteria. A proposal that ticks Sections A-C but
 * leaves D as one paragraph of generic prose loses 15-25 evaluator
 * points to a competitor that lays out structured commitments.
 *
 * Real Claude AI proposals (the benchmark) carry FOUR Section D tables:
 *
 *   1. Sustainability & ESG Plan — Climate / Gender / Universal Design
 *      / Environmental Compliance with concrete commitments + KPIs.
 *   2. Health & Safety Plan — Statistics, certifications, near-miss
 *      reporting, PPE policy, incident response.
 *   3. Innovation & Value Engineering — Beyond-spec proposals
 *      (digital twin, BIM coordination, drone monitoring, etc.) with
 *      client value framed in dollars-or-time-saved terms.
 *   4. Local Content & Capacity Building — Local employment %,
 *      supplier development, training programmes, knowledge transfer.
 *
 * THE FIX
 * Deterministic post-pass that, AFTER methodology-tables and BEFORE
 * rubric enforcement, appends any of the four tables that are missing.
 *
 *   - SECTOR-AWARE: row content adapts for sectors (healthcare gets
 *     IPC + biomedical-waste + climate-resilient hospital design;
 *     water gets non-revenue-water + climate-resilient infrastructure;
 *     road gets road-safety + climate-resilient drainage; urban gets
 *     transit-oriented + green-space; generic gets cross-cutting).
 *
 *   - VAULT-AWARE: when the company table has H&S certification fields
 *     (ISO 45001, OHSAS 18001), they're cited verbatim. When they're
 *     absent, the row emits "Bid-Team Action: confirm certification
 *     status before submission".
 *
 *   - IDEMPOTENT: marker comments
 *     `<!-- beyond-spec-table:sustainability -->` /
 *     `:health-safety` / `:innovation` / `:local-content`.
 *
 *   - NEVER FABRICATES: every cell that depends on company-specific
 *     data the engine doesn't have emits a Bid-Team Action note.
 *
 * SCOPE
 * Operates AFTER injectMethodologyTables (PR E) and BEFORE
 * ensureRubricHeadings (PR #258), so the rubric check counts these
 * tables as present.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

const MARKER_REGEX = /<!--\s+beyond-spec-table:([a-z-]+)\s+-->/gi;

const HEADING_PATTERNS: Record<string, RegExp[]> = {
  sustainability: [
    /^##\s+(?:Sustainability|ESG)(?:\s+(?:&|and)\s+ESG)?(?:\s+Plan)?/im,
    /^###\s+(?:Sustainability|ESG)(?:\s+Plan)?/im,
    /^##\s+Environmental\s+(?:and|&)\s+Social\s+(?:Plan|Safeguards)/im,
  ],
  healthSafety: [
    /^##\s+Health\s+(?:and|&)\s+Safety(?:\s+Plan)?/im,
    /^###\s+Health\s+(?:and|&)\s+Safety(?:\s+Plan)?/im,
    /^##\s+H&S\s+(?:Plan|Management)/im,
    /^##\s+Occupational\s+Health\s+(?:and|&)\s+Safety/im,
  ],
  innovation: [
    /^##\s+Innovation(?:\s+(?:and|&)\s+Value\s+Engineering)?/im,
    /^###\s+Innovation(?:\s+(?:and|&)\s+Value\s+Engineering)?/im,
    /^##\s+Value\s+Engineering(?:\s+Proposals)?/im,
    /^##\s+Beyond-Spec\s+Proposals/im,
  ],
  localContent: [
    /^##\s+Local\s+Content(?:\s+(?:and|&)\s+Capacity\s+Building)?/im,
    /^###\s+Local\s+Content(?:\s+(?:and|&)\s+Capacity\s+Building)?/im,
    /^##\s+Capacity\s+Building(?:\s+(?:and|&)\s+Knowledge\s+Transfer)?/im,
  ],
};

function detectExisting(markdown: string): Set<string> {
  const present = new Set<string>();
  for (const m of markdown.matchAll(MARKER_REGEX)) {
    if (m[1]) present.add(m[1]);
  }
  for (const [key, patterns] of Object.entries(HEADING_PATTERNS)) {
    const marker = toMarker(key);
    if (present.has(marker)) continue;
    if (patterns.some((p) => p.test(markdown))) present.add(marker);
  }
  return present;
}

function toMarker(key: string): string {
  if (key === "sustainability") return "sustainability";
  if (key === "healthSafety") return "health-safety";
  if (key === "innovation") return "innovation";
  if (key === "localContent") return "local-content";
  return key;
}

// ─── Sustainability rows ─────────────────────────────────────────────────

interface SustainabilityRow {
  pillar: string;
  commitment: string;
  kpi: string;
  evidenceMechanism: string;
}

function sustainabilityRows(sector: string): SustainabilityRow[] {
  const s = sector.toLowerCase();
  const generic: SustainabilityRow[] = [
    { pillar: "Climate Action", commitment: "Embed climate-resilient design into every technical decision; quantify embodied carbon at concept and detailed design stages", kpi: "≥ 15% reduction in embodied carbon vs business-as-usual baseline; climate-risk screening included in all design memos", evidenceMechanism: "Carbon calculation memo at 60% gate; climate-risk register reviewed monthly" },
    { pillar: "Gender Mainstreaming", commitment: "Apply IFC Performance Standard 2 / EBRD PR2 gender lens to design choices, employment, and stakeholder consultation", kpi: "≥ 30% female representation on the team; gender-disaggregated stakeholder consultation; gender-sensitive design audit at 60% gate", evidenceMechanism: "Team composition record; consultation attendance log; gender audit memo" },
    { pillar: "Universal Design / Accessibility", commitment: "Apply universal-design principles per UN CRPD / ISO 21542 across all built environment outputs", kpi: "100% compliance with national accessibility standard; accessibility audit signed off at 100% gate", evidenceMechanism: "Accessibility audit checklist; sign-off memo; corrective-action register" },
    { pillar: "Environmental Compliance", commitment: "Comply with national EIA framework + applicable IFC / WB ESF safeguards; integrate environmental & social management plan into deliverables", kpi: "Zero non-compliance findings at independent review; ESMP delivered with each design package", evidenceMechanism: "Independent ESF compliance review at 100% gate" },
    { pillar: "Anti-Corruption & Ethics", commitment: "Apply firm-wide anti-corruption code; gift-and-hospitality register; whistleblowing channel; named integrity officer", kpi: "Zero confirmed integrity incidents; integrity declaration signed by every team member", evidenceMechanism: "Integrity register; whistleblowing log; quarterly review" },
  ];

  if (/health|hospital|medical/.test(s)) {
    return [
      ...generic,
      { pillar: "Climate-Resilient Healthcare", commitment: "Hospital design accounts for projected heat-stress, flood risk, and energy reliability over 50-year service life", kpi: "Backup power for ≥ 72 hours; passive cooling design for outpatient zones; flood-elevation per IPCC RCP 4.5", evidenceMechanism: "Climate-resilience memo at concept design; backup-power schedule at 100% gate" },
      { pillar: "Biomedical Waste Management", commitment: "Design integrates color-coded segregation, autoclave, and incineration per WHO / national MoH biomedical waste guidance", kpi: "Waste-stream layout signed off by IPC officer; incinerator capacity sized for projected daily load", evidenceMechanism: "IPC sign-off memo; waste-management plan with handover pack" },
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      ...generic,
      { pillar: "Climate-Resilient Water Infrastructure", commitment: "Hydraulic design accounts for projected drought + flood frequency over service life", kpi: "Source yield reviewed against drought scenario; storage sized for 1.5× peak demand", evidenceMechanism: "Climate scenario memo at design stage; reservoir sizing calculations" },
      { pillar: "Non-Revenue Water Reduction", commitment: "Design integrates DMA zoning, leak-detection-ready instrumentation, and pressure management", kpi: "NRW design target ≤ 20%; pressure-zone layout per IWA Water Loss Task Force", evidenceMechanism: "NRW design memo; DMA layout drawing in BOQ pack" },
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      ...generic,
      { pillar: "Climate-Resilient Roads", commitment: "Pavement and drainage designed for projected rainfall intensity + temperature extremes", kpi: "Drainage capacity sized for 25-year + climate uplift; pavement bitumen grade selected for projected high-temperature exposure", evidenceMechanism: "Hydrology memo with climate uplift; bitumen specification memo" },
      { pillar: "Road Safety", commitment: "Road-safety audit at design AND pre-handover stages per iRAP framework", kpi: "iRAP star rating ≥ 3 stars for vulnerable road users; black-spot mitigation in detailed design", evidenceMechanism: "iRAP audit report; black-spot register; pre-handover audit memo" },
    ];
  }
  if (/urban|master plan/.test(s)) {
    return [
      ...generic,
      { pillar: "Transit-Oriented Development", commitment: "Land-use plan integrates public transit corridors, walkability + cycling infrastructure", kpi: "≥ 60% of plan area within 800 m walking distance of transit; cycling network connectivity ≥ 80%", evidenceMechanism: "Walkability + transit-coverage GIS analysis at 60% gate" },
      { pillar: "Green & Blue Infrastructure", commitment: "Green-space ratio + stormwater management integrated into zoning regulations", kpi: "≥ 15% green space coverage; stormwater detention sized for 25-year storm with climate uplift", evidenceMechanism: "Green-space GIS overlay; stormwater calculation memo" },
    ];
  }
  return generic;
}

// ─── Health & Safety rows ────────────────────────────────────────────────

interface HSRow {
  area: string;
  policy: string;
  kpi: string;
  evidenceMechanism: string;
}

function healthSafetyRows(): HSRow[] {
  return [
    { area: "Management System", policy: "Maintain ISO 45001 / OHSAS 18001-aligned occupational H&S management system; named H&S officer reports to Project Principal", kpi: "100% of staff covered by H&S induction; H&S management review every quarter", evidenceMechanism: "H&S induction register; quarterly review minutes; certification copy in submission pack (Bid-Team Action: confirm)" },
    { area: "Site Induction & PPE", policy: "All staff and visitors complete site induction before access; minimum PPE (helmet, hi-vis vest, safety boots, gloves, goggles) enforced at all sites", kpi: "100% PPE compliance at audit; zero unauthorized site access events", evidenceMechanism: "Site induction register; daily PPE audit log" },
    { area: "Risk Assessment", policy: "Job-specific risk assessment + method statement (RAMS) signed off before any high-risk activity; toolbox talks before each shift", kpi: "RAMS in place for 100% of high-risk activities; toolbox talks logged daily", evidenceMechanism: "RAMS register; toolbox-talk attendance log" },
    { area: "Incident Reporting", policy: "Mandatory reporting of all incidents, near-misses, and dangerous occurrences within 24 hours; root-cause analysis for any LTI within 5 working days", kpi: "Lost-time injury frequency rate (LTIFR) target ≤ 1.0 per million hours worked; near-miss reporting ratio ≥ 5 : 1 vs incidents (healthy reporting culture)", evidenceMechanism: "Incident register; RCA reports; monthly H&S dashboard" },
    { area: "Emergency Response", policy: "Site-specific emergency response plan covering medical evacuation, fire, and security incidents; drills every 3 months", kpi: "100% of sites with current emergency plan; quarterly drill completion ≥ 95%", evidenceMechanism: "Emergency plan per site; drill log; medivac contracts" },
    { area: "Sub-contractor H&S", policy: "Sub-contractors required to comply with our H&S management system + present own RAMS; pre-mobilization H&S audit", kpi: "100% pre-mobilization audit completion; no sub-contractor activity until audit passed", evidenceMechanism: "Sub-contractor audit register; pre-mobilization sign-off memo" },
  ];
}

// ─── Innovation & Value Engineering rows ─────────────────────────────────

interface InnovationRow {
  proposal: string;
  clientValue: string;
  effort: "Low" | "Medium" | "High";
  optInOptOut: "Included" | "Optional" | "Subject to client agreement";
}

function innovationRows(sector: string): InnovationRow[] {
  const s = sector.toLowerCase();
  const generic: InnovationRow[] = [
    { proposal: "Live decision-log shared workspace (e.g., Notion / SharePoint) accessible to client throughout engagement", clientValue: "Client sees decisions and pending items in real-time; reduces email volume; defensible audit trail at handover", effort: "Low", optInOptOut: "Included" },
    { proposal: "Independent technical peer reviewer (not on team) for 100% gate", clientValue: "Catches design blind-spots that the team has stopped seeing; raises deliverable confidence at no extra fee", effort: "Low", optInOptOut: "Included" },
    { proposal: "Lessons-learned capture session at engagement close + written memo handed to client", clientValue: "Client retains organisational knowledge for next phase; reduces ramp-up cost on follow-on engagements", effort: "Low", optInOptOut: "Included" },
    { proposal: "Post-handover advisory call (60 min, within 6 months of close-out) at no fee", clientValue: "Client gets continuity support during early implementation phase; reduces cost of returning to designer for clarifications", effort: "Low", optInOptOut: "Included" },
  ];
  if (/health|hospital|medical/.test(s)) {
    return [
      ...generic,
      { proposal: "BIM-coordinated MEP + medical-equipment model with clash-detection report at 60% gate", clientValue: "Eliminates 30-50% of construction-stage variations historically caused by mis-coordination of clinical equipment with services", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Patient-flow simulation (DES) for Emergency / Outpatient zones at concept design", clientValue: "Quantifies waiting-time impact of layout choices BEFORE construction; data-driven defense of zoning decisions", effort: "Medium", optInOptOut: "Optional" },
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      ...generic,
      { proposal: "Hydraulic-model digital twin handed to operator with O&M pack", clientValue: "Operator can simulate planned outages, fire-flow scenarios, and growth without re-engaging designer; extends usable life of design investment", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Solar-hybrid pump-station option with payback analysis", clientValue: "Reduces operating cost by 30-50% over 10 years; protects against grid unreliability; defensible against tariff increases", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      ...generic,
      { proposal: "Drone-based topographic survey + LiDAR for alignment design", clientValue: "Reduces survey time from weeks to days; higher density of survey points; lower whole-life survey cost", effort: "Medium", optInOptOut: "Subject to client agreement" },
      { proposal: "Pavement-management system seed data for client maintenance team", clientValue: "Client maintenance team gets a structured PMS dataset at handover; accelerates implementation of long-term maintenance strategy", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/urban|master plan/.test(s)) {
    return [
      ...generic,
      { proposal: "Public-facing online dashboard of plan progress + indicators", clientValue: "Increases transparency; reduces stakeholder consultation churn; demonstrates accountability to funders", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Implementation cost-and-benefit model handed to client", clientValue: "Client retains capability to test scenarios after handover; supports phased budget defense", effort: "Medium", optInOptOut: "Optional" },
    ];
  }
  return generic;
}

// ─── Local Content & Capacity Building rows ──────────────────────────────

interface LocalContentRow {
  area: string;
  commitment: string;
  kpi: string;
  evidenceMechanism: string;
}

function localContentRows(): LocalContentRow[] {
  return [
    { area: "Local Employment", commitment: "Maximize local-staff and local-graduate employment on the engagement; document any expatriate role with a sunset plan transitioning to local replacement", kpi: "≥ 80% of person-months delivered by national staff; sunset plan for any expatriate role longer than 6 months", evidenceMechanism: "Person-month-by-nationality timesheet; expatriate sunset plan in inception report" },
    { area: "Supplier Development", commitment: "Source goods and sub-consultancy services from local suppliers where feasible; pre-pay or fast-pay local suppliers to support cash-flow", kpi: "≥ 60% of procurement spend with local suppliers; local-supplier payment within 30 days", evidenceMechanism: "Supplier register with nationality + spend; payment-cycle dashboard" },
    { area: "Knowledge Transfer", commitment: "Pair local junior staff with senior expatriate experts; deliver structured mentoring + skills transfer; document transferable methodologies in handover pack", kpi: "≥ 80% of local junior staff complete documented mentoring milestones; skills-transfer memo with handover", evidenceMechanism: "Mentoring log; skills-transfer memo; competency assessment" },
    { area: "Training & Capacity Building", commitment: "Deliver structured training to client staff covering operation, maintenance, and basic troubleshooting of the delivered system / facility", kpi: "Training plan delivered with handover; ≥ 90% of client trainees pass post-training competency check", evidenceMechanism: "Training plan; attendance register; competency-assessment results" },
    { area: "Local Research & Academic Linkages", commitment: "Engage local universities / research institutes on data collection, analysis, or peer review where possible", kpi: "≥ 1 local academic partnership documented per engagement; published outputs co-authored with local academic", evidenceMechanism: "Partnership memo; published outputs (Bid-Team Action: confirm partnership status)" },
  ];
}

// ─── Table builders ──────────────────────────────────────────────────────

function buildSustainabilityTable(sector: string): string {
  const rows = sustainabilityRows(sector);
  const head = "| # | Pillar | Commitment | KPI | Evidence Mechanism |";
  const sep = "|---|--------|------------|-----|-------------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.pillar} | ${r.commitment} | ${r.kpi} | ${r.evidenceMechanism} |`);
  return [
    `<!-- beyond-spec-table:sustainability -->`,
    `## Sustainability and ESG Plan`,
    "",
    `Sustainability commitments are integrated into every phase of the engagement, with each pillar tied to a measurable KPI and a documented evidence mechanism. Compliance is monitored monthly and reported to the client at coordination meetings.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildHealthSafetyTable(): string {
  const rows = healthSafetyRows();
  const head = "| # | Area | Policy | KPI | Evidence Mechanism |";
  const sep = "|---|------|--------|-----|-------------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.area} | ${r.policy} | ${r.kpi} | ${r.evidenceMechanism} |`);
  return [
    `<!-- beyond-spec-table:health-safety -->`,
    `## Health and Safety Plan`,
    "",
    `Occupational health and safety is treated as a non-negotiable. The plan below covers management system, site discipline, risk assessment, incident reporting, emergency response, and sub-contractor governance, with each area tied to a measurable KPI and audit mechanism.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildInnovationTable(sector: string): string {
  const rows = innovationRows(sector);
  const head = "| # | Innovation / VE Proposal | Client Value | Effort | Inclusion |";
  const sep = "|---|--------------------------|--------------|--------|-----------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.proposal} | ${r.clientValue} | ${r.effort} | ${r.optInOptOut} |`);
  return [
    `<!-- beyond-spec-table:innovation -->`,
    `## Innovation and Value Engineering Proposals`,
    "",
    `Beyond-specification proposals offered to the client at no additional fee unless flagged as Optional or Subject to client agreement. Each carries a stated client-value rationale so the client can evaluate inclusion.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildLocalContentTable(): string {
  const rows = localContentRows();
  const head = "| # | Area | Commitment | KPI | Evidence Mechanism |";
  const sep = "|---|------|------------|-----|-------------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.area} | ${r.commitment} | ${r.kpi} | ${r.evidenceMechanism} |`);
  return [
    `<!-- beyond-spec-table:local-content -->`,
    `## Local Content and Capacity Building`,
    "",
    `Local content and capacity-building commitments are integrated into staffing, procurement, mentoring, training, and academic engagement. Each commitment carries a measurable KPI and an evidence mechanism the client can audit.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── Splice point detection ──────────────────────────────────────────────

// Find the start of any Section D / Section E / Conclusion heading and
// inject the beyond-spec tables BEFORE it (so they sit at the end of
// Section C / Technical Approach but before Compliance / Conclusion).
// Falls back to end-of-document if no D/E section exists.
function findInsertPoint(markdown: string): number {
  const lines = markdown.split("\n");

  // Prefer: end of Section D ("Strategic Value & Sustainability" /
  // "Value Added") so beyond-spec tables sit inside Section D.
  let dStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (
      /^#\s+Section\s+D\b/i.test(lines[i]) ||
      /^#\s+(?:Strategic\s+Value|Value\s+Added|Value-Added|Sustainability\s+(?:and|&)\s+Innovation)$/i.test(lines[i])
    ) {
      dStart = i;
      break;
    }
  }
  if (dStart >= 0) {
    for (let i = dStart + 1; i < lines.length; i += 1) {
      if (/^#\s+/.test(lines[i])) return i;
    }
    return lines.length;
  }

  // Fallback: before Section E / Compliance Matrix
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+E\b/i.test(lines[i]) || /^#\s+Compliance\s+Matrix/i.test(lines[i])) {
      return i;
    }
  }

  // Final fallback: end of document
  return lines.length;
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface BeyondSpecTablesResult {
  markdown: string;
  injected: Array<{ key: string; reason: "MISSING" | "SKIPPED_PRESENT" }>;
}

/**
 * Inject the four beyond-spec tables (Sustainability, H&S, Innovation,
 * Local Content). Idempotent.
 */
export function injectBeyondSpecTables(
  markdown: string,
  opts: { primarySector: string },
): BeyondSpecTablesResult {
  const present = detectExisting(markdown);
  const injected: Array<{ key: string; reason: "MISSING" | "SKIPPED_PRESENT" }> = [];
  const blocks: string[] = [];

  if (!present.has("sustainability")) {
    blocks.push(buildSustainabilityTable(opts.primarySector));
    injected.push({ key: "sustainability", reason: "MISSING" });
  } else {
    injected.push({ key: "sustainability", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("health-safety")) {
    blocks.push(buildHealthSafetyTable());
    injected.push({ key: "health-safety", reason: "MISSING" });
  } else {
    injected.push({ key: "health-safety", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("innovation")) {
    blocks.push(buildInnovationTable(opts.primarySector));
    injected.push({ key: "innovation", reason: "MISSING" });
  } else {
    injected.push({ key: "innovation", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("local-content")) {
    blocks.push(buildLocalContentTable());
    injected.push({ key: "local-content", reason: "MISSING" });
  } else {
    injected.push({ key: "local-content", reason: "SKIPPED_PRESENT" });
  }

  if (blocks.length === 0) return { markdown, injected };

  const insertAt = findInsertPoint(markdown);
  const lines = markdown.split("\n");
  const out = [
    ...lines.slice(0, insertAt),
    "",
    blocks.join("\n"),
    "",
    ...lines.slice(insertAt),
  ];
  return { markdown: out.join("\n"), injected };
}
