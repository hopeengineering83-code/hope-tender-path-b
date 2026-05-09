// Win probability estimator.
//
// Returns a 0–100 score estimating the firm's likelihood of winning a given
// tender, based on four axes:
//
//   1. Evidence match (0–30): How many of the selected projects are in the
//      same primary sector as the tender, scaled by contract values present.
//   2. Team strength (0–25): Number and quality of reviewed experts matched
//      to the tender — weighted by whether their disciplines align.
//   3. Compliance posture (0–25): How many compliance gaps are open; CRITICAL
//      gaps cap this axis at a low value.
//   4. Historical outcomes (0–20): Win rate from the firm's own bid history
//      for the same sector. Falls back to 10/20 when no history exists.
//
// The score is labelled:
//   85–100  → "Strong"
//   65–84   → "Competitive"
//   45–64   → "Fair"
//   <45     → "Weak"
//
// This is NOT a financial model. It is a heuristic indicator that helps
// bid managers decide whether to invest in improving the proposal before
// submission. It will be surfaced in the proposal UI alongside the quality
// score.

export type WinProbabilityInput = {
  primarySector: string;
  // Selected projects with their sectors and contract values
  projects: Array<{
    clientName?: string | null;
    country?: string | null;
    sectors?: string | null;      // JSON array
    contractValue?: number | null;
    contractCurrency?: string | null;
    name?: string | null;
  }>;
  // Selected experts with their disciplines
  experts: Array<{
    disciplines?: string | null;  // JSON array
    sectors?: string | null;      // JSON array
    yearsExperience?: number | null;
  }>;
  // Open compliance gaps from the tender
  complianceGaps: Array<{
    severity?: string | null;
    title?: string | null;
  }>;
  // Historical bid outcomes from this company — all sectors
  bidOutcomes?: Array<{
    won: boolean;
    primarySector?: string | null;
  }>;
};

export type WinProbabilityResult = {
  score: number;           // 0–100
  label: "Strong" | "Competitive" | "Fair" | "Weak";
  breakdown: {
    evidenceMatch: number;    // 0–30
    teamStrength: number;     // 0–25
    compliancePosture: number; // 0–25
    historicalOutcomes: number; // 0–20
  };
  notes: string[];
};

function safeArrField(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function normalizeSector(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sectorsOverlap(a: string, b: string[]): boolean {
  const aN = normalizeSector(a);
  return b.some((bs) => {
    const bN = normalizeSector(bs);
    return aN.includes(bN) || bN.includes(aN) || (aN.split(" ").some((w) => w.length > 3 && bN.includes(w)));
  });
}

// ── Axis 1: Evidence match (0–30) ─────────────────────────────────────────
function scoreEvidenceMatch(primarySector: string, projects: WinProbabilityInput["projects"]): { score: number; notes: string[] } {
  if (projects.length === 0) return { score: 0, notes: ["No reviewed projects selected — evidence score is zero."] };

  let matched = 0;
  let hasContractValue = 0;

  for (const p of projects) {
    const pSectors = safeArrField(p.sectors);
    if (pSectors.length > 0 && sectorsOverlap(primarySector, pSectors)) matched += 1;
    if (p.contractValue && p.contractValue > 0) hasContractValue += 1;
  }

  const matchRatio = matched / projects.length;
  const valueBonus = hasContractValue >= 2 ? 5 : hasContractValue >= 1 ? 3 : 0;

  let base = 0;
  if (matchRatio >= 0.8) base = 22;
  else if (matchRatio >= 0.5) base = 16;
  else if (matchRatio >= 0.25) base = 10;
  else if (projects.length >= 2) base = 5; // projects present but sector mismatch
  else base = 3;

  const score = Math.min(30, base + valueBonus);
  const notes: string[] = [];
  if (matched > 0) notes.push(`${matched} of ${projects.length} project(s) are in the same sector.`);
  else notes.push(`No selected projects match the tender sector (${primarySector}). Add comparable references.`);
  if (hasContractValue > 0) notes.push(`${hasContractValue} project(s) have contract values (evidence quality boost).`);

  return { score, notes };
}

// ── Axis 2: Team strength (0–25) ──────────────────────────────────────────
function scoreTeamStrength(primarySector: string, experts: WinProbabilityInput["experts"]): { score: number; notes: string[] } {
  if (experts.length === 0) return { score: 0, notes: ["No reviewed experts selected — team score is zero."] };

  let alignedCount = 0;
  let seniorCount = 0; // ≥ 10 years experience

  for (const e of experts) {
    const eSectors = safeArrField(e.sectors);
    const eDisciplines = safeArrField(e.disciplines);
    if (sectorsOverlap(primarySector, eSectors) || sectorsOverlap(primarySector, eDisciplines)) alignedCount += 1;
    if ((e.yearsExperience ?? 0) >= 10) seniorCount += 1;
  }

  let base = 0;
  if (experts.length >= 4) base = 14;
  else if (experts.length >= 2) base = 10;
  else base = 5;

  const alignBonus = alignedCount >= 2 ? 6 : alignedCount >= 1 ? 3 : 0;
  const seniorBonus = seniorCount >= 2 ? 5 : seniorCount >= 1 ? 2 : 0;

  const score = Math.min(25, base + alignBonus + seniorBonus);
  const notes: string[] = [`${experts.length} reviewed expert(s) selected.`];
  if (alignedCount > 0) notes.push(`${alignedCount} expert(s) have sector-aligned disciplines.`);
  if (seniorCount > 0) notes.push(`${seniorCount} expert(s) with 10+ years experience.`);

  return { score, notes };
}

// ── Axis 3: Compliance posture (0–25) ─────────────────────────────────────
function scoreCompliancePosture(gaps: WinProbabilityInput["complianceGaps"]): { score: number; notes: string[] } {
  const criticalGaps = gaps.filter((g) => /(critical|mandatory|high|ineligible)/i.test(g.severity ?? ""));
  const mediumGaps = gaps.filter((g) => /medium/i.test(g.severity ?? ""));

  if (criticalGaps.length >= 2) {
    return {
      score: 3,
      notes: [`${criticalGaps.length} critical/mandatory compliance gaps detected — severely limits win probability.`],
    };
  }
  if (criticalGaps.length === 1) {
    return {
      score: 8,
      notes: [`1 critical compliance gap: "${criticalGaps[0].title ?? "unknown"}". Resolve before submission.`],
    };
  }

  let score = 25;
  if (mediumGaps.length >= 3) score -= 8;
  else if (mediumGaps.length >= 1) score -= 4;
  if (gaps.length >= 5) score -= 3;

  const notes: string[] = [];
  if (gaps.length === 0) notes.push("No open compliance gaps detected.");
  else notes.push(`${gaps.length} compliance gap(s) open (${criticalGaps.length} critical, ${mediumGaps.length} medium).`);

  return { score: Math.max(0, score), notes };
}

// ── Axis 4: Historical outcomes (0–20) ────────────────────────────────────
function scoreHistoricalOutcomes(
  primarySector: string,
  outcomes: WinProbabilityInput["bidOutcomes"],
): { score: number; notes: string[] } {
  if (!outcomes || outcomes.length === 0) {
    return { score: 10, notes: ["No bid history available — using neutral baseline (10/20)."] };
  }

  const sectorOutcomes = outcomes.filter((o) =>
    o.primarySector ? sectorsOverlap(primarySector, [o.primarySector]) : false
  );

  const pool = sectorOutcomes.length >= 3 ? sectorOutcomes : outcomes;
  const wins = pool.filter((o) => o.won).length;
  const total = pool.length;
  const winRate = wins / total;

  let score = 0;
  if (winRate >= 0.6) score = 18;
  else if (winRate >= 0.4) score = 14;
  else if (winRate >= 0.25) score = 10;
  else if (winRate >= 0.1) score = 6;
  else score = 3;

  const label = sectorOutcomes.length >= 3 ? "sector-specific" : "overall";
  const notes = [
    `Historical win rate: ${wins}/${total} bids won (${Math.round(winRate * 100)}%) — ${label} data.`,
  ];

  return { score, notes };
}

// ── Public scorer ─────────────────────────────────────────────────────────
export function computeWinProbability(input: WinProbabilityInput): WinProbabilityResult {
  const ev = scoreEvidenceMatch(input.primarySector, input.projects);
  const ts = scoreTeamStrength(input.primarySector, input.experts);
  const cp = scoreCompliancePosture(input.complianceGaps);
  const ho = scoreHistoricalOutcomes(input.primarySector, input.bidOutcomes);

  const total = ev.score + ts.score + cp.score + ho.score;
  const clamped = Math.max(0, Math.min(100, total));

  const label: WinProbabilityResult["label"] =
    clamped >= 85 ? "Strong"
    : clamped >= 65 ? "Competitive"
    : clamped >= 45 ? "Fair"
    : "Weak";

  return {
    score: clamped,
    label,
    breakdown: {
      evidenceMatch: ev.score,
      teamStrength: ts.score,
      compliancePosture: cp.score,
      historicalOutcomes: ho.score,
    },
    notes: [...ev.notes, ...ts.notes, ...cp.notes, ...ho.notes],
  };
}

// Format for display in the proposal summary line.
export function formatWinProbability(result: WinProbabilityResult): string {
  return `Win probability: ${result.score}/100 (${result.label}) | Evidence ${result.breakdown.evidenceMatch}/30, Team ${result.breakdown.teamStrength}/25, Compliance ${result.breakdown.compliancePosture}/25, History ${result.breakdown.historicalOutcomes}/20`;
}
