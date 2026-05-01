import { proofDensitySummary } from "./proposal-proof-density";

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
  { label: "contains healthcare workflow depth", weight: 10, pattern: /Emergency|OPD|In-patient|Laboratory|Radiology|Imaging|Pharmacy|clinical zoning|patient flow|IPC/i },
  { label: "contains biomedical and MEP integration", weight: 8, pattern: /biomedical|medical equipment|medical gas|radiation shielding|MEP|HVAC|electrical load|telehealth/i },
  { label: "contains scope-by-scope delivery methodology", weight: 8, pattern: /Facility Identification|Technical Assessment|Conceptual|Detailed Design|Regulatory Compliance|Renovation|Close-Out/i },
  { label: "contains appendix evidence discipline", weight: 7, pattern: /Appendix Register|CV|certificate|registration|licence|photo|drawing|testimony|completion/i },
  { label: "contains source/evidence control", weight: 7, pattern: /Evidence Control|claim.to.evidence|source traceability|bid-team confirmation|unsupported claims/i },
  { label: "avoids AI and placeholder language", weight: 5, pattern: /^(?![\s\S]*(?:as an ai|language model|placeholder|insert name|insert date|\bTBD\b))[\s\S]*$/i },
];

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

export function benchmarkAuditSummary(markdown: string): string {
  const audit = auditProposalAgainstBenchmark(markdown);
  return `Benchmark audit ${audit.score}/100 (${audit.verdict}); matched: ${audit.matchedTraits.length}; missing: ${audit.missingTraits.join(" | ") || "none"}. ${proofDensitySummary(markdown)}`;
}
