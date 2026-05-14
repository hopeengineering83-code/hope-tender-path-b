import { prisma } from "./prisma";

type ReadinessDoc = { extractedText: string | null };
type ReadinessExpert = { trustLevel: string | null };
type ReadinessProject = { trustLevel: string | null };

export type IngestionReadinessSnapshot = {
  docs: ReadinessDoc[];
  experts: ReadinessExpert[];
  projects: ReadinessProject[];
};

export type IngestionReadinessOptions = {
  requireDocuments?: boolean;
  requireReviewedExperts?: boolean;
  requireReviewedProjects?: boolean;
};

function toCount(text: string | null | undefined, re: RegExp): number | null {
  const m = (text ?? "").match(re)?.[1];
  if (!m) return null;
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function assessCompanyIngestionReadiness(snapshot: IngestionReadinessSnapshot, opts: IngestionReadinessOptions = {}) {
  const requireDocuments = opts.requireDocuments !== false;
  const requireReviewedExperts = opts.requireReviewedExperts !== false;
  const requireReviewedProjects = opts.requireReviewedProjects !== false;

  const reviewedExperts = snapshot.experts.filter((e) => e.trustLevel === "REVIEWED").length;
  const reviewedProjects = snapshot.projects.filter((p) => p.trustLevel === "REVIEWED").length;
  const expectedExperts = snapshot.docs.map((d) => toCount(d.extractedText, /(\d{1,3})\s+(?:experts|expert cvs|cv|cvs|staff|personnel)/i)).find(Boolean) ?? null;
  const expectedProjects = snapshot.docs.map((d) => toCount(d.extractedText, /(\d{2,3})\s+(?:selected\s+)?projects?/i)).find(Boolean) ?? null;
  const missingExperts = expectedExperts ? Math.max(0, expectedExperts - snapshot.experts.length) : 0;
  const missingProjects = expectedProjects ? Math.max(0, expectedProjects - snapshot.projects.length) : 0;

  const blockers: string[] = [];
  if (requireDocuments && snapshot.docs.length === 0) blockers.push("No company documents uploaded.");
  if (requireReviewedExperts && reviewedExperts === 0) blockers.push("No REVIEWED experts available.");
  if (requireReviewedProjects && reviewedProjects === 0) blockers.push("No REVIEWED projects available.");
  if (missingExperts > 0) blockers.push(`Expert completeness gap: missing ${missingExperts} record(s) against expected count.`);
  if (missingProjects > 0) blockers.push(`Project completeness gap: missing ${missingProjects} record(s) against expected count.`);

  return {
    ingestionReady: blockers.length === 0,
    blockers,
    totals: {
      documents: snapshot.docs.length,
      experts: snapshot.experts.length,
      projects: snapshot.projects.length,
      reviewedExperts,
      reviewedProjects,
      expectedExperts,
      expectedProjects,
      missingExperts,
      missingProjects,
    },
  };
}

export async function getCompanyIngestionReadiness(companyId: string, opts: IngestionReadinessOptions = {}) {
  const [docs, experts, projects] = await Promise.all([
    prisma.companyDocument.findMany({ where: { companyId }, select: { extractedText: true } }),
    prisma.expert.findMany({ where: { companyId }, select: { trustLevel: true } }),
    prisma.project.findMany({ where: { companyId }, select: { trustLevel: true } }),
  ]);
  return assessCompanyIngestionReadiness({ docs, experts, projects }, opts);
}
