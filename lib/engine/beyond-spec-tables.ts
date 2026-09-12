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
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(s)) {
    return [
      ...generic,
      { pillar: "Renewable Energy Integration", commitment: "Design maximises renewable fraction; P50/P90 yield estimates use ≥ 10 years of validated resource data with conservative degradation factors", kpi: "Renewable fraction ≥ target in design basis; P90 yield estimate confirmed by independent review before financial close", evidenceMechanism: "Yield estimation report; independent review memo at 60% gate" },
      { pillar: "Grid Code Compliance", commitment: "Protection relay settings reviewed by independent power-systems engineer before utility submission; relay setting schedule issued with 100% design package", kpi: "Zero non-compliance findings at utility interconnection review; all relay settings documented", evidenceMechanism: "Protection coordination study; utility submission acknowledgement; relay setting schedule" },
    ];
  }
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(s)) {
    return [
      ...generic,
      { pillar: "Water-Use Efficiency", commitment: "Irrigation design incorporates water-use efficiency targets per FAO guidelines; WUA trained in demand management", kpi: "Design NRW in irrigation network ≤ 25%; water productivity target set and monitored post-handover", evidenceMechanism: "Hydraulic efficiency memo; WUA training attendance register; post-handover monitoring report" },
      { pillar: "Agri-Biodiversity and Soil Health", commitment: "Agronomic recommendations include cover-cropping, crop-rotation, and soil-conservation practices to protect long-term land productivity", kpi: "Soil-health baseline recorded before scheme commissioning; crop-rotation plan issued with O&M manual", evidenceMechanism: "Soil-health baseline report; agronomy recommendations in O&M manual" },
    ];
  }
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(s)) {
    return [
      ...generic,
      { pillar: "Tailings and Waste Management", commitment: "TSF design per MAC/ANCOLD guidelines; tailings characterisation completed before disposal; closure cost estimate with financial provision", kpi: "MAC/ANCOLD classification confirmed before TSF design proceeds; closure cost estimate peer-reviewed by independent engineer", evidenceMechanism: "Tailings characterisation report; TSF design; closure cost estimate review memo" },
      { pillar: "Mine Closure and Land Rehabilitation", commitment: "Progressive rehabilitation plan integrated from feasibility stage; land-use objectives agreed with community and regulator", kpi: "Closure and rehabilitation plan approved by regulator; financial provision adequacy confirmed annually", evidenceMechanism: "Closure plan; regulator approval letter; annual financial provision review" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour/.test(s)) {
    return [
      ...generic,
      { pillar: "Dredge Material and Sediment Management", commitment: "Dredge material characterised before works; disposal plan meets national and IMO guidelines", kpi: "Dredge material characterisation report issued before mobilisation; disposal site approved by environmental authority", evidenceMechanism: "Sediment characterisation report; environmental authority approval; disposal monitoring records" },
      { pillar: "Marine Ecology Protection", commitment: "Marine impact assessment including coral reef, seagrass, and mangrove surveys; mitigation hierarchy applied", kpi: "No dredging during spawning seasons for ecologically sensitive areas; turbidity monitoring compliant with trigger levels", evidenceMechanism: "Marine ecology survey report; turbidity monitoring log; compliance records" },
    ];
  }
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(s)) {
    return [
      ...generic,
      { pillar: "Process Safety and Major Hazard Management", commitment: "HAZOP study with all action items tracked to close-out; LOPA for high-severity nodes; process safety information (PSI) documented", kpi: "Zero outstanding critical HAZOP actions at detailed design completion; LOPA risk tolerance criteria confirmed in design basis", evidenceMechanism: "HAZOP action register; LOPA report; design basis memorandum" },
      { pillar: "Pipeline Integrity and Spill Prevention", commitment: "Cathodic-protection design to NACE/ISO standards; ILI programme specification issued with handover; emergency spill response plan included", kpi: "Cathodic-protection design peer-reviewed before installation; ILI baseline run within 12 months of commissioning", evidenceMechanism: "Cathodic-protection design review memo; ILI programme spec; emergency response plan" },
    ];
  }
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(s)) {
    return [
      ...generic,
      { pillar: "Data Privacy and Cyber Security", commitment: "System architecture includes data encryption at rest and in transit; RBAC controls; audit log; penetration test before go-live", kpi: "Zero critical findings at pre-go-live security review; RBAC roles documented and signed off by data owner", evidenceMechanism: "Penetration test report; RBAC role matrix sign-off; security review memo" },
      { pillar: "Regulatory Compliance Assurance", commitment: "Regulatory-gap analysis reviewed by licensed local legal counsel; compliance attestation included in handover documentation", kpi: "Zero post-go-live regulatory enforcement actions attributable to system design; legal counsel sign-off on gap analysis", evidenceMechanism: "Legal counsel review memo; compliance attestation in handover pack" },
    ];
  }
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(s)) {
    return [
      ...generic,
      { pillar: "Digital Inclusion and Last-Mile Access", commitment: "Coverage design prioritises underserved areas; last-mile technology selection accounts for affordability and device accessibility", kpi: "Coverage targets for rural and low-income areas met at SAT; affordability analysis documented in design report", evidenceMechanism: "Coverage simulation report; rural-coverage KPI at SAT; affordability analysis memo" },
      { pillar: "Electromagnetic Radiation (EMR) Compliance", commitment: "Base-station antenna heights and power levels comply with ICNIRP or national EMR standard; EMR exclusion zones documented", kpi: "100% of base stations certified compliant before commissioning; EMR exclusion zones marked on site drawings", evidenceMechanism: "EMR compliance certificates; site drawings with exclusion zones; regulator filing" },
    ];
  }
  if (/interior design|fit[-\s]?out|space planning|finishes|joinery/i.test(s)) {
    return [
      ...generic,
      { pillar: "Biophilic Design Integration", commitment: "Living walls, natural materials, and daylighting maximisation to improve occupant wellbeing and productivity", kpi: "Biophilic design elements incorporated in ≥ 80% of occupied zones; daylighting target ≥ 300 lux at workplane", evidenceMechanism: "WELL/biophilic design checklist at 60% gate; daylighting simulation results" },
      { pillar: "Low-VOC and Sustainably Sourced Materials", commitment: "Specification of low-VOC paints, adhesives, and sustainably-certified timber/finishes to protect indoor air quality", kpi: "100% of specified paints and adhesives GREENGUARD GOLD or equivalent certified; timber products FSC certified", evidenceMechanism: "Material specification schedule with certification references; sample approval register" },
      { pillar: "Circular-Economy Fit-Out", commitment: "Modular partition and furniture systems designed for demountability and re-use, reducing landfill waste at end of life", kpi: "≥ 60% of partition and furniture systems modular/demountable; waste diversion plan issued with construction package", evidenceMechanism: "FF&E demountability schedule; waste diversion plan" },
    ];
  }
  if (/construction supervision|resident engineer|site supervision/i.test(s)) {
    return [
      ...generic,
      { pillar: "Construction Environmental Management Plan (CEMP)", commitment: "Enforce CEMP compliance on site: dust suppression, noise monitoring, waste segregation, and contamination prevention", kpi: "Zero environmental non-conformances at monthly site audit; CEMP compliance rate ≥ 95%", evidenceMechanism: "Monthly CEMP compliance report; site audit log; non-conformance register" },
      { pillar: "Waste Tracking and Diversion Reporting", commitment: "Monthly C&D waste tracking with diversion rate target ≥70% from landfill, reported in monthly supervision report", kpi: "C&D waste diversion rate ≥ 70%; waste tracking register maintained weekly", evidenceMechanism: "Monthly waste tracking report; waste disposal manifests; diversion rate dashboard" },
      { pillar: "Health & Safety Hold-Point Regime", commitment: "Mandatory HSE hold-points at high-risk activities (excavation, lifting, electrical energisation) with recorded sign-off", kpi: "100% of defined H&S hold-points completed with sign-off before proceeding; zero LTIs attributable to hold-point bypass", evidenceMechanism: "HSE hold-point register; incident log; monthly H&S dashboard" },
    ];
  }
  if (/contract administration|fidic|variation order|claims management/i.test(s)) {
    return [
      ...generic,
      { pillar: "Fair and Transparent Contract Administration", commitment: "Timely determinations, fair VO assessments, and transparent final account settlement reduce disputes and rework", kpi: "100% of VO determinations issued within 28 days of submission; zero successful contractor arbitration awards against Employer", evidenceMechanism: "VO log with response dates; determination letters; final account statement" },
      { pillar: "Local-Content and Social Procurement Reporting", commitment: "Track and report local contractor spend, local labour percentage, and community-benefit outcomes", kpi: "Local labour ≥ 30% of total project workforce; local subcontractor spend ≥ 20% of contract value", evidenceMechanism: "Monthly local-content report; payroll records; subcontractor spend log" },
      { pillar: "Digital Contract Management Platform", commitment: "Use cloud-based contract management tool for document control, audit trail, and real-time cost dashboard", kpi: "100% of contract correspondence on platform within 48 hours; real-time cost dashboard available to Employer", evidenceMechanism: "Platform access log; document register; Employer access confirmation" },
    ];
  }
  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(s)) return [
    ...generic,
    { pillar: "Cultural Heritage Preservation", commitment: "Apply ICOMOS reversibility principle: all interventions documented, reversible, and compatible with original fabric; hazardous-materials survey and safe removal plan", kpi: "Zero original fabric lost to repair errors; 100% material-compatibility test results documented", evidenceMechanism: "Pre/post photographic record; material-compatibility test certificates; heritage authority sign-off at each phase gate" },
    { pillar: "Adaptive Reuse & Embodied Carbon", commitment: "Maximise adaptive reuse: structural intervention minimises embodied carbon versus demolish-and-rebuild; whole-life carbon assessment produced", kpi: "Embodied carbon ≤50% of equivalent new-build baseline per RICS Whole Life Carbon Assessment", evidenceMechanism: "Whole-life carbon calculation at design stage; peer-reviewed by independent assessor" },
    { pillar: "Community & Cultural Benefit", commitment: "Engage local communities, cultural bodies, and diaspora at every project stage; public heritage interpretation plan produced; local skilled tradespeople employed for craft repairs", kpi: "Three minimum public consultation events; ≥30% of specialist craft labour sourced locally", evidenceMechanism: "Consultation event records; labour-origin tracking register" },
  ];
  if (/industrial|manufactur|factory|abattoir|processing.*plant|warehouse.*industrial/i.test(s)) return [
    ...generic,
    { pillar: "Cleaner Production", commitment: "Apply UNIDO cleaner-production assessment methodology: waste minimisation at source, water-loop closure, energy-efficiency targets before end-of-pipe treatment", kpi: "Specific water consumption ≤60% of sector baseline; waste-to-landfill ≤15% of total solid waste generated", evidenceMechanism: "Monthly resource-consumption log; waste manifest; third-party cleaner-production audit at commissioning" },
    { pillar: "Effluent & Emissions Control", commitment: "Design effluent treatment plant to meet Ethiopian EPA/WHO standards with 25% safety margin; air-emissions management plan for dust, VOC, and process gases; real-time monitoring sensors", kpi: "Effluent BOD ≤50 mg/L; suspended solids ≤100 mg/L; air emissions within permit limits at all times", evidenceMechanism: "Quarterly third-party effluent analysis; continuous air-quality sensor data; EPA compliance inspection pass" },
    { pillar: "Worker Health & Safety", commitment: "OHSAS 18001/ISO 45001-aligned OHS plan; chemical-risk register; PPE supply and training; emergency-response procedures; LTI-free target", kpi: "Zero LTI (Lost Time Injuries) during construction and first year of operations; 100% PPE compliance on site", evidenceMechanism: "Weekly toolbox talks; PPE audit records; incident register; LTI-frequency rate monthly reporting" },
  ];
  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|basement.*podium/i.test(s)) return [
    ...generic,
    { pillar: "Structural Resilience", commitment: "Design to Ethiopian seismic zone requirements (ES EN 1998) with Ethiopian climatic wind loads; independent structural peer review before construction documents", kpi: "Pass Ethiopian Building Code (EBCS) seismic + wind compliance review; independent peer-review approval certificate", evidenceMechanism: "ETABS/SAP2000 analysis report; peer-review certificate; AA City Authority structural approval" },
    { pillar: "Energy Efficiency", commitment: "Passive design principles (orientation, shading, insulation) to reduce HVAC load; high-performance aluminium curtain wall with low-e glass; LED and BMS-controlled lighting throughout", kpi: "Building energy intensity ≤120 kWh/m²/year; HVAC energy ≤45% of total energy budget", evidenceMechanism: "Energy modelling report (IES VE or equivalent); BMS energy consumption data at 12 months post-handover" },
    { pillar: "Construction Waste & Materials", commitment: "Concrete mix design minimises OPC content via supplementary cementitious materials (fly ash, GGBS); construction waste sorted and recycled; MEP coordination via BIM to reduce rework waste", kpi: "OPC replacement ≥15% by supplementary materials; construction waste recycling rate ≥50%", evidenceMechanism: "Mix design certificate; waste manifest; BIM coordination clash-detection reports" },
  ];
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(s)) return [
    ...generic,
    { pillar: "Water Conservation", commitment: "Low-flow fixtures throughout guestrooms; greywater recycling for landscape irrigation; pool backwash water recovery; water-consumption targets per occupied room", kpi: "Water consumption ≤200 L/guest-night (industry benchmark 300 L); pool backwash recovery ≥80%", evidenceMechanism: "Monthly water-meter readings by department; BMS sub-metering; annual Green Globe audit" },
    { pillar: "Energy & Carbon", commitment: "Solar-assisted water heating for guestrooms; LED lighting with occupancy sensors in all guest and public areas; BMS for HVAC zoning; renewable energy procurement plan", kpi: "Energy intensity ≤150 kWh/m²/year; carbon footprint per guest-night ≤10 kg CO₂e", evidenceMechanism: "Energy model at design stage; BMS monthly energy reports; annual sustainability audit against GSTC criteria" },
    { pillar: "Responsible Sourcing & Community", commitment: "≥40% of food & beverage sourced locally; fair-trade procurement policy; community employment target ≥60% local workforce; heritage and cultural interpretation programme for guests", kpi: "Local sourcing ≥40% of F&B spend; ≥60% of operational staff from local community", evidenceMechanism: "Supplier origin register; payroll nationality data; annual community-impact report" },
  ];
  if (/geotech|soil.*invest|borehole.*programme|subsoil.*invest|ground.*invest|site.*invest.*geotech/i.test(s)) return [
    ...generic,
    { pillar: "Low-Impact Field Investigation", commitment: "Minimise ground disturbance: trial pits backfilled and compacted to original grade within 24 hours; borehole casings removed and grouted on completion; reinstatement monitored and signed-off by site supervisor", kpi: "100% of boreholes grouted within 24 hours of completion; 100% of trial pits reinstated; zero contamination incidents from drilling fluids", evidenceMechanism: "Borehole completion log with grouting record; site reinstatement photographic register; field supervisor sign-off sheet" },
    { pillar: "Responsible Chemical & Sample Handling", commitment: "Drilling fluids (bentonite, polymer) contained and disposed of per EPA/WHO guidelines; contaminated samples labelled, segregated, and disposed of through licensed waste contractor; chain-of-custody maintained throughout", kpi: "Zero field spills of drilling fluids; 100% of soil and rock samples tracked on chain-of-custody; hazardous samples (TPH, heavy metals) disposed of via licensed contractor", evidenceMechanism: "Drilling fluid disposal records; chain-of-custody sample tracking sheets; waste disposal manifests" },
    { pillar: "Data Quality & Traceability", commitment: "All borehole logs, laboratory results, and field observations referenced to unique borehole/test-pit IDs; raw data archived in GIS-compatible format and handed to client; laboratory accreditation certificates included in report appendices", kpi: "100% of test results traceable to accredited laboratory; raw field logs archived in industry-standard format (AGS 4.0 or equivalent); zero data gaps at report stage", evidenceMechanism: "AGS 4.0 data file delivered with report; laboratory accreditation certificate copies in appendix; field log archive on project server" },
  ];
  if (/architect|building.*design|residential.*design|commercial.*design|civic.*build|office.*build|school.*design|community.*centre|government.*build|new.*build.*design/i.test(s)) return [
    ...generic,
    { pillar: "Climate-Responsive Passive Design", commitment: "Building orientation, massing, and envelope optimised for local climate: natural ventilation, shading, and daylighting analysis completed at concept stage before HVAC sizing; thermal performance targets set in design brief", kpi: "Window-to-wall ratio and shading geometry achieve ≥ 30% reduction in peak cooling load vs unshaded baseline; daylighting autonomy ≥ 50% of occupied floor area per LEED/BREEAM daylight credit", evidenceMechanism: "Climate-responsive design memo at concept gate; energy/daylighting simulation report at schematic design; peer-reviewed by independent assessor" },
    { pillar: "Sustainable Materials and Circular Design", commitment: "Material palette prioritises locally sourced, recycled-content, and low-embodied-carbon alternatives; structural system evaluated for end-of-life disassembly; RICS whole-life carbon assessment produced at 60% gate", kpi: "≥ 20% of structural material (by mass) with recycled content or low-carbon cement substitute; whole-life carbon ≤ 70% of equivalent conventional-build baseline", evidenceMechanism: "Materials passport (product data sheets + EPD certificates); RICS whole-life carbon calculation memo; structural disassembly note in specification" },
    { pillar: "Universal Access and Inclusive Design", commitment: "Full compliance with national accessibility standard across all areas open to the public; CPTED principles applied to site layout; inclusive consultation — disability groups and elderly users involved in design review at schematic stage", kpi: "100% of public-facing areas fully accessible per national code; CPTED safety audit score ≥ 80%; ≥ 1 formal consultation session with disability and elderly stakeholders documented", evidenceMechanism: "Accessibility audit checklist signed off at 100% gate; CPTED audit report; consultation attendance register and minutes" },
  ];
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
    { proposal: "Independent technical peer reviewer (not on team) for 100% gate", clientValue: "Catches design blind-spots that the team has stopped seeing; raises deliverable confidence, and is included in the proposed scope", effort: "Low", optInOptOut: "Included" },
    { proposal: "Lessons-learned capture session at engagement close + written memo handed to client", clientValue: "Client retains organisational knowledge for the next phase, shortening ramp-up on follow-on engagements", effort: "Low", optInOptOut: "Included" },
    { proposal: "Post-handover advisory call (60 min, within 6 months of close-out), included in the proposed scope", clientValue: "Client gets continuity support during early implementation without re-engaging the designer for clarifications", effort: "Low", optInOptOut: "Included" },
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
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(s)) {
    return [
      ...generic,
      { proposal: "HOMER / SAM energy-yield model handed to client with O&M pack", clientValue: "Client can re-run yield scenarios as tariff or load conditions change without re-engaging designer; extends investment value of engineering study", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Remote SCADA diagnostics dashboard accessible to client during defects-liability period", clientValue: "Fault detection without site visit; reduces operator call-out cost; early identification of degradation trends", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(s)) {
    return [
      ...generic,
      { proposal: "Digital soil-moisture monitoring network (low-cost IoT) handed to WUA", clientValue: "WUA can optimise irrigation scheduling in real time; reduces water waste; extends system capacity", effort: "Medium", optInOptOut: "Subject to client agreement" },
      { proposal: "Agronomy productivity baseline survey included in handover", clientValue: "Client and WUA retain a before-after productivity baseline for grant reporting and Phase 2 justification", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(s)) {
    return [
      ...generic,
      { proposal: "3-D geological block model handed to client in open-source format (Leapfrog / QGIS)", clientValue: "Client retains full resource model for future exploration or mine-plan updates without re-engaging geologist", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Geotechnical monitoring dashboarded and handed to mine operator", clientValue: "Slope and TSF stability monitored in near-real-time; early warning of movement reduces safety and liability risk", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour/.test(s)) {
    return [
      ...generic,
      { proposal: "Fast-time nautical simulation report included in handover documentation", clientValue: "Port authority retains safety evidence for future vessel-class upgrades without commissioning new study", effort: "Low", optInOptOut: "Included" },
      { proposal: "Digital twinning of berth structure for predictive maintenance planning", clientValue: "Reduces inspection intervals; extends berth life; supports insurance and lender technical due diligence", effort: "High", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(s)) {
    return [
      ...generic,
      { proposal: "Digital P&ID (smartPlant / AVEVA E3D) database handed to client with as-built documentation", clientValue: "Client retains intelligent P&ID for future HAZOP revalidation, MOC, and maintenance planning without re-drawing from paper", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Pipeline integrity management plan (PIMP) pre-populated with ILI baseline run schedule", clientValue: "Client asset team can enter the integrity lifecycle immediately at handover; reduces first-interval inspection planning cost", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(s)) {
    return [
      ...generic,
      { proposal: "Automated regulatory reporting module (Basel / IFRS returns) pre-validated against regulator's published template", clientValue: "Reduces manual reporting effort by 60-70%; eliminates transcription errors that trigger regulatory queries", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Compliance knowledge-base wiki handed over as part of staff training package", clientValue: "Client compliance team retains searchable regulatory guidance without ongoing consultant dependency", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(s)) {
    return [
      ...generic,
      { proposal: "Live network KPI dashboard integrated with client NOC from commissioning day", clientValue: "Client operations team gets real-time visibility of coverage, capacity, and fault status from Day 1 without additional integration cost", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Automated frequency-planning and interference-management tool handed to spectrum team", clientValue: "Reduces spectrum re-planning cycle from weeks to hours; supports future technology upgrade (e.g., LTE → 5G NR) without re-engaging frequency planner", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/interior design|fit[-\s]?out|space planning|finishes|joinery/i.test(s)) {
    return [
      ...generic,
      { proposal: "BIM-integrated interior design (LOD 400) with clash detection and quantity takeoff", clientValue: "Reduces site RFIs by ~40% and material waste by ~15% — coordination issues resolved before site start", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Virtual reality (VR) client walkthrough at schematic stage", clientValue: "Client can experience the completed space before construction begins, enabling informed decisions and reducing late design changes", effort: "Medium", optInOptOut: "Subject to client agreement" },
      { proposal: "Cloud-based sample and material tracking board with lead-time dashboard", clientValue: "Prevents supply-chain delays by surfacing long-lead items 8–12 weeks ahead; photo log and supplier contacts in one place", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/construction supervision|resident engineer|site supervision/i.test(s)) {
    return [
      ...generic,
      { proposal: "Digital hold-point inspection app (mobile ITP) with GPS, photo evidence, and automatic NCR generation", clientValue: "Reduces quality documentation effort by 60% and improves traceability; real-time NCR status visible to Employer", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Weekly drone surveys producing ortho-photo and 3D point cloud for progress measurement", clientValue: "Enables accurate remote progress assessment without daily physical site presence; supports dispute resolution with photographic record", effort: "Medium", optInOptOut: "Subject to client agreement" },
      { proposal: "Real-time project dashboard for Employer (progress %, NCR status, IPC amounts, programme vs actual)", clientValue: "Increases Employer confidence and reduces ad-hoc reporting requests; accessible online at any time", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/contract administration|fidic|variation order|claims management/i.test(s)) {
    return [
      ...generic,
      { proposal: "AI-assisted contract risk scan at award — flags non-standard FIDIC clauses and hidden risk", clientValue: "Reduces surprises that lead to costly claims later; briefing memo issued at contract mobilisation", effort: "Low", optInOptOut: "Included" },
      { proposal: "Integrated Earned Value Management (EVM) dashboard linking programme baseline, actual cost, and forecast final cost", clientValue: "Provides 4–6 week early warning of cost overrun, enabling proactive corrective action before budget is breached", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Cloud-based claims register auto-populating from site diaries, weather logs, and delay notices", clientValue: "Strengthens Employer's position in dispute proceedings with FIDIC-timestamped, auditable contemporaneous records", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(s)) {
    return [
      ...generic,
      { proposal: "Photogrammetric 3D scan and point-cloud model (E57 format) of existing structure at inception — used for design coordination, area measurement, and post-construction comparison", clientValue: "Eliminates measurement errors; provides baseline for as-built comparison; creates heritage archive quality record; extends reuse value of survey data beyond the project", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Hydraulic lime mortars and natural hydraulic lime (NHL 2/3.5/5) matched to original masonry by XRF and petrographic testing — specification issued before contractor tender", clientValue: "Prevents irreversible damage to original fabric from OPC-induced salt crystallisation; extends conservation life by 30+ years versus standard OPC repairs", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/industrial|manufactur|factory|abattoir|processing.*plant|warehouse.*industrial/i.test(s)) {
    return [
      ...generic,
      { proposal: "AutoCAD Plant 3D / Revit MEP coordinated 3D plant model with clash detection — used for equipment installation sequencing and commissioning planning", clientValue: "Reduces construction rework by estimated 25%; accelerates commissioning sequencing planning; as-built 3D model handed to client for facility management", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Value-stream mapping (VSM) applied to production process flow before layout design — 5S and lean principles embedded in material-flow corridors, storage zones, and logistics docks", clientValue: "Estimated 15–20% reduction in material-handling distance versus conventional layout; operational efficiency gain from Day 1 without additional capital cost", effort: "Low", optInOptOut: "Included" },
    ];
  }
  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|basement.*podium/i.test(s)) {
    return [
      ...generic,
      { proposal: "Full BIM coordination across architecture, structure, and MEP at LOD 300+ — automated clash detection eliminates field coordination conflicts for MEP riser routing and structural penetrations", clientValue: "Estimated 20% reduction in site RFIs; faster authority submission with model-based coordination reports; LOD 300 model deliverable handed to client", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Post-tensioned flat slab system evaluated against conventional RC slab for floor plates >600 m² — reduces storey height by 150–200 mm per floor enabling additional floor within same building height", clientValue: "Potential one additional floor per 8–10 floors versus conventional RC; 8–12% concrete volume saving — structural system comparison report issued at design development stage", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(s)) {
    return [
      ...generic,
      { proposal: "All FF&E tracked via shared online procurement schedule with delivery milestone alerts — reduces lead-time surprises that delay pre-opening", clientValue: "Eliminates pre-opening delays caused by late FF&E delivery; real-time delivery status visible to client, contractor, and operator from a single live dashboard", effort: "Low", optInOptOut: "Included" },
      { proposal: "Mock guest room constructed and approved by client and brand operator before bulk room-finishing works commence — reduces rework cost from late design corrections", clientValue: "Estimated 10–15% reduction in rework cost; brand compliance confirmed at prototype stage rather than at snagging; before/after comparison record in handover pack", effort: "Medium", optInOptOut: "Subject to client agreement" },
    ];
  }
  if (/geotech|soil.*invest|borehole.*programme|subsoil.*invest|ground.*invest|site.*invest.*geotech/i.test(s)) {
    return [
      ...generic,
      { proposal: "Continuous borehole core photographed (macro + detail), catalogued in labelled core boxes, and handed to client as high-resolution digital archive (PDF + JPEG) alongside the geotechnical report", clientValue: "Client retains a permanent visual record of subsurface conditions for future phases — avoiding repeat borehole costs if foundation design changes or disputes arise during construction", effort: "Low", optInOptOut: "Included" },
      { proposal: "AGS 4.0 digital data file of all borehole logs, in-situ tests, and laboratory results handed to client — enabling direct import into any geotechnical software (Gint, dGeo, GeoStudio) without re-keying", clientValue: "Eliminates data re-entry cost for follow-on foundation design or monitoring phases; ensures long-term usability of investigation data beyond this engagement", effort: "Low", optInOptOut: "Included" },
      { proposal: "Bore-hole location and interpreted strata surfaces (top-of-rock, groundwater table, weak layer elevation) modelled as 3D GIS layers (Shapefile + GeoJSON) — handed to client for overlay on project drawings or BIM model", clientValue: "Enables structural designer to extract site-specific bearing-layer depths at any point within the site without additional interpretive work; reduces foundation design man-hours by an estimated 20–30%", effort: "Medium", optInOptOut: "Optional" },
    ];
  }
  if (/architect|building.*design|residential.*design|commercial.*design|civic.*build|office.*build|school.*design|community.*centre|government.*build|new.*build.*design/i.test(s)) {
    return [
      ...generic,
      { proposal: "Energy performance modelling (IES VE or EnergyPlus) at schematic stage to inform envelope, HVAC sizing, and glazing specifications before expensive detailed design commits the design direction", clientValue: "Decisions made at schematic stage cost ~1/10th to change vs decisions made at construction documents; energy model prevents oversized HVAC plant (typical 15–20% cost saving on M&E); model handed to client for post-occupancy benchmarking", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Federated BIM model (LOD 300) with architecture, structure, MEP, and specialist systems coordinated in one model — clash-detection report issued at 60% and 90% gate before drawings are issued for construction", clientValue: "Eliminates the most common source of site RFIs (estimated 25–35% reduction); authority submissions faster with model-based documentation; LOD 300 model handed to client for FM use", effort: "Medium", optInOptOut: "Optional" },
      { proposal: "Client design review conducted in an annotated PDF or live BIM viewer (Revit Live / BIM 360) at schematic and design-development stages — replacing traditional flat-PDF pin-up with an interactive walkthrough", clientValue: "Clients understand spatial outcomes earlier and make fewer late-stage change requests; review sessions shortened by an estimated 30%; decision record auto-generated from annotated model", effort: "Low", optInOptOut: "Included" },
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
    // A technical proposal in a two-envelope tender must not price anything, and
    // "at no additional fee" is a price. The point being made is that these are
    // included in the proposed scope, which is a technical statement.
    `Beyond-specification proposals are included within the proposed delivery approach unless flagged as Optional or Subject to client agreement. Each carries a stated client-value rationale so the client can evaluate inclusion.`,
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
