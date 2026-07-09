/**
 * HAEC Service-Stream Methodology Library
 *
 * Generates methodology sections appropriate to each HAEC service stream.
 * Never produces a generic one-size-fits-all methodology.
 */

import type { CompanyService } from "../engine/tender-classification";

export type MethodologySection = {
  title: string;
  content: string;
  deliverables: string[];
};

/**
 * Get the methodology sections for a given service stream.
 */
export function getMethodologyForServiceStream(stream: CompanyService): MethodologySection[] {
  switch (stream) {
    case "architecture":
      return architecturalDesignMethodology();
    case "supervision":
      return supervisionMethodology();
    case "geotechnical":
      return geotechnicalMethodology();
    case "interior-design":
      return interiorDesignMethodology();
    case "urban-planning":
      return urbanPlanningMethodology();
    case "structural":
      return structuralMethodology();
    case "mep":
      return mepMethodology();
    case "roads-transport":
      return roadsMethodology();
    case "water-sanitation":
      return waterSanitationMethodology();
    case "feasibility":
      return feasibilityMethodology();
    case "environmental-social":
      return environmentalMethodology();
    case "project-management":
      return projectManagementMethodology();
    default:
      return defaultMethodology();
  }
}

/**
 * Conceptual service streams supported by the methodology library.
 *
 * These extend the CompanyService union with conceptual streams that the
 * prompt requires (consultancy, contract administration, construction
 * management, building consultancy, engineering design, soil investigation,
 * road/infrastructure consultancy). Each maps to one or more methodology
 * functions.
 */
export type ConceptualServiceStream =
  | CompanyService
  | "consultancy"
  | "contract-administration"
  | "construction-management"
  | "building-consultancy"
  | "engineering-design"
  | "soil-investigation"
  | "infrastructure-consultancy";

/**
 * Get methodology for a conceptual service stream. Falls back to the
 * CompanyService mapping when the stream is a known CompanyService.
 */
export function getMethodologyForConceptualStream(stream: ConceptualServiceStream): MethodologySection[] {
  switch (stream) {
    case "consultancy":
      return consultancyMethodology();
    case "contract-administration":
      return contractAdministrationMethodology();
    case "construction-management":
      return constructionManagementMethodology();
    case "building-consultancy":
      return buildingConsultancyMethodology();
    case "engineering-design":
      return engineeringDesignMethodology();
    case "soil-investigation":
      return soilInvestigationMethodology();
    case "infrastructure-consultancy":
      return infrastructureConsultancyMethodology();
    default:
      return getMethodologyForServiceStream(stream as CompanyService);
  }
}

/**
 * Get combined methodology for multiple conceptual streams (no duplication).
 * Accepts both CompanyService and ConceptualServiceStream values.
 */
export function getCombinedConceptualMethodology(streams: ConceptualServiceStream[]): MethodologySection[] {
  const seen = new Set<string>();
  const combined: MethodologySection[] = [];
  for (const stream of streams) {
    if (stream === "unknown") continue;
    for (const section of getMethodologyForConceptualStream(stream)) {
      if (!seen.has(section.title)) {
        seen.add(section.title);
        combined.push(section);
      }
    }
  }
  if (combined.length === 0) return defaultMethodology();
  return combined;
}

/**
 * Get combined methodology for multiple service streams (no duplication).
 */
export function getCombinedMethodology(streams: CompanyService[]): MethodologySection[] {
  const seen = new Set<string>();
  const combined: MethodologySection[] = [];
  for (const stream of streams) {
    if (stream === "unknown") continue;
    for (const section of getMethodologyForServiceStream(stream)) {
      if (!seen.has(section.title)) {
        seen.add(section.title);
        combined.push(section);
      }
    }
  }
  if (combined.length === 0) return defaultMethodology();
  return combined;
}

// ─── Service-stream methodologies ───────────────────────────────────────────

function architecturalDesignMethodology(): MethodologySection[] {
  return [
    {
      title: "Site and Context Analysis",
      content: "We will conduct a comprehensive site analysis including topographic survey review, climate analysis, solar orientation study, vehicular and pedestrian access assessment, and contextual relationship with adjacent structures. The analysis will identify constraints and opportunities that inform the design response.",
      deliverables: ["Site analysis report", "Contextual study diagrams"],
    },
    {
      title: "Concept Development",
      content: "Based on the site analysis and client brief, we will develop design concepts that respond to the functional requirements, spatial relationships, and aesthetic aspirations of the project. Multiple concept options will be presented for client review and selection.",
      deliverables: ["Concept design drawings", "Design narrative"],
    },
    {
      title: "Schematic Design",
      content: "The selected concept will be developed into schematic design drawings including floor plans, elevations, sections, and 3D visualizations. The schematic design will demonstrate compliance with building codes, zoning requirements, and accessibility standards.",
      deliverables: ["Schematic design drawings", "3D renderings"],
    },
    {
      title: "Design Development",
      content: "The approved schematic design will be developed into detailed design development drawings with material specifications, fenestration details, and coordination with structural and MEP engineering disciplines.",
      deliverables: ["Design development drawings", "Material schedule"],
    },
    {
      title: "Authority Submission and Coordination",
      content: "We will prepare and submit drawings for regulatory approval, coordinate with authorities having jurisdiction, and address review comments. We will coordinate with structural, MEP, and specialist consultants to ensure integrated design solutions.",
      deliverables: ["Authority submission drawings", "Coordination meeting minutes"],
    },
    {
      title: "Deliverables and Quality Assurance",
      content: "All deliverables will undergo internal QA review using our ISO 9001-certified quality management system. Drawing sets will be issued in AutoCAD and PDF formats with a transmittal letter and revision control.",
      deliverables: ["Final drawing package", "QA checklist"],
    },
  ];
}

function supervisionMethodology(): MethodologySection[] {
  return [
    {
      title: "Mobilization",
      content: "We will mobilize the supervision team within 14 days of contract signing, including establishing the site office, deploying the Resident Engineer and key supervision staff, and initiating the document control system.",
      deliverables: ["Mobilization plan", "Site office setup"],
    },
    {
      title: "Site Supervision Methodology",
      content: "Our supervision approach follows FIDIC-based procedures: daily site inspections, weekly progress meetings, method statement reviews, material approval tracking, and non-conformance reporting. The Resident Engineer will maintain a daily site diary and issue instructions as needed.",
      deliverables: ["Site supervision manual", "Daily site diary template"],
    },
    {
      title: "Quality Assurance",
      content: "We will implement a three-tier QA system: contractor self-inspection, consultant verification, and independent audit. All inspection and test plans (ITPs) will be reviewed and approved before execution. Material samples will be tested at approved laboratories.",
      deliverables: ["ITP templates", "Material testing schedule"],
    },
    {
      title: "Progress Monitoring and Reporting",
      content: "Progress will be monitored against the approved work program using Primavera P6. Monthly progress reports will include physical progress, financial status, variations, claims, delays, and risk updates. Weekly progress meetings will be held with the contractor.",
      deliverables: ["Monthly progress report", "Updated work program"],
    },
    {
      title: "Contract Administration",
      content: "We will administer the contract in accordance with the conditions of contract: review and certify payment applications, evaluate variations and claims, maintain change order logs, and issue payment certificates. All contractual correspondence will be logged and tracked.",
      deliverables: ["Payment certificate", "Variation order log"],
    },
    {
      title: "Reporting and Handover",
      content: "We will prepare comprehensive completion reports, as-built drawing reviews, snag lists, and handover documentation. The final handover package will include all supervision records, test results, and warranty tracking.",
      deliverables: ["Completion report", "Handover documentation"],
    },
  ];
}

function geotechnicalMethodology(): MethodologySection[] {
  return [
    {
      title: "Desk Study",
      content: "We will review available geological maps, previous site investigation reports, aerial photographs, and published literature to develop a preliminary ground model and identify potential geohazards.",
      deliverables: ["Desk study report"],
    },
    {
      title: "Field Investigation",
      content: "We will plan and execute a field investigation program including boreholes, trial pits, in-situ testing (SPT, CPT, vane shear), and groundwater monitoring. Borehole locations and depths will be determined based on the desk study and project requirements.",
      deliverables: ["Field investigation plan", "Borehole logs"],
    },
    {
      title: "Laboratory Testing",
      content: "Representative soil and rock samples will be tested at an accredited geotechnical laboratory. The testing program will include index properties, strength testing (triaxial, direct shear), consolidation, and chemical analysis as required.",
      deliverables: ["Laboratory test report"],
    },
    {
      title: "Engineering Analysis",
      content: "We will perform geotechnical analysis including bearing capacity, settlement, slope stability, earth pressure, and liquefaction potential. Analysis will be based on the field and laboratory data using established geotechnical software.",
      deliverables: ["Geotechnical analysis report"],
    },
    {
      title: "Foundation Recommendations",
      content: "Based on the analysis, we will provide foundation recommendations including foundation type, depth, allowable bearing capacity, estimated settlements, and construction considerations. Lateral earth pressure parameters and dewatering requirements will also be provided.",
      deliverables: ["Foundation design report"],
    },
    {
      title: "Safety and Quality Assurance",
      content: "All field and laboratory work will follow relevant standards (ASTM, BS, Eurocode 7). A QA/QC plan will be implemented with calibration records, chain of custody, and data validation. A health and safety plan will be prepared for field work.",
      deliverables: ["QA/QC plan", "HSE plan"],
    },
  ];
}

function interiorDesignMethodology(): MethodologySection[] {
  return [
    {
      title: "Client Brief Validation",
      content: "We will conduct a detailed briefing session with the client to understand functional requirements, aesthetic preferences, brand identity, budget parameters, and project timeline. The brief will be documented and confirmed before design commences.",
      deliverables: ["Design brief document"],
    },
    {
      title: "Concept and Mood Board",
      content: "We will develop design concepts with mood boards, material palettes, and reference imagery that communicate the proposed design direction. Multiple concepts may be presented for client selection.",
      deliverables: ["Mood boards", "Material palette"],
    },
    {
      title: "Space Planning",
      content: "We will prepare detailed space plans showing furniture layout, circulation, zoning, and functional relationships. The space plan will optimize efficiency, comply with codes, and respond to the client's operational needs.",
      deliverables: ["Space plan drawings"],
    },
    {
      title: "Materials, Finishes, and Lighting",
      content: "We will develop a comprehensive finishes schedule, lighting design, and furniture selection. Materials will be specified with sustainability considerations, durability ratings, and maintenance requirements.",
      deliverables: ["Finishes schedule", "Lighting design", "Furniture specification"],
    },
    {
      title: "BOQ and Specifications",
      content: "We will prepare a detailed bill of quantities and technical specifications for all interior works including partitioning, flooring, ceiling, joinery, and MEP coordination. Specifications will reference relevant standards.",
      deliverables: ["BOQ", "Technical specifications"],
    },
    {
      title: "Implementation Supervision",
      content: "If requested, we will provide implementation supervision including site visits, shop drawing review, material approval, quality inspections, and snag list preparation at project completion.",
      deliverables: ["Site visit reports", "Snag list"],
    },
  ];
}

function urbanPlanningMethodology(): MethodologySection[] {
  return [
    {
      title: "Baseline Study",
      content: "We will conduct a comprehensive baseline study covering demographics, land use, infrastructure, environmental conditions, socio-economic profile, and institutional framework. Existing data will be supplemented with field surveys.",
      deliverables: ["Baseline study report"],
    },
    {
      title: "Stakeholder Consultation",
      content: "We will design and facilitate a stakeholder consultation program including focus group discussions, key informant interviews, public meetings, and online surveys. The consultation will inform the planning process and build consensus.",
      deliverables: ["Consultation plan", "Stakeholder report"],
    },
    {
      title: "Spatial Analysis",
      content: "Using GIS tools, we will analyze spatial data including land suitability, accessibility, environmental constraints, development pressure, and infrastructure capacity. The analysis will identify opportunities and constraints for planning options.",
      deliverables: ["GIS analysis maps", "Suitability analysis"],
    },
    {
      title: "Planning Options Development",
      content: "We will develop multiple planning options with different development scenarios, densities, and land use allocations. Each option will be evaluated against planning objectives, feasibility, and stakeholder preferences.",
      deliverables: ["Planning options report", "Comparative evaluation matrix"],
    },
    {
      title: "Infrastructure and Service Planning",
      content: "We will assess infrastructure requirements (transport, water, sanitation, power, telecommunications) and propose phased infrastructure development aligned with the planning framework.",
      deliverables: ["Infrastructure master plan"],
    },
    {
      title: "Implementation Framework",
      content: "We will prepare an implementation framework including phasing, financing options, institutional arrangements, regulatory tools, and monitoring indicators to guide plan delivery.",
      deliverables: ["Implementation framework", "Monitoring plan"],
    },
  ];
}

function structuralMethodology(): MethodologySection[] {
  return [
    {
      title: "Structural Concept Design",
      content: "We will develop structural concept designs that integrate with the architectural vision, including structural system selection, grid layout, and load transfer strategy. Concepts will be evaluated for constructability, cost, and performance.",
      deliverables: ["Structural concept report"],
    },
    {
      title: "Structural Analysis and Design",
      content: "Using established structural analysis software, we will perform detailed analysis and design of all structural elements. Designs will comply with relevant codes (Eurocode, ACI, BS) and include seismic and wind load considerations.",
      deliverables: ["Structural calculation report", "Design drawings"],
    },
    {
      title: "Foundation Design",
      content: "Based on geotechnical recommendations, we will design foundations (shallow or deep) including pile caps, footings, rafts, and retaining walls. Settlement and differential settlement will be checked.",
      deliverables: ["Foundation design drawings"],
    },
    {
      title: "Construction Documents",
      content: "We will prepare detailed structural drawings, bar bending schedules, and technical specifications suitable for tender and construction. Drawings will be coordinated with architectural and MEP disciplines.",
      deliverables: ["Structural drawing package", "Bar bending schedule"],
    },
  ];
}

function mepMethodology(): MethodologySection[] {
  return [
    {
      title: "MEP System Design",
      content: "We will design mechanical (HVAC, ventilation), electrical (power, lighting, LV), and plumbing (water supply, drainage, fire protection) systems that meet the project's functional requirements and energy efficiency targets.",
      deliverables: ["MEP design report"],
    },
    {
      title: "System Sizing and Calculations",
      content: "We will perform load calculations (cooling/heating, electrical demand, water demand), equipment sizing, and system selection. Calculations will be documented and verified.",
      deliverables: ["Load calculation report", "Equipment schedule"],
    },
    {
      title: "MEP Drawings and Coordination",
      content: "We will produce coordinated MEP drawings showing routing, equipment locations, and clearances. Clash detection will be performed using BIM tools to ensure coordination with structural and architectural disciplines.",
      deliverables: ["MEP drawing package", "Clash detection report"],
    },
    {
      title: "Commissioning and Specifications",
      content: "We will prepare technical specifications, commissioning procedures, and testing requirements. Commissioning will verify that installed systems perform as designed.",
      deliverables: ["Technical specifications", "Commissioning plan"],
    },
  ];
}

function roadsMethodology(): MethodologySection[] {
  return [
    {
      title: "Route Selection and Alignment",
      content: "We will evaluate alternative route options based on topography, geotechnical conditions, environmental impact, land acquisition, and construction cost. The selected alignment will be optimized for safety, drainage, and earthwork balance.",
      deliverables: ["Route selection report", "Alignment drawings"],
    },
    {
      title: "Pavement Design",
      content: "We will perform pavement design based on traffic analysis, subgrade CBR, and material availability. Both flexible and rigid pavement options will be evaluated. Design will follow AASHTO or relevant local standards.",
      deliverables: ["Pavement design report"],
    },
    {
      title: "Drainage and Structures",
      content: "We will design road drainage systems (surface, subsurface, culverts) and bridge/culvert structures. Hydrological and hydraulic analysis will be performed for all water crossings.",
      deliverables: ["Drainage design report", "Structure drawings"],
    },
    {
      title: "Road Safety Audit",
      content: "We will conduct road safety audits at design, construction, and pre-opening stages. Audit findings will be documented with recommendations for risk mitigation.",
      deliverables: ["Road safety audit report"],
    },
  ];
}

function waterSanitationMethodology(): MethodologySection[] {
  return [
    {
      title: "Demand Assessment",
      content: "We will assess current and projected water demand and wastewater generation based on population projections, per capita consumption, and industrial/commercial demand. Demand projections will cover the design horizon.",
      deliverables: ["Demand assessment report"],
    },
    {
      title: "System Design",
      content: "We will design water supply systems (intake, treatment, transmission, distribution) and sanitation systems (collection, treatment, disposal). Design will include hydraulic modeling, network analysis, and treatment process selection.",
      deliverables: ["System design report", "Network drawings"],
    },
    {
      title: "Treatment Process Design",
      content: "We will select and design appropriate treatment processes based on raw water/wastewater quality, effluent standards, and O&M considerations. Process flow diagrams and equipment sizing will be provided.",
      deliverables: ["Process flow diagrams", "Equipment schedule"],
    },
    {
      title: "Construction Supervision",
      content: "If requested, we will provide construction supervision including quality control, progress monitoring, testing, and commissioning of water/sanitation infrastructure.",
      deliverables: ["Supervision plan", "Testing protocol"],
    },
  ];
}

function feasibilityMethodology(): MethodologySection[] {
  return [
    {
      title: "Technical Feasibility",
      content: "We will assess the technical feasibility of the project including site conditions, technology options, infrastructure requirements, and construction methodology. Technical risks will be identified with mitigation measures.",
      deliverables: ["Technical feasibility report"],
    },
    {
      title: "Economic and Financial Analysis",
      content: "We will perform cost-benefit analysis, financial modeling, and sensitivity analysis. The analysis will cover capital costs, O&M costs, revenue projections, and economic internal rate of return.",
      deliverables: ["Financial model", "Cost-benefit analysis"],
    },
    {
      title: "Environmental and Social Assessment",
      content: "We will conduct a screening-level environmental and social impact assessment, identifying potential impacts and recommending mitigation measures in line with national and donor requirements.",
      deliverables: ["ESIA screening report"],
    },
    {
      title: "Implementation Roadmap",
      content: "We will prepare an implementation roadmap including project phasing, procurement strategy, institutional arrangements, and risk management framework.",
      deliverables: ["Implementation roadmap"],
    },
  ];
}

function environmentalMethodology(): MethodologySection[] {
  return [
    {
      title: "Scoping and Baseline",
      content: "We will conduct scoping to identify key environmental and social issues, followed by baseline data collection on biophysical and socio-economic conditions. The scoping report will define the assessment boundaries.",
      deliverables: ["Scoping report", "Baseline data report"],
    },
    {
      title: "Impact Identification and Assessment",
      content: "We will identify and assess potential environmental and social impacts using standardized matrices and expert judgment. Impacts will be classified by magnitude, duration, extent, and significance.",
      deliverables: ["Impact assessment matrix"],
    },
    {
      title: "Mitigation and Management Plan",
      content: "We will develop an Environmental and Social Management Plan (ESMP) with mitigation measures, monitoring indicators, institutional responsibilities, and cost estimates. The ESMP will be aligned with donor safeguard policies.",
      deliverables: ["ESMP"],
    },
    {
      title: "Stakeholder Engagement",
      content: "We will design and implement a stakeholder engagement plan including consultation meetings, grievance redress mechanism, and disclosure of assessment findings.",
      deliverables: ["Stakeholder engagement plan", "Consultation report"],
    },
  ];
}

function projectManagementMethodology(): MethodologySection[] {
  return [
    {
      title: "Project Initiation and Planning",
      content: "We will develop a comprehensive project management plan covering scope, schedule, budget, quality, risk, communications, and procurement. The plan will be aligned with PMI/PMBOK or PRINCE2 methodology.",
      deliverables: ["Project management plan"],
    },
    {
      title: "Schedule and Cost Control",
      content: "We will implement schedule and cost control using earned value management. Regular progress monitoring, variance analysis, and forecasting will be performed. Change management procedures will be enforced.",
      deliverables: ["EVM report", "Change order log"],
    },
    {
      title: "Risk Management",
      content: "We will maintain a project risk register with identified risks, probability, impact, mitigation measures, and owners. Regular risk reviews will be conducted and the register updated.",
      deliverables: ["Risk register"],
    },
    {
      title: "Quality and Reporting",
      content: "We will implement a quality management system and prepare regular progress reports for stakeholders. Reports will cover physical progress, financial status, risks, issues, and lookahead.",
      deliverables: ["Monthly progress report", "Quality plan"],
    },
  ];
}

function defaultMethodology(): MethodologySection[] {
  return [
    {
      title: "Project Understanding and Approach",
      content: "We have carefully reviewed the tender requirements and will apply our proven project approach to deliver the scope of services. Our methodology is structured into clear phases with defined deliverables and quality checkpoints.",
      deliverables: ["Project approach document"],
    },
    {
      title: "Execution Plan",
      content: "Our execution plan is based on best practices in the industry, with a focus on quality, timeliness, and client satisfaction. We will assign qualified personnel and use appropriate tools and technologies.",
      deliverables: ["Execution plan"],
    },
  ];
}

// ─── Conceptual-stream methodologies (prompt-required) ──────────────────────
//
// These extend the 12 CompanyService methodologies with 7 conceptual streams
// required by the release-manager prompt:
//   consultancy, contract-administration, construction-management,
//   building-consultancy, engineering-design, soil-investigation,
//   infrastructure-consultancy.

function consultancyMethodology(): MethodologySection[] {
  return [
    {
      title: "Scoping and Diagnosis",
      content: "We will conduct a structured scoping workshop with the client to confirm the assignment objectives, boundaries, stakeholders, and success criteria. A diagnostic phase will review existing documentation, identify gaps, and produce a clear problem statement that guides the consultancy engagement.",
      deliverables: ["Scoping report", "Diagnostic memo"],
    },
    {
      title: "Stakeholder Engagement",
      content: "We will identify all relevant stakeholders (internal teams, beneficiaries, regulators, donors) and design an engagement plan that ensures their input is captured at the right milestones. This includes key-informant interviews, focus groups, and validation workshops.",
      deliverables: ["Stakeholder map", "Engagement plan"],
    },
    {
      title: "Analysis and Recommendations",
      content: "Our analysis will combine quantitative and qualitative methods appropriate to the assignment. We will benchmark against international good practice, identify root causes (not just symptoms), and formulate actionable recommendations with clear ownership, timelines, and resource implications.",
      deliverables: ["Analysis report", "Recommendations matrix"],
    },
    {
      title: "Implementation Roadmap",
      content: "We will translate the recommendations into a phased implementation roadmap with quick wins, medium-term actions, and long-term structural changes. The roadmap will include a results framework, risk register, and monitoring indicators.",
      deliverables: ["Implementation roadmap", "Results framework"],
    },
    {
      title: "Knowledge Transfer",
      content: "Throughout the engagement, we will document our methodology, assumptions, and findings in a way that enables the client team to apply the same approach to future assignments. A final knowledge-transfer session will walk the client team through the deliverables.",
      deliverables: ["Knowledge-transfer session", "Methodology handbook"],
    },
  ];
}

function contractAdministrationMethodology(): MethodologySection[] {
  return [
    {
      title: "Contract Familiarization and Setup",
      content: "We will review the contract documents (conditions of contract, technical specifications, drawings, BOQ) and establish a contract administration framework. This includes setting up the contract register, payment certificate templates, variation order log, and claims tracking system.",
      deliverables: ["Contract register", "Administration manual"],
    },
    {
      title: "Payment Certification",
      content: "We will review the contractor's payment applications against the work actually executed on site, the contract rates, and the approved work program. Each payment certificate will be issued with supporting calculations, deductions for retentions and advances, and clear justification for any disputed items.",
      deliverables: ["Payment certificate", "Payment schedule"],
    },
    {
      title: "Variation and Claim Management",
      content: "We will evaluate contractor variations and claims against the contract provisions, including time-extension claims, rate-breakdown submissions, and quantum-merit claims. Each variation will be documented with a variation order, cost breakdown, and approval trace. Claims will be assessed for contractual merit and quantum reasonableness.",
      deliverables: ["Variation order log", "Claims assessment report"],
    },
    {
      title: "Contract Closeout",
      content: "At contract completion, we will administer the closeout process: final account reconciliation, retention release, defect-liability tracking, acceptance certificates, and lessons-learned documentation. The final closeout package will provide a complete audit trail of all contractual actions.",
      deliverables: ["Final account statement", "Closeout report"],
    },
  ];
}

function constructionManagementMethodology(): MethodologySection[] {
  return [
    {
      title: "Pre-Construction Planning",
      content: "We will lead pre-construction planning including constructability review, value engineering workshops, procurement scheduling, and mobilization planning. The construction management plan will address site logistics, safety, environmental controls, and quality management.",
      deliverables: ["Construction management plan", "Constructability report"],
    },
    {
      title: "Schedule and Cost Control",
      content: "We will implement earned-value management using Primavera P6 or MS Project. The baseline schedule will be resource-loaded, and progress will be tracked against it weekly. Cost control will monitor committed costs vs. budget, forecast at completion, and variance analysis.",
      deliverables: ["Baseline schedule", "EVM dashboard"],
    },
    {
      title: "Quality and Safety Management",
      content: "We will enforce a three-tier quality system (contractor self-inspection, consultant verification, independent audit) with inspection-and-test plans (ITPs) approved before execution. Safety management follows a project-specific HSE plan with daily toolbox talks, weekly walks, and incident reporting.",
      deliverables: ["ITP register", "HSE plan"],
    },
    {
      title: "Subcontractor and Supply Chain Coordination",
      content: "We will coordinate subcontractors and the supply chain through weekly coordination meetings, look-ahead schedules, and material-approval tracking. Long-lead items will be identified early and procured against the critical path.",
      deliverables: ["Coordination meeting minutes", "Look-ahead schedule"],
    },
    {
      title: "Commissioning and Handover",
      content: "We will manage the commissioning process: pre-commissioning checks, functional performance tests, integrated system tests, and readiness for handover. The handover package will include as-built drawings, O&M manuals, warranty tracking, and training records.",
      deliverables: ["Commissioning plan", "Handover package"],
    },
  ];
}

function buildingConsultancyMethodology(): MethodologySection[] {
  return [
    {
      title: "Building Condition Assessment",
      content: "We will conduct a comprehensive condition assessment of the building including structural elements, envelope, MEP systems, interiors, and site works. The assessment will identify defects, their causes, and recommended remedial works with cost estimates.",
      deliverables: ["Condition assessment report"],
    },
    {
      title: "Compliance and Code Review",
      content: "We will review the building against applicable codes (building, fire, accessibility, energy) and identify non-compliances. A compliance matrix will document each finding, the relevant code clause, and the remediation required.",
      deliverables: ["Compliance matrix", "Code review report"],
    },
    {
      title: "Energy and Sustainability Audit",
      content: "We will perform an energy audit identifying energy-conservation measures with payback analysis. Sustainability recommendations will cover water efficiency, waste management, indoor environmental quality, and certification opportunities (LEED, BREEAM, EDGE).",
      deliverables: ["Energy audit report", "Sustainability recommendations"],
    },
    {
      title: "Capital Planning and Lifecycle Analysis",
      content: "We will develop a 10-year capital plan identifying major repairs, replacements, and upgrades with cost forecasts and prioritization. Lifecycle analysis will evaluate the total cost of ownership for major systems.",
      deliverables: ["Capital plan", "Lifecycle cost analysis"],
    },
  ];
}

function engineeringDesignMethodology(): MethodologySection[] {
  return [
    {
      title: "Design Basis and Criteria",
      content: "We will establish the design basis including applicable codes, standards, loadings, materials, and performance criteria. The design basis document will be reviewed and approved by the client before design commences.",
      deliverables: ["Design basis document"],
    },
    {
      title: "Concept and Preliminary Design",
      content: "We will develop concept design options evaluating alternative materials, systems, and configurations. The preferred option will be developed into a preliminary design with sufficient detail to confirm feasibility, cost, and schedule.",
      deliverables: ["Concept design report", "Preliminary design drawings"],
    },
    {
      title: "Detailed Design and Analysis",
      content: "We will perform detailed engineering analysis using established software (ETABS, SAP2000, STAAD, Revit, Civil 3D). The design will be coordinated across disciplines (civil, structural, MEP, architectural) using BIM clash detection.",
      deliverables: ["Design calculation report", "Detailed design drawings"],
    },
    {
      title: "Construction Documents",
      content: "We will produce construction documents including technical specifications, BOQ, and bid-ready drawings. The documents will be sealed by licensed engineers and suitable for permit application and competitive bidding.",
      deliverables: ["Technical specifications", "BOQ", "Construction drawings"],
    },
    {
      title: "Design Review and Verification",
      content: "We will conduct independent design reviews at 30%, 60%, and 90% milestones. Verification checks will confirm code compliance, constructability, and alignment with the design basis. Comments will be tracked to closure in a review log.",
      deliverables: ["Design review reports", "Comment tracking log"],
    },
  ];
}

function soilInvestigationMethodology(): MethodologySection[] {
  return [
    {
      title: "Reconnaissance and Planning",
      content: "We will conduct a site reconnaissance to observe surface conditions, access constraints, and existing structures. A soil-investigation plan will be prepared specifying borehole locations, depths, sampling intervals, and in-situ tests based on the project type and loads.",
      deliverables: ["Soil-investigation plan", "Site reconnaissance memo"],
    },
    {
      title: "Field Investigation",
      content: "We will execute the field investigation including borehole drilling, standard penetration tests (SPT), cone penetration tests (CPT), vane shear tests, and groundwater monitoring. Disturbed and undisturbed samples will be collected for laboratory testing with proper chain-of-custody documentation.",
      deliverables: ["Borehole logs", "Field investigation report"],
    },
    {
      title: "Laboratory Testing",
      content: "We will perform laboratory tests on representative samples at an accredited geotechnical laboratory. The test program includes index properties (grain size, Atterberg limits, specific gravity), strength (triaxial, direct shear, unconfined compression), consolidation, and chemical tests (sulphate, chloride, organic content).",
      deliverables: ["Laboratory test report"],
    },
    {
      title: "Geotechnical Analysis and Reporting",
      content: "We will analyze the field and laboratory data to develop a geotechnical model of the site. The analysis includes bearing capacity, settlement, slope stability, earth pressures, liquefaction potential, and foundation recommendations. The report will provide design parameters and construction considerations.",
      deliverables: ["Geotechnical investigation report", "Foundation design parameters"],
    },
  ];
}

function infrastructureConsultancyMethodology(): MethodologySection[] {
  return [
    {
      title: "Infrastructure Needs Assessment",
      content: "We will assess current and future infrastructure demand based on demographic projections, economic trends, and service-level targets. The needs assessment covers transport, water, sanitation, power, telecommunications, and social infrastructure.",
      deliverables: ["Needs assessment report"],
    },
    {
      title: "Options Appraisal",
      content: "We will develop and appraise alternative infrastructure options using multi-criteria analysis (MCA) covering technical feasibility, cost, environmental impact, social impact, and risk. The preferred option will be validated through stakeholder consultation.",
      deliverables: ["Options appraisal report", "MCA matrix"],
    },
    {
      title: "Engineering Feasibility",
      content: "We will confirm engineering feasibility of the preferred option through preliminary design, site investigations, hydraulic/hydrological analysis, and constructability review. The feasibility report will include a Class-3 cost estimate and indicative schedule.",
      deliverables: ["Feasibility report", "Class-3 cost estimate"],
    },
    {
      title: "Environmental and Social Safeguards",
      content: "We will conduct an environmental and social screening aligned with national requirements and donor safeguard policies (IFC PS, World Bank ESS, AfDB OS). An ESMP will be prepared with mitigation measures, monitoring indicators, and institutional responsibilities.",
      deliverables: ["ESIA screening report", "ESMP"],
    },
    {
      title: "Procurement and Implementation Support",
      content: "We will support procurement through bid-document preparation, bid evaluation, and contract negotiation. During implementation, we will provide construction supervision, contract administration, and progress monitoring against the results framework.",
      deliverables: ["Bid documents", "Supervision plan", "Progress reports"],
    },
  ];
}
