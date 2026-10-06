// TEMPORARY local QA harness (PR #1175): runs the real deterministic generation
// end to end against the local CI database for a matrix of invented tenders of
// different types, all bid by one multi-sector firm, and checks each delivered
// proposal for the defect classes found in hosted runs. Nothing here touches
// Preview or Production. Usage:
//   DATABASE_URL=... RUN_DB_INTEGRATION=true npx tsx scripts/tmp-tender-matrix-harness.ts <outDir> [fixture-id ...]
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { prisma } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";
import { enqueueEngineJobForCurrentSources } from "../lib/engine/enqueue-engine-job";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { completeJob } from "../lib/ai-jobs";
import { runTenderEngine } from "../lib/engine/run-tender-engine";
import { buildAndVerifyBuildPlan } from "../lib/engine/automatic-build-plan";
import { generateTenderDocuments } from "../lib/engine/generate-elite";
import { generateMissingPlanFiles } from "../lib/engine/missing-plan-file-generation";
import { hasUnprovenClaim } from "../lib/engine/detection-patterns";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type Requirement = { title: string; type: string; quote: string; priority: "MANDATORY" | "SCORED"; quantity?: number };
type Fixture = {
  id: string;
  title: string;
  client: string;
  reference: string;
  text: string[];
  requirements: Requirement[];
  /** Words that belong to a different kind of work and must not appear. */
  forbidden: RegExp;
  /** Sector families a numbered heading may name for this tender. */
  ownSectors: string[];
  /** Owner pricing workbook lines, for a tender that asks for a financial proposal. */
  pricing?: Array<{ category: string; label: string; quantity: number; unit: string; rate: number }>;
};

/** Sector families a numbered heading can belong to; any family the tender does not own is foreign. */
const SECTOR_HEADINGS: Array<[string, RegExp]> = [
  ["mining", /\b(?:mining|mineral|JORC|tailings|ore)\b/i],
  ["ports", /\b(?:port|berth|dredging|marine|harbou?r)\b/i],
  ["oil-gas", /\b(?:refinery|HAZOP|oil and gas|petroleum)\b/i],
  ["banking", /\b(?:KYC|AML|core banking)\b/i],
  ["telecom", /\b(?:base station|backhaul|telecommunications?|telecom)\b/i],
  ["healthcare", /\b(?:healthcare|clinical|hospitals?|biomedical)\b/i],
  ["hospitality", /\b(?:hotels?|hospitality|guestrooms?)\b/i],
  ["roads", /\b(?:roads?|highways?|pavement)\b/i],
  ["water", /\b(?:water supply|sanitation|wastewater|boreholes?)\b/i],
  ["aviation", /\b(?:airports?|aviation|runways?)\b/i],
  ["energy", /\b(?:hydropower|substations?|transmission lines?|solar farm)\b/i],
];

const FIRM = {
  name: "Northgate Engineering Consultants",
  legalName: "Northgate Engineering Consultants PLC",
  description: "Northgate Engineering Consultants PLC is a multidisciplinary engineering and architectural consultancy registered in Ethiopia.",
  serviceLines: ["Architectural design", "Structural engineering", "Highway engineering", "Water supply engineering", "MEP design", "Construction supervision", "Feasibility studies", "Quantity surveying", "Urban planning", "Geotechnical investigation", "Environmental and social studies", "Heritage conservation"],
  sectors: ["Healthcare", "Hospitality/tourism", "Education", "Roads", "Water", "Commercial/office", "Urban planning", "Heritage"],
};

const EXPERTS = [
  { fullName: "Hanna Tadesse", title: "Managing Director / Principal Architect", years: 20, discipline: "Architecture", profile: "Principal architect. Led Riverside District Hospital and Lakeshore Resort Hotel designs, and the Hillcrest Office Tower. Professional Architect, Reg. No. AR/2201." },
  { fullName: "Samuel Bekele", title: "Senior Structural Engineer", years: 15, discipline: "Structural Engineering", profile: "Structural engineer on Riverside District Hospital and Hillcrest Office Tower. ETABS, SAP2000, SAFE. Professional Engineer, Reg. No. PE/3301." },
  { fullName: "Meron Assefa", title: "Senior Highway Engineer", years: 14, discipline: "Highway Engineering", profile: "Resident engineer on the Eastgate–Valley Road Rehabilitation (62 km). Pavement design and materials testing." },
  { fullName: "Yonas Girma", title: "Water Supply Engineer", years: 12, discipline: "Water Engineering", profile: "Hydraulic design of the Hilltown Water Supply Expansion: boreholes, transmission mains and reservoirs." },
  { fullName: "Ruth Haile", title: "MEP Engineer", years: 10, discipline: "Electrical Engineering", profile: "MEP design for Riverside District Hospital, Lakeshore Resort Hotel and Hillcrest Office Tower." },
  { fullName: "Daniel Worku", title: "Quantity Surveyor", years: 11, discipline: "Quantity Surveying", profile: "Quantity schedules and contract administration on Greenfield Secondary School and Eastgate–Valley Road Rehabilitation." },
  { fullName: "Selam Tesfaye", title: "Senior Urban Planner", years: 16, discipline: "Urban Planning", profile: "Urban planner. Led the Northridge Town Structure Plan: land-use zoning, GIS base mapping and infrastructure demand projection." },
  { fullName: "Abel Mengistu", title: "Senior Geotechnical Engineer", years: 13, discipline: "Geotechnical Engineering", profile: "Geotechnical engineer. Led the Central Market Geotechnical Investigation: boreholes, SPT, laboratory testing and bearing capacity report." },
  { fullName: "Martha Alemu", title: "Environmental and Social Specialist", years: 12, discipline: "Environmental Science", profile: "Environmental and social specialist. Prepared the ESIA and ESMP for the Eastgate–Valley Road Rehabilitation and the Hilltown Water Supply Expansion." },
  { fullName: "Bereket Lemma", title: "Conservation Architect", years: 14, discipline: "Architecture", profile: "Conservation architect. Led the Old Post Office Restoration: condition survey, archival research and conservation design." },
];

const PROJECTS = [
  { name: "Riverside District Hospital", client: "Riverside Regional Health Bureau", sector: "Healthcare", services: ["Architectural design", "Structural engineering", "MEP design", "Construction supervision"], value: 420_000_000, summary: "Design and supervision of a 150-bed district hospital (12,000 m²) with outpatient, maternity and theatre blocks. From Testimony Letter 1. Construction Cost: 420,000,000.00. Design Fee: 6,300,000.00." },
  { name: "Lakeshore Resort Hotel", client: "Lakeshore Hospitality PLC", sector: "Hospitality/tourism", services: ["Architectural design", "Interior design", "MEP design"], value: 310_000_000, summary: "Design of an 80-key resort hotel (9,500 m²) with conference centre and spa." },
  { name: "Greenfield Secondary School", client: "Greenfield City Education Office", sector: "Education", services: ["Architectural design", "Construction supervision", "Quantity surveying"], value: 64_000_000, summary: "Design and supervision of a 32-classroom secondary school (6,400 m²)." },
  { name: "Eastgate–Valley Road Rehabilitation", client: "Regional Roads Authority", sector: "Roads", services: ["Highway engineering", "Construction supervision", "Quantity surveying"], value: 980_000_000, summary: "Supervision of the rehabilitation of 62 km of gravel road to asphalt standard, including drainage structures." },
  { name: "Hilltown Water Supply Expansion", client: "Hilltown Water Utility", sector: "Water", services: ["Water supply engineering", "Feasibility studies", "Construction supervision"], value: 145_000_000, summary: "Feasibility, design and supervision of boreholes, 18 km of transmission mains and two 1,000 m³ reservoirs." },
  { name: "Hillcrest Office Tower", client: "Hillcrest Holdings", sector: "Commercial/office", services: ["Architectural design", "Structural engineering", "MEP design"], value: 520_000_000, summary: "Design of a G+14 office tower (21,000 m²) with two basement levels." },
  { name: "Northridge Town Structure Plan", client: "Northridge Town Administration", sector: "Urban planning", services: ["Urban planning", "Feasibility studies"], value: 18_000_000, summary: "Structure plan for a town of 120,000 residents: land-use zoning, road hierarchy and infrastructure demand to 2040." },
  { name: "Central Market Geotechnical Investigation", client: "Central City Trade Bureau", sector: "Commercial/office", services: ["Geotechnical investigation"], value: 3_200_000, summary: "Twelve boreholes to 25 m, SPT, laboratory testing and a bearing capacity report for a four-storey market." },
  { name: "Old Post Office Restoration", client: "City Culture and Heritage Office", sector: "Heritage", services: ["Heritage conservation", "Architectural design", "Structural engineering"], value: 42_000_000, summary: "Condition survey, conservation design and restoration supervision of a 1930s masonry post office (1,800 m²)." },
];

const COMMON_REQUIREMENTS: Requirement[] = [
  { title: "Company Profile and Registration", type: "COMPANY_PROFILE", quote: "Bidders shall submit a company profile with valid business registration.", priority: "MANDATORY" },
  { title: "Declaration of Non-Debarment", type: "DECLARATION", quote: "Bidders shall submit a signed declaration that they are not debarred.", priority: "MANDATORY" },
];

const FIXTURES: Fixture[] = [
  {
    id: "office-interior", title: "Interior Design and Space Planning of Office Floors", client: "Lakeside Research Institute", reference: "RFQ LRI/31-07",
    text: [
      "Lakeside Research Institute is a non-profit health research organization dedicated to advancing maternal and child health.",
      "The Institute invites firms to provide interior design, space planning, floor plans and 3D modelling of 900 sqm of office floors in Riverbend Town.",
      "Physical Address for Document Collection: Kebele 04, behind the Summit Hotel, Riverbend Town.",
      "Bidders shall submit a Health and Safety Plan. Quotations shall remain valid for 90 days.",
    ],
    requirements: [
      { title: "Similar Office Interior Design Experience", type: "PROJECT_EXPERIENCE", quote: "evidence of at least two similar office interior design assignments", priority: "SCORED", quantity: 2 },
      { title: "Lead Architect", type: "EXPERT", quote: "The proposed team shall include a lead architect.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|outpatient|guestroom|RevPAR|pavement|borehole)\b/i,
    ownSectors: [],
  },
  {
    id: "hospital", title: "Design and Construction Supervision of a 100-Bed General Hospital", client: "Northern Region Health Bureau", reference: "RFP NRHB/31-12",
    text: [
      "The Northern Region Health Bureau invites consultants for the design and construction supervision of a 100-bed general hospital with outpatient department, emergency department, maternity ward, operating theatres and medical gas systems.",
      "The consultant shall comply with infection prevention and control requirements and the applicable health facility standards.",
    ],
    requirements: [
      { title: "Hospital Design Experience", type: "PROJECT_EXPERIENCE", quote: "at least one hospital designed in the last ten years", priority: "MANDATORY" },
      { title: "Team Leader (Architect)", type: "EXPERT", quote: "A team leader architect with hospital design experience.", priority: "MANDATORY" },
      { title: "Technical Methodology", type: "METHODOLOGY", quote: "Describe the methodology for design and supervision.", priority: "SCORED" },
    ],
    forbidden: /\b(?:guestroom|RevPAR|FF&E brand)\b/i,
    ownSectors: ["healthcare"],
  },
  {
    id: "hotel", title: "Architectural Design of a 60-Room Business Hotel", client: "Summit Hospitality Group", reference: "RFP SHG/31-03",
    text: [
      "Summit Hospitality Group invites architectural firms to design a 60-room business hotel with restaurant, conference hall and rooftop bar in Riverbend Town.",
      "Complaints may be lodged with the procurement unit as a last resort.",
    ],
    requirements: [
      { title: "Hotel Design Experience", type: "PROJECT_EXPERIENCE", quote: "Experience in the design of at least one hotel.", priority: "SCORED" },
      { title: "Lead Architect", type: "EXPERT", quote: "A lead architect with hospitality design experience.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|outpatient|maternity|pavement)\b/i,
    ownSectors: ["hospitality"],
  },
  {
    id: "road", title: "Construction Supervision of the Westfield–Northpoint Road Rehabilitation (48 km)", client: "Regional Roads Authority", reference: "RFP RRA/31-22",
    text: [
      "The Regional Roads Authority invites consultants to supervise the rehabilitation of the Westfield–Northpoint road (48 km), including pavement, drainage structures and culverts.",
      "The consultant shall provide a resident engineer, a materials engineer and a quantity surveyor.",
    ],
    requirements: [
      { title: "Road Supervision Experience", type: "PROJECT_EXPERIENCE", quote: "Supervision of at least one road rehabilitation of 40 km or more.", priority: "MANDATORY" },
      { title: "Resident Engineer", type: "EXPERT", quote: "A resident engineer with highway experience.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|space programming|joinery)\b/i,
    ownSectors: ["roads"],
  },
  {
    id: "water", title: "Feasibility Study and Design of the Southvale Town Water Supply", client: "Southvale Water Utility", reference: "RFP SWU/31-05",
    text: [
      "Southvale Water Utility invites consultants for the feasibility study and detailed design of the town water supply: source investigation (boreholes), transmission mains, reservoirs and distribution network.",
    ],
    requirements: [
      { title: "Water Supply Design Experience", type: "PROJECT_EXPERIENCE", quote: "At least one town water supply designed.", priority: "MANDATORY" },
      { title: "Water Supply Engineer", type: "EXPERT", quote: "A water supply engineer with hydraulic design experience.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery|pavement design)\b/i,
    ownSectors: ["water"],
  },
  {
    id: "ict", title: "Development of a Human Resource Management Information System", client: "City Civil Service Bureau", reference: "RFP CSB/31-09",
    text: [
      "The City Civil Service Bureau invites firms to develop a web-based human resource management information system (MIS) with payroll, leave and records modules, data migration and user training.",
    ],
    requirements: [
      { title: "Software Development Experience", type: "PROJECT_EXPERIENCE", quote: "At least two information systems delivered.", priority: "MANDATORY" },
      { title: "Lead Systems Analyst", type: "EXPERT", quote: "A lead systems analyst.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|pavement|borehole|drilling rigs|curtain wall)\b/i,
    ownSectors: [],
  },
  {
    id: "telecom-eoi", title: "Expression of Interest for Telecommunication Tower Structural Audit", client: "Horizon Mobile Networks", reference: "EOI HMN/31-02",
    text: [
      "Horizon Mobile Networks invites Expressions of Interest from firms for the structural audit and strengthening design of telecommunication towers.",
      "No prices should be provided with this EOI.",
    ],
    requirements: [
      { title: "Previous Telecommunication Tower Experience", type: "PROJECT_EXPERIENCE", quote: "Demonstrate experience in telecommunication tower audit or strengthening.", priority: "SCORED" },
      { title: "Exclusion of Pricing Information", type: "SUBMISSION_RULE", quote: "No prices should be provided with this EOI.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|space programming)\b/i,
    ownSectors: ["telecom"],
  },
  {
    id: "school-supervision", title: "Construction Supervision of Two Primary Schools", client: "Eastvale Education Office", reference: "RFP EEO/31-14",
    text: [
      "Eastvale Education Office invites consultants to supervise the construction of two 16-classroom primary schools, including site supervision, quality control and payment certification.",
    ],
    requirements: [
      { title: "School Construction Supervision Experience", type: "PROJECT_EXPERIENCE", quote: "Supervision of at least one school building.", priority: "MANDATORY" },
      { title: "Resident Engineer", type: "EXPERT", quote: "A resident engineer with building supervision experience.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|IPC flow|medical gas|guestroom|RevPAR)\b/i,
    ownSectors: [],
  },
  {
    id: "industrial-feasibility", title: "Feasibility Study for an Agro-Industrial Park", client: "Regional Investment Commission", reference: "RFP RIC/31-01",
    text: [
      "The Regional Investment Commission invites consultants to prepare a feasibility study for a 200-hectare agro-industrial park: market assessment, site selection, infrastructure master plan and financial analysis.",
    ],
    requirements: [
      { title: "Feasibility Study Experience", type: "PROJECT_EXPERIENCE", quote: "At least one feasibility study for an industrial or infrastructure project.", priority: "SCORED" },
      { title: "Team Leader", type: "EXPERT", quote: "A team leader with feasibility study experience.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery)\b/i,
    ownSectors: ["water", "roads", "energy"],
  },
  {
    id: "clinic-renovation", title: "Design and Renovation Oversight for a Specialty Eye Clinic", client: "Riverbend Health Partners", reference: "RFP RHP/31-08",
    text: [
      "Riverbend Health Partners invites consultants to support the establishment of a specialty eye clinic in an existing building.",
      "Scope of Services",
      "1. Site Identification and Technical Assessment: The consultant shall assess candidate buildings for suitability as an eye clinic, including outpatient, diagnostics, operating theatre and pharmacy functions.",
      "2. Conceptual and Detailed Architectural Design: The consultant shall prepare concept and detailed architectural designs for the clinic, including patient flow and infection prevention and control.",
      "3. Building Services Coordination: The consultant shall coordinate mechanical, electrical, plumbing and medical gas systems for the clinic.",
      "4. Renovation Planning and Implementation Oversight: The consultant shall prepare renovation drawings, technical specifications, cost estimates, and BOQs where required, and supervise renovation works for compliance with the approved design.",
      "5. Handover Support: The consultant shall conduct a final inspection and support handover documentation.",
    ],
    requirements: [
      { title: "Healthcare Facility Design Experience", type: "PROJECT_EXPERIENCE", quote: "At least one healthcare facility designed.", priority: "MANDATORY" },
      { title: "Registered Architect", type: "EXPERT", quote: "A registered architect.", priority: "MANDATORY" },
      { title: "Annexes / Supporting Documents", type: "ANNEX", quote: "Attach supporting documents such as company profile, project references, professional CVs, licenses, and certificates.", priority: "SCORED" },
    ],
    forbidden: /\b(?:guestroom|RevPAR|pavement|FF&E brand|load-flow|SCADA|Senior Highway Engineer|on request)\b/i,
    ownSectors: ["healthcare"],
  },
  {
    id: "master-plan", title: "Preparation of a Structure Plan for Southvale Town", client: "Southvale Town Administration", reference: "RFP STA/31-04",
    text: [
      "Southvale Town Administration invites consultants to prepare a ten-year structure plan, including land-use zoning, a road hierarchy plan and infrastructure demand projections.",
    ],
    requirements: [
      { title: "Urban Planning Experience", type: "PROJECT_EXPERIENCE", quote: "At least one town structure plan or master plan prepared.", priority: "MANDATORY" },
      { title: "Urban Planner", type: "EXPERT", quote: "A senior urban planner.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery|curtain wall)\b/i,
    ownSectors: ["roads", "water"],
  },
  {
    id: "geotech", title: "Geotechnical Investigation for a Regional Library", client: "Eastvale Culture Bureau", reference: "RFQ ECB/31-06",
    text: [
      "Eastvale Culture Bureau invites consultants to carry out a geotechnical investigation for a G+3 regional library, including boreholes, in-situ testing, laboratory testing and a foundation recommendation report.",
    ],
    requirements: [
      { title: "Geotechnical Investigation Experience", type: "PROJECT_EXPERIENCE", quote: "At least one geotechnical investigation for a building.", priority: "MANDATORY" },
      { title: "Geotechnical Engineer", type: "EXPERT", quote: "A geotechnical engineer.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery|space programming|curtain wall)\b/i,
    ownSectors: [],
  },
  {
    id: "esia", title: "Environmental and Social Impact Assessment of the Westfield Bypass", client: "Regional Roads Authority", reference: "RFP RRA/31-30",
    text: [
      "The Regional Roads Authority invites consultants to prepare an Environmental and Social Impact Assessment and an Environmental and Social Management Plan for a 22 km bypass, including baseline surveys and public consultation.",
    ],
    requirements: [
      { title: "ESIA Experience", type: "PROJECT_EXPERIENCE", quote: "At least one ESIA for a road or water project.", priority: "MANDATORY" },
      { title: "Environmental and Social Specialist", type: "EXPERT", quote: "An environmental and social specialist.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery|space programming|curtain wall|Marshall mix)\b/i,
    ownSectors: ["roads"],
  },
  {
    id: "heritage", title: "Conservation and Restoration of the Old Railway Station", client: "City Culture and Heritage Office", reference: "RFP CHO/31-02",
    text: [
      "The City Culture and Heritage Office invites consultants for the condition survey, conservation design and restoration supervision of the 1920s Old Railway Station.",
    ],
    requirements: [
      { title: "Heritage Conservation Experience", type: "PROJECT_EXPERIENCE", quote: "At least one restoration of a historic building.", priority: "MANDATORY" },
      { title: "Conservation Architect", type: "EXPERT", quote: "A conservation architect.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|pavement design)\b/i,
    ownSectors: [],
  },
  {
    id: "structural-assessment", title: "Structural Condition Assessment of the Municipal Office Building", client: "Lakeside City Administration", reference: "RFQ LCA/31-17",
    text: [
      "Lakeside City Administration invites consultants to assess the structural condition of its G+5 municipal office building, including non-destructive testing, a structural analysis and a retrofit recommendation report.",
    ],
    requirements: [
      { title: "Structural Assessment Experience", type: "PROJECT_EXPERIENCE", quote: "At least one structural assessment of an existing building.", priority: "MANDATORY" },
      { title: "Structural Engineer", type: "EXPERT", quote: "A senior structural engineer.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|pavement design|space programming)\b/i,
    ownSectors: [],
  },
  {
    id: "qs-contract-admin", title: "Quantity Surveying and Contract Administration Services for a Housing Project", client: "Metro Housing Agency", reference: "RFP MHA/31-09",
    text: [
      "Metro Housing Agency invites consultants to provide quantity surveying and contract administration services for 400 low-cost housing units under construction, including measurement, interim payment certificates, variation assessment and the final account.",
    ],
    requirements: [
      { title: "Contract Administration Experience", type: "PROJECT_EXPERIENCE", quote: "At least one contract administration assignment for building works.", priority: "MANDATORY" },
      { title: "Quantity Surveyor", type: "EXPERT", quote: "A quantity surveyor.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|pavement design|space programming)\b/i,
    ownSectors: [],
  },
  {
    id: "road-design-with-financial", title: "Detailed Design of the Eastvale Feeder Roads (35 km)", client: "Regional Roads Authority", reference: "RFP RRA/31-40",
    text: [
      "The Regional Roads Authority invites consultants for the detailed engineering design of 35 km of feeder roads, including topographic survey, pavement design and tender documents.",
      "Proposals shall be submitted in two separate envelopes: a Technical Proposal and a Financial Proposal. The Financial Proposal shall state prices in Ethiopian Birr inclusive of VAT and remain valid for 120 days.",
    ],
    requirements: [
      { title: "Road Design Experience", type: "PROJECT_EXPERIENCE", quote: "At least one road design or rehabilitation project.", priority: "MANDATORY" },
      { title: "Highway Engineer", type: "EXPERT", quote: "A senior highway engineer.", priority: "MANDATORY" },
      { title: "Financial Proposal", type: "FINANCIAL_PROPOSAL", quote: "The Financial Proposal shall be submitted in a separate envelope, priced in Ethiopian Birr inclusive of VAT.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC-compliant|medical gas|guestroom|RevPAR|FF&E|joinery)\b/i,
    ownSectors: ["roads"],
    pricing: [
      { category: "PERSONNEL", label: "Team Leader / Senior Highway Engineer", quantity: 60, unit: "DAY", rate: 5_000 },
      { category: "PERSONNEL", label: "Quantity Surveyor", quantity: 30, unit: "DAY", rate: 3_000 },
      { category: "REIMBURSABLE", label: "Topographic survey field costs", quantity: 35, unit: "KM", rate: 2_500 },
    ],
  },
  {
    id: "office-building", title: "Architectural and Engineering Design of a G+8 Office Building", client: "Metro Savings Bank", reference: "RFP MSB/31-11",
    text: [
      "Metro Savings Bank invites consultants for the architectural, structural and MEP design of a G+8 head office building with one basement, including tender documents.",
    ],
    requirements: [
      { title: "Office Building Design Experience", type: "PROJECT_EXPERIENCE", quote: "At least one multi-storey office building designed.", priority: "MANDATORY" },
      { title: "Lead Architect", type: "EXPERT", quote: "A lead architect.", priority: "MANDATORY" },
    ],
    forbidden: /\b(?:clinical|patient|IPC(?![^\n]{0,6}\(?Interim)(?!\))|IPC-compliant|medical gas|guestroom|RevPAR|pavement)\b/i,
    ownSectors: [],
  },
];

async function docxText(base64: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

/** Generic checks every delivered proposal must pass, whatever the tender. */
function genericFindings(text: string, fixture: Fixture): string[] {
  const out: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = (label: string, re: RegExp) => {
    const m = text.match(re);
    if (m) out.push(`${label}: "${m[0].slice(0, 120)}"`);
  };
  hit("placeholder", /Your Company Name|\[(?:insert|name|tbd|company)[^\]]*\]|Bid-Team|\bTODO\b|\bTBD\b|lorem ipsum/i);
  hit("owner instruction", /Upload evidence|review matching candidates|before export|update this section|re-attach|confirm manual|Source-Evidence Action/i);
  hit("fee/cost in technical envelope", /\b(?:Design Fee|Construction Cost|Consultancy Fee)\s*:|\bfee\b[^\n|]{0,30}\d{1,3}(?:,\d{3})+/i);
  hit("testimony bookkeeping", /Testimony(?: Letter)? \d/i);
  hit("count grammar", /\b1 (?:experts|projects|references|reviewed project references)\b|\b1 of the 1\b|team of 1 named/i);
  hit("article", /\ba (?:[AEIOU][a-z]+) (?:requirement|project|assignment)\b/);
  hit("cross-sector", fixture.forbidden);
  hit("site visit claimed", /Site visit attendance confirmed/i);
  if (hasUnprovenClaim(text)) out.push("unproven claim the final gate refuses (phantom attachment or relationship claim)");
  hit("duplicated deliverable phrase", /design quantity and resource schedules?,?\s+(?:and\s+)?quantity schedules|quantity schedules,?\s+(?:and\s+)?design quantity and resource/i);
  hit("repeated evidence kind", /\b(from (?:company document|project reference|expert CV|proposal narrative|legal\/registration record))(?: \([^)|]*\))?; \1\b/);
  // Technical Methodology must say how the work is done, not one QA line.
  {
    const at = lines.findIndex((l) => /^[A-H](?:\.\d+)+\s+Technical Methodology$/.test(l));
    if (at >= 0) {
      const body: string[] = [];
      for (let j = at + 1; j < lines.length && !/^[A-H](?:\.\d+)+\s+\S/.test(lines[j]!); j++) body.push(lines[j]!);
      const words = body.join(" ").split(/\s+/).filter(Boolean).length;
      if (words < 60) out.push(`thin methodology (${words} words): "${body.join(" ").slice(0, 120)}"`);
    }
  }
  // A numbered heading that names a sector this tender does not belong to.
  for (const heading of lines.filter((l) => /^[A-H](?:\.\d+)+\s+\S/.test(l))) {
    const foreign = SECTOR_HEADINGS.find(([family, re]) => !fixture.ownSectors.includes(family) && re.test(heading));
    if (foreign) out.push(`foreign-sector heading (${foreign[0]}): "${heading.slice(0, 120)}"`);
  }
  // A heading followed by only attribution or nothing before the next heading.
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-H](?:\.\d+)+\s+\S/.test(lines[i]!)) continue;
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length && !/^[A-H](?:\.\d+)+\s+\S|^(?:SECTION|Section) [A-H]\b|^(?:Cover Letter|Executive Summary|Declaration)$/.test(lines[j]!)) { body.push(lines[j]!); j++; }
    const substantive = body.filter((l) => !/^(?:Responsible expert|Quality Gate)\s*:/i.test(l));
    if (substantive.length === 0) out.push(`empty heading: "${lines[i]}"`);
  }
  // Unfinished prose lines.
  const dangling = lines.find((l) => !l.includes("|") && l.split(" ").length >= 6 && /\b(?:the|and|of|to|a|with|for|by|in)$/i.test(l));
  if (dangling) out.push(`unfinished line: "${dangling.slice(-120)}"`);
  // Repeated paragraphs.
  const seen = new Map<string, number>();
  for (const l of lines.filter((x) => x.length > 80 && !x.includes("|"))) seen.set(l, (seen.get(l) ?? 0) + 1);
  const repeated = [...seen.entries()].find(([, n]) => n > 1);
  if (repeated) out.push(`repeated paragraph x${repeated[1]}: "${repeated[0].slice(0, 100)}"`);
  return out;
}

async function runFixture(fixture: Fixture, outDir: string): Promise<{ id: string; findings: string[]; sector: string | null }> {
  const nonce = randomUUID();
  const user = await prisma.user.create({ data: { email: `matrix-${fixture.id}-${nonce}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" } });
  try {
    const company = await prisma.company.create({ data: {
      userId: user.id, name: FIRM.name, legalName: FIRM.legalName, country: "ET", address: "Megenagna, Northgate House, Addis Ababa",
      email: "bids@northgate.example", phone: "+251 911 000 000", website: "northgate.example", tin: "0099887766",
      gmName: "Hanna Tadesse", gmTitle: "Managing Director", sectors: JSON.stringify(FIRM.sectors), serviceLines: JSON.stringify(FIRM.serviceLines), description: FIRM.description,
    } });
    const vaultText = [
      "NORTHGATE ENGINEERING CONSULTANTS — EXPERIENCE AND STAFF REGISTER",
      ...EXPERTS.flatMap((e) => [`Expert: ${e.fullName}`, `Title: ${e.title}`, `Years Experience: ${e.years}`, `Discipline: ${e.discipline}`, e.profile]),
      ...PROJECTS.flatMap((p) => [`Project: ${p.name}`, `Client: ${p.client}`, "Country: Ethiopia", `Sector: ${p.sector}`, `Service Area: ${p.services.join(", ")}`, `Contract Value: ETB ${p.value.toLocaleString("en-US")}`, p.summary]),
      "This register is the company's retained source evidence.",
    ].join("\n");
    await prisma.companyDocument.create({ data: {
      companyId: company.id, fileName: "register.txt", originalFileName: "register.txt", mimeType: "text/plain", size: Buffer.byteLength(vaultText), storagePath: "",
      extractedText: vaultText, contentSha256: sha(vaultText), contentByteLength: Buffer.byteLength(vaultText), integrityStatus: "VERIFIED", category: "COMPANY_PROFILE",
    } });
    for (const e of EXPERTS) await prisma.expert.create({ data: {
      companyId: company.id, fullName: e.fullName, title: e.title, yearsExperience: e.years, profile: e.profile,
      disciplines: JSON.stringify([e.discipline]), sectors: JSON.stringify(FIRM.sectors), trustLevel: "AI_DRAFT",
    } });
    for (const p of PROJECTS) await prisma.project.create({ data: {
      companyId: company.id, name: p.name, clientName: p.client, country: "Ethiopia", sector: p.sector, serviceAreas: JSON.stringify(p.services),
      contractValue: p.value, currency: "ETB", summary: p.summary, trustLevel: "AI_DRAFT",
    } });

    const requirements = [...COMMON_REQUIREMENTS, ...fixture.requirements];
    const tenderText = [`[Page 1] ${fixture.reference}`, fixture.title, `Issuing Authority: ${fixture.client}`, ...fixture.text,
      "[Page 2] Requirements", ...requirements.map((r) => r.quote), "Submission is by email to procurement@client.example."].join("\n");
    const tender = await prisma.tender.create({ data: {
      userId: user.id, title: fixture.title, clientName: fixture.client, reference: fixture.reference, deadline: new Date("2031-09-30T12:00:00Z"),
      submissionMethod: "EMAIL", submissionEmails: "procurement@client.example",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED", analysisSummary: fixture.text[0]!.slice(0, 300), status: "AI_ANALYZED",
    } });
    const source = await prisma.tenderFile.create({ data: {
      tenderId: tender.id, fileName: "tender.pdf", originalFileName: "tender.pdf", mimeType: "application/pdf", size: Buffer.byteLength(tenderText),
      extractedText: tenderText, totalPages: 2, extractedPages: 2, failedPages: 0, extractionScore: 100, extractionMethod: "text",
      integrityStatus: "VERIFIED", contentSha256: sha(tenderText), contentByteLength: Buffer.byteLength(tenderText),
    } });
    await prisma.tender.update({ where: { id: tender.id }, data: {
      clientNameSourceFileId: source.id, clientNameSourcePage: 1, clientNameSourceQuote: `Issuing Authority: ${fixture.client}`,
      submissionMethodSourceFileId: source.id, submissionMethodSourcePage: 2, submissionMethodSourceQuote: "Submission is by email",
      submissionEmailSourceFileId: source.id, submissionEmailSourcePage: 2, submissionEmailSourceQuote: "procurement@client.example",
      deadlineSourceFileId: source.id, deadlineSourcePage: 1, deadlineSourceQuote: fixture.reference,
      titleSourceFileId: source.id, titleSourcePage: 1, titleSourceQuote: fixture.title,
      referenceSourceFileId: source.id, referenceSourcePage: 1, referenceSourceQuote: fixture.reference,
    } });
    for (const r of requirements) await prisma.tenderRequirement.create({ data: {
      tenderId: tender.id, title: r.title, description: r.quote, requirementType: r.type, priority: r.priority, requiredQuantity: r.quantity ?? 1,
      sourceTenderFileId: source.id, sourcePageNumber: 2, sourceExactQuote: r.quote, sourceConfidence: 1,
    } });

    await prepareCompanyVaultForEngine(user.id);
    const hash = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tender.title, description: null, intakeSummary: null, files: [{ ...source, createdAt: source.createdAt }] }));
    await prisma.aiJob.create({ data: {
      userId: user.id, tenderId: tender.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", analysisInputHash: hash,
      promotedAt: new Date(), promotedBy: user.id, finishedAt: new Date(), output: JSON.stringify({ analysisSource: "AI" }), input: "{}",
    } });
    const job = await enqueueEngineJobForCurrentSources(prisma, { userId: user.id, tenderId: tender.id, companyId: company.id, manualRequested: true });
    await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
    await runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true });
    if (job) await completeJob(job.job.id, { ok: true });
    const selectedExperts = await prisma.tenderExpertMatch.findMany({ where: { tenderId: tender.id }, include: { expert: { select: { fullName: true, title: true } } }, orderBy: { score: "desc" } });
    const selectionNote = `ENGINE EXPERT MATCHES: ${selectedExperts.map((m) => `${m.expert.fullName} (${m.expert.title}) ${m.isSelected ? "SELECTED" : "not selected"} ${m.score.toFixed(2)}`).join("; ")}`;
    const plan = await buildAndVerifyBuildPlan(prisma, tender.id, user.id, { reuseCurrent: false });
    const findings: string[] = [];
    if (!plan.ok) findings.push(`build plan: ${plan.code}: ${plan.message}`);
    try {
      await generateTenderDocuments(tender.id, user.id);
    } catch (error) {
      findings.push(`generation threw: ${(error as Error).message.slice(0, 200)}`);
    }
    if (fixture.pricing) {
      await prisma.pricingWorkbook.create({ data: { tenderId: tender.id, currency: "ETB", validityDays: 120, vatPercent: 15, lines: { create: fixture.pricing.map((l) => ({ ...l, total: l.quantity * l.rate })) } } });
    }
    const planFiles = await generateMissingPlanFiles({ prisma, tenderId: tender.id, userId: user.id, actorLabel: "matrix-harness" }).catch((e: Error) => ({ ok: false, code: e.message }) as never);
    const planNote = (`PLAN FILES: ${JSON.stringify({ ok: (planFiles as { ok?: boolean }).ok, code: (planFiles as { code?: string }).code, created: (planFiles as { created?: unknown[] }).created?.length, planned: (planFiles as { plannedCreated?: unknown[] }).plannedCreated })}`);
    const docs = await prisma.generatedDocument.findMany({ where: { tenderId: tender.id }, orderBy: { createdAt: "asc" } });
    const parts: string[] = [selectionNote, planNote];
    for (const d of docs) {
      parts.push(`===== ${d.name} (${d.format}) =====`);
      if (d.fileContent && d.format === "DOCX") {
        const text = await docxText(d.fileContent);
        parts.push(text);
        if (/financial/i.test(`${d.name} ${d.documentType ?? ""}`)) {
          // The separate envelope: priced, and nothing technical in it.
          if (!/Total offer price/.test(text)) findings.push(`financial proposal has no total offer price: "${text.slice(0, 160)}"`);
          if (/methodology|work plan|technical approach|key personnel/i.test(text)) findings.push("technical content in the financial envelope");
        } else {
          findings.push(...genericFindings(text, fixture));
          // Historical project values are allowed; the offer's own figures are not.
          if (fixture.pricing) {
            const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });
            const subtotal = fixture.pricing.reduce((sum, l) => sum + l.quantity * l.rate, 0);
            const offerFigures = [fmt(subtotal), fmt(subtotal * 1.15), ...fixture.pricing.map((l) => fmt(l.rate))];
            const leaked = offerFigures.find((f) => text.includes(f));
            if (leaked || /Total offer price/.test(text)) findings.push(`price in the technical envelope: ${leaked ?? "Total offer price"}`);
          }
        }
      }
    }
    if (docs.length === 0) findings.push("no document generated");
    writeFileSync(`${outDir}/${fixture.id}.txt`, parts.join("\n"));
    const engineSector = (await prisma.tender.findUnique({ where: { id: tender.id }, select: { category: true } }))?.category ?? null;
    return { id: fixture.id, findings, sector: engineSector };
  } finally {
    await prisma.tender.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.company.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

async function main() {
  const outDir = process.argv[2] ?? "matrix-output";
  const only = process.argv.slice(3);
  mkdirSync(outDir, { recursive: true });
  const summary: string[] = [];
  for (const fixture of FIXTURES.filter((f) => only.length === 0 || only.includes(f.id))) {
    const result = await runFixture(fixture, outDir);
    summary.push(`## ${result.id}: ${result.findings.length === 0 ? "CLEAN" : `${result.findings.length} finding(s)`}`);
    for (const f of result.findings) summary.push(`  - ${f}`);
  }
  writeFileSync(`${outDir}/SUMMARY.txt`, summary.join("\n"));
  console.log(summary.join("\n"));
  await prisma.$disconnect();
}

main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
