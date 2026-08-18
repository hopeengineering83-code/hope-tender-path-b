/**
 * Local OpenAI-compatible AI provider for the real end-to-end pipeline drive.
 *
 * The app requires a genuine AI provider: analysis state AI_SUCCEEDED is the
 * ONLY state that unblocks Build Plan / generation / export
 * (see canExportWithAnalysisState in lib/engine/analysis-state-resolver.ts).
 * With no vendor key the pipeline can never reach a ZIP.
 *
 * This server speaks the OpenAI chat-completions wire format over real HTTP so
 * the app's own provider client, retry, health and promotion code paths all
 * execute unmodified. Only the LLM vendor is local.
 *
 * Development/diagnostic harness, not production code.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.LOCAL_AI_PORT ?? 4599);

// Quotes must be VERBATIM substrings of the extracted tender text — the gate
// enforces quote containment against the source file.
const REQUIREMENTS = [
  {
    title: "Valid business licence",
    description: "The Consultant shall submit a valid business licence issued by the competent authority.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
    exactFileName: "04-Compliance-Matrix.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a valid business licence issued by the competent\nauthority.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Valid tax clearance certificate",
    description: "The Consultant shall submit a valid tax clearance certificate.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
    exactFileName: "04-Compliance-Matrix.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a valid tax clearance certificate.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Three relevant project references",
    description: "The Consultant shall provide at least three relevant project references for water supply design assignments completed within the last five years.",
    requirementType: "EXPERIENCE",
    priority: "MANDATORY",
    exactFileName: "01-Technical-Proposal.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall provide at least three relevant project references for\nwater supply design assignments completed within the last five years.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Team Leader with fifteen years experience",
    description: "The Consultant shall nominate a Team Leader with a minimum of fifteen years of professional experience in water supply engineering.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
    exactFileName: "01-Technical-Proposal.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall nominate a Team Leader with a minimum of fifteen years\nof professional experience in water supply engineering.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Signed declarations of eligibility and no conflict of interest",
    description: "The Consultant shall submit a signed declaration of eligibility and a signed declaration of no conflict of interest.",
    requirementType: "DECLARATION",
    priority: "MANDATORY",
    exactFileName: "04-Compliance-Matrix.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a signed declaration of eligibility and a signed\ndeclaration of no conflict of interest.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Company profile",
    description: "The Consultant shall submit a company profile describing its organisation, staffing and relevant experience.",
    requirementType: "COMPANY_PROFILE",
    priority: "MANDATORY",
    exactFileName: "03-Company-Profile.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a company profile describing its organisation,\nstaffing and relevant experience.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Completed compliance matrix",
    description: "The Consultant shall submit a completed compliance matrix cross referencing each requirement of this Request for Proposal to the corresponding section of the technical proposal.",
    requirementType: "FORM",
    priority: "MANDATORY",
    exactFileName: "04-Compliance-Matrix.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a completed compliance matrix cross referencing\neach requirement of this Request for Proposal to the corresponding section\nof the technical proposal.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Technical approach and methodology",
    description: "The technical proposal shall present the approach and methodology for the scope of services, evaluated at 35 points.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    exactFileName: "01-Technical-Proposal.docx",
    sourcePage: 5,
    sourceQuote: "Technical approach and methodology: 35 points.",
    sourceSectionHeading: "SECTION V — EVALUATION CRITERIA",
  },
  {
    title: "Work plan, staffing schedule and quality assurance",
    description: "The technical proposal shall include a work plan, staffing schedule and quality assurance arrangements, evaluated at 15 points.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    exactFileName: "01-Technical-Proposal.docx",
    sourcePage: 5,
    sourceQuote: "Work plan, staffing schedule and quality assurance: 15 points.",
    sourceSectionHeading: "SECTION V — EVALUATION CRITERIA",
  },
  {
    title: "Separate financial proposal",
    description: "The Technical Proposal and the Financial Proposal must be submitted as two separate password protected files. The Technical Proposal must not contain any financial information.",
    requirementType: "SUBMISSION_RULE",
    priority: "MANDATORY",
    exactFileName: "02-Financial-Proposal.docx",
    sourcePage: 2,
    sourceQuote: "The Technical Proposal and the Financial Proposal must be submitted as two\nseparate password protected files.",
    sourceSectionHeading: "SECTION II — SUBMISSION INSTRUCTIONS",
  },
  {
    title: "Required email subject line",
    description: 'The email subject line must read exactly "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal".',
    requirementType: "SUBMISSION_RULE",
    priority: "MANDATORY",
    exactFileName: null,
    sourcePage: 2,
    sourceQuote: 'The email subject line must read exactly\n"MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal".',
    sourceSectionHeading: "SECTION II — SUBMISSION INSTRUCTIONS",
  },
  {
    title: "Detailed engineering design of water supply schemes",
    description: "The Consultant shall carry out detailed engineering design of water supply schemes including boreholes, pumping mains, reservoirs and distribution networks.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    exactFileName: "01-Technical-Proposal.docx",
    sourcePage: 4,
    sourceQuote: "detailed engineering design of water supply schemes including boreholes, pumping\nmains, reservoirs and distribution networks",
    sourceSectionHeading: "SECTION IV — TECHNICAL SCOPE OF SERVICES",
  },
];

const ANALYSIS = {
  summary:
    "Request for Proposal from the Ministry of Water and Energy for consultancy services covering detailed design and construction supervision of rural water supply schemes in Amhara Region. Submission is by email with separate technical and financial files, four exactly named documents, and a 70/30 technical/financial evaluation split.",
  requirements: REQUIREMENTS,
  exactFileNaming: [
    "01-Technical-Proposal.docx",
    "02-Financial-Proposal.docx",
    "03-Company-Profile.docx",
    "04-Compliance-Matrix.docx",
  ],
  exactFileOrder: [
    "01-Technical-Proposal.docx",
    "02-Financial-Proposal.docx",
    "03-Company-Profile.docx",
    "04-Compliance-Matrix.docx",
  ],
  evaluationMethodology:
    "Technical approach and methodology 35 points; relevant firm experience 25 points; qualifications of key experts 25 points; work plan, staffing schedule and quality assurance 15 points. Minimum technical score of 70 points to proceed to financial evaluation. Technical weight 70 percent, financial weight 30 percent.",
  submissionNotes:
    'Submit by email to procurement@mowe.gov.et by 30 November 2026 at 14:00 local time. Email subject must read exactly "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal". Technical and financial proposals must be two separate password protected files; the technical file must contain no pricing.',
  tenderCategory: "WATER_SUPPLY",
  envelopeMode: "TWO_ENVELOPE",
  clientType: "GOVERNMENT",
  submissionFormat: "DOCX",

  procuringEntityName: "Ministry of Water and Energy",
  legalClientName: "Ministry of Water and Energy",
  donorAgency: null,
  // The source names no separate implementing agency; per CLAUDE.md an absent
  // field must not be invented or mirrored from the procuring entity.
  implementingAgency: null,
  clientName: "Ministry of Water and Energy",
  clientNameSourcePage: 1,
  clientNameSourceQuote: "Procuring Entity: Ministry of Water and Energy",

  tenderTitle:
    "Consultancy Services for Detailed Design and Construction\nSupervision of Rural Water Supply Schemes in Amhara Region",
  tenderTitleSourcePage: 1,
  tenderTitleSourceQuote:
    "Tender Title: Consultancy Services for Detailed Design and Construction\nSupervision of Rural Water Supply Schemes in Amhara Region",

  procurementReferenceNumber: "MOWE/CS/RWS/2026/0117",
  referenceSourcePage: 1,
  referenceSourceQuote: "Reference: MOWE/CS/RWS/2026/0117",

  deadline: "2026-11-30T14:00:00.000Z",
  deadlineSourcePage: 1,
  deadlineSourceQuote: "Submission Deadline: 30 November 2026 at 14:00 local time.",

  submissionMethod: "EMAIL",
  submissionMethodSourcePage: 1,
  submissionMethodSourceQuote: "Submission Method: Email",

  submissionEmails: "procurement@mowe.gov.et",
  submissionEmailSourcePage: 1,
  submissionEmailSourceQuote: "Submission Email: procurement@mowe.gov.et",

  submissionAddress:
    "Ministry of Water and Energy, Haile Gebreselassie Street,\nAddis Ababa, Ethiopia, P.O. Box 5744.",
  submissionAddressSourcePage: 1,
  submissionAddressSourceQuote:
    "Client Address: Ministry of Water and Energy, Haile Gebreselassie Street,\nAddis Ababa, Ethiopia, P.O. Box 5744.",

  submissionEmailSubject: "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal",
  country: "Ethiopia",
  clientCity: "Addis Ababa",
  clientAddress:
    "Ministry of Water and Energy, Haile Gebreselassie Street,\nAddis Ababa, Ethiopia, P.O. Box 5744.",
  clientContactName: "Ato Getachew Bekele",
  clientContactTitle: "Director, Procurement Directorate",
  clientContactEmail: "getachew.bekele@mowe.gov.et",
  clientContactPhone: "+251 11 661 2345",
  clientWebsite: "https://www.mowe.gov.et/tenders",
  clientRepresentative: "Ato Getachew Bekele",
  preBidChannel: null,
  preBidMeetingDate: null,
  preBidMeetingLocation: null,
  technicalWeight: 70,
  financialWeight: 30,
};


// ─── Fixture B: EOI, email attachments, no financial envelope ───────────────
const REQUIREMENTS_B = [
  {
    title: "Valid business licence",
    description: "The Consultant shall submit a valid business licence issued by the competent authority.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
    exactFileName: "03-Capability-Statement.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a valid business licence issued by the competent\nauthority.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Valid tax clearance certificate",
    description: "The Consultant shall submit a valid tax clearance certificate.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
    exactFileName: "03-Capability-Statement.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a valid tax clearance certificate.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Three relevant project references",
    description: "The Consultant shall provide at least three relevant project references for water supply design or supervision assignments completed within the last five years.",
    requirementType: "EXPERIENCE",
    priority: "MANDATORY",
    exactFileName: "01-Expression-Of-Interest.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall provide at least three relevant project references for\nwater supply design or supervision assignments completed within the last five\nyears.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Team Leader with fifteen years experience",
    description: "The Consultant shall nominate a Team Leader with a minimum of fifteen years of professional experience in water supply engineering.",
    requirementType: "EXPERT",
    priority: "MANDATORY",
    exactFileName: "01-Expression-Of-Interest.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall nominate a Team Leader with a minimum of fifteen years of\nprofessional experience in water supply engineering.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Company profile",
    description: "The Consultant shall submit a company profile describing its organisation, staffing and relevant experience.",
    requirementType: "COMPANY_PROFILE",
    priority: "MANDATORY",
    exactFileName: "02-Company-Profile.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a company profile describing its organisation,\nstaffing and relevant experience.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Capability statement",
    description: "The Consultant shall submit a capability statement describing its technical approach to design review and technical audit assignments.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    exactFileName: "03-Capability-Statement.docx",
    sourcePage: 3,
    sourceQuote: "The Consultant shall submit a capability statement describing its technical\napproach to design review and technical audit assignments.",
    sourceSectionHeading: "SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS",
  },
  {
    title: "Firm experience in comparable assignments",
    description: "Relevant firm experience in comparable assignments is evaluated at 40 points.",
    requirementType: "EXPERIENCE",
    priority: "MANDATORY",
    exactFileName: "01-Expression-Of-Interest.docx",
    sourcePage: 5,
    sourceQuote: "Relevant firm experience in comparable assignments: 40 points.",
    sourceSectionHeading: "SECTION V — EVALUATION CRITERIA",
  },
  {
    title: "Technical approach to design review and audit",
    description: "The technical approach to design review and audit is evaluated at 20 points.",
    requirementType: "TECHNICAL",
    priority: "MANDATORY",
    exactFileName: "03-Capability-Statement.docx",
    sourcePage: 5,
    sourceQuote: "Technical approach to design review and audit: 20 points.",
    sourceSectionHeading: "SECTION V — EVALUATION CRITERIA",
  },
];

const ANALYSIS_B = {
  summary:
    "Request for Expression of Interest from the Awash Water Works Design and Supervision Enterprise for design review and technical audit of rural water supply schemes. Submission is by email as ordinary attachments, three exactly named documents, no pricing requested at this stage.",
  requirements: REQUIREMENTS_B,
  exactFileNaming: ["01-Expression-Of-Interest.docx", "02-Company-Profile.docx", "03-Capability-Statement.docx"],
  exactFileOrder: ["01-Expression-Of-Interest.docx", "02-Company-Profile.docx", "03-Capability-Statement.docx"],
  evaluationMethodology:
    "Relevant firm experience 40 points; qualifications and experience of key experts 40 points; technical approach to design review and audit 20 points. Consultants scoring a minimum of 70 points are shortlisted.",
  submissionNotes:
    'Submit by email to eoi@awwdse.gov.et by 15 October 2026 at 10:00 as ordinary attachments to a single email. Email subject must read exactly "AWWDSE/EOI/2026/0042 - Expression of Interest". No price information is requested at this stage.',
  tenderCategory: "WATER_SUPPLY",
  envelopeMode: "SINGLE_ENVELOPE",
  clientType: "GOVERNMENT",
  submissionFormat: "DOCX",

  procuringEntityName: "Awash Water Works Design and Supervision Enterprise",
  legalClientName: "Awash Water Works Design and Supervision Enterprise",
  donorAgency: null,
  implementingAgency: null,
  clientName: "Awash Water Works Design and Supervision Enterprise",
  clientNameSourcePage: 1,
  clientNameSourceQuote: "Procuring Entity: Awash Water Works Design and Supervision Enterprise",

  tenderTitle: "Expression of Interest for Design Review and Technical Audit\nof Rural Water Supply Schemes",
  tenderTitleSourcePage: 1,
  tenderTitleSourceQuote: "Tender Title: Expression of Interest for Design Review and Technical Audit\nof Rural Water Supply Schemes",

  procurementReferenceNumber: "AWWDSE/EOI/2026/0042",
  referenceSourcePage: 1,
  referenceSourceQuote: "Reference: AWWDSE/EOI/2026/0042",

  deadline: "2026-10-15T10:00:00.000Z",
  deadlineSourcePage: 1,
  deadlineSourceQuote: "Submission Deadline: 15 October 2026 at 10:00 local time.",

  submissionMethod: "EMAIL",
  submissionMethodSourcePage: 1,
  submissionMethodSourceQuote: "Submission Method: Email",

  submissionEmails: "eoi@awwdse.gov.et",
  submissionEmailSourcePage: 1,
  submissionEmailSourceQuote: "Submission Email: eoi@awwdse.gov.et",

  submissionAddress: "Awash Water Works Design and Supervision Enterprise,\nDembela Street, Adama, Ethiopia, P.O. Box 1187.",
  submissionAddressSourcePage: 1,
  submissionAddressSourceQuote: "Client Address: Awash Water Works Design and Supervision Enterprise,\nDembela Street, Adama, Ethiopia, P.O. Box 1187.",

  submissionEmailSubject: "AWWDSE/EOI/2026/0042 - Expression of Interest",
  country: "Ethiopia",
  clientCity: "Adama",
  clientAddress: "Awash Water Works Design and Supervision Enterprise,\nDembela Street, Adama, Ethiopia, P.O. Box 1187.",
  clientContactName: "W/ro Almaz Bekele",
  clientContactTitle: "Head, Procurement Unit",
  clientContactEmail: "almaz.bekele@awwdse.gov.et",
  clientContactPhone: "+251 22 111 4477",
  clientWebsite: "https://www.awwdse.gov.et/eoi",
  clientRepresentative: "W/ro Almaz Bekele",
  preBidChannel: null,
  preBidMeetingDate: null,
  preBidMeetingLocation: null,
  technicalWeight: 100,
  financialWeight: 0,
};

/**
 * Section/proposal prose generation. The analysis use-case wants JSON; the
 * proposal use-case wants prose. We detect intent from the prompt.
 */
function proseFor(prompt) {
  const heading = /section[^\n]*?[:"]\s*([^\n"]{3,80})/i.exec(prompt)?.[1]?.trim();
  const topic = heading ?? "Technical Response";
  return `## ${topic}

Hope Urban Planning Architectural and Engineering Consultancy submits this response for the Ministry of Water and Energy assignment "Consultancy Services for Detailed Design and Construction Supervision of Rural Water Supply Schemes in Amhara Region" (Reference MOWE/CS/RWS/2026/0117).

### Understanding of the assignment

The assignment requires inception and mobilisation, review of existing hydrogeological data, field assessment of candidate scheme sites, detailed engineering design of boreholes, pumping mains, reservoirs and distribution networks, preparation of bills of quantities and tender documentation, stakeholder consultation, environmental and social screening, and construction supervision through to final reporting.

### Firm capability

The firm was established in 2009 and operates under Grade 1 architectural and engineering consultancy licence MT/AA/3/0004521/2009 with 84 permanent professional staff. It has delivered more than 140 assignments for federal and regional government clients, multilateral development banks and United Nations agencies.

Directly comparable water supply assignments include the Detailed Design and Construction Supervision of the Adama Town Water Supply Distribution Network for Oromia Water Works Design and Supervision Enterprise (ETB 18,400,000; 2023-2025; 62 km of distribution network and four reservoirs), the Feasibility Study and Detailed Engineering Design for Hawassa Municipal Drainage Improvement for Hawassa City Administration (ETB 12,750,000; 2022-2024), and Borehole Siting, Design and Supervision for UNICEF Ethiopia under the Somali Region Water Access programme (USD 610,000; 2024-2025; 22 boreholes with hydrogeological survey).

### Key personnel

Eng. Abebe Tesfaye is nominated as Team Leader and Project Manager. He holds an MSc in Civil Engineering from Addis Ababa University (2004), has 22 years of professional experience in water supply and municipal infrastructure, and is a Registered Professional Engineer, Grade I, licence PE/ET/2231. This exceeds the minimum fifteen years of professional experience required. He is supported by Eng. Meron Gebrehiwot, Senior Water Supply Engineer (MSc Water Resources Engineering, 15 years, WaterCAD and EPANET specialist), and Eng. Sara Hailu, Environmental and Social Safeguards Specialist (MSc Environmental Engineering, 13 years of ESIA experience on World Bank and African Development Bank funded assignments).

### Methodology and quality assurance

The firm applies a four-stage assurance procedure to every assignment: inception review, interim technical review, independent peer review by a non-project senior engineer, and final director sign-off before issue. All deliverables are version controlled, field data is validated against survey control points, and design calculations are independently checked. A monthly progress report is issued to the client with an updated work plan, risk register and mitigation actions.

### Compliance

All mandatory eligibility documents are enclosed, comprising a valid business licence, a valid tax clearance certificate, three or more relevant project references completed within the last five years, the nominated Team Leader's qualifications, signed declarations of eligibility and of no conflict of interest, the company profile, and the completed compliance matrix. No financial information is contained in the technical proposal.`;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
    const messages = parsed.messages ?? [];
    const prompt = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    const wantsJson =
      parsed.response_format?.type === "json_object" ||
      /\bJSON\b/.test(prompt.slice(0, 4000)) && /requirements/i.test(prompt);

    // Serve the analysis matching whichever tender the prompt carries.
    const analysis = /AWWDSE\/EOI\/2026\/0042/.test(prompt) ? ANALYSIS_B : ANALYSIS;
    const content = wantsJson ? JSON.stringify(analysis) : proseFor(prompt);

    const payload = {
      id: "chatcmpl-local-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: parsed.model ?? "local-analysis",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    };
    const out = JSON.stringify(payload);
    console.log(`[local-ai] ${req.method} ${req.url} -> ${wantsJson ? "JSON analysis" : "prose"} (${out.length}b)`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(out);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[local-ai] listening on http://127.0.0.1:${PORT}/v1`));
