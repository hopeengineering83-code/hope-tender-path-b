// Section evidence map (G5 fix)
//
// THE PROBLEM
// ───────────
// The latest engine emits a criterion evidence map at the proposal level
// but does NOT trace each generated section back to:
//   • the tender requirements it covers
//   • the evidence IDs (experts, projects, evidences) it cites
//   • a text hash so we can detect when a section has been edited
//   • a reviewer status so we know who approved what
//
// Without this, the proposal-defensibility chain (auditor: "where in
// the source did this claim come from?") breaks at the section level.
//
// THE FIX
// ───────
// `writeSectionEvidence()` records each section into SectionEvidenceMap.
// `detectWeakSections()` reads the map back and flags sections with
// low evidence count, no requirement coverage, or low word count.
// `detectMissingCriterionDepth()` flags evaluation criteria that no
// section addresses with material depth.
//
// Writes are idempotent: the unique index on
// (tenderId, proposalVersion, sectionId) means a section can be
// regenerated without orphaning its prior row.

import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../prisma";

export interface SectionEvidenceInput {
  tenderId: string;
  proposalVersion: number;
  sectionId: string;       // canonical, e.g. "cover-letter", "section-a-1"
  sectionTitle: string;
  text: string;            // the rendered Markdown of the section
  requirementIds?: string[];
  evidenceIds?: string[];
  expertIds?: string[];
  projectIds?: string[];
}

export async function writeSectionEvidence(input: SectionEvidenceInput): Promise<void> {
  await prismaReady;
  const text = (input.text || "").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const textHash = createHash("sha256").update(text).digest("hex").slice(0, 32);

  const reqIds = (input.requirementIds ?? []).filter(Boolean).join("|");
  const evdIds = (input.evidenceIds ?? []).filter(Boolean).join("|");
  const expIds = (input.expertIds ?? []).filter(Boolean).join("|");
  const prjIds = (input.projectIds ?? []).filter(Boolean).join("|");

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
    console.warn(`[section-evidence-map] write failed for ${input.sectionId}:`, err instanceof Error ? err.message : err);
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

/**
 * Convenience: split a stitched proposal markdown into top-level sections
 * and write each one to the SectionEvidenceMap. Used at the end of
 * proposal generation when we want a one-shot record without changing
 * how individual sections are produced upstream.
 */
export async function writeSectionEvidenceFromMarkdown(opts: {
  tenderId: string;
  proposalVersion: number;
  markdown: string;
  // optional global lists; the function will associate ALL of these
  // with each section. Per-section attribution can be added later by
  // re-calling writeSectionEvidence() with finer grouping.
  requirementIds?: string[];
  expertIds?: string[];
  projectIds?: string[];
}): Promise<{ sectionsWritten: number }> {
  const { markdown } = opts;
  const sectionRegex = /^# +(.+)$/gm;
  const matches = Array.from(markdown.matchAll(sectionRegex));
  if (matches.length === 0) return { sectionsWritten: 0 };

  let written = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const start = (m.index ?? 0) + m[0].length;
    const end = next ? next.index ?? markdown.length : markdown.length;
    const text = markdown.slice(start, end).trim();
    const title = m[1].trim();
    const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `section-${i}`;
    await writeSectionEvidence({
      tenderId: opts.tenderId,
      proposalVersion: opts.proposalVersion,
      sectionId,
      sectionTitle: title,
      text,
      requirementIds: opts.requirementIds,
      expertIds: opts.expertIds,
      projectIds: opts.projectIds,
    });
    written += 1;
  }
  return { sectionsWritten: written };
}
