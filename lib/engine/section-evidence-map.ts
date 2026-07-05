import { logger } from "../observability";
// Section evidence map (G5 fix)
//
// Records each generated proposal section and the tender requirements / vault
// evidence it supports. The evidence coverage panel reads these rows to show
// whether mandatory requirements are covered, partially covered, or uncovered.

import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../prisma";

export interface SectionEvidenceInput {
  tenderId: string;
  proposalVersion: number;
  sectionId: string;
  sectionTitle: string;
  text: string;
  requirementIds?: string[];
  evidenceIds?: string[];
  expertIds?: string[];
  projectIds?: string[];
}

export type EvidenceReviewStatus =
  | "PENDING"
  | "SUGGESTED"
  | "AUTO_LINKED_PARTIAL"
  | "USER_CONFIRMED"
  | "COMPLIANCE_SUPPORTED"
  | "FULLY_ACCEPTED"
  | "REJECTED";

export type RequirementForEvidenceMap = {
  id: string;
  title: string;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
}

function keywordHit(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function sectionFamily(sectionId: string, sectionTitle: string): "OPENING" | "COMPANY" | "TECHNICAL" | "CLOSING" | "GENERIC" {
  const text = `${sectionId} ${sectionTitle}`.toLowerCase();
  if (keywordHit(text, ["cover", "summary", "opening"])) return "OPENING";
  if (keywordHit(text, ["company", "experience", "profile", "section-a", "section-b"])) return "COMPANY";
  if (keywordHit(text, ["technical", "methodology", "approach", "work plan", "section-c"])) return "TECHNICAL";
  if (keywordHit(text, ["additional", "declaration", "appendix", "submission", "section-d"])) return "CLOSING";
  return "GENERIC";
}

function familyKeywords(family: ReturnType<typeof sectionFamily>): string[] {
  switch (family) {
    case "OPENING":
      return ["submission", "deadline", "delivery", "client", "subject", "email", "portal", "validity", "cover letter", "executive summary"];
    case "COMPANY":
      return ["company", "profile", "experience", "project", "similar", "reference", "expert", "personnel", "team", "qualification", "license", "registration", "legal", "eligibility", "financial", "audited", "capacity", "statement"];
    case "TECHNICAL":
      return ["technical", "methodology", "approach", "scope", "work plan", "deliverable", "solar", "pumping", "electro", "mechanical", "design", "survey", "supervision", "implementation", "quality"];
    case "CLOSING":
      return ["declaration", "appendix", "submission", "deadline", "delivery", "legal", "eligibility", "financial", "audited", "registration", "license", "compliance", "form"];
    default:
      return [];
  }
}

function scoreRequirement(sectionId: string, sectionTitle: string, sectionText: string, requirement: RequirementForEvidenceMap): number {
  const family = sectionFamily(sectionId, sectionTitle);
  const reqText = `${requirement.title} ${requirement.description ?? ""} ${requirement.requirementType ?? ""}`.toLowerCase();
  const sectionTextLower = `${sectionTitle} ${sectionText}`.toLowerCase();
  let score = 0;

  const reqWords = words(reqText);
  const sectionWords = words(sectionTextLower);
  for (const word of reqWords) {
    if (sectionWords.has(word)) score += 2;
  }

  for (const keyword of familyKeywords(family)) {
    if (reqText.includes(keyword)) score += 4;
  }

  if (keywordHit(reqText, ["submission", "deadline", "delivery", "email", "portal", "subject"]) && (family === "OPENING" || family === "CLOSING")) score += 8;
  if (keywordHit(reqText, ["expert", "personnel", "team", "qualification", "electro", "mechanical", "solar pumping"]) && (family === "COMPANY" || family === "TECHNICAL")) score += 8;
  if (keywordHit(reqText, ["financial", "audited", "capacity", "turnover", "bank"]) && (family === "COMPANY" || family === "CLOSING")) score += 8;
  if (keywordHit(reqText, ["legal", "registration", "license", "eligibility", "tax", "vat", "tin"]) && (family === "COMPANY" || family === "CLOSING")) score += 8;
  if (keywordHit(reqText, ["methodology", "technical", "scope", "deliverable", "work plan"]) && family === "TECHNICAL") score += 8;

  return score;
}

export function inferSectionRequirementIds(opts: {
  sectionId: string;
  sectionTitle: string;
  sectionText?: string | null;
  requirements: RequirementForEvidenceMap[];
}): string[] {
  const scored = opts.requirements
    .map((requirement) => ({ requirement, score: scoreRequirement(opts.sectionId, opts.sectionTitle, opts.sectionText ?? "", requirement) }))
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) return unique(scored.map((entry) => entry.requirement.id));

  const highPriority = opts.requirements.filter((requirement) => ["MANDATORY", "CRITICAL", "HIGH"].includes((requirement.priority ?? "").toUpperCase()));
  if (highPriority.length === 1) return [highPriority[0].id];
  return [];
}

export async function writeSectionEvidence(input: SectionEvidenceInput): Promise<void> {
  await prismaReady;
  const text = (input.text || "").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const textHash = createHash("sha256").update(text).digest("hex").slice(0, 32);

  const reqIds = unique(input.requirementIds ?? []).join("|");
  const evdIds = unique(input.evidenceIds ?? []).join("|");
  const expIds = unique(input.expertIds ?? []).join("|");
  const prjIds = unique(input.projectIds ?? []).join("|");

  try {
    await prisma.sectionEvidenceMap.upsert({
      where: {
        tenderId_proposalVersion_sectionId: {
          tenderId: input.tenderId,
          proposalVersion: input.proposalVersion,
          sectionId: input.sectionId,
        },
      },
      update: {
        sectionTitle: input.sectionTitle.slice(0, 200),
        requirementIds: reqIds,
        evidenceIds: evdIds,
        expertIds: expIds,
        projectIds: prjIds,
        textHash,
        wordCount,
        updatedAt: new Date(),
      },
      create: {
        tenderId: input.tenderId,
        proposalVersion: input.proposalVersion,
        sectionId: input.sectionId,
        sectionTitle: input.sectionTitle.slice(0, 200),
        requirementIds: reqIds,
        evidenceIds: evdIds,
        expertIds: expIds,
        projectIds: prjIds,
        textHash,
        wordCount,
      },
    });
  } catch (err) {
    logger.warn(`[section-evidence-map] write failed for ${input.sectionId}:`, { detail: err instanceof Error ? err.message : err });
  }
}

export interface WeakSectionFinding {
  sectionId: string;
  sectionTitle: string;
  reasons: string[];
  wordCount: number;
}

export async function detectWeakSections(tenderId: string, proposalVersion: number, opts?: { minWordCount?: number; minEvidenceCount?: number }): Promise<WeakSectionFinding[]> {
  await prismaReady;
  const minWords = opts?.minWordCount ?? 80;
  const minEvidence = opts?.minEvidenceCount ?? 1;

  const rows = await prisma.sectionEvidenceMap.findMany({
    where: { tenderId, proposalVersion },
  });

  const findings: WeakSectionFinding[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    if (r.wordCount < minWords) reasons.push(`word count ${r.wordCount} below minimum ${minWords}`);
    const evidenceCount = (r.evidenceIds || "").split("|").filter(Boolean).length
      + (r.expertIds || "").split("|").filter(Boolean).length
      + (r.projectIds || "").split("|").filter(Boolean).length;
    if (evidenceCount < minEvidence) reasons.push(`only ${evidenceCount} evidence reference(s) (minimum ${minEvidence})`);
    const reqCount = (r.requirementIds || "").split("|").filter(Boolean).length;
    if (reqCount === 0) reasons.push("no requirement coverage recorded");
    if (reasons.length > 0) {
      findings.push({ sectionId: r.sectionId, sectionTitle: r.sectionTitle, reasons, wordCount: r.wordCount });
    }
  }
  return findings;
}

export async function detectMissingCriterionDepth(tenderId: string, proposalVersion: number): Promise<Array<{ requirementId: string; title: string; reason: string }>> {
  await prismaReady;
  const requirements = await prisma.tenderRequirement.findMany({
    where: { tenderId, priority: { in: ["MANDATORY", "HIGH"] } },
    select: { id: true, title: true, requirementType: true },
  });
  const sectionRows = await prisma.sectionEvidenceMap.findMany({
    where: { tenderId, proposalVersion },
    select: { requirementIds: true },
  });
  const coveredRequirementIds = new Set<string>();
  for (const s of sectionRows) {
    for (const r of (s.requirementIds || "").split("|").filter(Boolean)) coveredRequirementIds.add(r);
  }

  const findings: Array<{ requirementId: string; title: string; reason: string }> = [];
  for (const r of requirements) {
    if (!coveredRequirementIds.has(r.id)) {
      findings.push({ requirementId: r.id, title: r.title, reason: `requirement type=${r.requirementType} is not covered by any proposal section` });
    }
  }
  return findings;
}

export async function writeSectionEvidenceFromMarkdown(opts: {
  tenderId: string;
  proposalVersion: number;
  markdown: string;
  requirementIds?: string[];
  expertIds?: string[];
  projectIds?: string[];
}): Promise<{ sectionsWritten: number }> {
  const { markdown } = opts;
  const sectionRegex = /^# +(.+)$/gm;
  const matches = Array.from(markdown.matchAll(sectionRegex));
  if (matches.length === 0) return { sectionsWritten: 0 };

  const requirements = opts.requirementIds && opts.requirementIds.length > 0
    ? []
    : await prisma.tenderRequirement.findMany({
        where: { tenderId: opts.tenderId },
        select: { id: true, title: true, description: true, requirementType: true, priority: true },
      }).catch(() => [] as RequirementForEvidenceMap[]);

  let written = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const start = (m.index ?? 0) + m[0].length;
    const end = next ? next.index ?? markdown.length : markdown.length;
    const text = markdown.slice(start, end).trim();
    const title = m[1].trim();
    const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `section-${i}`;
    const inferredRequirementIds = opts.requirementIds && opts.requirementIds.length > 0
      ? opts.requirementIds
      : inferSectionRequirementIds({ sectionId, sectionTitle: title, sectionText: text, requirements });
    await writeSectionEvidence({
      tenderId: opts.tenderId,
      proposalVersion: opts.proposalVersion,
      sectionId,
      sectionTitle: title,
      text,
      requirementIds: inferredRequirementIds,
      expertIds: opts.expertIds,
      projectIds: opts.projectIds,
    });
    written += 1;
  }
  return { sectionsWritten: written };
}
