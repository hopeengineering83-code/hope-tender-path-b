import { safeParse, safeParseJsonArray } from "./safe-json-util";
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
        const parsed = safeParseJsonArray(e.certifications);
        if (Array.isArray(parsed)) certificationsCount += parsed.length;
      } catch {
        certificationsCount += (e.certifications.match(/[,;|]/g)?.length ?? 0) + 1;
      }
    }
    if (e.disciplines) {
      try {
        const parsed = safeParseJsonArray(e.disciplines);
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
  if (metrics.reviewedProjectCount > 0) {
    tiles.push(`| **${metrics.reviewedProjectCount}** Reviewed Project Reference${metrics.reviewedProjectCount === 1 ? "" : "s"} |`);
  }
  if (metrics.totalContractValue > 0) {
    tiles.push(`| **${summariseValue(metrics.totalContractValue, metrics.currency)}** Aggregate Portfolio Value |`);
  }
  if (metrics.reviewedExpertCount > 0) {
    tiles.push(`| **${metrics.reviewedExpertCount}** Reviewed Specialist${metrics.reviewedExpertCount === 1 ? "" : "s"} on the Proposed Team |`);
  }
  if (metrics.certificationsCount > 0) {
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
    tiles.push(`| ✓ Donor / international institution delivery track record on file |`);
  }

  return [
    "## A.0 Portfolio at a Glance",
    `Headline metrics for ${companyName}, computed from reviewed project and expert records:`,
    "",
    "| Headline Metric |",
    "|---|",
    ...tiles,
  ].join("\n");
}
