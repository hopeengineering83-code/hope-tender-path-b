import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import { exactSelectionLimit } from "./scope-policy";
import { deriveRequirementConstraintProfile } from "./requirement-constraints";
import { checkMatchingEligibility } from "./matching-eligibility";
import { effectiveReviewTrustLevel, type ReviewRecordState } from "../vault-review-provenance";

// Per-record lexical interpretation cycles. For each candidate expert /
// project, the matcher runs MATCHING_CYCLES different tokenization
// strategies against the tender requirements and keeps the best score.
// This is the OLD iteration loop (Stage 1) — purely individual scoring.
const MATCHING_CYCLES = 20;

// Portfolio-level optimization cycles. After Stage 1 produces individual
// scores, Stage 2 iterates PORTFOLIO_OPTIMIZATION_CYCLES combinations of
// the top candidates to find the SET that maximizes collective coverage
// of the tender's capability families and disciplines. This is the
// "iterate to select the best" step the user asked for: instead of
// blindly taking top-N by individual score (which can over-concentrate
// on one capability and under-cover others), we evaluate multiple
// candidate sets and pick the one with the broadest, most coherent
// coverage of what THIS tender actually demands.
const PORTFOLIO_OPTIMIZATION_CYCLES = 20;

// Lowered from 0.90 to 0.75 — at 0.90 experts/projects with slightly different
// vocabulary (e.g., "infrastructure design" vs "civil design") were excluded
// from the evidence library, causing Claude to fall back to placeholders.
// A floor of 3 matches is enforced downstream so the evidence library is
// never empty when candidates exist.
const SELECTION_THRESHOLD = 0.75;

type KnowledgeWithOptionalTrust = { trustLevel?: string | null };

// CapabilityFamily covers the major consultancy disciplines the matching
// engine knows about. The list is intentionally broad — adding a family
// here makes the portfolio optimizer (Stage 2 selection) reward
// candidates who carry that capability when the tender requires it.
//
// New families can be added without breaking anything: capabilityFamilies()
// returns an empty array if no keywords match, in which case the
// portfolio optimizer falls back to individual scores.
type CapabilityFamily =
  | "WATER_SUPPLY"
  | "SOLAR_PUMPING"
  | "FEASIBILITY_DESIGN"
  | "SUPERVISION_CONTRACT"
  | "URBAN_MUNICIPAL"
  | "CIVIL_INFRASTRUCTURE"
  | "ELECTRO_MECHANICAL"
  | "GEOTECH_HYDROGEOLOGY"
  | "ENVIRONMENT_SOCIAL"
  | "PROJECT_MANAGEMENT"
  | "ARCHITECTURE_BUILDINGS"
  | "FINANCIAL_LEGAL"
  | "HEALTHCARE_FACILITIES"
  | "EDUCATION_FACILITIES"
  | "ICT_DIGITAL"
  | "AGRICULTURE_RURAL"
  | "ENERGY_POWER"
  | "TRANSPORT_LOGISTICS"
  | "MINING_EXTRACTIVES"
  | "TELECOMS"
  | "OIL_GAS_PETROLEUM"
  | "INSTITUTIONAL_REFORM";

// PR XX-MATCH-FIX (Fix A) — tightened keyword lists.
// The pre-fix keywords included generic terms like `building`, `construction`,
// `facility`, `design`, and `office` that caused warehouse / residential
// projects to match CIVIL_INFRASTRUCTURE and ARCHITECTURE_BUILDINGS for
// healthcare tenders. The new lists require SECTOR-DISTINCTIVE evidence,
// not generic project boilerplate.
// PR XX-MATCH-FIX MERGE — taking remote's (HEAD) generally-tighter set
// AND applying my even-stricter ARCHITECTURE_BUILDINGS + CIVIL_INFRASTRUCTURE
// to remove the residual /building/i + /residential/i triggers that were
// the headline cause of warehouse projects anchoring healthcare tenders.
const CAPABILITY_KEYWORDS: Record<CapabilityFamily, RegExp[]> = {
  // Word boundary on WASH — bare /WASH/i matched "Washington" /
  // "washroom" / "washable", causing matching false-positives on
  // non-water projects with Washington-state clients.
  WATER_SUPPLY: [/water/i, /supply/i, /sanitary/i, /hydraulic/i, /pipeline/i, /pipe/i, /borehole/i, /well/i, /drilling/i, /reservoir/i, /pump/i, /irrigation/i, /woreda/i, /kebele/i, /\bWASH\b/i, /sanitation/i],
  SOLAR_PUMPING: [/solar/i, /\bpv\b/i, /photovoltaic/i, /pump/i, /pumping/i, /electromechanical/i, /electro[\s-]mechanical/i],
  FEASIBILITY_DESIGN: [/feasibility/i, /\bfsdd\b/i, /detailed[\s-]+design/i, /\bddp\b/i, /assessment/i, /investigation/i, /drawing/i, /specification/i, /bill[\s-]+of[\s-]+quantit/i, /\bboq\b/i],
  SUPERVISION_CONTRACT: [/supervision/i, /construction\s+supervision/i, /contract\s+administration/i, /site\s+(?:engineer|supervisor|supervision|inspector|manager|representative)\b/i, /quality\s+control/i, /resident\s+engineer/i, /inspection/i],
  URBAN_MUNICIPAL: [/urban\s+plan/i, /master\s+plan/i, /municipal/i, /spatial\s+plan/i, /land[-\s]?use\s+(?:plan|study)/i, /zoning\s+(?:plan|regulation|code|by-?law)/i, /city\s+plan/i, /town\s+plan/i, /settlement\s+plan/i, /urban\s+design/i],
  // PR XX-MATCH-FIX MERGE — stricter than remote: drop /building/i, /construction/i,
  // /structure/i (too generic — warehouse projects matched these for healthcare tenders).
  CIVIL_INFRASTRUCTURE: [/road\s+(?:design|construction|rehabilitation)/i, /\bbridge\s+(?:design|construction)/i, /highway/i, /pavement/i, /drainage\s+system/i, /culvert/i, /\bRCC\b/i, /civil\s+(?:engineering|works)/i, /infrastructure\s+(?:design|project)/i],
  ELECTRO_MECHANICAL: [/electrical/i, /mechanical/i, /electro/i, /\bmep\b/i, /pump/i, /generator/i, /motor/i, /\bHVAC\b/i, /cooling/i],
  GEOTECH_HYDROGEOLOGY: [/geotech/i, /geological/i, /hydrogeology/i, /soil/i, /foundation/i, /investigation/i, /drilling/i, /groundwater/i, /aquifer/i],
  ENVIRONMENT_SOCIAL: [/environment/i, /social/i, /safeguard/i, /climate/i, /\besmp\b/i, /\besia\b/i, /impact/i, /resettlement/i, /biodiversity/i, /ESS\d/i, /\bESF\b/i],
  PROJECT_MANAGEMENT: [/project[\s-]+management/i, /team[\s-]+leader/i, /coordination/i, /schedule/i, /programme/i, /work[\s-]+plan/i, /project[\s-]+planning/i, /\bPMI\b/i, /\bPMP\b/i],
  // PR XX-MATCH-FIX MERGE — stricter: require "architectural design"/"interior design"
  // signature words. /building/i, /residential/i, /housing/i moved here for residential
  // projects to match but require a residential-distinctive token, not just "building".
  ARCHITECTURE_BUILDINGS: [/architectural\s+design/i, /interior\s+design/i, /floor\s+plan/i, /space\s+planning/i, /furniture\s+layout/i, /3D\s+(?:visualization|rendering)/i, /BIM\b/i, /Revit/i, /ArchiCAD/i, /SketchUp/i, /AutoCAD/i, /\bG\+\d/i, /residential\s+(?:design|building)/i, /housing\s+(?:project|design)/i],
  FINANCIAL_LEGAL: [/financial/i, /audit/i, /turnover/i, /registration/i, /license/i, /certificate/i, /tax/i, /legal/i, /\bvat\b/i, /\btin\b/i, /procurement/i, /\bKYC\b/i, /\bAML\b/i, /\bBasel\b/i, /\bIFRS\b/i, /core\s+banking/i, /credit\s+risk/i, /microfinance/i, /prudential/i],
  // Universal families — added so the portfolio optimizer can match any
  // tender sector, not only the construction / consulting cluster.
  HEALTHCARE_FACILITIES: [/health(?:care)?\s+(?:facilit|design|infra)/i, /\bhospital/i, /medical\s+(?:facility|center|cent|equipment|gas|imaging)/i, /clinic/i, /specialty\s+(?:medical|cent)/i, /\bOPD\b/i, /\bICU\b/i, /surgical\s+suite/i, /radiology/i, /pharmacy\s+design/i, /clinical\s+(?:lab|workflow)/i, /biomedical/i, /pharma/i, /patient\s+(?:flow|room|safety)/i, /\bIPC\b/i, /infection\s+control/i, /\bMoH\b/i, /ministry\s+of\s+health/i],
  EDUCATION_FACILITIES: [/school\s+(?:design|construct|rehab)/i, /university\s+(?:design|build|campus)/i, /campus\s+plan/i, /classroom\s+block/i, /vocational\s+(?:training|cent)/i, /academic\s+building/i, /education\s+facility/i, /TVET/i],
  ICT_DIGITAL: [/\bICT\b/i, /software\s+development/i, /digital\s+platform/i, /database\s+design/i, /\bMIS\b/i, /\bERP\b/i, /system\s+integration/i, /\bAPI\b/i, /cloud\s+infrastructure/i, /cybersecurity/i, /information\s+system/i, /data\s+management/i, /web\s+application/i, /mobile\s+app/i],
  AGRICULTURE_RURAL: [/agricultur(?:al|e)/i, /agronom/i, /irrigation/i, /livestock/i, /horticulture/i, /value\s+chain/i, /smallholder/i, /post-?harvest/i, /agribusiness/i, /food\s+secur/i, /rural\s+development/i],
  ENERGY_POWER: [/electricity\s+(?:grid|distribution)/i, /transmission\s+line/i, /substation/i, /power\s+(?:generation|plant|station)/i, /renewable\s+energy/i, /wind\s+farm/i, /hydro\s*power/i, /geothermal/i, /off-?grid/i, /mini-?grid/i, /solar\s+farm/i, /grid.?code/i, /\bSCADA\b/i, /load\s+forecast/i, /electrification\s+scheme/i],
  TRANSPORT_LOGISTICS: [/airport\s+(?:design|infrastructure)/i, /railway/i, /port\s+(?:design|infrastructure)/i, /maritime/i, /freight/i, /cargo/i, /supply\s+chain/i, /logistics\s+(?:hub|network)/i, /terminal\s+(?:design|construct)/i, /warehouse\s+(?:design|management)/i],
  MINING_EXTRACTIVES: [/mining/i, /extractiv/i, /quarry/i, /mineral\s+resourc/i, /tailings/i, /smelter/i, /refining/i, /artisanal/i, /\bJORC\b/i, /slope\s+stability/i, /mine\s+plan/i],
  TELECOMS: [/telecom/i, /telecommunication/i, /fiber\s+optic/i, /fibre\s+optic/i, /broadband/i, /\b5G\b/i, /\b4G\b/i, /tower\s+infrastructure/i, /spectrum/i, /\bBTS\b/i, /backhaul/i],
  OIL_GAS_PETROLEUM: [/\bHAZOP\b/i, /\bP&ID\b/i, /pipeline\s+(?:design|integrit|engineer)/i, /refinery/i, /petrochemical/i, /wellhead/i, /upstream\s+petroleum/i, /oil\s+facilit/i, /gas\s+facilit/i, /\bFEED\b.*process/i, /process\s+safety/i, /\bPSSR\b/i],
  INSTITUTIONAL_REFORM: [/institutional\s+(?:reform|strengthen)/i, /governance\s+reform/i, /policy\s+(?:design|framework)/i, /capacity\s+building/i, /public\s+sector\s+reform/i, /civil\s+service\s+reform/i, /regulator\s+(?:design|framework)/i, /strategic\s+plan/i, /M&E\s+framework/i, /monitoring\s+and\s+evaluation/i],
};

// ─── Sector-dominance detection (PR XX-MATCH-FIX Fix B) ──────────────────────
// Some capability families are sector-DEFINING — when the tender hits them
// strongly, a project missing that family is almost certainly the wrong
// project. The penalty applied in capabilityScore() drops such projects
// below the 0.90 selection threshold so they no longer auto-anchor.
//
// Threshold: a family qualifies as "dominant" when its keyword set hits
// ≥ 3 distinct keywords in the query text. This filters out incidental
// mentions (e.g., one stray "hospital" in a road tender's site map).
const SECTOR_DEFINING_FAMILIES: CapabilityFamily[] = [
  "HEALTHCARE_FACILITIES",
  "WATER_SUPPLY",
  "ENERGY_POWER",
  "ICT_DIGITAL",
  "EDUCATION_FACILITIES",
  "AGRICULTURE_RURAL",
  "MINING_EXTRACTIVES",
  "TELECOMS",
  "URBAN_MUNICIPAL",
  "ENVIRONMENT_SOCIAL",
  "OIL_GAS_PETROLEUM",
];

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

// Two-character tokens that carry significant domain meaning and must NOT be
// dropped by the general length filter (they become lowercase after split).
// "it" removed — it is an extremely common pronoun that cannot be distinguished
// from the ICT acronym after lowercasing, injecting high-frequency noise into
// TF-IDF scoring. ICT signal is carried by sector regexes in proposal-intelligence.ts.
const KEEP_SHORT_TOKENS = new Set(["ai", "pm", "qa", "qc", "hr", "gm", "jv", "ict"]);

function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 || KEEP_SHORT_TOKENS.has(t));
}

function parseArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildIdf(corpus: string[][]): Map<string, number> {
  const docCount = Math.max(corpus.length, 1);
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  return idf;
}

function cosineTfidf(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const queryFreq = new Map<string, number>();
  for (const t of queryTokens) queryFreq.set(t, (queryFreq.get(t) ?? 0) + 1);

  const docFreq = new Map<string, number>();
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  const allTokens = new Set([...queryFreq.keys(), ...docFreq.keys()]);

  let dot = 0;
  let qNorm = 0;
  let dNorm = 0;
  for (const token of allTokens) {
    const w = idf.get(token) ?? 1;
    const q = ((queryFreq.get(token) ?? 0) / queryTokens.length) * w;
    const d = ((docFreq.get(token) ?? 0) / docTokens.length) * w;
    dot += q * d;
    qNorm += q * q;
    dNorm += d * d;
  }

  const denom = Math.sqrt(qNorm) * Math.sqrt(dNorm);
  return denom === 0 ? 0 : dot / denom;
}

export function capabilityFamilies(text: string): CapabilityFamily[] {
  return (Object.keys(CAPABILITY_KEYWORDS) as CapabilityFamily[]).filter((family) =>
    CAPABILITY_KEYWORDS[family].some((pattern) => pattern.test(text)),
  );
}

function criticalFamilyMismatchPenalty(queryText: string, recordText: string): number {
  const requiredFamilies = capabilityFamilies(queryText);
  const recordFamilies = capabilityFamilies(recordText);
  if (requiredFamilies.length === 0 || recordFamilies.length === 0) return 0;

  const sharedFamilies = requiredFamilies.filter((family) => recordFamilies.includes(family));

  if (sharedFamilies.length === 0) {
    // Zero overlap: hard penalty — the record has no detectable family that
    // the tender requires.  Strict sectors (healthcare, education, ICT, mining,
    // telecoms) get a larger penalty because an unrelated record can never
    // credibly fulfil those domains.
    const strictFamilies: CapabilityFamily[] = [
      "HEALTHCARE_FACILITIES",
      "EDUCATION_FACILITIES",
      "ICT_DIGITAL",
      "MINING_EXTRACTIVES",
      "TELECOMS",
    ];
    const requiresStrictFamily = requiredFamilies.some((family) => strictFamilies.includes(family));
    return requiresStrictFamily ? -0.40 : -0.25;
  }

  // Proportional penalty: tender requires ≥ 4 families but record covers < 30%
  // of them. A single generic overlapping family (e.g. FEASIBILITY_DESIGN from a
  // road firm for a water tender) must not suppress the penalty entirely.
  // Raised from -0.10 to -0.18 so that bonus stacking (trust+experience+sector)
  // cannot push a low-coverage record above the 0.55 selection floor when there
  // is a genuine sector conflict in play.
  if (requiredFamilies.length >= 4 && sharedFamilies.length / requiredFamilies.length < 0.30) {
    return -0.18;
  }

  return 0;
}

function requirementWeight(priority: string): number {
  if (priority === "MANDATORY") return 3;
  if (priority === "SCORED") return 2;
  return 1;
}

function weightedRequiredFamilies(requirements: RequirementDraft[], tenderTitle?: string | null, tenderSector?: string | null): CapabilityFamily[] {
  const weighted: CapabilityFamily[] = [];
  for (const requirement of requirements) {
    const families = capabilityFamilies(`${requirement.title} ${requirement.description}`);
    const weight = requirementWeight(requirement.priority);
    for (let i = 0; i < weight; i += 1) weighted.push(...families);
  }
  if (tenderTitle) weighted.push(...capabilityFamilies(tenderTitle));
  if (tenderSector) weighted.push(...capabilityFamilies(tenderSector));
  return weighted;
}

function strictFamilyRequired(requiredFamilies: CapabilityFamily[]): boolean {
  const strictFamilies: CapabilityFamily[] = ["HEALTHCARE_FACILITIES", "EDUCATION_FACILITIES", "ICT_DIGITAL", "MINING_EXTRACTIVES", "TELECOMS", "OIL_GAS_PETROLEUM"];
  return requiredFamilies.some((family) => strictFamilies.includes(family));
}

function domainTagMatchScore(domainTags: string[], recordText: string): number {
  if (domainTags.length === 0) return 0;
  const text = recordText.toLowerCase();
  const checks: Record<string, RegExp> = {
    healthcare: /hospital|healthcare|medical|clinic|ward|pharmacy|laboratory|patient/i,
    telecom: /telecom|telecommunication|fiber|fibre|broadband|5g|4g|tower|bts/i,
    ict: /ict|digital|software|platform|information\s+system|database|api|cloud/i,
    mining: /mining|extractive|quarry|mineral|ore|tailings/i,
    education: /school|education|university|college|campus|classroom/i,
    oil_gas: /hazop|p&id|pipeline.*design|refinery|petrochemical|wellhead|upstream.*petroleum/i,
    energy: /power.*plant|solar.*farm|wind.*farm|grid.*code|substation|generation.*capacity/i,
    port: /berth.*design|dredging|harbour|maritime.*infra|isps|nautical/i,
    financial: /kyc|aml|core.*banking|microfinance|ifrs|basel|prudential/i,
  };
  const matches = domainTags.filter((tag) => checks[tag]?.test(text));
  return matches.length / domainTags.length;
}

function minimumFamilyDiversity(requiredFamilies: CapabilityFamily[]): number {
  if (strictFamilyRequired(requiredFamilies)) return Math.min(3, Math.max(2, requiredFamilies.length));
  return Math.min(2, requiredFamilies.length);
}

export function capabilityScore(queryText: string, recordText: string, type: "expert" | "project"): number {
  const qFamilies = capabilityFamilies(queryText);
  const rFamilies = capabilityFamilies(recordText);
  if (qFamilies.length === 0 || rFamilies.length === 0) return 0;
  const shared = qFamilies.filter((family) => rFamilies.includes(family));
  const coverage = shared.length / Math.max(qFamilies.length, 1);
  const depth = shared.length / Math.max(rFamilies.length, 1);
  let score = coverage * 0.75 + depth * 0.25;

  // GLM-A2 Issue #1135 Gap #4: Score calibration — 100% must require
  // exceptional, fully source-grounded coverage and must NOT result from
  // clamping or bonus stacking. Bonuses are capped so the raw score
  // cannot exceed 0.95 from bonuses alone. The remaining 0.05 is only
  // achievable when coverage = 1.0 (every required family is shared).
  // This prevents the "all 28 experts get 100%" scenario shown in the
  // screenshots.
  const MAX_BONUS_TOTAL = 0.20;
  let bonusTotal = 0;

  // Senior-consultant equivalence: a firm with design/supervision/water/infra
  // experience can be strongly relevant even when wording is not identical.
  const broadInfra = ["WATER_SUPPLY", "FEASIBILITY_DESIGN", "SUPERVISION_CONTRACT", "CIVIL_INFRASTRUCTURE"] as CapabilityFamily[];
  const sharedBroadInfra = broadInfra.filter((family) => qFamilies.includes(family) && rFamilies.includes(family)).length;
  if (sharedBroadInfra >= 2) bonusTotal += type === "project" ? 0.18 : 0.14;
  if (qFamilies.includes("SOLAR_PUMPING") && rFamilies.some((f) => ["ELECTRO_MECHANICAL", "WATER_SUPPLY", "SOLAR_PUMPING"].includes(f))) bonusTotal += 0.16;
  if (qFamilies.includes("GEOTECH_HYDROGEOLOGY") && rFamilies.some((f) => ["GEOTECH_HYDROGEOLOGY", "WATER_SUPPLY", "FEASIBILITY_DESIGN"].includes(f))) bonusTotal += 0.10;

  // Cap total bonuses so score cannot reach 1.0 from stacking alone
  score += Math.min(bonusTotal, MAX_BONUS_TOTAL);

  // ─── PR XX-MATCH-FIX Fix B — dominant-family penalty ─────────────────────
  // When the tender has a strong sector signal (e.g., HEALTHCARE_FACILITIES
  // matched 3+ keywords), a project / expert missing that family is almost
  // certainly the wrong record. Apply a hard penalty so warehouse projects
  // don't auto-anchor a healthcare cover letter.
  //
  // The penalty multiplies the score by 0.30, which drops a 0.85 raw score
  // to 0.255 — well below the 0.90 SELECTION_THRESHOLD. Records that DO
  // carry the dominant family are unaffected.
  const dominant = detectDominantFamily(queryText);
  if (dominant && !rFamilies.includes(dominant)) {
    score *= 0.30;
  }

  // GLM-A2 Issue #1135 Gap #4: 100% requires full coverage (all required
  // families shared). If coverage < 1.0, cap at 0.95 so no score can
  // reach 1.0 without complete family coverage.
  if (coverage < 1.0) {
    score = Math.min(score, 0.95);
  }

  return Math.max(0, Math.min(1, score));
}

// Mutually-exclusive sector groups. When tender and item map to DIFFERENT
// groups, the item is penalised (-0.20) regardless of lexical overlap.
// This prevents a "healthcare supply warehouse" project from receiving a
// sector boost for a healthcare tender, and pushes confirmed off-sector
// items well below the 0.75 auto-select threshold.
const SECTOR_CONFLICT_GROUPS: RegExp[] = [
  /health|hospital|medical|clinic|patient|pharmacy|biomedical/,
  /warehouse|logistics|cargo|freight|storage|supply.?chain|distribution.?cent/,
  /water|borehole|hydraulic|irrigation|sanitation|sewer/,
  /road|bridge|highway|pavement|transport(?!ation.?planning)/,
  /school|university|campus|education|classroom/,
  /industrial|manufacturing|factory/,
  // GLM-A2 Issue #1135: abattoir / livestock / slaughter is a confirmed
  // off-sector domain for healthcare, residential, commercial, and office
  // tenders. Without this group, "Moyale Abattoir Rehabilitation" scored
  // 83% and was SELECTED for a healthcare tender.
  /abattoir|slaughter|livestock|butcher|meat.?process/,
  // GLM-A2 Issue #1135: residential / housing / apartment is a confirmed
  // off-sector domain for healthcare, industrial, warehouse, and
  // infrastructure tenders. "Mohammed Seid (G+2 Residential)" scored 75%
  // and was SELECTED for a healthcare tender.
  /residential|housing|apartment|condo|villa|dormitor/,
  // GLM-A2 Issue #1135: commercial / retail / office-building is a
  // confirmed off-sector domain for healthcare, residential, industrial,
  // and warehouse tenders. "B+G+10 TERRACE COMMERCIAL BUILDING" scored
  // 57% and was SELECTED for a healthcare tender.
  /commercial|retail|shop|mall|office.?building|storefront/,
  // New high-distinction sectors: items from these domains never belong in
  // a competing sector's shortlist regardless of lexical overlap.
  /\bport\b.*\b(design|master.*plan|infrastructure|facilit|terminal|study)\b|\b(berth|quay.*wall|dredging.*scheme|maritime.*infrastructure|harbour.*develop|ISPS.*audit)\b/,
  /\b(HAZOP|P&ID|upstream.*petroleum|petrochemical.*plant|refinery.*design|wellhead.*design|pipeline.*design|oil.*facilit|gas.*facilit)\b/,
  /\b(KYC|AML|core.*banking|microfinance.*platform|credit.*risk.*model|prudential.*regul|capital.*adequacy|Basel.*compliance)\b/,
];

function sectorBoost(tenderSector: string | null | undefined, items: string[]): number {
  if (!tenderSector) return 0;
  const tender = tenderSector.toLowerCase();
  const itemText = items.join(" ").toLowerCase();
  if (!itemText) return 0;

  // Sector conflict penalty: confirmed cross-sector match → penalise harder
  // (raised from -0.20 to -0.30 so a single high cosine score can no longer
  // rescue a confirmed cross-sector item above the 0.75 selection threshold)
  const tenderGroup = SECTOR_CONFLICT_GROUPS.findIndex((g) => g.test(tender));
  const itemGroup = SECTOR_CONFLICT_GROUPS.findIndex((g) => g.test(itemText));
  if (tenderGroup >= 0 && itemGroup >= 0 && tenderGroup !== itemGroup) return -0.30;

  // Positive boost: word-boundary match (avoids substring false-positives like
  // "healthcare supply warehouse" getting +0.15 for a healthcare tender).
  const tenderWords = tender.split(/[\s/,;:&()+]+/).filter((w) => w.length >= 5);
  if (tenderWords.length > 0 && tenderWords.some((w) => new RegExp(`\\b${w}\\b`).test(itemText))) return 0.15;
  if (items.some((item) => {
    const iWords = item.toLowerCase().split(/[\s/,;:&()+]+/).filter((w) => w.length >= 5);
    return iWords.some((w) => new RegExp(`\\b${w}\\b`).test(tender));
  })) return 0.15;

  // Generic fallback boost only when the tender is not in a specific
  // conflict group. If the tender is sector-specific (healthcare, water,
  // road, education, industrial, warehouse), "engineering" or "design"
  // vocabulary alone does NOT earn a positive sector score — the item
  // must match the tender's specific domain or earn 0.
  if (tenderGroup < 0 &&
      /urban|planning|infrastructure|water|sanitary|engineering|design|supervision/.test(tender) &&
      /urban|planning|infrastructure|water|sanitary|engineering|design|supervision/.test(itemText)) return 0.12;
  return 0;
}

/**
 * Trust contribution to the match score.
 *
 * Flat, because scoring only ever reaches a record that already passed
 * checkMatchingEligibility — an ineligible record is forced to score 0 at the
 * call site, so there is no draft tier left here to penalise. This used to be
 * written as `if (true) return 0.18;` above two unreachable draft branches,
 * which read as though drafts were still being scored down. They were not.
 */
const ELIGIBLE_TRUST_ADJUSTMENT = 0.18;

/**
 * How the record's provenance is described in the rationale the user reads.
 *
 * This must not say "Reviewed" unless a person actually reviewed it.
 * checkMatchingEligibility deliberately accepts a durably machine
 * SOURCE_VERIFIED record on equal terms with a human REVIEWED one — and
 * isDurablySourceVerified requires reviewedBy and reviewedAt to be null, so
 * those records provably have no reviewer. The old code returned "✓ Reviewed"
 * for every eligible record, which stated a human judgement that never
 * happened. Both are legitimate evidence; only one of them was reviewed.
 *
 * Derived from effectiveReviewTrustLevel rather than the raw trustLevel
 * column, so a record whose stored level is not backed by durable provenance
 * cannot claim either status.
 */
const HUMAN_REVIEWED_LABEL = "✓ Reviewed";

function trustProvenanceLabel(record: ReviewRecordState): string {
  switch (effectiveReviewTrustLevel(record)) {
    case "REVIEWED": return HUMAN_REVIEWED_LABEL;
    case "SOURCE_VERIFIED": return "✓ Source-verified against uploaded document (not human-reviewed)";
    default: return "⚠ Provenance required";
  }
}

/**
 * Rank a result by whether a person reviewed its source record.
 *
 * Reads the label through the same constant the label is written from. While
 * every eligible record was labelled "✓ Reviewed" this comparison was a
 * constant and the sort silently degraded to score-only — rewording the label
 * must not be able to do that again.
 */
function humanReviewedRank(rationale: string): number {
  return rationale.includes(HUMAN_REVIEWED_LABEL) ? 1 : 0;
}

function cycleQueryTokens(baseTokens: string[], cycle: number): string[] {
  const stop = new Set(["shall", "must", "submit", "required", "proposal", "tender", "document", "provide", "include", "form"]);
  const unique = [...new Set(baseTokens)];
  const long = baseTokens.filter((token) => token.length >= 5);
  const domain = baseTokens.filter((token) => /(engineer|architect|planning|design|supervision|management|urban|road|water|structural|electrical|mechanical|project|expert|experience|consultancy|hospital|building|master|geotechnical|financial|legal|registration|methodology|construction|infrastructure|environmental|feasibility|solar|pump|borehole|hydraulic|sanitary)/i.test(token));
  const noStop = baseTokens.filter((token) => !stop.has(token));
  const firstHalf = baseTokens.slice(0, Math.ceil(baseTokens.length / 2));
  const secondHalf = baseTokens.slice(Math.floor(baseTokens.length / 2));

  switch (cycle) {
    case 1: return baseTokens;
    case 2: return [...baseTokens, ...long];
    case 3: return noStop;
    case 4: return [...baseTokens, ...firstHalf];
    case 5: return unique;
    case 6: return domain;
    case 7: return long;
    case 8: return [...secondHalf, ...baseTokens.slice(0, Math.ceil(baseTokens.length / 3))];
    case 9: return [...baseTokens, ...noStop.filter((token) => token.length >= 5)];
    case 10: return [...new Set(noStop)];
    case 11: return [...domain, ...domain, ...long];
    case 12: return [...firstHalf, ...domain];
    case 13: return [...secondHalf, ...domain];
    case 14: return baseTokens.filter((token) => /(expert|staff|cv|personnel|team|leader|specialist|engineer|architect|planner|experience|years|hydraulic|water|electrical|mechanical)/i.test(token));
    case 15: return baseTokens.filter((token) => /(project|reference|similar|assignment|portfolio|client|contract|completed|experience|sector|water|design|supervision|solar)/i.test(token));
    case 16: return [...unique, ...domain, ...noStop.slice(0, 20)];
    case 17: return noStop.filter((token) => token.length >= 6);
    case 18: return [...baseTokens.slice(0, 15), ...baseTokens.slice(-15), ...domain];
    case 19: return [...baseTokens, ...domain, ...domain, ...noStop.filter((token) => token.length >= 6)];
    case 20: return [...new Set([...domain, ...long, ...noStop])];
    default: return unique;
  }
}

function selectedLimit(requirements: RequirementDraft[], type: string, available: number): number {
  const profile = deriveRequirementConstraintProfile(requirements);
  const exact = exactSelectionLimit(requirements, type);
  if (exact > 0) return Math.min(exact, available);
  if (type === "EXPERT" && profile.expertCount > 0) return Math.min(profile.expertCount, available);
  if (type === "PROJECT_EXPERIENCE" && profile.projectCount > 0) return Math.min(profile.projectCount, available);
  const relevant = requirements.filter((r) => r.requirementType === type);
  if (relevant.length > 0) return Math.min(available, type === "EXPERT" ? 8 : 10);
  return Math.min(available, type === "EXPERT" ? 6 : 8);
}

// ─── Portfolio optimization (authoritative selection) ──────────────────────────────
//
// A simple top-N selection can over-concentrate: e.g., for a healthcare tender it might pick
// 5 experts who all duplicate "structural engineer" capability and miss
// MEP, biomedical, or healthcare-planning experts that the evaluator
// specifically wants. Stage 2 below evaluates multiple candidate sets
// and picks the one with the broadest, most coherent coverage of what
// THIS tender actually demands.
//
// Algorithm — runs PORTFOLIO_OPTIMIZATION_CYCLES times:
//
//   1. Greedy seed: take the top-scoring candidate.
//   2. For each remaining slot, evaluate every remaining candidate
//      against the running set. Score each candidate by:
//        - individual score (weight 0.55)  — keep quality high
//        - marginal capability coverage gain (weight 0.30)  —
//          reward capabilities the running set doesn't already have
//        - sector / discipline diversity (weight 0.15)  — reward
//          adding a discipline the set lacks
//      Pick the candidate with the highest combined score.
//   3. After filling all slots, score the whole set by:
//        - sum of individual scores (efficiency)
//        - capability-family coverage breadth
//        - discipline / sector breadth
//
// Across PORTFOLIO_OPTIMIZATION_CYCLES iterations, the seed is varied
// (cycle 1 = top-scorer, cycle 2 = second-top, …, cycle 20 = a
// shuffled candidate). The cycle producing the highest set score wins.
//
// This is the universal optimizer — works for any sector because
// coverage is computed against `requiredCapabilityFamilies` extracted
// from the tender requirements directly, not a sector hardcode.

function uniqueStringsFrom(arrays: string[][]): Set<string> {
  const out = new Set<string>();
  for (const arr of arrays) for (const v of arr) {
    const t = v.trim();
    if (t.length > 0) out.add(t.toLowerCase());
  }
  return out;
}

interface PortfolioCandidate<T extends { score: number; isSelected: boolean }> {
  match: T;
  capabilityFamilies: CapabilityFamily[];
  disciplineTags: string[];
}

function setCoverageScore<T extends { score: number; isSelected: boolean }>(
  candidates: PortfolioCandidate<T>[],
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): number {
  if (candidates.length === 0) return 0;

  const setFamilies = new Set<CapabilityFamily>();
  const setDisciplines = new Set<string>();
  let scoreSum = 0;
  for (const c of candidates) {
    for (const f of c.capabilityFamilies) setFamilies.add(f);
    for (const d of c.disciplineTags) setDisciplines.add(d.toLowerCase());
    scoreSum += c.match.score;
  }

  const familyCoverage = requiredFamilies.length === 0
    ? 1
    : requiredFamilies.filter((f) => setFamilies.has(f)).length / requiredFamilies.length;

  const disciplineCoverage = requiredDisciplines.size === 0
    ? 1
    : [...requiredDisciplines].filter((d) => setDisciplines.has(d)).length / requiredDisciplines.size;

  const efficiency = scoreSum / candidates.length;

  // Weighted blend — coverage is more important than raw score because
  // coverage is what the evaluator explicitly scores against.
  return efficiency * 0.45 + familyCoverage * 0.40 + disciplineCoverage * 0.15;
}

function marginalGainScore<T extends { score: number; isSelected: boolean }>(
  candidate: PortfolioCandidate<T>,
  currentSet: PortfolioCandidate<T>[],
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): number {
  const currentFamilies = new Set<CapabilityFamily>();
  const currentDisciplines = new Set<string>();
  for (const c of currentSet) {
    for (const f of c.capabilityFamilies) currentFamilies.add(f);
    for (const d of c.disciplineTags) currentDisciplines.add(d.toLowerCase());
  }

  const newFamilies = candidate.capabilityFamilies.filter((f) => !currentFamilies.has(f) && requiredFamilies.includes(f)).length;
  const newDisciplines = candidate.disciplineTags.filter((d) => !currentDisciplines.has(d.toLowerCase()) && requiredDisciplines.has(d.toLowerCase())).length;

  const requiredFamiliesCount = Math.max(requiredFamilies.length, 1);
  const requiredDisciplinesCount = Math.max(requiredDisciplines.size, 1);

  // Family coverage is weighted higher than individual score so that
  // a high-scoring but domain-mismatched record cannot displace a
  // lower-scoring in-domain candidate who adds a new required family.
  // Previous split (0.55 / 0.30) allowed a 0.90-scorer with 0 new
  // families to edge out a 0.76-scorer who adds a required family.
  return (
    candidate.match.score * 0.40 +
    (newFamilies / requiredFamiliesCount) * 0.45 +
    (newDisciplines / requiredDisciplinesCount) * 0.15
  );
}

function optimizePortfolioSelection<T extends { score: number; isSelected: boolean }>(
  matches: T[],
  candidates: PortfolioCandidate<T>[],
  limit: number,
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): T[] {
  if (limit <= 0 || candidates.length === 0) {
    return matches.map((m) => ({ ...m, isSelected: false }));
  }

  // Strict-family gate: when the tender requires a strict family
  // (healthcare, education, mining, telecoms, oil/gas, etc.), only
  // candidates that BOTH (a) clear the canonical SELECTION_THRESHOLD
  // (0.75) AND (b) carry at least one of the required families are
  // eligible. If no candidate clears both filters, we fall back to
  // candidates that clear the threshold alone (without the family
  // restriction) — but the strict-family coverage rescue pass below
  // will still prefer family-carrying candidates during set assembly.
  //
  // Fail-closed: if NO candidate clears SELECTION_THRESHOLD, the
  // eligible set is empty and the function returns zero selections
  // (see the empty-eligible guard below). The previous below-threshold
  // fallback that promoted borderline candidates was removed because it
  // violated fail-closed evidence rules and could select irrelevant
  // candidates in strict sectors.
  const hardFamilyGate = strictFamilyRequired(requiredFamilies);
  const strictEligible = candidates.filter((c) => {
    if (c.match.score < SELECTION_THRESHOLD) return false;
    if (!hardFamilyGate) return true;
    return c.capabilityFamilies.some((family) => requiredFamilies.includes(family));
  });
  const eligible = strictEligible.length > 0
    ? strictEligible
    : candidates.filter((c) => c.match.score >= SELECTION_THRESHOLD);

  // GLM-A2 Issue #1135 Gap #2:
  // Fail-closed selection: only candidates that meet the canonical
  // SELECTION_THRESHOLD are ever selected. The previous
  // code had a below-threshold fallback that promoted
  // candidates when zero cleared the threshold. This violated fail-closed
  // evidence rules. The fallback has been removed.
  //
  // When zero candidates clear the SELECTION_THRESHOLD (0.75), the selection
  // set is empty. The caller must:
  //   1. Create a blocking evidence gap ("no comparable sector experience in vault")
  //   2. Lock generation (no proposal output without source-grounded evidence)
  //   3. Surface the gap to the user for manual evidence linking
  //
  // This is the correct fail-closed behavior for strict sectors (healthcare,
  // education, mining, telecoms, oil/gas) where promoting irrelevant
  // candidates would produce misleading proposals.
  if (eligible.length === 0) {
    return matches.map((m) => ({ ...m, isSelected: false }));
  }

  let bestSet: PortfolioCandidate<T>[] = [];
  let bestScore = -Infinity;

  for (let cycle = 0; cycle < PORTFOLIO_OPTIMIZATION_CYCLES; cycle += 1) {
    // Vary the seed across cycles: cycle 0 starts with top-scorer,
    // cycle 1 starts with #2, etc. Once we've used all real seeds,
    // remaining cycles re-evaluate with random tie-breaking — cheap
    // exploration that catches alternative seeds we'd otherwise miss.
    const seedIdx = cycle % eligible.length;
    const seed = eligible[seedIdx];
    const remaining = eligible.filter((_, i) => i !== seedIdx);
    const set: PortfolioCandidate<T>[] = [seed];

    while (set.length < limit && remaining.length > 0) {
      let bestNext = remaining[0];
      let bestNextScore = -Infinity;
      let bestNextIdx = 0;
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const gain = marginalGainScore(candidate, set, requiredFamilies, requiredDisciplines);
        if (gain > bestNextScore) {
          bestNext = candidate;
          bestNextScore = gain;
          bestNextIdx = i;
        }
      }
      set.push(bestNext);
      remaining.splice(bestNextIdx, 1);
    }

    const setScore = setCoverageScore(set, requiredFamilies, requiredDisciplines);
    if (setScore > bestScore) {
      bestScore = setScore;
      bestSet = set;
    }
  }

  // Coverage rescue pass: if strict families are required and still missing
  // from the winning set, swap in the highest scoring candidate carrying
  // each missing family (while preserving set size).
  if (hardFamilyGate && bestSet.length > 0) {
    // Recompute covered and missing after EACH swap so that:
    // (a) a candidate covering two missing families only triggers one swap,
    // (b) the drop-candidate's "helps" check uses the live missing list
    //     (not a stale snapshot from before prior swaps altered coverage).
    const currentlyCovered = (): Set<CapabilityFamily> => {
      const s = new Set<CapabilityFamily>();
      for (const c of bestSet) for (const f of c.capabilityFamilies) s.add(f);
      return s;
    };
    for (const family of requiredFamilies) {
      if (currentlyCovered().has(family)) continue; // already covered after a prior swap
      const replacement = eligible
        .filter((c) => c.capabilityFamilies.includes(family) && !bestSet.includes(c))
        .sort((a, b) => b.match.score - a.match.score)[0];
      if (!replacement) continue;
      // Recompute which families are still missing for the drop decision.
      const stillMissing = requiredFamilies.filter((f) => !currentlyCovered().has(f));
      const dropIdx = bestSet
        .map((candidate, idx) => ({ idx, score: candidate.match.score, helps: candidate.capabilityFamilies.some((f) => stillMissing.includes(f)) }))
        .filter((item) => !item.helps)
        .sort((a, b) => a.score - b.score)[0]?.idx;
      if (dropIdx === undefined) continue;
      bestSet.splice(dropIdx, 1, replacement);
    }
  }

  // Diversity guardrail: enforce minimum distinct required-family coverage.
  const minDiversity = minimumFamilyDiversity(requiredFamilies);
  if (minDiversity > 0 && bestSet.length > 0) {
    const distinctCovered = () => {
      const set = new Set<CapabilityFamily>();
      for (const c of bestSet) {
        for (const f of c.capabilityFamilies) if (requiredFamilies.includes(f)) set.add(f);
      }
      return set;
    };

    let covered = distinctCovered();
    if (covered.size < minDiversity) {
      const missing = requiredFamilies.filter((f) => !covered.has(f));
      for (const family of missing) {
        if (covered.size >= minDiversity) break;
        const replacement = eligible
          .filter((c) => c.capabilityFamilies.includes(family) && !bestSet.includes(c))
          .sort((a, b) => b.match.score - a.match.score)[0];
        if (!replacement) continue;
        const dropIdx = bestSet
          .map((candidate, idx) => ({ idx, score: candidate.match.score, familyCount: candidate.capabilityFamilies.filter((f) => requiredFamilies.includes(f)).length }))
          .sort((a, b) => (a.familyCount - b.familyCount) || (a.score - b.score))[0]?.idx;
        if (dropIdx === undefined) continue;
        bestSet.splice(dropIdx, 1, replacement);
        covered = distinctCovered();
      }
    }
  }

  // Mark the winning set as selected on the final returned matches.
  const selectedIds = new Set(bestSet.map((c) => (c.match as unknown as { expertId?: string; projectId?: string }).expertId ?? (c.match as unknown as { projectId?: string }).projectId));
  return matches.map((m) => {
    const id = (m as unknown as { expertId?: string; projectId?: string }).expertId ?? (m as unknown as { projectId?: string }).projectId;
    return { ...m, isSelected: id !== undefined && selectedIds.has(id) };
  });
}

function optionalTrust(item: KnowledgeWithOptionalTrust): string | null | undefined {
  return item.trustLevel;
}

function seniorScore(params: {
  cosine: number;
  capability: number;
  sector: number;
  trust: number;
  experience: number;
  valueOrRecency: number;
  hasRealText: boolean;
}): number {
  // Cap the combined upside bonuses (trust + experience + recency) at 0.28
  // so that a REVIEWED senior expert with matching sector cannot rescue a
  // low-capability record above the 0.55 selection floor.  The sector
  // component is kept outside the cap because it can be negative (sector
  // conflict penalty −0.30) and must retain its full suppression effect.
  const bonusCapped = Math.min(params.trust + params.experience + params.valueOrRecency, 0.28);
  const base = params.capability >= 0.72
    ? (params.capability * 0.62 + params.cosine * 0.20 + params.sector + bonusCapped)
    : (params.capability * 0.42 + params.cosine * 0.35 + params.sector + bonusCapped);
  const evidenceConfidence = params.hasRealText ? 0.06 : -0.08;
  return Math.max(0, Math.min(1, base + evidenceConfidence));
}

export function buildMatches(
  requirements: RequirementDraft[],
  knowledge: CompanyKnowledgeSnapshot,
  tenderSector?: string | null,
  tenderTitle?: string | null,
): MatchingResult {
  const constraintProfile = deriveRequirementConstraintProfile(requirements);
  const priorityWeight: Record<string, number> = { MANDATORY: 3, SCORED: 2, INFORMATIONAL: 1 };
  const queryParts: string[] = [];
  for (const req of requirements) {
    const w = priorityWeight[req.priority] ?? 1;
    for (let i = 0; i < w; i += 1) queryParts.push(`${req.title} ${req.description}`);
  }
  if (tenderTitle) queryParts.push(tenderTitle, tenderTitle);
  if (tenderSector) queryParts.push(tenderSector);
  const queryText = queryParts.join(" ");
  const requiredFamiliesWeighted = weightedRequiredFamilies(requirements, tenderTitle, tenderSector);
  const requiredFamiliesUnique = [...new Set(requiredFamiliesWeighted)];
  const baseQueryTokens = tokenize(queryText);

  const expertTexts = knowledge.experts.map((e) => [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" "));
  const projectTexts = knowledge.projects.map((p) => [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" "));
  const expertTokenSets = expertTexts.map(tokenize);
  const projectTokenSets = projectTexts.map(tokenize);
  const idf = buildIdf([...expertTokenSets, ...projectTokenSets]);

  const expertMatches = knowledge.experts
    .map((expert, idx) => {
      const docTokens = expertTokenSets[idx] ?? [];
      let bestScore = 0;
      let bestCycle = 0;
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        const s = cosineTfidf(queryTokens, docTokens, idf);
        if (s > bestScore) { bestScore = s; bestCycle = cycle; }
        if (bestScore >= 0.995) break; // near-perfect match — remaining cycles cannot improve meaningfully
      }
      const recordText = expertTexts[idx] ?? "";
      const recordFamilies = capabilityFamilies(recordText);
      const trustLevel = optionalTrust(expert);
      const capability = capabilityScore(queryText, recordText, "expert");
      const weightedCapability = requiredFamiliesWeighted.length === 0
        ? capability
        : requiredFamiliesWeighted.filter((family) => recordFamilies.includes(family)).length / requiredFamiliesWeighted.length;
      const effectiveCap = Math.max(capability, weightedCapability);
      const sector = sectorBoost(tenderSector, parseArr(expert.sectors));
      const trust = ELIGIBLE_TRUST_ADJUSTMENT;
      const experience = Math.min(0.18, Math.max(0, (expert.yearsExperience ?? 0) * 0.008));
      const mismatchPenalty = criticalFamilyMismatchPenalty(queryText, recordText);
      const domainScore = domainTagMatchScore(constraintProfile.domainTags, recordText);
      const isHardExcluded = constraintProfile.strictDomain && domainScore === 0;
      const domainPenalty = isHardExcluded ? -0.9 : 0;
      // Capability relevance gate: records with near-zero family overlap must
      // not reach the 0.75 auto-select threshold on pure lexical similarity alone.
      const capCeiling = effectiveCap < 0.15 ? 0.58 : 1.0;
      const computedScore = Math.max(0, Math.min(capCeiling, seniorScore({ cosine: bestScore, capability: effectiveCap, sector, trust, experience, valueOrRecency: 0, hasRealText: docTokens.length > 8 }) + mismatchPenalty + domainPenalty));
      const rawScore = isHardExcluded ? 0 : computedScore;
      // GLM-A2 Issue #1135 Gap #3: Enforce durable provenance eligibility.
      // A reviewed-but-ungrounded record (REVIEWED but no sourceDocumentId,
      // reviewedBy, or reviewedAt) scores zero and cannot be selected.
      const eligibilityRecord = {
        id: expert.id,
        companyId: (expert as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (expert as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (expert as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (expert as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (expert as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (expert as { sourceDocument?: never }).sourceDocument ?? null,
        fullName: expert.fullName,
        title: expert.title,
        yearsExperience: expert.yearsExperience,
        disciplines: expert.disciplines,
        sectors: expert.sectors,
        certifications: expert.certifications,
      };
      const matchingEligibility = checkMatchingEligibility(eligibilityRecord);
      const score = matchingEligibility.eligible ? rawScore : 0;
      const evidence = [expert.title, ...parseArr(expert.disciplines), ...parseArr(expert.sectors)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const requiredFamilyHits = requiredFamiliesUnique.filter((family) => recordFamilies.includes(family)).length;
      const families = recordFamilies.join(", ");
      const trustLabel = matchingEligibility.eligible ? trustProvenanceLabel(eligibilityRecord as never) : "⚠ Provenance required";
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥75%." : "Below 75%; review only.";
      const domainLabel = constraintProfile.strictDomain
        ? (domainScore > 0 ? `Domain-tag overlap ${(domainScore * 100).toFixed(0)}%.` : "No strict-domain overlap; hard-excluded.")
        : "";
      return {
        expertId: expert.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} ${domainLabel} Required-family coverage: ${requiredFamilyHits}/${Math.max(requiredFamiliesUnique.length, 1)}. Capability families: ${families || "general consultancy"}. Keywords: ${topMatches || evidence || "general professional profile"}.${expert.yearsExperience ? ` ${expert.yearsExperience} yrs experience.` : ""}`,
        evidenceSummary: evidence || "No disciplines/sectors recorded — review the expert profile",
        isSelected: false,
      };
    })
    .sort((a, b) => {
      const aReviewed = humanReviewedRank(a.rationale);
      const bReviewed = humanReviewedRank(b.rationale);
      if (aReviewed !== bReviewed) return bReviewed - aReviewed;
      return b.score - a.score;
    });

  const projectMatches = knowledge.projects
    .map((project, idx) => {
      const docTokens = projectTokenSets[idx] ?? [];
      let bestScore = 0;
      let bestCycle = 0;
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        const s = cosineTfidf(queryTokens, docTokens, idf);
        if (s > bestScore) { bestScore = s; bestCycle = cycle; }
        if (bestScore >= 0.995) break;
      }
      const recordText = projectTexts[idx] ?? "";
      const recordFamilies = capabilityFamilies(recordText);
      const trustLevel = optionalTrust(project);
      const capability = capabilityScore(queryText, recordText, "project");
      const weightedCapability = requiredFamiliesWeighted.length === 0
        ? capability
        : requiredFamiliesWeighted.filter((family) => recordFamilies.includes(family)).length / requiredFamiliesWeighted.length;
      const effectiveCap = Math.max(capability, weightedCapability);
      const sector = sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);
      const trust = ELIGIBLE_TRUST_ADJUSTMENT;
      let recency = 0;
      if (project.endDate) {
        const ageYears = (Date.now() - new Date(project.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 5) recency += 0.07;
        else if (ageYears < 10) recency += 0.03;
      }
      if ((project.contractValue ?? 0) > 100000) recency += 0.03;
      const mismatchPenalty = criticalFamilyMismatchPenalty(queryText, recordText);
      const domainScore = domainTagMatchScore(constraintProfile.domainTags, recordText);
      const isHardExcluded = constraintProfile.strictDomain && domainScore === 0;
      const domainPenalty = isHardExcluded ? -0.9 : 0;
      // Capability relevance gate: records with near-zero family overlap must
      // not reach the 0.75 auto-select threshold on pure lexical similarity alone.
      const capCeiling = effectiveCap < 0.15 ? 0.58 : 1.0;
      const computedScore = Math.max(0, Math.min(capCeiling, seniorScore({ cosine: bestScore, capability: effectiveCap, sector, trust, experience: 0, valueOrRecency: recency, hasRealText: docTokens.length > 8 }) + mismatchPenalty + domainPenalty));
      const rawScore = isHardExcluded ? 0 : computedScore;
      // GLM-A2 Issue #1135 Gap #3: Enforce durable provenance eligibility.
      // A reviewed-but-ungrounded record (REVIEWED but no sourceDocumentId,
      // reviewedBy, or reviewedAt) scores zero and cannot be selected.
      const eligibilityRecord = {
        id: project.id,
        companyId: (project as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (project as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (project as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (project as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (project as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (project as { sourceDocument?: never }).sourceDocument ?? null,
        name: project.name,
        clientName: project.clientName,
        country: project.country,
        sector: project.sector,
        serviceAreas: project.serviceAreas,
        contractValue: project.contractValue,
        currency: project.currency,
      };
      const matchingEligibility = checkMatchingEligibility(eligibilityRecord);
      const score = matchingEligibility.eligible ? rawScore : 0;
      const evidence = [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const requiredFamilyHits = requiredFamiliesUnique.filter((family) => recordFamilies.includes(family)).length;
      const families = recordFamilies.join(", ");
      const trustLabel = matchingEligibility.eligible ? trustProvenanceLabel(eligibilityRecord as never) : "⚠ Provenance required";
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥75%." : "Below 75%; review only.";
      const domainLabel = constraintProfile.strictDomain
        ? (domainScore > 0 ? `Domain-tag overlap ${(domainScore * 100).toFixed(0)}%.` : "No strict-domain overlap; hard-excluded.")
        : "";
      return {
        projectId: project.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} ${domainLabel} Required-family coverage: ${requiredFamilyHits}/${Math.max(requiredFamiliesUnique.length, 1)}. Capability families: ${families || "general project profile"}. Keywords: ${topMatches || evidence || "general project profile"}.${project.contractValue ? ` Contract: ${project.currency?.trim() ? project.currency : "Currency unresolved"} ${project.contractValue.toLocaleString()}.` : ""}`,
        evidenceSummary: evidence || "No service areas recorded — review the project record",
        isSelected: false,
      };
    })
    .sort((a, b) => {
      const aReviewed = humanReviewedRank(a.rationale);
      const bReviewed = humanReviewedRank(b.rationale);
      if (aReviewed !== bReviewed) return bReviewed - aReviewed;
      return b.score - a.score;
    });

  // ─── Stage 2: Portfolio optimization ───────────────────────────────────────
  // Stage 1 above produced individual scores per expert / project using
  // 20 lexical cycles. Stage 2 below evaluates PORTFOLIO_OPTIMIZATION_CYCLES
  // candidate SETS to find the combination that best COVERS the tender's
  // capability families and disciplines as a group — not just the
  // individually highest scorers. This is the universal optimizer: it
  // looks at what THIS tender requires (extracted from requirement text),
  // not at hardcoded sector buckets, so it works for healthcare, water,
  // road, urban, environmental, ICT, education, and any future sector.
  //
  // Why this matters: the previous selection just took top-N by score.
  // For complex tenders with multiple disciplines (e.g., a hospital
  // assignment requiring architectural + structural + MEP + biomedical
  // experts), top-N often duplicated one discipline and missed others.
  // The portfolio optimizer rewards SETS that collectively cover all
  // required disciplines.

  const requirementText = queryText;
  const requiredFamilies = requiredFamiliesUnique.length > 0 ? requiredFamiliesUnique : capabilityFamilies(requirementText);
  const requirementDisciplineSources = [
    requirementText,
    ...requirements.map((r) => `${r.title} ${r.description}`),
    tenderTitle ?? "",
    tenderSector ?? "",
  ];
  const requiredDisciplines = uniqueStringsFrom(
    requirementDisciplineSources.map((src) => tokenize(src).filter((t) => t.length >= 5)),
  );

  const expertCandidates: PortfolioCandidate<typeof expertMatches[number]>[] = expertMatches.map((m) => {
    const e = knowledge.experts.find((x) => x.id === m.expertId);
    const recordText = e ? [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors)].join(" ") : "";
    const disciplines = e ? [...parseArr(e.disciplines), ...parseArr(e.sectors)] : [];
    return {
      match: m,
      capabilityFamilies: capabilityFamilies(recordText),
      disciplineTags: disciplines,
    };
  });

  const projectCandidates: PortfolioCandidate<typeof projectMatches[number]>[] = projectMatches.map((m) => {
    const p = knowledge.projects.find((x) => x.id === m.projectId);
    const recordText = p ? [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" ") : "";
    const disciplines = p ? [p.sector ?? "", ...parseArr(p.serviceAreas)].filter(Boolean) : [];
    return {
      match: m,
      capabilityFamilies: capabilityFamilies(recordText),
      disciplineTags: disciplines,
    };
  });

  return {
    expertMatches: optimizePortfolioSelection(
      expertMatches,
      expertCandidates,
      selectedLimit(requirements, "EXPERT", expertMatches.length),
      requiredFamilies,
      requiredDisciplines,
    ),
    projectMatches: optimizePortfolioSelection(
      projectMatches,
      projectCandidates,
      selectedLimit(requirements, "PROJECT_EXPERIENCE", projectMatches.length),
      requiredFamilies,
      requiredDisciplines,
    ),
  };
}
