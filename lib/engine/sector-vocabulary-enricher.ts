/**
 * Post-generation enricher that ensures the proposal contains the
 * sector-specific technical vocabulary an evaluator expects to see in a
 * winning bid. Different sectors have different vocabulary; missing terms
 * signal generic, surface-level writing.
 *
 * Strategy: detect the primary sector, identify which expected terms are
 * NOT present in the proposal, and append a "Sector-Specific Technical
 * Standards Applied" section that enumerates the terms in context. The
 * appended section is short (5–10 lines) and grounded — it does NOT
 * fabricate methodology beyond what the deterministic glossary covers.
 *
 * If the AI output already covers all expected terms, nothing is appended.
 */

type VocabularyEntry = { term: string; context: string };

const SECTOR_VOCABULARY: Record<string, VocabularyEntry[]> = {
  healthcare: [
    { term: "IPC", context: "Infection Prevention and Control protocols are embedded in clinical zoning, materials specification, and HVAC design." },
    { term: "PACS", context: "Picture Archiving and Communication System integration points are included in all imaging room cabling for remote radiologist review." },
    { term: "HEPA", context: "High-Efficiency Particulate Air filtration is specified for theatres, isolation rooms, and other clean clinical zones." },
    { term: "medical gas", context: "Medical gas pipeline systems (oxygen, medical air, vacuum, nitrous oxide) are designed with zone valve boxes, pressure alarm panels, and emergency shutoff systems." },
    { term: "lead shielding", context: "Radiation shielding (lead-lined wall, floor, and ceiling specifications) is applied to all imaging areas including X-ray, CT, and fluoroscopy rooms." },
    { term: "Legionella", context: "Hot and cold water temperatures are specified to prevent Legionella, with documented commissioning checks." },
    { term: "HTM 02-01", context: "Medical gas systems are aligned with HTM 02-01 principles where the local Health Authority does not specify a stricter standard." },
  ],
  water: [
    { term: "EPANET", context: "Hydraulic modelling uses EPANET for network analysis, pressure-zone definition, and demand-projection scenarios." },
    { term: "WaterCAD", context: "WaterCAD is used for distribution-network sizing, pressure-zone validation, and pump-curve matching." },
    { term: "yield testing", context: "Borehole yield testing follows step-drawdown and constant-rate methodology with documented recovery analysis." },
    { term: "EBCS", context: "Materials testing follows EBCS / ASTM standards for concrete, aggregates, and reinforcement." },
    { term: "chlorination", context: "Disinfection design includes chlorination dosing, contact time calculation, and residual monitoring schedule." },
    { term: "sanitary protection zone", context: "A defined sanitary protection zone is established around each source, with land-use restrictions and monitoring frequency." },
  ],
  road: [
    { term: "ESAL", context: "Equivalent Single Axle Load calculations drive pavement layer thickness design per the ERA / AASHTO methodology adopted." },
    { term: "CBR", context: "California Bearing Ratio testing of subgrade material is the primary input to pavement layer specification." },
    { term: "Marshall", context: "Marshall mix design is applied for asphalt concrete with documented stability, flow, and air-void compliance." },
    { term: "FIDIC", context: "Construction supervision follows FIDIC contract administration discipline for variation control, payment certification, and defects-liability monitoring." },
    { term: "AASHTO", context: "Geometric design follows AASHTO Green Book principles, calibrated to the local design speed and terrain category." },
    { term: "drainage hydrology", context: "Cross-drainage and side-drain hydrology uses return-period storms appropriate to the road class and surrounding land use." },
  ],
  urban: [
    { term: "GIS", context: "GIS spatial analysis underpins land-use mapping, demographic overlays, and infrastructure network analysis." },
    { term: "land-use zoning", context: "Land-use zoning scenarios are developed with regulatory alignment review and multi-stakeholder consultation." },
    { term: "phasing strategy", context: "The master plan is structured with a phasing strategy that ties priority projects to fundable, deliverable horizons." },
    { term: "stakeholder consultation", context: "Stakeholder consultation records, disclosure documentation, and grievance mechanism design are prepared to safeguard standards." },
  ],
  environmental: [
    { term: "ESF", context: "Environmental and Social Framework (World Bank ESF) standards apply across screening, baseline, ESMP, and disclosure deliverables." },
    { term: "ESMP", context: "The Environmental and Social Management Plan defines mitigation measures per impact, monitoring indicators, responsibilities, and reporting schedule." },
    { term: "mitigation hierarchy", context: "Each impact is addressed through the mitigation hierarchy: avoid → minimise → restore → offset → compensate." },
    { term: "baseline data", context: "Baseline data is collected through primary field survey covering physical environment, biological/ecological context, and socio-economic conditions." },
    { term: "grievance mechanism", context: "A grievance mechanism with documented intake, response, and escalation steps is established before construction begins." },
  ],
  ict: [
    { term: "API", context: "Integrations with existing systems follow versioned API contracts with documented authentication, rate limiting, and observability." },
    { term: "UAT", context: "User Acceptance Testing is structured around documented acceptance criteria with named sign-off authorities." },
    { term: "RBAC", context: "Role-Based Access Control is applied across application and data layers, with audit-log retention aligned to organisational policy." },
    { term: "SLA", context: "Post-deployment support is governed by an SLA covering response time, resolution time, and escalation paths." },
    { term: "DR / backup", context: "Disaster Recovery and backup procedures are documented with named recovery time objective (RTO) and recovery point objective (RPO) targets." },
  ],
  education: [
    { term: "pupil-ratio", context: "Sanitation facility design complies with the national pupil-to-toilet ratio requirements." },
    { term: "accessible design", context: "Accessible design covers ramps, accessible toilets, and wayfinding for users with mobility, sensory, and cognitive needs." },
    { term: "climate-responsive", context: "Climate-responsive design (natural ventilation, shading, daylighting) is applied to reduce operating cost and improve learner comfort." },
    { term: "fire egress", context: "Fire egress, emergency lighting, and assembly-point design comply with the applicable life-safety code." },
  ],
  energy: [
    { term: "load forecast", context: "Load forecasting uses historical consumption data, growth projections, and coincidence factors to size generation and transmission capacity." },
    { term: "HOMER", context: "HOMER Pro or equivalent software is used for hybrid off-grid system optimisation (solar, storage, diesel backup)." },
    { term: "single-line diagram", context: "A single-line diagram (SLD) is produced for each substation and distribution feeder, showing protection coordination and switching sequences." },
    { term: "grid code", context: "Grid code compliance is verified for all interconnection points, covering frequency regulation, voltage profile, and fault-level contribution." },
    { term: "SCADA", context: "Supervisory Control and Data Acquisition (SCADA) is included for real-time monitoring, remote control, and performance logging of the generation/distribution system." },
  ],
  agriculture: [
    { term: "agronomic baseline", context: "An agronomic baseline establishes current crop yield, soil fertility, water availability, and pest/disease pressure for the project area." },
    { term: "irrigation efficiency", context: "Irrigation efficiency targets are set for each scheme, distinguishing conveyance, distribution, and field-application losses." },
    { term: "value-chain", context: "Value-chain analysis covers input supply, production, post-harvest handling, market linkages, and price formation to identify key constraints." },
    { term: "FAO", context: "Crop-water requirements are calculated using FAO Penman-Monteith reference evapotranspiration, calibrated against local weather-station data." },
    { term: "yield model", context: "Yield modelling under current and improved management scenarios provides the economic foundation for cost-benefit analysis." },
  ],
  mining: [
    { term: "geotechnical investigation", context: "A phased geotechnical investigation programme (logging, sampling, laboratory testing, reporting) follows the Q-system or RMR classification." },
    { term: "slope stability", context: "Slope stability analysis uses Limit Equilibrium (Slice Method) and/or numerical methods for critical pit walls and waste-dump embankments." },
    { term: "tailings management", context: "Tailings Storage Facility (TSF) design follows MAC/ANCOLD guidelines with stability monitoring, seepage control, and closure provisions." },
    { term: "blast design", context: "Blast design parameters (burden, spacing, powder factor, timing) are optimised for fragmentation, vibration, and flyrock control." },
    { term: "JORC", context: "Mineral Resource estimation follows the JORC Code (or equivalent national standard), with documented confidence classification." },
  ],
  port: [
    { term: "berth design", context: "Berth design is based on vessel-class parameters (LOA, beam, DWT, draft) with allowance for tidal range, wave climate, and mooring loads." },
    { term: "container throughput", context: "Container throughput projections drive equipment selection (quay cranes, RTGs), yard dimensioning, and gate capacity planning." },
    { term: "port master plan", context: "A port master plan allocates land and water-side zones, phasing capital investment against traffic projections over a 20–30 year horizon." },
    { term: "dredging", context: "Dredging scope, equipment selection, spoil disposal plan, and environmental monitoring are defined based on navigation-channel maintenance data." },
    { term: "pilotage", context: "Pilotage procedures, VTS integration, and vessel-traffic simulation are addressed in the nautical safety study." },
  ],
  oil_gas: [
    { term: "P&ID", context: "Piping and Instrumentation Diagrams (P&IDs) are produced at the appropriate level of detail for each process unit, following ISA 5.1 symbology." },
    { term: "HAZOP", context: "Hazard and Operability Study (HAZOP) is conducted at the defined-design stage, with all action items tracked to close-out." },
    { term: "pipeline integrity", context: "Pipeline integrity management follows API 570 (in-service inspection) and API 1160 (pipeline management systems), including ILI run planning." },
    { term: "API", context: "Process and mechanical equipment is specified and inspected in accordance with applicable API standards (API 650 tanks, API 610 pumps, etc.)." },
    { term: "HSE plan", context: "A project-specific Health, Safety and Environment Plan is prepared covering ALARP demonstration, emergency response, and permit-to-work system." },
  ],
  financial: [
    { term: "KYC", context: "Know-Your-Customer (KYC) procedures are documented with risk-based tiering, data capture requirements, and refresh intervals." },
    { term: "AML", context: "Anti-Money Laundering (AML) framework design includes transaction monitoring rules, suspicious-transaction reporting, and staff training programme." },
    { term: "IFRS", context: "Financial statements and management accounts follow IFRS (or applicable national GAAP), with reconciliation to regulatory reporting." },
    { term: "credit risk", context: "Credit risk assessment methodology covers probability of default, loss given default, exposure at default, and portfolio-level concentration limits." },
    { term: "Basel", context: "Capital adequacy analysis follows Basel III/IV standards, covering credit, market, and operational risk risk-weighted assets." },
  ],
  telecoms: [
    { term: "spectrum", context: "Spectrum requirements, licensing conditions, and co-existence management are addressed in the radio-frequency planning document." },
    { term: "base station", context: "Base station (BTS/eNB/gNB) site selection follows coverage analysis, interference mitigation, and civil/structural feasibility screening." },
    { term: "backhaul", context: "Backhaul connectivity (fibre, microwave, or satellite) is dimensioned for peak throughput, latency budget, and redundancy requirements." },
    { term: "last-mile", context: "Last-mile access design distinguishes fixed broadband (FTTH, FTTB), wireless (LTE/5G FWA), and mixed-technology coverage scenarios." },
    { term: "QoS", context: "Quality of Service (QoS) parameters — throughput, latency, jitter, packet loss — are specified for each service class and SLA tier." },
  ],
  building: [
    { term: "BIM", context: "Building Information Modelling (BIM) is used for coordinated multi-discipline design, clash detection, and construction sequencing." },
    { term: "MEP", context: "Mechanical, Electrical, and Plumbing (MEP) design is fully integrated with the architectural and structural models." },
    { term: "fire compartmentation", context: "Fire compartmentation strategy, fire doors, smoke control, and emergency lighting are designed to the applicable fire code and insurer requirements." },
    { term: "HVAC", context: "HVAC system design includes load calculation, system selection, air distribution, and commissioning protocol." },
    { term: "BOQ", context: "A fully priced Bill of Quantities (BOQ) is prepared per RICS / local measurement standard, serving as the basis for tendering and cost control." },
  ],
};

function detectVocabulary(primarySector: string): VocabularyEntry[] {
  const sector = primarySector.toLowerCase();
  if (/health|hospital|medical|clinic/.test(sector)) return SECTOR_VOCABULARY.healthcare;
  if (/water|borehole|hydraulic|sanitary/.test(sector)) return SECTOR_VOCABULARY.water;
  if (/road|bridge|highway|pavement/.test(sector)) return SECTOR_VOCABULARY.road;
  if (/urban|master.?plan|municipal/.test(sector)) return SECTOR_VOCABULARY.urban;
  if (/environmental|esia|esmp|safeguard/.test(sector)) return SECTOR_VOCABULARY.environmental;
  if (/ict|software|digital|mis|erp/.test(sector)) return SECTOR_VOCABULARY.ict;
  if (/school|university|campus|education/.test(sector)) return SECTOR_VOCABULARY.education;
  if (/energy|power|solar|wind|grid|generation|transmission/.test(sector)) return SECTOR_VOCABULARY.energy;
  if (/agri|farm|crop|irrigation|livestock|rural develop/.test(sector)) return SECTOR_VOCABULARY.agriculture;
  if (/mining|mineral|quarry|extracti/.test(sector)) return SECTOR_VOCABULARY.mining;
  if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(sector)) return SECTOR_VOCABULARY.port;
  if (/oil|gas|petroleum|refinery|pipeline/.test(sector)) return SECTOR_VOCABULARY.oil_gas;
  if (/finance|bank|micro.?finance|insurance|credit|lending|investment fund/.test(sector)) return SECTOR_VOCABULARY.financial;
  if (/telecom|broadband|spectrum|mobile network|isp/.test(sector)) return SECTOR_VOCABULARY.telecoms;
  if (/building|construct|architect|structure|facility|facilities/.test(sector)) return SECTOR_VOCABULARY.building;
  return [];
}

export function enrichSectorVocabulary(opts: {
  markdown: string;
  primarySector: string;
}): { markdown: string; injectedTerms: string[] } {
  const expected = detectVocabulary(opts.primarySector);
  if (expected.length === 0) return { markdown: opts.markdown, injectedTerms: [] };

  const text = opts.markdown.toLowerCase();
  const missing = expected.filter((entry) => !text.includes(entry.term.toLowerCase()));

  // If 70% or more of expected terms are already present, nothing to enrich.
  if (missing.length <= Math.floor(expected.length * 0.3)) return { markdown: opts.markdown, injectedTerms: [] };

  const block = [
    "## C.4 Sector-Specific Technical Standards Applied",
    `The following technical standards and protocols are applied throughout this assignment, in line with sector best practice for ${opts.primarySector}:`,
    "",
    ...missing.map((entry) => `- **${entry.term}** — ${entry.context}`),
  ].join("\n");

  // Append at the end of the proposal, before any final Declaration / Submission Control Sheet.
  const declarationIdx = opts.markdown.search(/^#{1,3}\s+(D\.4|Declaration|Submission Control Sheet)/im);
  if (declarationIdx > 0) {
    return {
      markdown: opts.markdown.slice(0, declarationIdx) + block + "\n\n" + opts.markdown.slice(declarationIdx),
      injectedTerms: missing.map((m) => m.term),
    };
  }
  return {
    markdown: `${opts.markdown}\n\n${block}`,
    injectedTerms: missing.map((m) => m.term),
  };
}
