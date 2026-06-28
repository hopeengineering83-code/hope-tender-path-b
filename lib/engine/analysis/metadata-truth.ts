import { PrismaClient } from "@prisma/client";
import { resolveCanonicalFieldState, type CanonicalFieldStatus } from "../canonical-field-state";

export type MetadataFactStatus = CanonicalFieldStatus;

export type MetadataTruthSummary = {
  counts: {
    total: number;
    detected: number;
    valid: number;
    grounded: number;
    confirmed: number;
  };
  readinessScore: number;
  fields: Record<string, {
    status: MetadataFactStatus;
    value: string | null;
    isCritical: boolean;
    label: string;
    blockerReason: string | null;
    grounded: boolean;
    override?: {
      fieldState: string;
      actor: string | null;
      timestamp: Date | null;
      reason: string | null;
    };
  }>;
};

/**
 * Metadata Truth Resolver (Redirected)
 *
 * Redirected to the canonical resolver to ensure Rule 1 consistency.
 */
export async function resolveMetadataTruth(
  prisma: PrismaClient,
  tenderId: string,
  userId?: string
): Promise<MetadataTruthSummary> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, ...(userId ? { userId } : {}) },
    include: {
      metadataOverrides: true,
      requirements: true,
    }
  });

  if (!tender) throw new Error("Tender not found");

  const canonical = resolveCanonicalFieldState({
    tender: tender as any,
    overrides: tender.metadataOverrides as any,
    hasExtractedRequirements: tender.requirements.length > 0,
  });

  const fields: MetadataTruthSummary["fields"] = {};
  for (const f of canonical.fields) {
    fields[f.fieldKey] = {
      status: f.status,
      value: f.effectiveValue,
      isCritical: f.criticality !== "non-critical",
      label: f.label,
      blockerReason: f.blockerReason,
      grounded: f.isGrounded,
      override: f.overrideState ? {
        fieldState: f.overrideState,
        actor: f.overriddenBy,
        timestamp: f.overrideTimestamp,
        reason: f.overrideReason,
      } : undefined,
    };
  }

  return {
    counts: {
      total: canonical.totalFields,
      detected: canonical.validFields,
      valid: canonical.validFields,
      grounded: canonical.groundedFields,
      confirmed: canonical.fields.filter(f => f.isManuallyConfirmed).length,
    },
    readinessScore: (canonical.validFields / canonical.totalFields),
    fields,
  };
}
