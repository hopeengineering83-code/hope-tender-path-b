/**
 * AI Analyze Content Hash
 *
 * Deterministic hashing of tender analysis input.
 * Used to detect when tender content changes and to resume exact jobs.
 *
 * Content includes:
 * - All tender file extracted text (sorted by file ID)
 * - Tender metadata (title, description, deadline, etc.)
 * - Company metadata (name, legal name, etc.)
 *
 * Hash is stable: same input → same hash.
 * Changes to files or metadata → new hash.
 * Resume only works if hashes match exactly.
 */

import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";

export interface TenderAnalysisContent {
  tenderId: string;
  fileHashes: { fileId: string; fileContentHash: string }[];
  tenderMetadata: {
    title?: string | null;
    description?: string | null;
    deadline?: string | null; // ISO date string
    reference?: string | null;
    clientName?: string | null;
    budget?: number | null;
    country?: string | null;
    submissionMethod?: string | null;
  };
  companyMetadata?: {
    name?: string;
    legalName?: string | null;
    foundingYear?: number | null;
  };
}

/**
 * Build the canonical analysis content input for a tender.
 *
 * Collects all tender files and metadata that feed into AI analysis.
 * Order is deterministic (files sorted by ID) for hash stability.
 */
export async function buildTenderAnalysisContent(
  tenderId: string,
  userId: string,
  prismaClient: PrismaClient,
): Promise<TenderAnalysisContent> {
  // Fetch tender and all its files
  const tender = await prismaClient.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      description: true,
      deadline: true,
      reference: true,
      clientName: true,
      budget: true,
      country: true,
      submissionMethod: true,
      userId: true,
      user: {
        select: {
          company: {
            select: {
              name: true,
              legalName: true,
              foundingYear: true,
            },
          },
        },
      },
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: {
          id: true,
          extractedText: true,
        },
        orderBy: { id: "asc" }, // Deterministic order
      },
    },
  });

  if (!tender) {
    throw new Error("Tender not found or access denied");
  }

  // Hash each file's extracted text
  const fileHashes = tender.files.map((file) => ({
    fileId: file.id,
    fileContentHash: hashContent(file.extractedText || ""),
  }));

  // Build tender metadata object (null-safe)
  const tenderMetadata = {
    title: tender.title || null,
    description: tender.description || null,
    deadline: tender.deadline ? tender.deadline.toISOString() : null,
    reference: tender.reference || null,
    clientName: tender.clientName || null,
    budget: tender.budget || null,
    country: tender.country || null,
    submissionMethod: tender.submissionMethod || null,
  };

  // Build company metadata if available
  const companyMetadata = tender.user?.company
    ? {
        name: tender.user.company.name,
        legalName: tender.user.company.legalName || null,
        foundingYear: tender.user.company.foundingYear || null,
      }
    : undefined;

  return {
    tenderId,
    fileHashes,
    tenderMetadata,
    companyMetadata,
  };
}

/**
 * Compute deterministic hash of a TenderAnalysisContent object.
 *
 * Renamed from `computeAnalysisContentHash` to
 * `computeTenderAnalysisContentHash` to disambiguate from the
 * string-input `computeAnalysisContentHash` in
 * lib/engine/tender-analysis-content.ts (which is the canonical
 * 16-char truncated hash used by the checkpoint system). This variant
 * takes the structured TenderAnalysisContent object and returns the
 * full 64-char hex hash.
 *
 * Backward-compat alias `computeAnalysisContentHash` is preserved at
 * the bottom of the file so existing imports continue to work.
 *
 * Returns a stable hex-encoded SHA-256 hash.
 * Same content → same hash.
 * Different content → different hash.
 */
export function computeTenderAnalysisContentHash(content: TenderAnalysisContent): string {
  // Serialize content in a stable order
  const serialized = JSON.stringify(content, null, 0); // No whitespace for determinism
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

/**
 * Compute hash of raw content (string).
 *
 * Used for individual file content hashing.
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Build and hash tender analysis content in one call.
 *
 * Returns the content object and its hash.
 */
export async function buildAndHashTenderAnalysisContent(
  tenderId: string,
  userId: string,
  prismaClient: PrismaClient,
): Promise<{ content: TenderAnalysisContent; hash: string }> {
  const content = await buildTenderAnalysisContent(tenderId, userId, prismaClient);
  const hash = computeTenderAnalysisContentHash(content);
  return { content, hash };
}

// Backward-compat alias — preserved so existing imports
// `computeAnalysisContentHash` from this module continue to work. New code
// should prefer the explicit `computeTenderAnalysisContentHash` name to
// avoid confusion with the string-input `computeAnalysisContentHash` in
// lib/engine/tender-analysis-content.ts.
export const computeAnalysisContentHash = computeTenderAnalysisContentHash;
