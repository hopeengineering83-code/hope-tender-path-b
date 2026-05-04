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
