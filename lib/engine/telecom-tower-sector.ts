// Telecom tower and mast structural work: audit, analysis, strengthening and
// maintenance of existing towers.
//
// 2026-09-30, Preview, a telecom-tower EOI ("Provision of Tower Audit,
// Structural Analysis, Strengthening and Maintenance Services"): no sector
// recognised the work, so the proposal fell to "Building Design & Construction
// Supervision" and printed payment certificates, variation orders and a
// defects-liability phase. The section generator's own detector read
// "arbitral award" as a hospital "ward" and planned "Regulatory Approval and
// Permit Documentation". The telecoms sector that exists is network design
// (spectrum, backhaul), which is not this work either.
//
// Every sector table keys on TELECOM_TOWER_SECTOR through
// isTelecomTowerSector, so the phases, methodology, risk register and QA plan
// all describe the same work.

export const TELECOM_TOWER_SECTOR = "Telecom Tower & Mast Structural Engineering";

/** Tender text describing structural work on existing towers or masts. */
export function describesTelecomTowerWork(text: string): boolean {
  const subject = /\b(?:telecom(?:munication)?s?\s+towers?|towers?\s+and\s+masts?|lattice\s+towers?|monopoles?|guyed\s+masts?|communication\s+masts?|(?:telecom|mobile|cell|radio|communication)\s+masts?)\b/i;
  const work = /\b(?:tower|mast)s?\s+(?:audit|inspection|strengthening|structural|maintenance|assessment)|\b(?:structural\s+analysis|strengthening|retrofit|condition\s+(?:audit|assessment)|climbing\s+inspection)\b/i;
  return subject.test(text) && work.test(text);
}

export function isTelecomTowerSector(sector: string): boolean {
  return /telecom tower & mast structural/i.test(sector);
}

export const TELECOM_TOWER_SCOPE_ITEMS = [
  "Inception and Tower Records Review",
  "Site Inspection and Condition Audit",
  "Structural Analysis and Capacity Assessment",
  "Foundation Condition Assessment",
  "Strengthening Design and Method Statements",
  "Maintenance Plan and Tower Records Update",
  "Digital Inspection Records and Reporting",
  "Supervision of Strengthening and Maintenance Works",
];

export const TELECOM_TOWER_PHASES = [
  { phase: "1. Inception and Tower Records Review", deliverables: "Tower list and records reviewed (drawings, previous inspection reports, installed and planned equipment loading); inspection plan, site schedule and access arrangements agreed with the client", duration: "Weeks 1–2", responsible: "Project Manager" },
  { phase: "2. Site Inspection and Condition Audit", deliverables: "Inspection of members, connections, bolts, welds, foundations and earthing; corrosion, verticality and damage recorded with photographs; inspection records captured in the client's reporting format", duration: "Weeks 2–6", responsible: "Structural Engineer" },
  { phase: "3. Structural Analysis and Capacity Assessment", deliverables: "Analysis model per tower from the as-inspected geometry and the stated equipment loading, to the design standard the client specifies; member, connection and foundation utilisation report", duration: "Weeks 4–8", responsible: "Senior Structural Engineer" },
  { phase: "4. Strengthening Design and Method Statements", deliverables: "Strengthening scheme for each tower that fails its check: member and connection reinforcement, foundation upgrade where required; installation method statement and work-at-height safety plan", duration: "Weeks 6–10", responsible: "Senior Structural Engineer" },
  { phase: "5. Strengthening and Maintenance Supervision", deliverables: "Supervision of strengthening and maintenance works; hold-point inspection records; close-out report and updated tower records", duration: "As instructed by the client", responsible: "Project Manager" },
];

type Level = "High" | "Medium" | "Low";

export const TELECOM_TOWER_RISKS: Array<{ risk: string; impact: Level; likelihood: Level; mitigation: string }> = [
  { risk: "Tower records incomplete or out of date, so analysis would use the wrong geometry or loading", impact: "High", likelihood: "Medium", mitigation: "As-inspected member sizes and installed equipment govern the analysis; every discrepancy with the records is logged and reported to the client." },
  { risk: "Work-at-height incident during inspection or strengthening", impact: "High", likelihood: "Low", mitigation: "Climbing only by trained and certified personnel under a permit-to-work with a rescue plan; weather stand-down criteria agreed before site work." },
  { risk: "Site access restrictions delay the inspection programme", impact: "Medium", likelihood: "Medium", mitigation: "Access schedule agreed with the client at inception; sites grouped by region so a blocked site does not stop the programme." },
  { risk: "Equipment added to a tower after its analysis invalidates the result", impact: "High", likelihood: "Medium", mitigation: "Loading recorded at inspection date and stated in each report; any added equipment triggers a re-check before approval." },
  { risk: "Foundation condition cannot be seen and records are absent", impact: "High", likelihood: "Medium", mitigation: "Foundation checked from records where they exist; where they do not, limited excavation proposed to the client before the capacity check is concluded." },
];

export const TELECOM_TOWER_QA: Array<{ checkpoint: string; criterion: string; method: string; frequency: string; responsible: string; type: "Hold" | "Witness" | "Review" }> = [
  { checkpoint: "Inspection Record Completeness", criterion: "Every member, connection and foundation on the checklist is recorded with photographs", method: "Record review against the inspection checklist before analysis starts", frequency: "Per tower", responsible: "Structural Engineer", type: "Hold" },
  { checkpoint: "Independent Analysis Check", criterion: "Model geometry, loading and utilisation results verified", method: "Second engineer checks the model and results of each tower", frequency: "Per tower", responsible: "Senior Structural Engineer", type: "Hold" },
  { checkpoint: "Strengthening Design Check", criterion: "Scheme resolves every failing member and is buildable at height", method: "Design review with the method statement and safety plan", frequency: "Per strengthening scheme", responsible: "Senior Structural Engineer", type: "Hold" },
];

export const TELECOM_TOWER_METHODOLOGY: Record<"understanding" | "methodology" | "workplan" | "quality", string> = {
  understanding: "Tower work starts from the towers as they stand: the as-inspected geometry, the condition of members, connections and foundations, and the equipment actually installed. Records and previous reports are the starting point and are checked against the site, not assumed.",
  methodology: "Each tower is inspected, then analysed from the as-inspected geometry and the stated equipment loading to the design standard the client specifies. Towers that fail their check receive a strengthening scheme with a method statement for work at height; the rest receive maintenance recommendations.",
  workplan: "Phased deliverables: records review and inspection plan → site inspection and condition audit → structural analysis and capacity report → strengthening design and method statements → supervision of strengthening and maintenance → close-out report and updated tower records.",
  quality: "Quality holds at inspection-record completeness, an independent check of every analysis model, and a design review of every strengthening scheme before it is issued.",
};
