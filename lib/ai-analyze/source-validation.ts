/**
 * AI Analyze Source Validation
 *
 * Validates that extracted requirements are grounded in tender sources.
 *
 * Rules:
 * - Every extracted requirement must have source file ID, page number, quote
 * - File token must reference actual tender file
 * - Quote must be non-empty (minimum reasonable length)
 * - Page number must be in valid range (1 to total pages)
 * - No phantom sources (file ID that doesn't exist in tender)
 *
 * Used before promotion to canonical to ensure data integrity.
 */

import type { PrismaClient } from "@prisma/client";

export interface RequirementSource {
  fileId?: string;
  page?: number;
  quote?: string;
  extractionMethod?: "text" | "ocr" | "manual";
}

export interface ExtractedRequirement {
  id: string;
  title: string;
  description?: string;
  source?: RequirementSource;
}

export interface SourceValidationResult {
  isValid: boolean;
  errors: SourceValidationError[];
}

export interface SourceValidationError {
  requirementId: string;
  field: string;
  error: string;
}

/**
 * Validate that a requirement has proper source grounding.
 *
 * Checks:
 * - source exists
 * - fileId exists and matches tender file
 * - page is numeric and in valid range
 * - quote is non-empty and reasonable length (> 10 chars)
 */
export async function validateRequirementSource(
  requirement: ExtractedRequirement,
  tenderId: string,
  prismaClient: PrismaClient,
): Promise<SourceValidationResult> {
  const errors: SourceValidationError[] = [];

  if (!requirement.source) {
    errors.push({
      requirementId: requirement.id,
      field: "source",
      error: "Requirement has no source information",
    });
    return { isValid: false, errors };
  }

  const { fileId, page, quote } = requirement.source;

  // Validate file ID
  if (!fileId) {
    errors.push({
      requirementId: requirement.id,
      field: "source.fileId",
      error: "Source file ID is missing",
    });
  } else {
    // Verify file exists and belongs to tender
    const file = await prismaClient.tenderFile.findFirst({
      where: { id: fileId, tenderId },
      select: { id: true, totalPages: true },
    });

    if (!file) {
      errors.push({
        requirementId: requirement.id,
        field: "source.fileId",
        error: `File ${fileId} not found in tender or deleted`,
      });
    } else if (page && file.totalPages) {
      // Validate page number
      if (!Number.isInteger(page) || page < 1 || page > file.totalPages) {
        errors.push({
          requirementId: requirement.id,
          field: "source.page",
          error: `Page ${page} is outside valid range (1-${file.totalPages})`,
        });
      }
    }
  }

  // Validate page number exists
  if (page === undefined) {
    errors.push({
      requirementId: requirement.id,
      field: "source.page",
      error: "Page number is missing",
    });
  }

  // Validate quote
  if (!quote) {
    errors.push({
      requirementId: requirement.id,
      field: "source.quote",
      error: "Source quote is missing",
    });
  } else if (quote.trim().length < 10) {
    errors.push({
      requirementId: requirement.id,
      field: "source.quote",
      error: "Source quote is too short (minimum 10 characters)",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate all requirements in a job have proper sources.
 *
 * Returns aggregate validation result.
 * If any requirement is invalid, isValid = false.
 */
export async function validateAllRequirementSources(
  tenderId: string,
  prismaClient: PrismaClient,
): Promise<SourceValidationResult> {
  const requirements = await prismaClient.tenderRequirement.findMany({
    where: { tenderId },
    select: {
      id: true,
      title: true,
      description: true,
      // Note: actual source fields depend on schema extension
      // For now, assume sourceJson stores { fileId, page, quote, ... }
      // This will need schema update in Phase 3
    },
  });

  const allErrors: SourceValidationError[] = [];

  for (const req of requirements) {
    const result = await validateRequirementSource(
      {
        id: req.id,
        title: req.title,
        description: req.description || undefined,
        // source would come from sourceJson column in schema update
      },
      tenderId,
      prismaClient,
    );

    allErrors.push(...result.errors);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Check if file is actively part of tender (not deleted).
 *
 * Used to verify token references actual file.
 */
export async function isFilePresentInTender(
  fileId: string,
  tenderId: string,
  prismaClient: PrismaClient,
): Promise<boolean> {
  const file = await prismaClient.tenderFile.findFirst({
    where: {
      id: fileId,
      tenderId,
      deletionStatus: "ACTIVE",
    },
    select: { id: true },
  });

  return file != null;
}

/**
 * Audit trail for source validation results.
 *
 * Records validation before promotion for compliance/debugging.
 */
export interface SourceValidationAudit {
  jobId: string;
  tenderId: string;
  userId: string;
  validationTimestamp: Date;
  passed: boolean;
  errorCount: number;
  errors: SourceValidationError[];
}
