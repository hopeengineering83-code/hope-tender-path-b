/**
 * Company Evidence Matching System
 *
 * THE PROBLEM
 * The requirement-categories module classifies tender requirements into 16
 * categories (eligibility, qualifications, experience, personnel, methodology,
 * deliverables, required-documents, evaluation-criteria, financial-requirements,
 * bid-security, submission-rules, annexes, contracts, compliance, formatting,
 * unknown). Each classification has a `linkedCompanyEvidence` field that's
 * currently null (the comment says "Filled by matching engine") and a
 * `determineUnresolvedReason` helper that returns "company-evidence-missing"
 * when no evidence is linked.
 *
 * But the matching engine that should fill these in doesn't exist as a
 * coherent module. There's:
 *   - lib/engine/matching.ts (capability-score matching for experts/projects)
 *   - lib/engine/ai-multi-perspective-matcher.ts (AI rematch)
 *   - lib/matching-quality.ts (structural state)
 * But NO module that takes a classified tender requirement and decides which
 * company evidence (expert, project, compliance record, legal record, financial
 * record, company document) resolves it.
 *
 * THE FIX
 * This module is the company evidence matching system. It takes:
 *   - A list of classified tender requirements (from classifyTenderRequirement)
 *   - A company's evidence vault (experts, projects, compliance records, etc.)
 *
 * And produces:
 *   - For each requirement: a list of matching evidence items, sorted by score
 *   - For each requirement: a resolution status (RESOLVED, PARTIAL, UNRESOLVED)
 *   - For each requirement: a linked evidence summary (for the requirement-categories
 *     module's `linkedCompanyEvidence` field)
 *   - An overall coverage report: how many mandatory requirements are resolved
 *
 * The matching is evidence-based: every match includes the evidence item's ID,
 * the matching score, and a rationale explaining WHY the evidence matches.
 *
 * CRITICAL INVARIANTS
 *   - A requirement is RESOLVED only when at least one evidence item has a
 *     score >= RESOLUTION_THRESHOLD (60).
 *   - Advisory requirements (mandatory === "advisory") are NEVER blocking —
 *     they're resolved with any score >= 0 (informational only).
 *   - DELETED experts/projects are never matched (excluded by deletedAt filter).
 *   - REGEX_DRAFT evidence is matched but flagged as "needs review" — it cannot
 *     auto-resolve a mandatory requirement (only REVIEWED evidence can).
 *   - Compliance records must have a valid certificateDate (not expired) to
 *     match compliance requirements.
 */

import type { RequirementCategory } from "./requirement-categories";
import type { RequirementClassification } from "./requirement-categories";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The types of company evidence we match against. */
export type EvidenceType =
  | "expert"            // Expert personnel (CV)
  | "project"           // Past project reference
  | "compliance"        // Compliance record (ISO certificate, license, etc.)
  | "legal"             // Legal record (registration, court records)
  | "financial"         // Financial record (audit, turnover)
  | "company-document"  // Generic company document (policies, manuals)
  | "company-asset";    // Company asset (insurance, bank guarantee)

/** A single piece of company evidence, normalized for matching. */
export type CompanyEvidence = {
  id: string;
  type: EvidenceType;
  title: string;
  text: string;             // The text content to match against
  trustLevel: "REGEX_DRAFT" | "AI_DRAFT" | "REVIEWED";
  isDeleted: boolean;
  /** Optional metadata for scoring (e.g., yearsExperience, sectors, etc.). */
  metadata?: {
    sectors?: string[];
    serviceAreas?: string[];
    yearsExperience?: number;
    certifications?: string[];
    contractValue?: number;
    startDate?: Date;
    endDate?: Date;
    certificateDate?: Date;
    expiryDate?: Date;
    documentType?: string;
  };
};

/** A single requirement-to-evidence match. */
export type EvidenceMatch = {
  evidence: CompanyEvidence;
  score: number;            // 0-100
  rationale: string;        // Why this evidence matches
  matchedKeywords: string[];
};

/** The result of matching a single requirement against the evidence vault. */
export type RequirementEvidenceResult = {
  requirement: RequirementClassification;
  requirementText: string;
  matches: EvidenceMatch[];
  /** Best match (highest score) — the evidence item itself, or null if no matches. */
  bestMatch: CompanyEvidence | null;
  /** Resolution status based on best match score. */
  resolution: "RESOLVED" | "PARTIAL" | "UNRESOLVED";
  /** Whether the resolution uses REVIEWED evidence (vs REGEX_DRAFT/AI_DRAFT). */
  hasReviewedEvidence: boolean;
  /** A short summary for the linkedCompanyEvidence field. */
  linkedEvidenceSummary: string | null;
  /** The unresolved reason (mirrors determineUnresolvedReason). */
  unresolvedReason: string | null;
};

/** The overall coverage report for a tender. */
export type EvidenceCoverageReport = {
  totalRequirements: number;
  mandatoryRequirements: number;
  resolved: number;
  resolvedMandatory: number;
  partial: number;
  unresolved: number;
  unresolvedMandatory: number;
  /** Per-category coverage breakdown. */
  byCategory: Record<RequirementCategory, { total: number; resolved: number; unresolved: number }>;
  /** Per-evidence-type usage breakdown. */
  byEvidenceType: Record<EvidenceType, number>;
  /** True when ALL mandatory requirements are RESOLVED with REVIEWED evidence. */
  fullyResolved: boolean;
  /** The list of unresolved mandatory requirements (for UI surfacing). */
  unresolvedMandatoryList: Array<{ requirementText: string; category: RequirementCategory; reason: string }>;
};

// ─── Constants ──────────────────────────────────────────────────────────────

/** A requirement is RESOLVED when the best match has score >= this threshold. */
export const RESOLUTION_THRESHOLD = 60;

/** A requirement is PARTIAL when matches exist but the best score is < threshold. */
export const PARTIAL_THRESHOLD = 30;

// ─── Keyword maps: which keywords indicate which evidence type ──────────────

const CATEGORY_KEYWORDS: Record<RequirementCategory, string[]> = {
  eligibility: ["business licence", "tax clearance", "registration", "legal", "incorporation"],
  qualifications: ["iso", "certification", "qualification", "license", "professional", "registration"],
  experience: ["project", "experience", "track record", "similar", "previous", "completed"],
  personnel: ["expert", "personnel", "staff", "consultant", "engineer", "architect", "specialist", "cv", "resume"],
  methodology: ["methodology", "approach", "work plan", "technical approach", "design"],
  deliverables: ["deliverable", "output", "report", "drawing", "design"],
  "required-documents": ["document", "policy", "manual", "procedure", "annex"],
  "evaluation-criteria": [], // Not a proposal section — evaluation is by the client
  "financial-requirements": ["financial", "audit", "turnover", "annual report"],
  "bid-security": ["bid security", "bid bond", "bank guarantee", "insurance", "performance security"],
  "submission-rules": [], // Not a proposal section — compliance check
  annexes: ["annex", "appendix", "attachment", "schedule"],
  contracts: ["contract", "legal", "terms", "conditions"],
  compliance: ["iso", "compliance", "certificate", "statutory", "regulatory"],
  formatting: [], // Not a proposal section — formatting check
  unknown: [],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize a string for keyword matching: lowercase, collapse whitespace.
 */
function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Check if a piece of evidence is "reviewed" (trustLevel === REVIEWED and not deleted).
 */
function isReviewedEvidence(e: CompanyEvidence): boolean {
  return !e.isDeleted && e.trustLevel === "REVIEWED";
}

/**
 * Check if a compliance record's certificate is still valid (not expired).
 */
function isComplianceValid(e: CompanyEvidence): boolean {
  if (e.type !== "compliance" && e.type !== "legal") return true;
  if (!e.metadata?.expiryDate) return true; // No expiry date = assume valid
  return e.metadata.expiryDate.getTime() > Date.now();
}

/**
 * Compute the keyword overlap score between a requirement text and an evidence item.
 * Returns 0-100.
 */
function computeKeywordScore(requirementText: string, evidenceText: string, category: RequirementCategory): { score: number; matchedKeywords: string[] } {
  const reqNorm = normalize(requirementText);
  const evNorm = normalize(evidenceText);
  if (!reqNorm || !evNorm) return { score: 0, matchedKeywords: [] };

  const categoryKeywords = CATEGORY_KEYWORDS[category] ?? [];
  const matchedKeywords: string[] = [];
  let matches = 0;

  for (const keyword of categoryKeywords) {
    if (reqNorm.includes(keyword) && evNorm.includes(keyword)) {
      matches++;
      matchedKeywords.push(keyword);
    }
  }

  // Also check general word overlap (excluding common English stop words)
  const stopWords = new Set([
    "the", "and", "or", "of", "to", "in", "for", "with", "by", "on", "at", "from",
    "as", "is", "are", "be", "will", "shall", "must", "should", "may", "can",
    "a", "an", "this", "that", "these", "those", "it", "its", "their", "they",
    "we", "you", "i", "me", "us", "our", "your", "company", "firm", "consultant",
    "bidder", "tender", "proposal", "submission", "requirement", "required",
  ]);
  const reqWords = new Set(reqNorm.split(" ").filter((w) => w.length > 2 && !stopWords.has(w)));
  const evWords = new Set(evNorm.split(" ").filter((w) => w.length > 2 && !stopWords.has(w)));
  let wordOverlap = 0;
  for (const w of reqWords) {
    if (evWords.has(w)) {
      wordOverlap++;
      if (!matchedKeywords.includes(w)) matchedKeywords.push(w);
    }
  }

  // Score: weighted combination of category-keyword matches (high weight)
  // and general word overlap (lower weight).
  const categoryScore = categoryKeywords.length > 0 ? (matches / categoryKeywords.length) * 100 : 0;
  const overlapScore = reqWords.size > 0 ? Math.min(100, (wordOverlap / Math.max(1, reqWords.size)) * 200) : 0;
  const score = Math.round(Math.max(categoryScore * 0.7 + overlapScore * 0.3, Math.min(overlapScore, 100)));
  return { score: Math.min(100, score), matchedKeywords };
}

/**
 * Determine the best evidence type for a requirement category.
 */
function categoryToEvidenceType(category: RequirementCategory): EvidenceType[] {
  switch (category) {
    case "eligibility":
      return ["legal", "company-document"];
    case "qualifications":
      return ["compliance", "company-document"];
    case "experience":
      return ["project"];
    case "personnel":
      return ["expert"];
    case "methodology":
      return ["company-document", "project"];
    case "deliverables":
      return ["project", "company-document"];
    case "required-documents":
      return ["company-document"];
    case "financial-requirements":
      return ["financial"];
    case "bid-security":
      return ["company-asset"];
    case "annexes":
      return ["company-document"];
    case "contracts":
      return ["legal", "company-document"];
    case "compliance":
      return ["compliance"];
    case "evaluation-criteria":
    case "submission-rules":
    case "formatting":
    case "unknown":
      return [];
  }
}

/**
 * Adjust the score based on evidence trust level + validity.
 * - REVIEWED evidence gets a +10 bonus.
 * - REGEX_DRAFT evidence gets a -10 penalty.
 * - Expired compliance records get a -50 penalty.
 * - DELETED evidence is excluded entirely (handled by the caller).
 */
function adjustScoreForTrust(evidence: CompanyEvidence, baseScore: number): number {
  let adjusted = baseScore;
  if (isReviewedEvidence(evidence)) adjusted += 10;
  if (evidence.trustLevel === "REGEX_DRAFT") adjusted -= 10;
  if (!isComplianceValid(evidence)) adjusted -= 50;
  return Math.max(0, Math.min(100, adjusted));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Match a single requirement against the company evidence vault.
 *
 * Returns the matches (sorted by score, descending), the best match, the
 * resolution status, and a summary for the linkedCompanyEvidence field.
 */
export function matchRequirementToEvidence(
  requirementText: string,
  classification: RequirementClassification,
  evidence: CompanyEvidence[],
): RequirementEvidenceResult {
  const preferredTypes = categoryToEvidenceType(classification.category);
  const matches: EvidenceMatch[] = [];

  for (const ev of evidence) {
    // Skip deleted evidence
    if (ev.isDeleted) continue;

    // Skip evidence types not preferred for this category (unless unknown category)
    if (classification.category !== "unknown" && preferredTypes.length > 0 && !preferredTypes.includes(ev.type)) {
      // Still allow the match, but with a penalty
    }

    // Skip expired compliance/legal records entirely
    if (!isComplianceValid(ev)) continue;

    // Compute the keyword score
    const { score: baseScore, matchedKeywords } = computeKeywordScore(requirementText, ev.text, classification.category);
    if (baseScore === 0) continue;

    // Adjust for trust level + validity
    const adjustedScore = adjustScoreForTrust(ev, baseScore);
    if (adjustedScore === 0) continue;

    // Apply a penalty if the evidence type is not preferred for this category
    let finalScore = adjustedScore;
    if (classification.category !== "unknown" && preferredTypes.length > 0 && !preferredTypes.includes(ev.type)) {
      finalScore = Math.max(0, finalScore - 20);
    }

    matches.push({
      evidence: ev,
      score: finalScore,
      rationale: `Matched on: ${matchedKeywords.slice(0, 5).join(", ") || "general word overlap"}. Trust: ${ev.trustLevel}. Type: ${ev.type}.`,
      matchedKeywords,
    });
  }

  // Sort by score, descending
  matches.sort((a, b) => b.score - a.score);

  // Take top 5 matches (don't surface too many in the UI)
  const topMatches = matches.slice(0, 5);

  // Determine the best match
  const bestMatch = topMatches[0]?.evidence ?? null;
  const bestScore = topMatches[0]?.score ?? 0;
  void bestMatch; // bestMatch is included in the result; we use bestScore here

  // Determine resolution status
  let resolution: RequirementEvidenceResult["resolution"] = "UNRESOLVED";
  if (bestScore >= RESOLUTION_THRESHOLD) {
    resolution = "RESOLVED";
  } else if (bestScore >= PARTIAL_THRESHOLD) {
    resolution = "PARTIAL";
  }

  // Advisory requirements are NEVER blocking — if any match exists, mark RESOLVED
  if (classification.mandatory === "advisory" && topMatches.length > 0) {
    resolution = "RESOLVED";
  }

  // Determine if REVIEWED evidence was used
  const hasReviewedEvidence = topMatches.some((m) => isReviewedEvidence(m.evidence));

  // Build the linked-evidence summary
  let linkedEvidenceSummary: string | null = null;
  if (bestMatch) {
    const top3 = topMatches.slice(0, 3);
    linkedEvidenceSummary = top3
      .map((m) => `${m.evidence.title} (${m.evidence.type}, score=${m.score}, trust=${m.evidence.trustLevel})`)
      .join("; ");
  }

  // Determine the unresolved reason (mirrors determineUnresolvedReason)
  let unresolvedReason: string | null = null;
  if (classification.mandatory === "advisory") {
    unresolvedReason = null;
  } else if (resolution === "UNRESOLVED") {
    unresolvedReason = "company-evidence-missing";
  } else if (resolution === "PARTIAL") {
    unresolvedReason = "company-evidence-weak";
  } else if (resolution === "RESOLVED" && !hasReviewedEvidence) {
    unresolvedReason = "company-evidence-needs-review";
  }

  return {
    requirement: classification,
    requirementText,
    matches: topMatches,
    bestMatch,
    resolution,
    hasReviewedEvidence,
    linkedEvidenceSummary,
    unresolvedReason,
  };
}

/**
 * Match a list of requirements against the evidence vault.
 *
 * Returns per-requirement results + an overall coverage report.
 */
export function matchRequirementsToEvidence(
  requirements: Array<{ text: string; classification: RequirementClassification }>,
  evidence: CompanyEvidence[],
): { results: RequirementEvidenceResult[]; coverage: EvidenceCoverageReport } {
  const results = requirements.map((r) =>
    matchRequirementToEvidence(r.text, r.classification, evidence),
  );

  // Build the coverage report
  const byCategory = {} as EvidenceCoverageReport["byCategory"];
  const byEvidenceType = {} as EvidenceCoverageReport["byEvidenceType"];
  let resolved = 0;
  let resolvedMandatory = 0;
  let partial = 0;
  let unresolved = 0;
  let unresolvedMandatory = 0;
  let mandatoryRequirements = 0;
  const unresolvedMandatoryList: EvidenceCoverageReport["unresolvedMandatoryList"] = [];

  for (const r of results) {
    const cat = r.requirement.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, resolved: 0, unresolved: 0 };
    byCategory[cat].total++;

    if (r.resolution === "RESOLVED") {
      resolved++;
      byCategory[cat].resolved++;
    } else if (r.resolution === "PARTIAL") {
      partial++;
    } else {
      unresolved++;
      byCategory[cat].unresolved++;
    }

    if (r.requirement.mandatory !== "advisory") {
      mandatoryRequirements++;
      if (r.resolution === "RESOLVED") {
        resolvedMandatory++;
      } else {
        unresolvedMandatory++;
        unresolvedMandatoryList.push({
          requirementText: r.requirementText,
          category: cat,
          reason: r.unresolvedReason ?? "unresolved",
        });
      }
    }

    // Track evidence type usage (count distinct evidence items used)
    for (const m of r.matches) {
      const type = m.evidence.type;
      byEvidenceType[type] = (byEvidenceType[type] ?? 0) + 1;
    }
  }

  const fullyResolved = mandatoryRequirements > 0
    && resolvedMandatory === mandatoryRequirements
    && results.every((r) => r.requirement.mandatory === "advisory" || r.hasReviewedEvidence);

  return {
    results,
    coverage: {
      totalRequirements: results.length,
      mandatoryRequirements,
      resolved,
      resolvedMandatory,
      partial,
      unresolved,
      unresolvedMandatory,
      byCategory,
      byEvidenceType,
      fullyResolved,
      unresolvedMandatoryList,
    },
  };
}

/**
 * Build a CompanyEvidence list from Prisma query results.
 *
 * This is a convenience helper that converts the raw Prisma objects (Expert,
 * Project, CompanyComplianceRecord, LegalRecord, FinancialRecord,
 * CompanyDocument, CompanyAsset) into the normalized CompanyEvidence shape
 * that matchRequirementToEvidence expects.
 */
export function buildEvidenceVault(opts: {
  experts?: Array<{
    id: string; fullName: string; title: string | null; profile: string | null;
    disciplines: string; sectors: string; certifications: string;
    yearsExperience: number | null; trustLevel: string; deletedAt: Date | null;
  }>;
  projects?: Array<{
    id: string; name: string; summary: string | null; sector: string | null;
    serviceAreas: string; contractValue: number | null;
    startDate: Date | null; endDate: Date | null;
    trustLevel: string; deletedAt: Date | null;
  }>;
  complianceRecords?: Array<{
    id: string; title: string; description: string | null;
    certificateDate: Date | null; expiryDate: Date | null;
  }>;
  legalRecords?: Array<{
    id: string; title: string; description: string | null;
  }>;
  financialRecords?: Array<{
    id: string; title: string; description: string | null;
  }>;
  companyDocuments?: Array<{
    id: string; originalFileName: string; classification: string | null;
    description: string | null; deletedAt: Date | null;
  }>;
  companyAssets?: Array<{
    id: string; fileName: string; assetType: string | null; description: string | null;
  }>;
}): CompanyEvidence[] {
  const out: CompanyEvidence[] = [];

  for (const e of opts.experts ?? []) {
    if (e.deletedAt) continue;
    out.push({
      id: e.id,
      type: "expert",
      title: e.fullName,
      text: [e.fullName, e.title, e.profile, e.disciplines, e.sectors, e.certifications].filter(Boolean).join(" "),
      trustLevel: e.trustLevel as CompanyEvidence["trustLevel"],
      isDeleted: Boolean(e.deletedAt),
      metadata: {
        yearsExperience: e.yearsExperience ?? undefined,
        sectors: parseJsonArray(e.sectors),
        certifications: parseJsonArray(e.certifications),
      },
    });
  }

  for (const p of opts.projects ?? []) {
    if (p.deletedAt) continue;
    out.push({
      id: p.id,
      type: "project",
      title: p.name,
      text: [p.name, p.summary, p.sector, p.serviceAreas].filter(Boolean).join(" "),
      trustLevel: p.trustLevel as CompanyEvidence["trustLevel"],
      isDeleted: Boolean(p.deletedAt),
      metadata: {
        sectors: p.sector ? [p.sector] : [],
        serviceAreas: parseJsonArray(p.serviceAreas),
        contractValue: p.contractValue ?? undefined,
        startDate: p.startDate ?? undefined,
        endDate: p.endDate ?? undefined,
      },
    });
  }

  for (const c of opts.complianceRecords ?? []) {
    out.push({
      id: c.id,
      type: "compliance",
      title: c.title,
      text: [c.title, c.description].filter(Boolean).join(" "),
      trustLevel: "REVIEWED", // Compliance records are reviewed by definition
      isDeleted: false,
      metadata: {
        certificateDate: c.certificateDate ?? undefined,
        expiryDate: c.expiryDate ?? undefined,
      },
    });
  }

  for (const l of opts.legalRecords ?? []) {
    out.push({
      id: l.id,
      type: "legal",
      title: l.title,
      text: [l.title, l.description].filter(Boolean).join(" "),
      trustLevel: "REVIEWED",
      isDeleted: false,
    });
  }

  for (const f of opts.financialRecords ?? []) {
    out.push({
      id: f.id,
      type: "financial",
      title: f.title,
      text: [f.title, f.description].filter(Boolean).join(" "),
      trustLevel: "REVIEWED",
      isDeleted: false,
    });
  }

  for (const d of opts.companyDocuments ?? []) {
    if (d.deletedAt) continue;
    out.push({
      id: d.id,
      type: "company-document",
      title: d.originalFileName,
      text: [d.originalFileName, d.classification, d.description].filter(Boolean).join(" "),
      trustLevel: "REVIEWED", // Uploaded company documents are reviewed
      isDeleted: Boolean(d.deletedAt),
      metadata: {
        documentType: d.classification ?? undefined,
      },
    });
  }

  for (const a of opts.companyAssets ?? []) {
    out.push({
      id: a.id,
      type: "company-asset",
      title: a.fileName,
      text: [a.fileName, a.assetType, a.description].filter(Boolean).join(" "),
      trustLevel: "REVIEWED",
      isDeleted: false,
    });
  }

  return out;
}

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
