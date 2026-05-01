export type ProofDensityResult = {
  score: number;
  verdict: "STRONG_PROOF_DENSITY" | "WEAK_PROOF_DENSITY";
  evidenceHits: number;
  uniqueEvidenceSignals: string[];
  missingSignals: string[];
};

const SIGNALS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "project names / project proof", patterns: [/project/i, /assignment/i, /portfolio/i, /reference/i] },
  { label: "client proof", patterns: [/client/i, /prepared for/i, /reference letter/i, /testimony/i] },
  { label: "scope proof", patterns: [/scope/i, /services/i, /deliverables/i, /methodology/i] },
  { label: "value / scale proof", patterns: [/value/i, /contract/i, /ETB|USD|EUR|GBP|AED|SAR/i, /million|billion/i, /m\b/i] },
  { label: "expert / CV proof", patterns: [/expert/i, /CV/i, /team/i, /specialist/i, /qualification/i, /licence|license/i] },
  { label: "appendix proof", patterns: [/appendix/i, /certificate/i, /registration/i, /licence|license/i, /photo/i, /drawing/i] },
  { label: "healthcare functional proof", patterns: [/Emergency/i, /OPD/i, /In-patient/i, /Laboratory/i, /Radiology/i, /Imaging/i, /Pharmacy/i] },
  { label: "biomedical / MEP proof", patterns: [/biomedical/i, /medical equipment/i, /medical gas/i, /MEP/i, /HVAC/i, /electrical/i, /radiation shielding/i] },
  { label: "approval / QA proof", patterns: [/approval/i, /regulatory/i, /QA|QC/i, /quality assurance/i, /review gate/i, /document control/i] },
  { label: "bid-review controls", patterns: [/bid-team confirmation/i, /to be confirmed/i, /unsupported claim/i, /evidence control/i, /source traceability/i] },
];

function countMatches(markdown: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (markdown.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))?.length ?? 0), 0);
}

export function scoreProofDensity(markdown: string): ProofDensityResult {
  const uniqueEvidenceSignals: string[] = [];
  const missingSignals: string[] = [];
  let evidenceHits = 0;

  for (const signal of SIGNALS) {
    const hits = countMatches(markdown, signal.patterns);
    evidenceHits += hits;
    if (hits > 0) uniqueEvidenceSignals.push(signal.label);
    else missingSignals.push(signal.label);
  }

  const lengthFactor = markdown.length >= 12000 ? 15 : markdown.length >= 9000 ? 10 : markdown.length >= 6500 ? 6 : 0;
  const signalScore = Math.round((uniqueEvidenceSignals.length / SIGNALS.length) * 65);
  const hitScore = Math.min(20, Math.round(evidenceHits / 3));
  const score = Math.max(0, Math.min(100, signalScore + hitScore + lengthFactor));

  return {
    score,
    verdict: score >= 85 ? "STRONG_PROOF_DENSITY" : "WEAK_PROOF_DENSITY",
    evidenceHits,
    uniqueEvidenceSignals,
    missingSignals,
  };
}

export function proofDensitySummary(markdown: string): string {
  const result = scoreProofDensity(markdown);
  return `Proof density ${result.score}/100 (${result.verdict}); evidence hits: ${result.evidenceHits}; signals: ${result.uniqueEvidenceSignals.length}/${SIGNALS.length}; missing: ${result.missingSignals.join(" | ") || "none"}`;
}
