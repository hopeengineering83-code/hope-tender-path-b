import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

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
      files: { select: { id: true, originalFileName: true, classification: true, extractedText: true } },
      requirements: true,
      complianceMatrix: true,
      expertMatches: { include: { expert: { select: { id: true, fullName: true, title: true, trustLevel: true, sourceDocumentId: true, profile: true } } }, orderBy: { score: "desc" } },
      projectMatches: { include: { project: { select: { id: true, name: true, clientName: true, sector: true, trustLevel: true, sourceDocumentId: true, summary: true } } }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const requirementTrace = tender.requirements.map((requirement) => {
    const sourceFiles = tender.files
      .filter((file) => textIncludes(file.extractedText, requirement.title) || textIncludes(file.extractedText, requirement.description) || textIncludes(file.extractedText, requirement.sectionReference))
      .map((file) => ({ id: file.id, fileName: file.originalFileName, classification: file.classification }));
    const matrixRows = tender.complianceMatrix.filter((row) => row.requirementId === requirement.id);
    return {
      requirementId: requirement.id,
      code: requirement.code,
      title: requirement.title,
      priority: requirement.priority,
      requirementType: requirement.requirementType,
      sectionReference: requirement.sectionReference,
      sourceFiles,
      sourceConfidence: sourceFiles.length > 0 ? "MEDIUM" : "LOW",
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
    sourceDocumentId: match.project.sourceDocumentId,
    evidenceConfidence: evidenceConfidence(`${match.rationale ?? ""} ${match.project.summary ?? ""}`),
    rationale: short(match.rationale),
  }));

  const weakRequirements = requirementTrace.filter((r) => r.sourceFiles.length === 0 || r.supportRows.length === 0);
  const weakSelectedExperts = expertEvidence.filter((e) => e.isSelected && (e.trustLevel !== "REVIEWED" || ["NONE", "LOW"].includes(e.evidenceConfidence)));
  const weakSelectedProjects = projectEvidence.filter((p) => p.isSelected && (p.trustLevel !== "REVIEWED" || ["NONE", "LOW"].includes(p.evidenceConfidence)));

  return NextResponse.json({
    success: true,
    traceability: {
      requirementTrace,
      expertEvidence,
      projectEvidence,
      summary: {
        requirements: requirementTrace.length,
        weakRequirements: weakRequirements.length,
        selectedExpertsWithWeakEvidence: weakSelectedExperts.length,
        selectedProjectsWithWeakEvidence: weakSelectedProjects.length,
      },
      warnings: [
        weakRequirements.length > 0 ? `${weakRequirements.length} requirement(s) have weak source/support traceability.` : null,
        weakSelectedExperts.length > 0 ? `${weakSelectedExperts.length} selected expert(s) have weak evidence or are not REVIEWED.` : null,
        weakSelectedProjects.length > 0 ? `${weakSelectedProjects.length} selected project(s) have weak evidence or are not REVIEWED.` : null,
      ].filter(Boolean),
    },
  });
}
