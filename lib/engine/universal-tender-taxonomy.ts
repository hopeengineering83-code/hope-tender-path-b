export type ServiceCapability =
  | "ARCHITECTURAL_DESIGN"
  | "INTERIOR_DESIGN"
  | "ENGINEERING_DESIGN"
  | "SUPERVISION"
  | "CONTRACT_ADMINISTRATION"
  | "GEOTECHNICAL_INVESTIGATION"
  | "URBAN_PLANNING"
  | "ASSET_MANAGEMENT"
  | "PROJECT_MANAGEMENT"
  | "FEASIBILITY_STUDY"
  | "QUANTITY_SURVEYING_BOQ"
  | "ENVIRONMENT_SOCIAL"
  | "MEP_ELECTROMECHANICAL"
  | "WATER_SANITATION"
  | "TRANSPORT_INFRASTRUCTURE"
  | "BUILDING_FACILITIES"
  | "PROCUREMENT_ADVISORY"
  | "TRAINING_CAPACITY_BUILDING"
  | "POWER_SYSTEMS_ENGINEERING"
  | "RESOURCE_GEOLOGY"
  | "MARITIME_ENGINEERING"
  | "PROCESS_ENGINEERING"
  | "REGULATORY_COMPLIANCE_ADVISORY"
  | "TELECOMS_PLANNING";

export type TenderForm =
  | "EOI"
  | "RFP"
  | "RFQ"
  | "ITT"
  | "PREQUALIFICATION"
  | "TECHNICAL_PROPOSAL"
  | "FINANCIAL_PROPOSAL"
  | "FRAMEWORK"
  | "CONSULTANCY";

export type SectorDomain =
  | "HEALTHCARE"
  | "EDUCATION"
  | "COMMERCIAL_INDUSTRIAL"
  | "RESIDENTIAL_HOUSING"
  | "URBAN_MUNICIPAL"
  | "WATER_SANITATION"
  | "TRANSPORT"
  | "ENERGY"
  | "AGRICULTURE_RURAL"
  | "PUBLIC_ADMINISTRATION"
  | "ICT_DIGITAL"
  | "LOGISTICS_WAREHOUSING"
  | "GENERAL_BUILDINGS"
  | "MINING_EXTRACTIVE"
  | "PORT_MARITIME"
  | "OIL_GAS"
  | "FINANCIAL_SERVICES"
  | "TELECOMS_BROADBAND";

export type UniversalTenderProfile = {
  serviceCapabilities: ServiceCapability[];
  tenderForms: TenderForm[];
  sectorDomains: SectorDomain[];
  textSignals: string[];
};

type PatternMap<T extends string> = Record<T, RegExp[]>;

const SERVICE_PATTERNS: PatternMap<ServiceCapability> = {
  ARCHITECTURAL_DESIGN: [/architect(?:ure|ural)?/i, /concept\s+design/i, /schematic\s+design/i, /design\s+development/i, /building\s+design/i],
  INTERIOR_DESIGN: [/interior/i, /fit[-\s]?out/i, /space\s+planning/i, /furniture/i, /finishes/i, /joinery/i, /ceiling/i, /flooring/i, /partition/i],
  ENGINEERING_DESIGN: [/engineering\s+design/i, /structural/i, /civil\s+design/i, /detailed\s+design/i, /design\s+review/i, /drawings?/i, /specifications?/i],
  SUPERVISION: [/supervision/i, /construction\s+supervision/i, /site\s+supervision/i, /resident\s+engineer/i, /quality\s+control/i, /inspection/i],
  CONTRACT_ADMINISTRATION: [/contract\s+administration/i, /contract\s+management/i, /claims?/i, /variation\s+orders?/i, /interim\s+payment/i, /payment\s+certificate/i, /fidic/i],
  GEOTECHNICAL_INVESTIGATION: [/geotechnical/i, /geo[-\s]?technical/i, /soil\s+investigation/i, /foundation\s+investigation/i, /borehole/i, /subsurface/i, /laboratory\s+test/i, /ground\s+investigation/i],
  URBAN_PLANNING: [/urban\s+planning/i, /urban\s+design/i, /master\s+plan/i, /structure\s+plan/i, /spatial\s+plan/i, /land\s+use/i, /zoning/i, /municipal\s+plan/i, /city\s+plan/i],
  ASSET_MANAGEMENT: [/asset\s+management/i, /facility\s+management/i, /condition\s+assessment/i, /asset\s+register/i, /maintenance\s+plan/i, /lifecycle/i, /operation\s+and\s+maintenance/i, /o&m/i],
  PROJECT_MANAGEMENT: [/project\s+management/i, /programme\s+management/i, /coordination/i, /work\s+plan/i, /schedule/i, /planning\s+and\s+control/i, /pmp/i],
  FEASIBILITY_STUDY: [/feasibility/i, /pre[-\s]?feasibility/i, /study/i, /assessment/i, /options\s+analysis/i, /business\s+case/i],
  QUANTITY_SURVEYING_BOQ: [/quantity\s+survey/i, /boq/i, /bill\s+of\s+quantit/i, /cost\s+estimate/i, /cost\s+plan/i, /engineer'?s\s+estimate/i],
  ENVIRONMENT_SOCIAL: [/environment/i, /social/i, /esia/i, /esmp/i, /safeguard/i, /impact\s+assessment/i, /resettlement/i, /climate/i],
  MEP_ELECTROMECHANICAL: [/mep/i, /mechanical/i, /electrical/i, /electromechanical/i, /hvac/i, /plumbing/i, /fire\s+fighting/i, /low\s+current/i, /power/i],
  WATER_SANITATION: [/water/i, /sanitation/i, /wastewater/i, /stormwater/i, /drainage/i, /pipeline/i, /reservoir/i, /pump/i, /wash/i],
  TRANSPORT_INFRASTRUCTURE: [/road/i, /bridge/i, /transport/i, /traffic/i, /parking/i, /pavement/i, /airport/i, /rail/i],
  BUILDING_FACILITIES: [/building/i, /facility/i, /office/i, /hospital/i, /school/i, /warehouse/i, /campus/i, /complex/i, /center/i, /centre/i],
  PROCUREMENT_ADVISORY: [/procurement/i, /bid\s+evaluation/i, /tender\s+document/i, /employer'?s\s+requirements/i, /evaluation\s+criteria/i],
  TRAINING_CAPACITY_BUILDING: [/training/i, /capacity\s+building/i, /workshop/i, /knowledge\s+transfer/i, /institutional\s+strengthening/i],
  POWER_SYSTEMS_ENGINEERING: [/load[-\s]?flow/i, /protection\s+relay/i, /single[-\s]?line\s+diagram/i, /\bscada\b/i, /grid[-\s]?code/i, /p50/i, /p90/i, /\bfat\b.*\bsat\b|\bsat\b.*\bfat\b/i],
  RESOURCE_GEOLOGY: [/\bjorc\b/i, /resource\s+estim/i, /block\s+model/i, /competent\s+person/i, /tailings\s+facilit/i, /slope\s+stability/i, /tsf\b/i],
  MARITIME_ENGINEERING: [/met[-\s]?ocean/i, /bathymetric/i, /nautical\s+simul/i, /dredge\s+volume/i, /berth\s+design/i, /shore[-\s]?power/i],
  PROCESS_ENGINEERING: [/hazop/i, /p&id/i, /lopa/i, /pipeline\s+stress/i, /cathodic\s+protect/i, /caesar\s+ii/i, /\bpsi\b/i, /ili\s+programme/i],
  REGULATORY_COMPLIANCE_ADVISORY: [/\bkyc\b/i, /\baml\b/i, /\brbac\b/i, /data\s+migrat/i, /parallel[-\s]?run/i, /\bifrs\b/i, /\bbasel\b/i, /regulatory\s+gap/i],
  TELECOMS_PLANNING: [/spectrum\s+licens/i, /rf\s+coverage/i, /drive[-\s]?test/i, /\brsrp\b/i, /backhaul\s+design/i, /path\s+availab/i, /\bsar\b.*emr|\bemr\b/i],
};

const TENDER_FORM_PATTERNS: PatternMap<TenderForm> = {
  EOI: [/\beoi\b/i, /expression\s+of\s+interest/i],
  RFP: [/\brfp\b/i, /request\s+for\s+proposals?/i],
  RFQ: [/\brfq\b/i, /request\s+for\s+quotations?/i],
  ITT: [/\bitt\b/i, /invitation\s+to\s+tender/i, /invitation\s+for\s+bids?/i],
  PREQUALIFICATION: [/pre[-\s]?qualification/i, /shortlist/i, /registration\s+of\s+consultants/i],
  TECHNICAL_PROPOSAL: [/technical\s+proposal/i, /technical\s+offer/i, /methodology/i, /approach/i, /work\s+plan/i],
  FINANCIAL_PROPOSAL: [/financial\s+proposal/i, /price\s+schedule/i, /priced\s+boq/i, /commercial\s+proposal/i],
  FRAMEWORK: [/framework\s+agreement/i, /call[-\s]?off/i, /multiple\s+award/i],
  CONSULTANCY: [/consultancy/i, /consulting\s+services/i, /consultant/i],
};

const SECTOR_PATTERNS: PatternMap<SectorDomain> = {
  HEALTHCARE: [/health/i, /hospital/i, /medical/i, /clinic/i, /patient/i, /pharmacy/i, /laboratory/i, /biomedical/i],
  EDUCATION: [/school/i, /university/i, /college/i, /education/i, /classroom/i, /campus/i],
  COMMERCIAL_INDUSTRIAL: [/commercial/i, /industrial/i, /factory/i, /manufactur/i, /retail/i, /mall/i, /hotel/i],
  RESIDENTIAL_HOUSING: [/residential/i, /housing/i, /apartment/i, /condominium/i, /real\s+estate/i],
  URBAN_MUNICIPAL: [/urban/i, /municipal/i, /city/i, /town/i, /woreda/i, /kebele/i, /spatial/i],
  WATER_SANITATION: [/water/i, /sanitation/i, /wastewater/i, /drainage/i, /wash/i, /stormwater/i],
  TRANSPORT: [/road/i, /bridge/i, /transport/i, /traffic/i, /rail/i, /airport/i, /parking/i],
  ENERGY: [/energy/i, /power/i, /solar/i, /grid/i, /substation/i, /renewable/i, /electrical/i],
  AGRICULTURE_RURAL: [/agricultur/i, /rural/i, /irrigation/i, /livestock/i, /agribusiness/i, /food\s+security/i],
  PUBLIC_ADMINISTRATION: [/government/i, /public\s+sector/i, /institutional/i, /ministry/i, /authority/i, /administration/i],
  ICT_DIGITAL: [/ict/i, /digital/i, /software/i, /platform/i, /database/i, /erp/i, /mis/i, /information\s+system/i],
  LOGISTICS_WAREHOUSING: [/warehouse/i, /logistics/i, /cargo/i, /freight/i, /supply\s+chain/i, /storage/i],
  GENERAL_BUILDINGS: [/building/i, /facility/i, /office/i, /complex/i, /centre/i, /center/i],
  MINING_EXTRACTIVE: [/mining/i, /\bjorc\b/i, /tailings/i, /ore\s+body/i, /mine\s+plan/i, /mineral\s+resource/i, /quarry/i, /extractive/i],
  PORT_MARITIME: [/\bport\b/i, /berth/i, /quay/i, /maritime/i, /dredging/i, /harbour/i, /\bisps\b/i, /nautical/i],
  OIL_GAS: [/\bhazop\b/i, /p&id/i, /pipeline\s+design/i, /oil\s+facilit/i, /gas\s+facilit/i, /petrochemical/i, /upstream\s+petroleum/i, /refinery/i],
  FINANCIAL_SERVICES: [/\bkyc\b/i, /\baml\b/i, /core\s+banking/i, /microfinance/i, /\bifrs\b/i, /\bbasel\b/i, /fintech/i, /payment\s+system/i, /prudential/i],
  TELECOMS_BROADBAND: [/spectrum/i, /broadband/i, /\blte\b/i, /\b5g\b/i, /base\s+station/i, /backhaul/i, /mobile\s+network/i, /telecoms\b/i, /\brf\b\s+plan/i],
};

function unique<T extends string>(items: T[]): T[] {
  return [...new Set(items)];
}

function matches<T extends string>(text: string, patterns: PatternMap<T>): T[] {
  return unique((Object.keys(patterns) as T[]).filter((key) => patterns[key].some((pattern) => pattern.test(text))));
}

export function classifyUniversalTender(text: string | null | undefined): UniversalTenderProfile {
  const value = text ?? "";
  const serviceCapabilities = matches(value, SERVICE_PATTERNS);
  const tenderForms = matches(value, TENDER_FORM_PATTERNS);
  const sectorDomains = matches(value, SECTOR_PATTERNS);
  const textSignals = unique([
    ...serviceCapabilities,
    ...tenderForms,
    ...sectorDomains,
  ]);

  return {
    serviceCapabilities,
    tenderForms,
    sectorDomains,
    textSignals,
  };
}

export function capabilityOverlapScore(required: ServiceCapability[], candidate: ServiceCapability[]): number {
  if (required.length === 0 || candidate.length === 0) return required.length === 0 ? 1 : 0;
  const candidateSet = new Set(candidate);
  return required.filter((capability) => candidateSet.has(capability)).length / required.length;
}

export function sectorOverlapScore(required: SectorDomain[], candidate: SectorDomain[]): number {
  if (required.length === 0 || candidate.length === 0) return required.length === 0 ? 1 : 0;
  const candidateSet = new Set(candidate);
  return required.filter((sector) => candidateSet.has(sector)).length / required.length;
}

export function isUnsafeSectorMismatch(required: UniversalTenderProfile, candidate: UniversalTenderProfile): boolean {
  if (required.sectorDomains.length === 0 || candidate.sectorDomains.length === 0) return false;
  const sectorScore = sectorOverlapScore(required.sectorDomains, candidate.sectorDomains);
  const capabilityScore = capabilityOverlapScore(required.serviceCapabilities, candidate.serviceCapabilities);

  const healthcareVsLogistics = required.sectorDomains.includes("HEALTHCARE")
    && candidate.sectorDomains.includes("LOGISTICS_WAREHOUSING")
    && !candidate.sectorDomains.includes("HEALTHCARE");

  if (healthcareVsLogistics) return true;

  return sectorScore === 0 && capabilityScore < 0.34;
}

export function universalProfileSummary(profile: UniversalTenderProfile): string {
  const services = profile.serviceCapabilities.length ? profile.serviceCapabilities.join(", ") : "unspecified services";
  const forms = profile.tenderForms.length ? profile.tenderForms.join(", ") : "unspecified tender form";
  const sectors = profile.sectorDomains.length ? profile.sectorDomains.join(", ") : "unspecified sector";
  return `services=${services}; tenderForms=${forms}; sectors=${sectors}`;
}
