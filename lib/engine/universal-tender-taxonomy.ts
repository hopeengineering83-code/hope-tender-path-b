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

export type CapabilityFamily =
  | "WATER_SUPPLY"
  | "SANITATION_DRAINAGE"
  | "GEOTECHNICAL_GEOSPATIAL"
  | "ARCHITECTURAL_INTERIORS"
  | "MEP_ELECTRICAL_MECHANICAL"
  | "STRUCTURAL_CIVIL"
  | "URBAN_TRANSPORT_INFRASTRUCTURE"
  | "ENVIRONMENTAL_SOCIAL"
  | "PROJECT_MANAGEMENT_SUPERVISION"
  | "COMMERCIAL_FINANCIAL_ADVISORY"
  | "ICT_DIGITAL_GOVERNANCE";

export const CAPABILITY_KEYWORDS: Record<CapabilityFamily, RegExp[]> = {
  WATER_SUPPLY: [
    /\bwater\b.*\b(supply|distrib|network|storage|treat|source|well|borehole)\b/,
    /\b(pump|reservoir|piping|transmission|intake|aquifer|groundwater)\b/,
  ],
  SANITATION_DRAINAGE: [
    /\b(sewer|wastewater|sanitation|effluent|drainage|flood|stormwater)\b/,
    /\b(WWTP|STP|faecal|sludge|manhole|treatment.*plant)\b/,
  ],
  GEOTECHNICAL_GEOSPATIAL: [
    /\b(geotech|soil|drilling|investigation|topograph|survey|GIS|mapping)\b/,
    /\b(foundation|subsurface|geolog|bathymetry|lidar|cadastral)\b/,
  ],
  ARCHITECTURAL_INTERIORS: [
    /\b(architect|building|design|facade|interior|landscap|urban.*design)\b/,
    /\b(concept|schematic|rendering|visualization|fit-out|aesthetic)\b/,
  ],
  MEP_ELECTRICAL_MECHANICAL: [
    /\b(MEP|electrical|mechanical|HVAC|plumbing|power|lighting|lift|escalat)\b/,
    /\b(LV|MV|HV|substation|generator|cooling|ventilation|fire.*fighting)\b/,
  ],
  STRUCTURAL_CIVIL: [
    /\b(structural|concrete|steel|masonry|civil|earthwork|grading|pavement)\b/,
    /\b(loading|stress|stiffness|analysis|slab|beam|column|abutment)\b/,
  ],
  URBAN_TRANSPORT_INFRASTRUCTURE: [
    /\b(road|highway|bridge|interchange|traffic|transport|master.*plan|parking)\b/,
    /\b(pavement|ITS|mobility|transit|railway|urban.*infrastructure)\b/,
  ],
  ENVIRONMENTAL_SOCIAL: [
    /\b(environment|ESIA|ESMP|social|impact|safeguard|resettlement|RAP)\b/,
    /\b(ecology|biodiversity|pollution|mitigation|gender|stakeholder)\b/,
  ],
  PROJECT_MANAGEMENT_SUPERVISION: [
    /\b(project.*manage|supervision|contract.*admin|FIDIC|PMC|QC|QA)\b/,
    /\b(monitor|inspect|reporting|schedule|milestone|audit|compliance)\b/,
  ],
  COMMERCIAL_FINANCIAL_ADVISORY: [
    /\b(commercial|financial|economic|feasibility|business.*case|PPP|market)\b/,
    /\b(procurement|BOQ|cost.*estimate|quantity.*survey|tender.*assist)\b/,
  ],
  ICT_DIGITAL_GOVERNANCE: [
    /\b(ICT|software|digital|system|integration|IT|network|server|cloud)\b/,
    /\b(database|automation|governance|strategy|platform|data.*analysis)\b/,
  ],
};

export const SECTOR_DEFINING_FAMILIES: CapabilityFamily[] = Object.keys(CAPABILITY_KEYWORDS) as CapabilityFamily[];

export function capabilityFamilies(text: string): CapabilityFamily[] {
  const families: CapabilityFamily[] = [];
  for (const [family, patterns] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (patterns.some((p) => p.test(text))) families.push(family as CapabilityFamily);
  }
  return families;
}

export function detectDominantFamily(queryText: string): CapabilityFamily | null {
  let best: { family: CapabilityFamily; hits: number } | null = null;
  for (const family of SECTOR_DEFINING_FAMILIES) {
    const patterns = CAPABILITY_KEYWORDS[family];
    let hits = 0;
    const seen = new Set<string>();
    for (const p of patterns) {
      const m = queryText.match(p);
      if (m && !seen.has(p.source)) { hits += 1; seen.add(p.source); }
    }
    if (hits >= 3 && (!best || hits > best.hits)) {
      best = { family, hits };
    }
  }
  return best ? best.family : null;
}
