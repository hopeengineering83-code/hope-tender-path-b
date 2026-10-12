import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../../../../../lib/vault-review-provenance";

export const dynamic = "force-dynamic";

function textIncludes(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  if (!haystack || !needle) return false;
  const cleanNeedle = needle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (cleanNeedle.length < 6) return false;
  const tokens = cleanNeedle.split(/\s+/).filter((t) => t.length > 3).slice(0, 8);
  const text = haystack.toLowerCase();
  return tokens.length > 0 && tokens.some((token) => text.includes(token));
}

function evidenceConfidence(value: string | null | undefined): "NONE" | "LOW" | "MEDIUM" | "HIGH" {
  if (!value) return "NONE";
  const text = value.toLowerCase();
  let score = 0;
  if (/reviewed|validated|certificate|completion|client|contract|license|registration|cv|years|engineer|manager/.test(text)) score += 2;
  if (/page|source|document|reference|project|sector|discipline/.test(text)) score += 1;
  if (text.length > 250) score += 1;
  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

function short(value: string | null | undefined, max = 420): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      files: { select: { id: true, originalFileName: true, classification: true, extractedText: true, extractionMethod: true } },
      requirements: true,
      complianceMatrix: true,
      expertMatches: { include: { expert: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT, id: true, profile: true } } }, orderBy: { score: "desc" } },
      projectMatches: { include: { project: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT, id: true, summary: true } } }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const requirementTrace = tender.requirements.map((requirement) => {
    const sourceFiles = tender.files
      .filter((file) => textIncludes(file.extractedText, requirement.title) || textIncludes(file.extractedText, requirement.description) || textIncludes(file.extractedText, requirement.sectionReference))
      .map((file) => ({ id: file.id, fileName: file.originalFileName, classification: file.classification }));
    const matrixRows = tender.complianceMatrix.filter((row) => row.requirementId === requirement.id);
    // Use DB-stored source fields (set by AI Analyze / engine) for authoritative traceability.
    // Fall back to text-match confidence when DB fields are absent.
    const dbSourceConfidence = requirement.sourceConfidence ?? 0;
    const derivedConfidence = sourceFiles.length > 0 ? "MEDIUM" : "LOW";
    return {
      requirementId: requirement.id,
      code: requirement.code,
      title: requirement.title,
      priority: requirement.priority,
      requirementType: requirement.requirementType,
      sectionReference: requirement.sectionReference,
      // DB-stored source traceability fields (per CLAUDE.md source-traceability requirement)
      sourcePageNumber: requirement.sourcePageNumber ?? null,
      sourceSectionHeading: requirement.sourceSectionHeading ?? null,
      sourceExactQuote: short(requirement.sourceExactQuote, 300),
      sourceConfidenceScore: dbSourceConfidence,
      extractionMethod: (() => {
        if (!requirement.sourceTenderFileId) return "manual_or_unknown";
        const srcFile = tender.files.find((f) => f.id === requirement.sourceTenderFileId);
        if (srcFile?.extractionMethod) return srcFile.extractionMethod; // "text" | "ocr" | "mixed" | "failed"
        return "ai_extracted";
      })(),
      // Text-match source file references
      sourceFiles,
      sourceConfidence: dbSourceConfidence > 0.6 ? "HIGH" : dbSourceConfidence > 0.3 ? "MEDIUM" : derivedConfidence,
      supportRows: matrixRows.map((row) => ({
        evidenceType: row.evidenceType,
        evidenceSource: row.evidenceSource,
        evidenceReference: row.evidenceReference,
        supportLevel: row.supportLevel,
        notes: short(row.notes),
      })),
    };
  });

  const expertEvidence = tender.expertMatches.map((match) => ({
    matchId: match.id,
    expertId: match.expertId,
    name: match.expert.fullName,
    title: match.expert.title,
    score: match.score,
    isSelected: match.isSelected,
    trustLevel: match.expert.trustLevel,
    usableAsEvidence: canUseVaultRecord(match.expert as ReviewRecordState, "GENERATION"),
    sourceDocumentId: match.expert.sourceDocumentId,
    evidenceConfidence: evidenceConfidence(`${match.rationale ?? ""} ${match.expert.profile ?? ""}`),
    rationale: short(match.rationale),
  }));

  const projectEvidence = tender.projectMatches.map((match) => ({
    matchId: match.id,
    projectId: match.projectId,
    name: match.project.name,
    clientName: match.project.clientName,
    sector: match.project.sector,
    score: match.score,
    isSelected: match.isSelected,
    trustLevel: match.project.trustLevel,
    usableAsEvidence: canUseVaultRecord(match.project as ReviewRecordState, "GENERATION"),
    sourceDocumentId: match.project.sourceDocumentId,
    evidenceConfidence: evidenceConfidence(`${match.rationale ?? ""} ${match.project.summary ?? ""}`),
    rationale: short(match.rationale),
  }));

  const weakRequirements = requirementTrace.filter((r) => r.sourceFiles.length === 0 || r.supportRows.length === 0);
  const weakMandatoryCritical = weakRequirements.filter((r) => r.priority === "MANDATORY" || r.priority === "CRITICAL");
  // "Weak" means generation genuinely cannot use the record, not that its
  // label is not literally "REVIEWED". Testing the raw trustLevel flagged
  // every durably SOURCE_VERIFIED record as weak, so a company whose evidence
  // comes only from its own uploaded documents saw this panel report all of
  // its evidence as weak while generation and export used it without issue.
  const weakSelectedExperts = expertEvidence.filter((e) => e.isSelected && (!e.usableAsEvidence || ["NONE", "LOW"].includes(e.evidenceConfidence)));
  const weakSelectedProjects = projectEvidence.filter((p) => p.isSelected && (!p.usableAsEvidence || ["NONE", "LOW"].includes(p.evidenceConfidence)));

  return NextResponse.json({
    success: true,
    traceability: {
      requirementTrace,
      expertEvidence,
      projectEvidence,
      summary: {
        requirements: requirementTrace.length,
        weakRequirements: weakRequirements.length,
        weakMandatoryCriticalRequirements: weakMandatoryCritical.length,
        selectedExpertsWithWeakEvidence: weakSelectedExperts.length,
        selectedProjectsWithWeakEvidence: weakSelectedProjects.length,
      },
      warnings: [
        weakMandatoryCritical.length > 0 ? `${weakMandatoryCritical.length} MANDATORY/CRITICAL requirement(s) have weak source/support traceability — export may be blocked.` : null,
        weakRequirements.length > weakMandatoryCritical.length ? `${weakRequirements.length - weakMandatoryCritical.length} other requirement(s) have weak traceability.` : null,
        weakSelectedExperts.length > 0 ? `${weakSelectedExperts.length} selected expert(s) have weak evidence or are not REVIEWED.` : null,
        weakSelectedProjects.length > 0 ? `${weakSelectedProjects.length} selected project(s) have weak evidence or are not REVIEWED.` : null,
      ].filter(Boolean),
    },
  });
}
