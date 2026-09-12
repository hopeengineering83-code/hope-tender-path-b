/**
 * Aggregate portfolio metrics tile block — mirrors the benchmark's cover-page
 * "headline facts" row (e.g., "2 Hospitals Designed | ETB 675M | 12-Expert
 * Team | World Bank ESF compliant") and is reused as a Section A.0
 * "Portfolio at a Glance" table.
 *
 * Built deterministically from the reviewed knowledge vault. Uses no AI.
 */

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";

function summariseValue(total: number, currency: string): string {
  if (total >= 1_000_000_000) return `${currency} ${(total / 1_000_000_000).toFixed(1)}B`;
  if (total >= 1_000_000) return `${currency} ${(total / 1_000_000).toFixed(1)}M`;
  return `${currency} ${total.toLocaleString("en-US")}`;
}

export type PortfolioMetrics = {
  reviewedProjectCount: number;
  reviewedExpertCount: number;
  totalContractValue: number;
  currency: string;
  countriesCovered: string[];
  topSectors: string[];
  certificationsCount: number;
  uniqueDisciplines: string[];
  hasDonorEvidence: boolean;
};

export function computePortfolioMetrics(opts: {
  experts: ExpertRecord[];
  projects: ProjectRecord[];
}): PortfolioMetrics {
  const projects = opts.projects;
  const experts = opts.experts;
  const currencies = projects.map((p) => p.currency).filter(Boolean);
  const dominantCurrency = currencies.find((c) => currencies.filter((x) => x === c).length >= currencies.length / 2) || currencies[0] || "ETB";

  const totalContractValue = projects.reduce((sum, p) => sum + (p.contractValue ?? 0), 0);
  const countriesCovered = Array.from(new Set(projects.map((p) => (p.country ?? "").trim()).filter(Boolean)));
  const sectorCounts = new Map<string, number>();
  for (const p of projects) {
    const s = (p.sector ?? "").trim();
    if (!s) continue;
    sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1);
  }
  const topSectors = Array.from(sectorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([sector]) => sector);

  let certificationsCount = 0;
  const disciplines = new Set<string>();
  for (const e of experts) {
    if (e.certifications) {
      try {
        const parsed = JSON.parse(e.certifications);
        if (Array.isArray(parsed)) certificationsCount += parsed.length;
      } catch {
        certificationsCount += (e.certifications.match(/[,;|]/g)?.length ?? 0) + 1;
      }
    }
    if (e.disciplines) {
      try {
        const parsed = JSON.parse(e.disciplines);
        if (Array.isArray(parsed)) parsed.forEach((d: string) => disciplines.add(d));
      } catch {
        e.disciplines.split(/[,;|]/).forEach((d) => disciplines.add(d.trim()));
      }
    }
  }

  const allTextForDonor = projects.map((p) => `${p.summary ?? ""} ${p.clientName ?? ""}`).join(" ").toLowerCase();
  const hasDonorEvidence = /world bank|undp|usaid|british council|german gov|french gov|gtz|jica|kfw|adb|afdb|igad/i.test(allTextForDonor);

  return {
    reviewedProjectCount: projects.length,
    reviewedExpertCount: experts.length,
    totalContractValue,
    currency: dominantCurrency,
    countriesCovered: countriesCovered.slice(0, 5),
    topSectors,
    certificationsCount,
    uniqueDisciplines: Array.from(disciplines).slice(0, 8),
    hasDonorEvidence,
  };
}

export function buildPortfolioMetricsBlock(metrics: PortfolioMetrics, companyName: string): string {
  if (metrics.reviewedProjectCount === 0 && metrics.reviewedExpertCount === 0) {
    return [
      "## A.0 Portfolio at a Glance",
      "_Source-evidence action: review and mark project + expert records as REVIEWED before final submission so portfolio metrics can be computed._",
    ].join("\n\n");
  }

  const tiles: string[] = [];
  // "Reviewed" is this application's internal trust state, not a fact about the
  // firm. It meant nothing to the evaluator and, worse, a headline block that
  // opened "1 Reviewed Project Reference" announced thin evidence in the first
  // line an evaluator reads — while the reference itself is set out in full in
  // Section B, where it does the firm some good.
  //
  // A count of one is not a portfolio statistic; it is the reference. Count
  // tiles therefore appear only at two or more, and the substantive tiles
  // below — disciplines, sectors, geography, certifications — carry the block
  // when the counts are small. Nothing is hidden: every record still appears in
  // Section A.5 and Section B in full.
  if (metrics.reviewedProjectCount >= 2) {
    tiles.push(`| **${metrics.reviewedProjectCount}** Project References |`);
  }
  if (metrics.totalContractValue > 0) {
    // "Aggregate Portfolio Value" overstates what this number is.
    //
    // Project.contractValue is extracted from the project reference text, and
    // on a real consultancy portfolio it is overwhelmingly the CONSTRUCTION
    // cost of the works the firm designed or supervised — 95 of 112 on the
    // portfolio this was measured against — not the firm's own fee, which is
    // a separate and far smaller figure in the same reference ("Construction
    // Cost: 550,074,678.02 ETB" alongside "Design Cost: 1,100,000 ETB").
    //
    // Until this tile rendered, the distinction cost nothing: every value was
    // null and the tile never appeared. Now that the import derives the
    // column, an unqualified "Portfolio Value" in the first block an
    // evaluator reads would imply firm-scale turnover. Say what it is.
    tiles.push(`| **${summariseValue(metrics.totalContractValue, metrics.currency)}** Aggregate Value of Projects Delivered |`);
  }
  if (metrics.reviewedExpertCount >= 2) {
    tiles.push(`| **${metrics.reviewedExpertCount}** Specialists on the Proposed Team |`);
  }
  if (metrics.certificationsCount >= 2) {
    tiles.push(`| **${metrics.certificationsCount}** Documented Professional Certifications & Licences |`);
  }
  if (metrics.countriesCovered.length > 0) {
    tiles.push(`| Operating across **${metrics.countriesCovered.join(", ")}** |`);
  }
  if (metrics.topSectors.length > 0) {
    tiles.push(`| Sector coverage: **${metrics.topSectors.join(", ")}** |`);
  }
  if (metrics.uniqueDisciplines.length > 0) {
    tiles.push(`| Disciplines on the team: ${metrics.uniqueDisciplines.join(" / ")} |`);
  }
  if (metrics.hasDonorEvidence) {
    // No dingbat. U+2713 CHECK MARK is outside WinAnsi, so the PDF renderer
    // switches to an embedded Unicode face for the whole document - and the
    // face it picks has no glyph for it, which draws .notdef. On the
    // delivered 35-page PDF (run 34698133772) the client's first capability
    // block carried a NUL where the tick should be:
    //
    //   <U+0000> Donor / international institution delivery track record...
    //
    // Nothing was logged. A missing glyph is silent, unlike an UNENCODABLE
    // character, which throws and is therefore caught in development. Every
    // sibling tile in this block is plain text; this one now matches.
    tiles.push(`| Donor / international institution delivery track record on file |`);
  }

  if (tiles.length === 0) {
    // Every tile was suppressed. An empty table is worse than no block: the
    // capability detail lives in Section A and the references in Section B.
    return "";
  }

  return [
    "## A.0 Portfolio at a Glance",
    `Headline capability profile for ${companyName}:`,
    "",
    "| Headline Metric |",
    "|---|",
    ...tiles,
  ].join("\n");
}
