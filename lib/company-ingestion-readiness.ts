import { prisma } from "./prisma";

function toCount(text: string | null | undefined, re: RegExp): number | null {
  const m = (text ?? "").match(re)?.[1];
  if (!m) return null;
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getCompanyIngestionReadiness(companyId: string) {
  const [docs, experts, projects] = await Promise.all([
    prisma.companyDocument.findMany({ where: { companyId }, select: { extractedText: true } }),
    prisma.expert.findMany({ where: { companyId }, select: { trustLevel: true } }),
    prisma.project.findMany({ where: { companyId }, select: { trustLevel: true } }),
  ]);
  const reviewedExperts = experts.filter((e) => e.trustLevel === "REVIEWED").length;
  const reviewedProjects = projects.filter((p) => p.trustLevel === "REVIEWED").length;
  const expectedExperts = docs.map((d) => toCount(d.extractedText, /(\d{1,3})\s+(?:experts|expert cvs|cv|cvs|staff|personnel)/i)).find(Boolean) ?? null;
  const expectedProjects = docs.map((d) => toCount(d.extractedText, /(\d{2,3})\s+(?:selected\s+)?projects?/i)).find(Boolean) ?? null;
  const missingExperts = expectedExperts ? Math.max(0, expectedExperts - experts.length) : 0;
  const missingProjects = expectedProjects ? Math.max(0, expectedProjects - projects.length) : 0;
  const blockers: string[] = [];
  if (docs.length === 0) blockers.push("No company documents uploaded.");
  if (reviewedExperts === 0) blockers.push("No REVIEWED experts available.");
  if (reviewedProjects === 0) blockers.push("No REVIEWED projects available.");
  if (missingExperts > 0) blockers.push(`Expert completeness gap: missing ${missingExperts} record(s) against expected count.`);
  if (missingProjects > 0) blockers.push(`Project completeness gap: missing ${missingProjects} record(s) against expected count.`);
  return { ingestionReady: blockers.length === 0, blockers, totals: { documents: docs.length, experts: experts.length, projects: projects.length, reviewedExperts, reviewedProjects, expectedExperts, expectedProjects, missingExperts, missingProjects } };
}
