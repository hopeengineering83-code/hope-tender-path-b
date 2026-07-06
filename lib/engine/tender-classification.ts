/**
 * Universal Tender Classification
 *
 * Classifies tender type, procurement structure, and company service relevance
 * from extracted text. Evidence-based and configurable — never hard-codes one
 * tender layout or terminology.
 *
 * Supported tender types: RFP, RFQ, EOI, REOI, ITB, RFT, prequalification,
 * consultancy, works, goods, framework, mixed, unknown.
 *
 * Supported procurement structures: technical-only, financial-only,
 * technical+financial, separate-envelopes, single-envelope, email, portal,
 * physical, mixed, unknown.
 *
 * Supported company services: architecture, urban-planning, roads,
 * water-sanitation, geotechnical, structural, MEP, interior-design,
 * supervision, feasibility, environmental, project-management,
 * multidisciplinary, goods-supply, unknown.
 */

export type TenderType =
  | "RFP" | "RFQ" | "EOI" | "REOI" | "ITB" | "RFT"
  | "prequalification" | "consultancy" | "works" | "goods"
  | "framework" | "mixed" | "unknown";

export type ProcurementStructure =
  | "technical-only" | "financial-only" | "technical-financial"
  | "separate-envelopes" | "single-envelope"
  | "email" | "portal" | "physical" | "mixed" | "unknown";

export type CompanyService =
  | "architecture" | "urban-planning" | "roads-transport"
  | "water-sanitation" | "geotechnical" | "structural"
  | "mep" | "interior-design" | "supervision"
  | "feasibility" | "environmental-social" | "project-management"
  | "multidisciplinary" | "goods-supply" | "unknown";

export type EvidenceCategory =
  | "submission-rules" | "eligibility" | "qualifications"
  | "experience" | "personnel" | "methodology" | "deliverables"
  | "required-documents" | "evaluation-criteria" | "financial-requirements"
  | "bid-security" | "annexes" | "contracts" | "compliance"
  | "formatting" | "unknown";

export type TenderClassification = {
  tenderType: TenderType;
  tenderTypeEvidence: string | null;
  procurementStructure: ProcurementStructure;
  procurementStructureEvidence: string | null;
  companyServices: CompanyService[];
  companyServiceEvidence: string | null;
  confidence: number; // 0-1
  classificationSource: "text" | "ai" | "manual" | "unknown";
};

// ─── Tender type patterns (evidence-based, not hard-coded) ──────────────────

const TENDER_TYPE_PATTERNS: Array<{ type: TenderType; patterns: RegExp[] }> = [
  { type: "RFP", patterns: [/request\s+for\s+proposal/i, /\bRFP\b/i, /request\s+for\s+proposals/i] },
  { type: "RFQ", patterns: [/request\s+for\s+quotation/i, /\bRFQ\b/i, /request\s+for\s+quote/i] },
  { type: "REOI", patterns: [/request\s+for\s+expression\s+of\s+interest/i, /\bREOI\b/i] },
  { type: "EOI", patterns: [/expression\s+of\s+interest/i, /\bEOI\b/i] },
  { type: "ITB", patterns: [/invitation\s+(?:to|for)\s+bid/i, /\bITB\b/i] },
  { type: "RFT", patterns: [/request\s+for\s+tender/i, /\bRFT\b/i] },
  { type: "prequalification", patterns: [/prequalification/i, /pre-qualification/i, /pre\s+qualification/i] },
  { type: "consultancy", patterns: [/consultanc(?:y|ies)\s+(?:services?|contract)/i, /consulting\s+services/i] },
  { type: "works", patterns: [/works\s+(?:contract|tender)/i, /construction\s+(?:works?|tender)/i, /civil\s+works/i] },
  { type: "goods", patterns: [/goods?\s+(?:supply|procurement)/i, /supply\s+(?:of|contract)/i] },
  { type: "framework", patterns: [/framework\s+agreement/i, /framework\s+contract/i] },
];

// ─── Procurement structure patterns ─────────────────────────────────────────

const PROCUREMENT_STRUCTURE_PATTERNS: Array<{ structure: ProcurementStructure; patterns: RegExp[] }> = [
  { structure: "separate-envelopes", patterns: [/separate\s+envelopes?/i, /two\s+envelope/i, /technical\s+envelope.*financial\s+envelope/i, /envelope\s+one.*envelope\s+two/i] },
  { structure: "technical-financial", patterns: [/technical\s+(?:and|&)\s+financial\s+proposal/i, /technical\s+proposal.*financial\s+proposal/i] },
  { structure: "technical-only", patterns: [/technical\s+(?:proposal|submission)\s+only/i, /technical\s+evaluation\s+only/i] },
  { structure: "financial-only", patterns: [/financial\s+(?:proposal|submission)\s+only/i, /price\s+(?:schedule|proposal)\s+only/i] },
  { structure: "single-envelope", patterns: [/single\s+envelope/i, /one\s+envelope/i] },
  { structure: "email", patterns: [/submit\s+by\s+email/i, /email\s+submission/i, /electronic\s+submission/i] },
  { structure: "portal", patterns: [/e-procurement\s+portal/i, /online\s+submission/i, /portal\s+submission/i, /e-tendering\s+portal/i] },
  { structure: "physical", patterns: [/physical\s+submission/i, /submit\s+(?:in\s+person|by\s+hand|by\s+courier|by\s+post)/i, /sealed\s+envelope\s+delivery/i] },
];

// ─── Company service patterns ───────────────────────────────────────────────

const COMPANY_SERVICE_PATTERNS: Array<{ service: CompanyService; patterns: RegExp[] }> = [
  { service: "architecture", patterns: [/architectural?\s+(?:services?|design|consultancy)/i, /\barchitecture\b/i] },
  { service: "urban-planning", patterns: [/urban\s+planning/i, /\bcity\s+planning\b/i, /\bspatial\s+planning\b/i, /master\s+plan(?:ning)?/i] },
  { service: "roads-transport", patterns: [/road(?:s)?\s+(?:and\s+transport|engineering|design|construction)/i, /transport(?:ation)?\s+(?:engineering|infrastructure|planning)/i, /highway\s+engineering/i] },
  { service: "water-sanitation", patterns: [/water\s+(?:and\s+sanitation|supply|engineering|treatment)/i, /sanitation\s+(?:engineering|services?)/i, /wastewater\s+(?:treatment|engineering)/i, /\bWSH\b/i, /\bWASH\b/i] },
  { service: "geotechnical", patterns: [/geotechnical\s+(?:investigation|engineering|services?|study|report)/i, /soil\s+investigation/i, /subsurface\s+investigation/i] },
  { service: "structural", patterns: [/structural\s+(?:engineering|design|analysis|consultancy)/i, /\bstructural\s+design\b/i] },
  { service: "mep", patterns: [/(?:mechanical|electrical|plumbing)\s+(?:and|&)\s+(?:mechanical|electrical|plumbing)/i, /\bMEP\b/i, /electrical\s+and\s+mechanical\s+engineering/i, /\bHVAC\b/i] },
  { service: "interior-design", patterns: [/interior\s+design/i, /interior\s+(?:architecture|works?|fit-out)/i] },
  { service: "supervision", patterns: [/construction\s+supervision/i, /project\s+supervision/i, /works?\s+supervision/i, /construction\s+management/i] },
  { service: "feasibility", patterns: [/feasibility\s+(?:study|studies|assessment|report)/i, /pre-feasibility\s+study/i] },
  { service: "environmental-social", patterns: [/environmental\s+(?:and\s+social\s+)?(?:impact\s+)?assessment/i, /\bESIA\b/i, /\bEIA\b/i, /\bESHS\b/i, /social\s+impact\s+assessment/i] },
  { service: "project-management", patterns: [/project\s+management\s+(?:services?|consultancy)/i, /\bPMO\b/i, /programme?\s+management/i] },
  { service: "multidisciplinary", patterns: [/multidisciplinary\s+(?:engineering|consultancy|services?)/i, /multi-disciplinary\s+(?:engineering|consultancy)/i, /integrated\s+engineering\s+services/i] },
  { service: "goods-supply", patterns: [/supply\s+of\s+(?:goods|equipment|materials?|products?)/i, /goods?\s+(?:and|&)\s+(?:equipment|materials?)/i] },
];

// ─── Evidence category patterns ─────────────────────────────────────────────

const EVIDENCE_CATEGORY_PATTERNS: Array<{ category: EvidenceCategory; patterns: RegExp[] }> = [
  { category: "submission-rules", patterns: [/submission\s+(?:instructions?|rules?|requirements?|guidelines?)/i, /how\s+to\s+(?:submit|apply)/i, /submission\s+(?:deadline|date|method)/i] },
  { category: "eligibility", patterns: [/eligibility\s+(?:criteria|requirements?|conditions?)/i, /who\s+(?:can|may)\s+(?:apply|participate|bid)/i, /qualified\s+(?:bidders?|firms?|consultants?)/i] },
  { category: "qualifications", patterns: [/qualifications?\s+(?:of|for)/i, /minimum\s+(?:qualifications?|requirements?)/i, /professional\s+qualifications?/i] },
  { category: "experience", patterns: [/relevant\s+experience/i, /prior\s+experience/i, /similar\s+(?:assignment|project|work)\s+experience/i, /track\s+record/i] },
  { category: "personnel", patterns: [/(?:key|core|proposed)\s+personnel/i, /(?:key|proposed)\s+staff/i, /(?:experts?|professionals?|specialists?|consultants?)\s+(?:to be|proposed|required)/i, /CVs?\s+(?:of|for)/i] },
  { category: "methodology", patterns: [/technical\s+methodology/i, /proposed\s+methodology/i, /approach\s+and\s+methodology/i, /work\s+methodology/i] },
  { category: "deliverables", patterns: [/deliverables?\s+(?:list|schedule|of)/i, /expected\s+(?:outputs?|deliverables?|results?)/i, /scope\s+of\s+(?:deliverables?|outputs?)/i] },
  { category: "required-documents", patterns: [/required\s+documents?/i, /documents?\s+to\s+be\s+submitted/i, /submission\s+checklist/i, /list\s+of\s+(?:required|documents)/i] },
  { category: "evaluation-criteria", patterns: [/evaluation\s+criteria/i, /evaluation\s+methodology/i, /scoring\s+(?:criteria|methodology)/i, /evaluation\s+(?:and|&)\s+awards?/i] },
  { category: "financial-requirements", patterns: [/financial\s+(?:proposal|requirements?|conditions?)/i, /price\s+(?:schedule|proposal)/i, /bill\s+of\s+(?:quantities|quantities|BOQ)/i, /\bBOQ\b/i] },
  { category: "bid-security", patterns: [/bid\s+security/i, /bid\s+bond/i, /performance\s+security/i, /performance\s+bond/i, /bank\s+guarantee/i] },
  { category: "annexes", patterns: [/annex(?:es)?\s+[A-Z]/i, /appendix\s+[A-Z]/i, /attachment\s+[A-Z]/i, /schedule\s+[A-Z]/i] },
  { category: "contracts", patterns: [/contract\s+(?:conditions?|terms?|agreement)/i, /general\s+conditions\s+of\s+contract/i, /\bGCC\b/i, /\bSCC\b/i] },
  { category: "compliance", patterns: [/compliance\s+(?:requirements?|certificates?|standards?)/i, /statutory\s+(?:requirements?|compliance)/i, /regulatory\s+(?:requirements?|compliance)/i] },
  { category: "formatting", patterns: [/formatting\s+(?:requirements?|guidelines?|rules?)/i, /page\s+limit/i, /font\s+size/i, /paper\s+size/i, /binding\s+requirements?/i] },
];

// ─── Classification function ────────────────────────────────────────────────

/**
 * Classify a tender from its extracted text. Evidence-based — returns the
 * first matching pattern as evidence. Unknown stays unknown (never forced).
 */
export function classifyTender(text: string): TenderClassification {
  const trimmed = (text ?? "").trim();
  const sample = trimmed.slice(0, 50_000); // Only scan the first 50K chars

  // Tender type
  let tenderType: TenderType = "unknown";
  let tenderTypeEvidence: string | null = null;
  for (const { type, patterns } of TENDER_TYPE_PATTERNS) {
    for (const pattern of patterns) {
      const match = sample.match(pattern);
      if (match) {
        tenderType = type;
        tenderTypeEvidence = match[0];
        break;
      }
    }
    if (tenderType !== "unknown") break;
  }

  // Procurement structure
  let procurementStructure: ProcurementStructure = "unknown";
  let procurementStructureEvidence: string | null = null;
  for (const { structure, patterns } of PROCUREMENT_STRUCTURE_PATTERNS) {
    for (const pattern of patterns) {
      const match = sample.match(pattern);
      if (match) {
        procurementStructure = structure;
        procurementStructureEvidence = match[0];
        break;
      }
    }
    if (procurementStructure !== "unknown") break;
  }

  // Company services (can match multiple)
  const companyServices: CompanyService[] = [];
  let companyServiceEvidence: string | null = null;
  for (const { service, patterns } of COMPANY_SERVICE_PATTERNS) {
    for (const pattern of patterns) {
      const match = sample.match(pattern);
      if (match) {
        if (!companyServices.includes(service)) {
          companyServices.push(service);
          if (!companyServiceEvidence) companyServiceEvidence = match[0];
        }
        break;
      }
    }
  }
  if (companyServices.length === 0) {
    companyServices.push("unknown");
  }

  // Confidence: higher when multiple signals agree
  const signals = [
    tenderType !== "unknown",
    procurementStructure !== "unknown",
    companyServices.length > 0 && companyServices[0] !== "unknown",
  ];
  const confidence = signals.filter(Boolean).length / signals.length;

  return {
    tenderType,
    tenderTypeEvidence,
    procurementStructure,
    procurementStructureEvidence,
    companyServices,
    companyServiceEvidence,
    confidence,
    classificationSource: "text",
  };
}

/**
 * Classify a requirement text into an evidence category.
 */
export function classifyRequirement(requirementText: string): EvidenceCategory {
  const sample = (requirementText ?? "").trim().slice(0, 2_000);
  for (const { category, patterns } of EVIDENCE_CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(sample)) return category;
    }
  }
  return "unknown";
}

/**
 * Classify the mandatory level of a requirement.
 */
export function classifyRequirementMandatory(requirementText: string): "mandatory" | "critical" | "advisory" {
  const sample = (requirementText ?? "").trim().toLowerCase();
  // Check "must/shall/mandatory/required" first (strongest signal)
  if (/\b(must|shall|mandatory|required|compulsory|obligatory)\b/.test(sample)) return "mandatory";
  // Check "critical/essential/key/core" next
  if (/\b(critical|essential|key|core|important)\b/.test(sample)) return "critical";
  // Check "should/recommended/preferred/desirable/advisory" last
  if (/\b(should|recommended|preferred|desirable|advisory)\b/.test(sample)) return "advisory";
  return "advisory"; // Default to advisory (non-blocking) when unclear
}
