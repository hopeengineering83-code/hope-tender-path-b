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
    { term: "load-flow analysis", context: "Load-flow analysis using SKM/ETAP validates voltage profiles, thermal ratings, and fault-level compliance across the network under normal and contingency conditions." },
    { term: "protection relay coordination", context: "Protection relay coordination study ensures selective isolation of faulted sections while maintaining supply to healthy sections; relay settings are documented in a relay setting schedule." },
    { term: "P50/P90", context: "P50 (median expected yield) and P90 (90th-percentile yield) estimates are produced from ≥ 10 years of validated irradiance/wind data, using conservative degradation rates." },
    { term: "SCADA", context: "SCADA architecture covers remote monitoring, supervisory control, data acquisition, alarm management, and historian for energy generation and grid infrastructure." },
    { term: "grid code", context: "Grid-code compliance review covers voltage regulation, frequency response, power factor, protection settings, and islanding detection per the utility's interconnection requirements." },
    { term: "FAT/SAT", context: "Factory acceptance test (FAT) and site acceptance test (SAT) protocols are prepared before equipment delivery and commissioning; all tests are witnessed and documented." },
  ],
  agriculture: [
    { term: "FAO Penman-Monteith", context: "Crop water requirement is calculated using the FAO Penman-Monteith method, based on local climatic data (temperature, humidity, radiation, wind speed)." },
    { term: "command area", context: "The command area (net irrigable area) is mapped using topographic survey and GIS; design capacity is based on the command area and crop water requirement." },
    { term: "WUA", context: "Water User Association (WUA) governance structure — constitution, water-allocation rules, fee-collection mechanism, and dispute-resolution procedure — is established before scheme commissioning." },
    { term: "NRW", context: "Non-revenue water (NRW) in the irrigation network is controlled through canal lining specification, gate seating standards, and commissioning seepage tests." },
    { term: "hydrological analysis", context: "Hydrological analysis uses a minimum 20-year flow record; low-flow frequency analysis confirms the safe yield available for scheme design." },
  ],
  mining: [
    { term: "JORC", context: "Resource estimation is reported in compliance with the JORC Code; an independent qualified competent person reviews the estimate before publication." },
    { term: "TSF", context: "Tailings storage facility (TSF) design follows MAC/ANCOLD guidelines for dam classification, freeboard, drainage, embankment stability, and emergency spillway capacity." },
    { term: "slope stability", context: "Slope-stability analysis is completed using deterministic and probabilistic methods (limit equilibrium, numerical modelling); inter-ramp angles are confirmed before pit design is finalised." },
    { term: "block model", context: "A 3-D geological block model is built from drillhole data using industry-standard software (Leapfrog/Surpac); grade estimation uses kriging or appropriate geostatistical method." },
    { term: "closure cost", context: "Mine closure cost estimate is prepared at feasibility stage per international guidelines; financial provision is sized and reviewed annually to meet regulatory requirements." },
  ],
  port: [
    { term: "met-ocean", context: "Met-ocean analysis uses a minimum 20-year validated hindcast data set covering wave height, wind speed, current, and tide; design conditions are derived for the return period appropriate to the berth class." },
    { term: "nautical simulation", context: "Fast-time nautical simulation validates berth layout, turning basin dimensions, and channel width under design vessel and wind/current conditions before structural design is finalised." },
    { term: "bathymetric survey", context: "Bathymetric survey maps the seabed topography to define dredge volumes, berth pocket dimensions, and approach channel profile." },
    { term: "ISPS", context: "ISPS Code compliance covers facility security assessment, port facility security plan (PFSP), designated restricted areas, access control, and security officer training." },
    { term: "dredge disposal", context: "Dredge material characterisation (bulk chemistry, elutriate testing) determines disposal classification; disposal site and method are pre-approved by environmental authority before works commence." },
  ],
  oilgas: [
    { term: "HAZOP", context: "HAZOP study is conducted systematically against all P&IDs using guide words; all deviations, causes, consequences, and actions are recorded; the action register is tracked to full close-out before construction." },
    { term: "P&ID", context: "Piping and Instrumentation Diagrams (P&IDs) are developed through multiple review cycles; each revision is controlled and all changes are tracked through a formal management-of-change process." },
    { term: "LOPA", context: "Layer of Protection Analysis (LOPA) is conducted for high-severity HAZOP nodes to verify that the combination of independent protection layers (IPLs) meets the tolerable risk criteria." },
    { term: "cathodic protection", context: "Cathodic protection design follows NACE/ISO standards; soil resistivity survey is completed before design; close-interval potential survey (CIPS) is specified within 12 months of commissioning." },
    { term: "pipeline stress analysis", context: "Pipeline stress analysis is conducted using Caesar II or equivalent; compliance with ASME B31.4 (liquid) or B31.8 (gas) is confirmed; analysis reports are peer-reviewed before construction issue." },
  ],
  financial: [
    { term: "KYC", context: "Know-Your-Customer (KYC) programme design covers customer identification, verification, risk classification, ongoing due diligence, and politically exposed persons (PEP) screening." },
    { term: "AML", context: "Anti-Money Laundering (AML) controls cover transaction monitoring thresholds, suspicious transaction reporting (STR), record-retention periods, and staff training requirements." },
    { term: "IFRS", context: "IFRS implementation covers standard interpretation, accounting policy mapping, system configuration, parallel-run reconciliation, and first-time adoption disclosure requirements." },
    { term: "Basel", context: "Basel compliance (Pillar 1 capital adequacy, Pillar 2 ICAAP, Pillar 3 disclosure) is mapped to the institution's current reporting system; gap remediation is prioritised by regulatory deadline." },
    { term: "RBAC", context: "Role-Based Access Control (RBAC) covers application, database, and infrastructure layers; role matrix is documented and signed off by the data owner before go-live." },
  ],
  telecoms: [
    { term: "spectrum", context: "Spectrum assignment is confirmed through regulatory licensing authority before network design is finalised; spectrum co-existence analysis confirms no harmful interference with existing licensees." },
    { term: "RF planning", context: "RF planning uses a calibrated propagation model (Okumura-Hata, 3GPP, or ray-tracing) with field-measured correction factors; coverage acceptance is tested by drive-test against agreed KPIs." },
    { term: "backhaul", context: "Backhaul capacity is sized with minimum 1.5× headroom over peak busy-hour traffic; radio link budget and path availability (Rayleigh / rain) are calculated for each microwave hop." },
    { term: "LTE", context: "LTE (4G) base-station design covers frequency reuse, handover parameters, power control, and MIMO configuration; 5G-NR migration path is documented in the network architecture." },
    { term: "SAT", context: "Site acceptance test (SAT) protocol covers RF performance, power system, transmission, alarm verification, and drive-test against coverage KPIs; sign-off is required before commercial launch." },
  ],
};

function detectVocabulary(primarySector: string): VocabularyEntry[] {
  const sector = primarySector.toLowerCase();
  if (/health|hospital|medical|clinic/.test(sector)) return SECTOR_VOCABULARY.healthcare;
  if (/water|borehole|hydraulic|sanitary/.test(sector)) return SECTOR_VOCABULARY.water;
  if (/road|bridge|highway|pavement|transport/.test(sector)) return SECTOR_VOCABULARY.road;
  if (/urban|master plan|municipal/.test(sector)) return SECTOR_VOCABULARY.urban;
  if (/environmental|esia|esmp|safeguard/.test(sector)) return SECTOR_VOCABULARY.environmental;
  if (/ict|software|digital|mis|erp/.test(sector)) return SECTOR_VOCABULARY.ict;
  if (/school|university|campus|education/.test(sector)) return SECTOR_VOCABULARY.education;
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(sector)) return SECTOR_VOCABULARY.energy;
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(sector)) return SECTOR_VOCABULARY.agriculture;
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(sector)) return SECTOR_VOCABULARY.mining;
  if (/port|berth|quay|maritime|dredging|harbour/.test(sector)) return SECTOR_VOCABULARY.port;
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(sector)) return SECTOR_VOCABULARY.oilgas;
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(sector)) return SECTOR_VOCABULARY.financial;
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(sector)) return SECTOR_VOCABULARY.telecoms;
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
