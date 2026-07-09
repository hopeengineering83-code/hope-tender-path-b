import { PrismaClient, Expert, Project, LegalRecord, FinancialRecord, CompanyAsset, CompanyComplianceRecord, Company, Tender } from "@prisma/client";
import {
  TenderEvidenceSelection,
  RequirementEvidenceMatch,
  MissingEvidenceGap,
  SelectedExpert,
  SelectedProjectReference,
  SelectedLegalRecord,
  SelectedFinancialRecord,
  SelectedCompanyAsset
} from "./tender-evidence-types";

function parseArr(val: string | null | undefined): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Minimum acceptable relevance score for compliance-record selection.
 *
 * Records with a score of 0 (no keyword/title match) are NEVER selected —
 * they would be irrelevant evidence. This fixes the review blocker where
 * `findBestCompliance` returned the first candidate even when score was 0.
 */
const COMPLIANCE_MIN_SCORE = 1;

/**
 * Structured authorization-error result.
 *
 * Returned by `selectEvidence` and `getTenderEvidenceSelectionById` when
 * the caller fails the tenant-ownership check. Callers MUST check for this
 * shape (or `null`) and surface a 403 Forbidden response.
 */
export type TenderEvidenceForbidden = {
  forbidden: true;
  reason: string;
  code:
    | "USER_NOT_AUTHENTICATED"
    | "COMPANY_NOT_FOUND"
    | "TENDER_NOT_FOUND"
    | "TENDER_NOT_OWNED_BY_USER"
    | "COMPANY_NOT_OWNED_BY_USER"
    | "TENDER_COMPANY_MISMATCH";
};

/**
 * Check if a value is a forbidden result.
 */
export function isTenderEvidenceForbidden(
  result: TenderEvidenceSelection | TenderEvidenceForbidden | null,
): result is TenderEvidenceForbidden {
  return result !== null && typeof result === "object" && (result as TenderEvidenceForbidden).forbidden === true;
}

export class TenderEvidenceSelector {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Select evidence for a tender from a company's vault.
   *
   * AUTHORIZATION (review-blocker fix #1):
   * The caller supplies `companyId` AND `userId`. This method verifies:
   *   1. The company exists AND `company.userId === userId` (the authenticated
   *      user owns the company whose evidence is being selected).
   *   2. The tender exists AND `tender.userId === userId` (the authenticated
   *      user owns the tender for which evidence is being selected).
   *
   * If either check fails, the method returns a structured
   * `TenderEvidenceForbidden` result instead of throwing. Callers MUST
   * check the result with `isTenderEvidenceForbidden()` and surface a 403.
   *
   * The caller-supplied `companyId` alone does NOT authorize access — the
   * user must own both the company and the tender.
   */
  async selectEvidence(
    tenderId: string,
    companyId: string,
    userId: string,
  ): Promise<TenderEvidenceSelection | TenderEvidenceForbidden> {
    if (!userId) {
      return { forbidden: true, reason: "User ID is required for evidence selection.", code: "USER_NOT_AUTHENTICATED" };
    }

    // ── Check 1: the company exists AND belongs to the authenticated user ──
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, userId: true, name: true },
    });
    if (!company) {
      return { forbidden: true, reason: `Company ${companyId} not found.`, code: "COMPANY_NOT_FOUND" };
    }
    if (company.userId !== userId) {
      return {
        forbidden: true,
        reason: `Company ${companyId} does not belong to user ${userId}.`,
        code: "COMPANY_NOT_OWNED_BY_USER",
      };
    }

    // ── Check 2: the tender exists AND belongs to the authenticated user ──
    const tender = await this.prisma.tender.findUnique({
      where: { id: tenderId },
      include: { requirements: true },
    });
    if (!tender) {
      return { forbidden: true, reason: `Tender ${tenderId} not found.`, code: "TENDER_NOT_FOUND" };
    }
    if (tender.userId !== userId) {
      return {
        forbidden: true,
        reason: `Tender ${tenderId} does not belong to user ${userId}.`,
        code: "TENDER_NOT_OWNED_BY_USER",
      };
    }

    // Both checks passed — the user owns both the company and the tender.
    // It is now safe to select evidence from this company for this tender.
    return this.doSelectEvidence(tender, company, userId);
  }

  /**
   * Internal method that performs the actual evidence selection after
   * authorization has been verified. Separated from `selectEvidence` so
   * the authorization logic is testable in isolation.
   */
  private async doSelectEvidence(
    tender: Tender & { requirements: any[] },
    company: Pick<Company, "id" | "userId" | "name">,
    _userId: string,
  ): Promise<TenderEvidenceSelection> {
    const companyId = company.id;

    const experts = await this.prisma.expert.findMany({
      where: { companyId, isActive: true, deletedAt: null }
    });

    const projects = await this.prisma.project.findMany({
      where: { companyId, deletedAt: null },
      include: { evidences: true }
    });

    const legalRecords = await this.prisma.legalRecord.findMany({
      where: { companyId, status: "ACTIVE" }
    });

    const financialRecords = await this.prisma.financialRecord.findMany({
      where: { companyId }
    });

    const complianceRecords = await this.prisma.companyComplianceRecord.findMany({
      where: { companyId, status: "ACTIVE" }
    });

    const assets = await this.prisma.companyAsset.findMany({
      where: { companyId, isActive: true }
    });

    const requirementMatches: RequirementEvidenceMatch[] = [];
    const selectedExperts: SelectedExpert[] = [];
    const selectedProjects: SelectedProjectReference[] = [];
    const selectedLegalRecords: SelectedLegalRecord[] = [];
    const selectedFinancialRecords: SelectedFinancialRecord[] = [];
    const selectedAssets: SelectedCompanyAsset[] = [];
    const missingEvidence: MissingEvidenceGap[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];

    const tenderContext = `${tender.title} ${tender.description || ""} ${tender.category} ${tender.country || ""}`.toLowerCase();

    for (const req of tender.requirements) {
      const type = req.requirementType;
      const query = `${req.title} ${req.description || ""}`.trim();
      const priority = (req.priority || "UNKNOWN") as any;

      if (type === "EXPERT") {
        const bestExpert = this.findBestExpert(query, experts, tenderContext);
        if (bestExpert) {
          selectedExperts.push(bestExpert);
          requirementMatches.push({
            requirementId: req.id,
            requirementText: req.title,
            priority,
            evidenceType: "EXPERT_CV",
            evidenceId: bestExpert.expertId,
            evidenceTitle: bestExpert.fullName,
            relevanceScore: bestExpert.relevanceScore,
            reason: bestExpert.reason,
            status: bestExpert.relevanceScore > 0.75 ? "matched" : "weak_match"
          });
        } else if (priority === "MANDATORY") {
          missingEvidence.push({
            gapType: "MISSING_EXPERT_CV",
            requirementId: req.id,
            requirementText: req.title,
            severity: "final_blocker",
            reason: `No matching expert found for ${req.title}`,
            nextAction: "UPLOAD_CV"
          });
          blockers.push(`Missing mandatory expert: ${req.title}`);
        }
      } else if (type === "PROJECT_EXPERIENCE") {
        const bestProject = this.findBestProject(query, projects, tenderContext);
        if (bestProject) {
          selectedProjects.push(bestProject);
          requirementMatches.push({
            requirementId: req.id,
            requirementText: req.title,
            priority,
            evidenceType: "PROJECT_REFERENCE",
            evidenceId: bestProject.projectId,
            evidenceTitle: bestProject.projectName,
            relevanceScore: bestProject.relevanceScore,
            reason: bestProject.reason,
            status: bestProject.relevanceScore > 0.75 ? "matched" : "weak_match"
          });
        } else if (priority === "MANDATORY") {
          missingEvidence.push({
            gapType: "MISSING_PROJECT_REFERENCE",
            requirementId: req.id,
            requirementText: req.title,
            severity: "final_blocker",
            reason: `No matching project reference found for ${req.title}`,
            nextAction: "UPLOAD_PROJECT_REFERENCE"
          });
          blockers.push(`Missing mandatory project experience: ${req.title}`);
        }
      } else if (["LEGAL", "ELIGIBILITY", "REGISTRATION"].includes(type)) {
        const bestLegal = this.findBestLegal(query, legalRecords);
        if (bestLegal) {
          selectedLegalRecords.push(bestLegal);
          requirementMatches.push({
            requirementId: req.id,
            requirementText: req.title,
            priority,
            evidenceType: "LEGAL_RECORD",
            evidenceId: bestLegal.recordId,
            evidenceTitle: bestLegal.title,
            relevanceScore: bestLegal.isValid ? 1.0 : 0.6,
            reason: bestLegal.reason,
            status: bestLegal.isValid ? "matched" : "weak_match"
          });
          if (!bestLegal.isValid) {
            warnings.push(`Selected legal record for ${req.title} is expired.`);
          }
        } else if (priority === "MANDATORY") {
          missingEvidence.push({
            gapType: "MISSING_LEGAL_RECORD",
            requirementId: req.id,
            requirementText: req.title,
            severity: "final_blocker",
            reason: `No legal document found for ${req.title}`,
            nextAction: "UPLOAD_LEGAL_DOCUMENT"
          });
          blockers.push(`Missing mandatory legal document: ${req.title}`);
        }
      } else if (["FINANCIAL", "FINANCIAL_CAPACITY"].includes(type)) {
        const bestFinancial = this.findBestFinancial(query, financialRecords);
        if (bestFinancial) {
          selectedFinancialRecords.push(bestFinancial);
          requirementMatches.push({
            requirementId: req.id,
            requirementText: req.title,
            priority,
            evidenceType: "FINANCIAL_RECORD",
            evidenceId: bestFinancial.recordId,
            evidenceTitle: `${bestFinancial.recordType} ${bestFinancial.fiscalYear}`,
            relevanceScore: 1.0,
            reason: bestFinancial.reason,
            status: "matched"
          });
        } else if (priority === "MANDATORY") {
          missingEvidence.push({
            gapType: "MISSING_FINANCIAL_RECORD",
            requirementId: req.id,
            requirementText: req.title,
            severity: "final_blocker",
            reason: `No financial record found for ${req.title}`,
            nextAction: "UPLOAD_FINANCIAL_RECORD"
          });
          blockers.push(`Missing mandatory financial record: ${req.title}`);
        }
      } else if (["COMPLIANCE", "CERTIFICATION", "DECLARATION"].includes(type)) {
        const bestCompliance = this.findBestCompliance(query, complianceRecords);
        if (bestCompliance) {
          requirementMatches.push({
            requirementId: req.id,
            requirementText: req.title,
            priority,
            evidenceType: "CERTIFICATE",
            evidenceId: bestCompliance.recordId,
            evidenceTitle: bestCompliance.title,
            relevanceScore: 1.0,
            reason: bestCompliance.reason,
            status: "matched"
          });
        } else if (priority === "MANDATORY") {
          missingEvidence.push({
            gapType: "MISSING_CERTIFICATE",
            requirementId: req.id,
            requirementText: req.title,
            severity: "final_blocker",
            reason: `No compliance certificate found for ${req.title}`,
            nextAction: "UPLOAD_CERTIFICATE"
          });
          blockers.push(`Missing mandatory certificate: ${req.title}`);
        }
      }
    }

    const defaultAssets = ["LOGO", "LETTERHEAD", "SIGNATURE", "STAMP"];
    for (const assetType of defaultAssets) {
      const asset = assets.find(a => a.assetType === assetType);
      if (asset) {
        selectedAssets.push({
          assetId: asset.id,
          assetType,
          fileName: asset.fileName,
          reason: `Default active ${assetType} selected.`
        });
      } else if (assetType === "LOGO") {
        missingEvidence.push({
          gapType: "MISSING_ASSET",
          severity: "draft_warning",
          reason: "Company logo is missing",
          nextAction: "UPLOAD_ASSET"
        });
        warnings.push("Company logo is missing");
      }
    }

    const score = this.calculateOverallScore(requirementMatches, missingEvidence);

    return {
      tenderId: tender.id,
      companyId,
      sourceRevision: new Date().toISOString(),
      requirementMatches,
      selectedExperts,
      selectedProjects,
      selectedLegalRecords,
      selectedFinancialRecords,
      selectedAssets,
      missingEvidence,
      warnings,
      blockers,
      score
    };
  }

  private findBestExpert(query: string, experts: Expert[], tenderContext: string): SelectedExpert | null {
    if (experts.length === 0) return null;

    const candidates = experts.map(e => {
      let score = 0;
      const eDisciplines = parseArr(e.disciplines);
      const eSectors = parseArr(e.sectors);
      const text = `${e.fullName} ${e.title} ${e.profile} ${eDisciplines.join(" ")} ${eSectors.join(" ")}`.toLowerCase();
      const queryLower = query.toLowerCase();

      const keywords = queryLower.split(/\s+/).filter(k => k.length > 3);
      let hits = 0;
      keywords.forEach(k => {
        if (text.includes(k)) hits++;
      });

      score = hits / Math.max(keywords.length, 1);

      // Boost for sector match
      eSectors.forEach(s => {
        if (tenderContext.includes(s.toLowerCase())) score += 0.1;
      });

      // Seniority boost
      if ((e.yearsExperience ?? 0) > 10) score += 0.05;

      return {
        expertId: e.id,
        fullName: e.fullName,
        role: e.title || "Expert",
        relevanceScore: Math.min(1.0, score),
        reason: `Deterministic score: ${(score * 100).toFixed(0)}% based on keywords and profile.`,
        fileId: e.sourceDocumentId || undefined
      };
    });

    candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const best = candidates[0];
    return best && best.relevanceScore > 0.15 ? best : null;
  }

  private findBestProject(query: string, projects: (Project & { evidences: any[] })[], tenderContext: string): SelectedProjectReference | null {
    if (projects.length === 0) return null;

    const candidates = projects.map(p => {
      let score = 0;
      const pServiceAreas = parseArr(p.serviceAreas);
      const text = `${p.name} ${p.summary} ${p.sector} ${pServiceAreas.join(" ")} ${p.clientName}`.toLowerCase();
      const queryLower = query.toLowerCase();

      const keywords = queryLower.split(/\s+/).filter(k => k.length > 3);
      let hits = 0;
      keywords.forEach(k => {
        if (text.includes(k)) hits++;
      });

      score = hits / Math.max(keywords.length, 1);

      // Boost for sector/service match
      if (p.sector && tenderContext.includes(p.sector.toLowerCase())) score += 0.15;
      pServiceAreas.forEach(s => {
        if (tenderContext.includes(s.toLowerCase())) score += 0.1;
      });

      // Boost for scale (contract value) if relevant keywords are in query
      if (queryLower.includes("large") || queryLower.includes("scale")) {
        if ((p.contractValue ?? 0) > 1000000) score += 0.1;
      }

      // Recency boost
      if (p.endDate) {
        const ageYears = (Date.now() - new Date(p.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 5) score += 0.05;
      }

      return {
        projectId: p.id,
        projectName: p.name,
        relevanceScore: Math.min(1.0, score),
        reason: `Deterministic score: ${(score * 100).toFixed(0)}% based on keywords, sector, and scale.`,
        evidenceFileIds: p.evidences.map(ev => ev.storagePath).filter(Boolean) as string[]
      };
    });

    candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const best = candidates[0];
    return best && best.relevanceScore > 0.15 ? best : null;
  }

  private findBestLegal(query: string, records: LegalRecord[]): SelectedLegalRecord | null {
    if (records.length === 0) return null;
    const queryLower = query.toLowerCase();
    const now = new Date();

    const candidates = records.map(r => {
      const titleLower = r.title.toLowerCase();
      const typeLower = r.recordType.toLowerCase();
      let score = 0;
      if (titleLower.includes(queryLower) || queryLower.includes(typeLower)) {
        score = 1.0;
      }
      // Keyword overlap
      const keywords = queryLower.split(/\s+/).filter(k => k.length > 3);
      keywords.forEach(k => {
        if (titleLower.includes(k)) score += 0.1;
      });

      return { record: r, score };
    }).filter(c => c.score > 0);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aExpired = a.record.expiryDate && a.record.expiryDate < now;
      const bExpired = b.record.expiryDate && b.record.expiryDate < now;
      if (aExpired !== bExpired) return aExpired ? 1 : -1;
      return b.score - a.score;
    });

    const best = candidates[0].record;
    return {
      recordId: best.id,
      title: best.title,
      isValid: !(best.expiryDate && best.expiryDate < now),
      expiryDate: best.expiryDate,
      reason: `Legal record matched by type/title keywords.`,
      fileId: undefined
    };
  }

  private findBestFinancial(query: string, records: FinancialRecord[]): SelectedFinancialRecord | null {
    if (records.length === 0) return null;
    const queryLower = query.toLowerCase();
    const candidates = records.map(r => {
      let score = r.fiscalYear;
      if (queryLower.includes(r.recordType.toLowerCase())) score += 100;
      return { record: r, score };
    });

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0].record;
    return {
      recordId: best.id,
      fiscalYear: best.fiscalYear,
      recordType: best.recordType,
      reason: `Financial record for ${best.fiscalYear} selected (${best.recordType}).`,
      fileId: undefined
    };
  }

  /**
   * Find the best-matching compliance record for a requirement query.
   *
   * REVIEW-BLOCKER FIX #3:
   * Previously this method returned the first candidate even when its score
   * was 0 — meaning an irrelevant compliance record would be selected as
   * evidence. This violated the "no invented/irrelevant evidence" rule.
   *
   * Now: candidates with score 0 are filtered OUT before sorting. If no
   * candidate has a positive score (≥ COMPLIANCE_MIN_SCORE), the method
   * returns null — the requirement is then recorded as a missing-evidence
   * gap instead of being matched to an irrelevant record.
   */
  private findBestCompliance(query: string, records: CompanyComplianceRecord[]): { recordId: string, title: string, reason: string } | null {
    if (records.length === 0) return null;
    const queryLower = query.toLowerCase();

    // Score every candidate, then FILTER OUT score-0 candidates.
    // Only records with a positive keyword/title/type match are considered.
    const candidates = records.map(r => {
      let score = 0;
      if (r.title.toLowerCase().includes(queryLower)) score += 1;
      if (queryLower.includes(r.complianceType.toLowerCase())) score += 1;
      // Keyword overlap on individual query terms
      const keywords = queryLower.split(/\s+/).filter(k => k.length > 3);
      keywords.forEach(k => {
        if (r.title.toLowerCase().includes(k)) score += 0.5;
        if (r.complianceType.toLowerCase().includes(k)) score += 0.5;
      });
      return { record: r, score };
    }).filter(c => c.score >= COMPLIANCE_MIN_SCORE);

    // No candidate with a positive score → return null (no irrelevant evidence)
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0].record;
    return {
      recordId: best.id,
      title: best.title,
      reason: `Compliance certificate matched by title/type (score ${candidates[0].score.toFixed(1)}).`
    };
  }

  private calculateOverallScore(matches: RequirementEvidenceMatch[], gaps: MissingEvidenceGap[]): number {
    const totalRequirements = matches.length + gaps.filter(g => g.severity === "final_blocker").length;
    if (totalRequirements === 0) return 100;

    const matchedScore = matches.reduce((acc, m) => acc + (m.status === "matched" ? 1.0 : 0.5), 0);
    return Math.round((matchedScore / totalRequirements) * 100);
  }
}

/**
 * Select evidence for a tender from a company's vault.
 *
 * Wraps `TenderEvidenceSelector.selectEvidence()`. Returns either the
 * evidence selection or a structured `TenderEvidenceForbidden` error.
 * Callers MUST check the result with `isTenderEvidenceForbidden()`.
 */
export async function getTenderEvidenceSelection(
  prisma: PrismaClient,
  tenderId: string,
  companyId: string,
  userId: string,
): Promise<TenderEvidenceSelection | TenderEvidenceForbidden> {
  const selector = new TenderEvidenceSelector(prisma);
  return selector.selectEvidence(tenderId, companyId, userId);
}

/**
 * Get tender evidence selection by tender ID + authenticated user ID.
 *
 * REVIEW-BLOCKER FIX #2:
 * Previously this function accepted a `userId` but did NOT verify that the
 * tender belonged to that user. It loaded the user's company and selected
 * evidence — but the tender could belong to a different user (different
 * tenant). This was a cross-tenant authorization bypass.
 *
 * Now: this function verifies that the tender belongs to the authenticated
 * user BEFORE selecting evidence. The authorization flow is:
 *   1. Load the company by `userId` (the user's own company).
 *   2. Load the tender by `tenderId`.
 *   3. Verify `tender.userId === userId` (the tender belongs to this user).
 *   4. If all checks pass, select evidence via `selectEvidence()`.
 *
 * Returns:
 *   - `TenderEvidenceSelection` on success
 *   - `TenderEvidenceForbidden` on authorization failure (callers surface 403)
 *   - `null` if the company doesn't exist (user has no workspace yet)
 *
 * This function does NOT use fake user IDs — it requires the real
 * authenticated user ID from the session.
 */
export async function getTenderEvidenceSelectionById(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<TenderEvidenceSelection | TenderEvidenceForbidden | null> {
  if (!userId) {
    return { forbidden: true, reason: "User ID is required.", code: "USER_NOT_AUTHENTICATED" };
  }

  // Load the authenticated user's company/workspace
  const company = await prisma.company.findFirst({ where: { userId } });
  if (!company) return null;

  // selectEvidence() performs the full authorization:
  //   - company.userId === userId (company belongs to user)
  //   - tender.userId === userId (tender belongs to user)
  // This prevents cross-tenant access — a user cannot select evidence for
  // another user's tender even if they know the tenderId.
  const selector = new TenderEvidenceSelector(prisma);
  return selector.selectEvidence(tenderId, company.id, userId);
}

export async function getConfirmedEvidenceFileIds(prisma: PrismaClient, tenderId: string): Promise<string[]> {
  const expertMatches = await prisma.tenderExpertMatch.findMany({
    where: { tenderId, isSelected: true },
    include: { expert: true }
  });
  const projectMatches = await prisma.tenderProjectMatch.findMany({
    where: { tenderId, isSelected: true },
    include: { project: { include: { evidences: true } } }
  });

  const fileIds: string[] = [];
  expertMatches.forEach(m => {
    if (m.expert.sourceDocumentId) fileIds.push(m.expert.sourceDocumentId);
  });
  projectMatches.forEach(m => {
    m.project.evidences.forEach(ev => {
      if (ev.storagePath) fileIds.push(ev.storagePath);
    });
  });

  return [...new Set(fileIds)];
}
