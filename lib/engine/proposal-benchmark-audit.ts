import { proofDensitySummary } from "./proposal-proof-density";
import { proofDensityRepairSummary } from "./proof-density-repair-guidance";

export type ProposalBenchmarkAudit = {
  score: number;
  verdict: "BENCHMARK_READY" | "NEEDS_REPAIR";
  matchedTraits: string[];
  missingTraits: string[];
};

const TRAITS: Array<{ label: string; weight: number; pattern: RegExp }> = [
  { label: "opens with direct comparable project proof", weight: 10, pattern: /(?:project|reference|portfolio|similar assignment|contract|client).{0,160}(?:evidence|value|scope|services|experience)/i },
  { label: "names client and tender", weight: 8, pattern: /(?:client|tender|proposal|assignment|prepared for)/i },
  { label: "includes Section A company profile structure", weight: 8, pattern: /SECTION A|A\.1|Company Background|Corporate Information|Core Areas of Expertise/i },
  { label: "includes Section B relevant experience structure", weight: 8, pattern: /SECTION B|Relevant Experience|Client References|Project Portfolio|Project Cards/i },
  { label: "includes Section C technical approach structure", weight: 8, pattern: /SECTION C|Technical Approach|Technical Methodology|Understanding of the Assignment/i },
  { label: "includes Section D additional information", weight: 5, pattern: /SECTION D|Additional Information|Value to the Client|Value-Added|Declaration of Eligibility/i },
  { label: "maps team to project evidence", weight: 8, pattern: /team.to.project|expert.*project|previous role|mapped to|experience mapping/i },
  { label: "contains sector-specific technical depth", weight: 10, pattern: /Emergency|OPD|In-patient|Laboratory|Radiology|Imaging|Pharmacy|clinical zoning|patient flow|IPC|hydraulic.*model|borehole.*design|water.*treatment|WASH.*scheme|reservoir.*design|pump.*station|road.*design|pavement.*design|bridge.*design|culvert.*design|traffic.*analysis|ESIA|ESMP|environmental.*impact|social.*safeguard|biodiversity.*survey|master.*plan|land.*use.*plan|GIS.*analysis|zoning.*plan|ICT.*architect|software.*develop|database.*design|MIS.*develop|ERP.*implement|school.*design|campus.*layout|education.*facilit|biomedical.*integrat|medical.*equipment.*plan|load.flow.*analysis|protection.*relay.*coordination|P50.*P90|SCADA.*architecture|grid.code.*compliance|FAO.*Penman|crop.water.*requirement|WUA.*governance|irrigation.*network|command.area|JORC.*resource|TSF.*design|slope.stability.*analysis|mine.*plan|competent.person.*review|met.ocean.*analysis|bathymetric.*survey|nautical.*simulation|ISPS.*compliance|dredge.*disposal|HAZOP.*study|P&ID.*development|pipeline.*stress.*analysis|cathodic.protection|LOPA.*analysis|KYC.*AML.*gap|regulatory.*gap.*analysis|RBAC.*encryption|data.*migration.*reconciliation|parallel.run.*cutover|RF.*coverage.*simulation|spectrum.*licensing|drive.test.*KPI|backhaul.*path.*availability/i },
  { label: "contains technical systems and infrastructure integration", weight: 8, pattern: /biomedical|medical equipment|medical gas|radiation shielding|MEP|HVAC|electrical load|telehealth|hydraulic.*system|pipeline.*network|pump.*station|structural.*design|civil.*engineering|geotechnical|foundation.*design|network.*infrastructure|server.*architect|laboratory.*equipment|workshop.*facilit|irrigation.*scheme|wastewater.*treatment|load.flow.*model|single.line.*diagram|relay.*coordination|SCADA.*system|power.*systems|canal.*design|weir.*structure|diversion.*structure|block.*model|geotechnical.*investigation|tailings.*facilit|berth.*structural|dredge.*volume|shore.power|HAZOP.*action.*register|pipeline.*stress|cathodic.*protection.*design|regulatory.*compliance.*gap|RBAC.*control|audit.*log.*configuration|base.station.*siting|backhaul.*design|path.*availability.*calculation/i },
  { label: "contains scope-by-scope delivery methodology", weight: 8, pattern: /Facility Identification|Technical Assessment|Conceptual|Detailed Design|Regulatory Compliance|Renovation|Close-Out/i },
  { label: "contains appendix evidence discipline", weight: 7, pattern: /Appendix Register|CV|certificate|registration|licence|photo|drawing|testimony|completion/i },
  { label: "contains source/evidence control", weight: 7, pattern: /Evidence Control|claim.to.evidence|source traceability|bid-team confirmation|unsupported claims/i },
  { label: "avoids AI and placeholder language", weight: 5, pattern: /^(?![\s\S]*(?:as an ai|language model|placeholder|insert name|insert date|\bTBD\b))[\s\S]*$/i },
];

const TRAIT_REPAIR_MAP: Record<string, string> = {
  "opens with direct comparable project proof": "project names / project proof",
  "names client and tender": "client proof",
  "includes Section B relevant experience structure": "project names / project proof",
  "maps team to project evidence": "expert / CV proof",
  "contains sector-specific technical depth": "healthcare functional proof",
  "contains technical systems and infrastructure integration": "biomedical / MEP proof",
  "contains scope-by-scope delivery methodology": "scope proof",
  "contains appendix evidence discipline": "appendix proof",
  "contains source/evidence control": "bid-review controls",
};

export function auditProposalAgainstBenchmark(markdown: string): ProposalBenchmarkAudit {
  const matchedTraits: string[] = [];
  const missingTraits: string[] = [];
  let score = 0;

  for (const trait of TRAITS) {
    if (trait.pattern.test(markdown)) {
      score += trait.weight;
      matchedTraits.push(trait.label);
    } else {
      missingTraits.push(trait.label);
    }
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore,
    verdict: finalScore >= 92 ? "BENCHMARK_READY" : "NEEDS_REPAIR",
    matchedTraits,
    missingTraits,
  };
}

function missingTraitsToRepairSignals(missingTraits: string[]): string[] {
  return Array.from(new Set(missingTraits.map((trait) => TRAIT_REPAIR_MAP[trait]).filter(Boolean)));
}

export function benchmarkAuditSummary(markdown: string): string {
  const audit = auditProposalAgainstBenchmark(markdown);
  const repairSignals = missingTraitsToRepairSignals(audit.missingTraits);
  return `Benchmark audit ${audit.score}/100 (${audit.verdict}); matched: ${audit.matchedTraits.length}; missing: ${audit.missingTraits.join(" | ") || "none"}. ${proofDensitySummary(markdown)}. ${proofDensityRepairSummary(repairSignals)}`;
}
