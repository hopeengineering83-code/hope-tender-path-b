/**
 * Gathers the evidence estimateTenderPrice reads for one tender: the tender's
 * own text, the selected team, the firm's past contracts and the rates the
 * owner approved on other tenders, and the rate card with the public
 * benchmarks. Read-only.
 */

import { prisma as defaultPrisma } from "../prisma";
import { canUseVaultRecord, parseStoredStringList } from "../vault-review-provenance";
import { estimateTenderPrice, type PricingEstimate } from "./pricing-intelligence";
import { loadBenchmarks } from "./pricing-rate-card";

export async function loadPricingEstimate(tenderId: string, userId: string, db: any = defaultPrisma, now = new Date()): Promise<PricingEstimate | null> {
  const tender = await db.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, country: true, category: true, currency: true, budget: true, description: true,
      files: { where: { deletedAt: null }, select: { extractedText: true } },
      requirements: { select: { title: true, description: true, requirementType: true } },
      expertMatches: {
        where: { isSelected: true },
        orderBy: { score: "desc" },
        select: { expert: { select: { id: true, fullName: true, title: true, yearsExperience: true, deletedAt: true } } },
      },
      projectMatches: { where: { isSelected: true }, select: { projectId: true } },
    },
  });
  if (!tender) return null;

  const company = await db.company.findUnique({
    where: { userId },
    select: {
      settings: { select: { defaultCurrency: true } },
      projects: {
        where: { deletedAt: null },
        select: {
          id: true, name: true, sector: true, serviceAreas: true, contractValue: true, currency: true, startDate: true, endDate: true,
          trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true,
        },
      },
    },
  }).catch(() => null);

  const selectedProjectIds = new Set<string>(tender.projectMatches.map((m: { projectId: string }) => m.projectId));
  const historicalProjects = (company?.projects ?? [])
    .filter((p: any) => canUseVaultRecord(p, "GENERATION"))
    .map((p: any) => ({
      name: p.name,
      sector: p.sector,
      serviceAreas: parseStoredStringList(p.serviceAreas),
      contractValue: p.contractValue,
      currency: p.currency,
      startDate: p.startDate,
      endDate: p.endDate,
      selected: selectedProjectIds.has(p.id),
    }));

  // Rates the owner set on other tenders: the firm's own commercial history.
  const priorLines = await db.costLine.findMany({
    where: { rate: { gt: 0 }, workbook: { tenderId: { not: tenderId }, tender: { userId } } },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { label: true, category: true, unit: true, rate: true, updatedAt: true, workbook: { select: { currency: true, tender: { select: { title: true } } } } },
  }).catch(() => []);

  const tenderText = [
    ...tender.files.map((f: { extractedText: string | null }) => f.extractedText ?? ""),
    ...tender.requirements.map((r: { title: string; description: string | null }) => `${r.title}. ${r.description ?? ""}`),
  ].join("\n\n");

  return estimateTenderPrice({
    tender: { id: tender.id, title: tender.title, country: tender.country, category: tender.category, currency: tender.currency, budget: tender.budget },
    tenderText,
    experts: tender.expertMatches
      .map((m: any) => m.expert)
      .filter((e: any) => e && !e.deletedAt)
      .map((e: any) => ({ id: e.id, name: e.fullName, title: e.title, yearsExperience: e.yearsExperience })),
    teamRequirementTexts: tender.requirements
      .filter((r: { requirementType: string | null }) => String(r.requirementType ?? "").toUpperCase() === "EXPERT")
      .map((r: { title: string; description: string | null }) => r.description ?? r.title),
    historicalProjects,
    priorRates: priorLines.map((l: any) => ({
      label: l.label, category: l.category, unit: l.unit, rate: l.rate, currency: l.workbook?.currency ?? "", date: l.updatedAt, tenderTitle: l.workbook?.tender?.title ?? null,
    })),
    companyDefaultCurrency: company?.settings?.defaultCurrency ?? null,
    benchmarks: await loadBenchmarks(userId, db),
    now,
  });
}
