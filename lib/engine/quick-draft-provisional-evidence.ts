export type ProvisionalEvidenceCandidate = {
  label: string;
  detail?: string | null;
  score: number;
};

function clean(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function scoreAgainstTender(text: string, tenderText: string): number {
  const lowerText = text.toLowerCase();
  const lowerTender = tenderText.toLowerCase();
  let score = 0;
  const signals = [
    // Healthcare
    "health", "hospital", "medical", "clinic", "radiology", "laboratory",
    "pharmacy", "opd", "emergency", "in-patient", "biomedical", "ipc",
    // Building / MEP
    "mep", "hvac", "renovation", "bim", "structural", "electrical", "mechanical",
    // General
    "assessment", "design", "supervision", "infrastructure",
    // Water / hydraulic
    "water", "borehole", "hydraulic", "sanitary", "epanet", "waterworks",
    // Roads / transport
    "road", "bridge", "pavement", "highway", "traffic", "aashto",
    // Urban / planning
    "urban", "master plan", "municipal", "gis", "zoning",
    // Environmental / safeguards
    "esia", "esmp", "safeguard", "baseline", "environmental",
    // ICT / digital
    "ict", "software", "digital", "database", "erp", "mis", "api", "uat",
    // Energy / power
    "energy", "power", "solar", "grid", "scada", "generation", "substation",
    // Agriculture / irrigation
    "irrigation", "agriculture", "crop", "agronomic", "fao", "farm",
    // Mining
    "mining", "mineral", "jorc", "tailings", "slope stability", "geotechnical",
    // Port / maritime
    "port", "berth", "dredging", "maritime", "quay", "harbour",
    // Oil & gas
    "pipeline", "hazop", "p&id", "refinery", "petrochemical", "wellhead",
    // Financial services
    "kyc", "aml", "banking", "basel", "ifrs", "credit risk",
    // Telecoms
    "spectrum", "backhaul", "base station", "lte", "broadband", "telecom",
  ];
  for (const signal of signals) {
    if (lowerText.includes(signal) && lowerTender.includes(signal)) score += 4;
    else if (lowerText.includes(signal)) score += 1;
  }
  // Sector-match bonus: when the item's text and the tender share a sector signal, boost relevance.
  const sectorBonusPatterns: RegExp[] = [
    /hospital|medical|health|clinic/,
    /\bwater\b|borehole|hydraulic/,
    /\broad\b|bridge|pavement|highway/,
    /urban|master.?plan|municipal/,
    /esia|esmp|safeguard|environmental.*impact/,
    /\bict\b|software|digital.*system|erp|mis\b/,
    /energy|power.*plant|solar.*farm|grid.*connect/,
    /irrigation.*scheme|agri|crop.*water|fao.*penman/,
    /mining|mineral.*extract|jorc|tailings/,
    /\bport\b|berth|dredging|maritime/,
    /pipeline|hazop|p&id|refinery/,
    /kyc|aml|core.*banking|basel/,
    /spectrum|base.*station|backhaul|telecom/,
  ];
  for (const pattern of sectorBonusPatterns) {
    if (pattern.test(lowerText) && pattern.test(lowerTender)) { score += 3; break; }
  }
  return score;
}

export function rankProvisionalEvidence<T extends { label: string; detail?: string | null }>(
  items: T[],
  tenderText: string,
  limit = 8,
): ProvisionalEvidenceCandidate[] {
  return items
    .map((item) => ({ ...item, label: clean(item.label), detail: clean(item.detail), score: scoreAgainstTender(`${item.label}\n${item.detail ?? ""}`, tenderText) }))
    .filter((item) => item.label)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function provisionalEvidenceNote(hasSelected: boolean, evidenceType: "experts" | "projects"): string | null {
  if (hasSelected) return null;
  return evidenceType === "experts"
    ? "No tender-specific expert match was selected yet, so the quick draft is using highest-relevance reviewed company expert candidates as provisional evidence. Confirm final CV selection before submission."
    : "No tender-specific project match was selected yet, so the quick draft is using highest-relevance reviewed company project candidates as provisional evidence. Confirm final project references before submission.";
}
