/**
 * Tender-domain-specific generation instructions.
 *
 * Given the tender title and category string, returns a focused instruction
 * block that is injected into the AI generation prompt so the writer
 * addresses the technical concerns that evaluators in that sector actually
 * score. Returns an empty string for generic/unrecognised tenders so
 * callers can safely .filter(Boolean) or check truthiness.
 *
 * Integration point in generate-elite.ts:
 *   After `evaluationMethodology` is assembled (around line 1504-1526),
 *   append `getTenderDomainInstructions(cleanedTenderTitle, tender.category ?? "")` as
 *   an additional entry in the evaluationMethodology array (inside the
 *   .filter(Boolean).join("\n") block).
 *
 *   Alternatively, inject it into `aiInputBase.evaluationMethodology`:
 *
 *     const domainBlock = getTenderDomainInstructions(
 *       cleanedTenderTitle,
 *       tender.category ?? "",
 *     );
 *
 *   Then add `domainBlock` to the evaluationMethodology join array so it
 *   appears alongside evaluation criteria and rubric directives.
 */

export function getTenderDomainInstructions(title: string, category: string): string {
  const combined = `${title} ${category}`.toLowerCase();

  // EOI/RFQ/RFP document-type signals must be checked FIRST — before any
  // sector keyword, because "EOI for architectural design services" must
  // produce EOI guidance, not full architectural-proposal guidance.
  if (/\beoi\b|expression.?of.?interest/.test(combined)) {
    return `TENDER DOCUMENT TYPE — EXPRESSION OF INTEREST (EOI):
This is a pre-qualification Expression of Interest, NOT a full technical proposal. The EOI must:
- Be concise — evaluators score on eligibility and relevance, not volume
- Lead with: firm credentials, legal standing, relevant sector experience summary
- Present team composition at overview level (names + roles only — no full CVs)
- Demonstrate understanding of the assignment scope in 1–2 focused paragraphs
- State motivation for interest and any unique positioning clearly
- List 3–5 most relevant comparable projects (name, client, value, year, your role)
- Confirm availability and capacity to mobilise within the stated timeline
DO NOT include a full Technical Proposal, Financial Proposal, or detailed methodology at EOI stage — it wastes evaluator time and signals poor bid process literacy.`;
  }

  if (/building|design|architect|interior/.test(combined)) {
    return `TENDER DOMAIN — BUILDING / ARCHITECTURAL DESIGN:
This is a building/architectural design tender. The proposal must explicitly address:
- Design philosophy and aesthetic approach aligned with client brief
- Compliance with applicable building codes, standards, and regulations
- Architectural drawing process: concept → schematic → detailed design stages
- Structural and MEP (mechanical, electrical, plumbing) integration considerations
- Materials specification strategy and value-engineering approach
- Project management methodology for design delivery
- Design quality assurance — review gates, checking procedures, revision rounds
- Team composition: lead architect, structural engineer, MEP specialist roles
Do NOT write generic infrastructure methodology for a design tender.`;
  }

  if (/road|highway|pavement|asphalt|civil/.test(combined)) {
    return `TENDER DOMAIN — ROAD / HIGHWAY / CIVIL INFRASTRUCTURE:
This is a road/infrastructure construction or supervision tender. The proposal must explicitly address:
- Construction methodology: earthworks, sub-base, base course, wearing course sequencing
- Material testing regime: CBR, compaction tests, Marshall stability for asphalt mixes
- Compaction specifications and field density testing schedule
- Drainage design: side drains, culverts, camber specification
- Traffic management plan during construction
- HSE (Health, Safety & Environment) plan specific to road works
- Quality control plan aligned with relevant road construction standards (e.g., ERA, AASHTO, BS)
- Equipment mobilization schedule and key plant
Do NOT write generic consulting methodology for a civil works tender.`;
  }

  if (/water|sanitation|wash|pipe|borehole|irrigation|drainage/.test(combined)) {
    return `TENDER DOMAIN — WATER / SANITATION / WASH:
This is a water supply, sanitation, or WASH-sector tender. The proposal must explicitly address:
- Hydraulic design approach: pipe sizing, pressure analysis, network modelling
- Pipe specification: material selection (HDPE, GI, uPVC), jointing, pressure class
- Water quality testing plan and treatment design if applicable
- Community engagement and social mobilisation approach
- Operation and Maintenance (O&M) plan and capacity building
- Environmental compliance: EIA requirements, abstraction permits, effluent standards
- WASH standards compliance (e.g., WHO, Sphere standards, UNICEF guidelines)
- For boreholes: drilling methodology, pump test design, water quality sampling
Do NOT write generic infrastructure methodology for a water/sanitation tender.`;
  }

  if (/geotechnical|soil|investigation|borehole/.test(combined)) {
    return `TENDER DOMAIN — GEOTECHNICAL INVESTIGATION:
This is a geotechnical investigation tender. The proposal must explicitly address:
- Investigation methodology: desk study, field reconnaissance, borehole/trial pit programme
- Borehole programme design: number, depths, spacing rationale based on site and structure type
- In-situ testing plan: SPT, CPT, vane shear, permeability tests as appropriate
- Laboratory testing plan: classification, compaction, shear strength, consolidation tests
- Data analysis approach: bearing capacity, settlement analysis, slope stability if relevant
- Reporting standards: factual report vs interpretive report separation
- Equipment mobilization: drilling rig type, support vehicles, lab capacity
- Health, safety, and environmental controls for site investigation works
Do NOT write generic consulting methodology for a geotechnical investigation tender.`;
  }

  if (/urban|planning|master.?plan|land.?use/.test(combined)) {
    return `TENDER DOMAIN — URBAN PLANNING / MASTER PLAN:
This is an urban planning or master planning tender. The proposal must explicitly address:
- Planning methodology: baseline analysis, visioning, scenario development, draft plan, stakeholder review
- Stakeholder and community engagement plan: workshops, surveys, public participation schedule
- Zoning analysis and land use assessment approach
- GIS mapping and spatial data analysis strategy
- Infrastructure capacity analysis (roads, utilities, green space)
- Regulatory compliance: alignment with national planning legislation and urban development frameworks
- Planning standards referenced: national urban planning standards or relevant international benchmarks
- Deliverables: phasing of draft structure plans, zoning maps, regulations
Do NOT write generic consulting methodology for an urban planning tender.`;
  }

  if (/hospital|medical|clinic|health(?:care|[\s-]facilit)/.test(combined)) {
    return `TENDER DOMAIN — HEALTHCARE / HOSPITAL FACILITY:
This is a healthcare facility construction, design, or supervision tender. The proposal must explicitly address:
- Infection control design: ventilation zoning (positive/negative pressure), HEPA filtration, hand hygiene infrastructure
- Medical equipment planning: equipment schedule, utility rough-in coordination
- Patient flow design: separation of clean/dirty corridors, emergency vs. elective pathways
- Accessibility compliance: barrier-free design, ramp gradients, signage standards
- Facility management and commissioning plan for clinical environments
- Compliance with healthcare facility regulations and standards (e.g., FGI Guidelines, SANS/ISO applicable standards, national health facility standards)
- Biomedical systems integration: medical gas, nurse-call, patient monitoring rough-ins
Do NOT write generic building methodology for a healthcare facility tender.`;
  }

  if (/\bdonor\b|\bida\b|\badb\b|\bafdb\b|world.?bank|eu.?fund|usaid|dfid|giz\b/.test(combined)) {
    return `TENDER DOMAIN — DONOR / MULTILATERAL BANK-FUNDED PROJECT:
This is a donor or multilateral bank-funded assignment. The proposal must explicitly address:
- Development objectives alignment: link deliverables to the project's stated development outcomes
- Poverty reduction / social impact indicators where relevant
- Procurement compliance: confirm methodology complies with the specific donor's procurement rules
  (e.g., World Bank Procurement Regulations, ADB Procurement Policy, AfDB Rules, EU PRAG)
- Environmental and Social Safeguards: reference the applicable safeguard framework (e.g., World Bank ESF, IFC PS)
- Gender mainstreaming: describe how gender equity is integrated into work plan and team composition
- Fiduciary standards: financial management, audit, and reporting obligations
- Results framework: inputs → activities → outputs → outcomes → impact chain
- Anti-corruption and integrity compliance: reference donor's code of conduct requirements
Do NOT write a standard government-RFP proposal for a donor-funded tender — procurement rules, language, and evaluation criteria differ significantly.`;
  }

  return "";
}
