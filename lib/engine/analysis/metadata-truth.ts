import { PrismaClient, Tender } from "@prisma/client";
import { assessTenderMetadataCompleteness } from "../tender-metadata-completeness";
import { containsMetadataPlaceholder, isValidClientName, isValidReferenceNumber, isValidCountry } from "../metadata-validators";

export type MetadataFactStatus =
  | "EXTRACTED_AND_GROUNDED"
  | "EXTRACTED_UNVERIFIED"
  | "MANUAL_CONFIRMED"
  | "NOT_FOUND_CONFIRMED"
  | "NOT_APPLICABLE"
  | "AMBIGUOUS_SOURCE_TEXT"
  | "INTERNAL_PLACEHOLDER"
  | "PORTAL_CONTAMINATION"
  | "INVALID";

export type MetadataTruthSummary = {
  extractionCoverage: number;
  readinessScore: number;
  groundingCoverage: number;
  confirmationCoverage: number;
  fields: Record<string, {
    status: MetadataFactStatus;
    value: string | null;
    isCritical: boolean;
  }>;
};

export async function resolveMetadataTruth(
  prisma: PrismaClient,
  tenderId: string
): Promise<MetadataTruthSummary> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      metadataOverrides: true,
      requirements: true,
    }
  });

  if (!tender) throw new Error("Tender not found");

  const metaReport = assessTenderMetadataCompleteness({
    clientName: (tender.clientName || tender.procuringEntityName) ?? null,
    country: tender.country ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    deadline: tender.deadline ?? null,
    currency: tender.currency ?? null,
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
    requirementCount: tender.requirements.length,
  }, tender.metadataOverrides);

  const criticalFields = new Set([
    "clientName", "title", "deadline", "submissionMethod", "reference"
  ]);

  const fields: MetadataTruthSummary["fields"] = {};
  const allFieldKeys = [
    "clientName", "title", "reference", "deadline", "country", "submissionMethod",
    "submissionAddress", "submissionEmails", "currency", "clientContactName"
  ];

  let extractedCount = 0;
  let confirmedCount = 0;
  let groundedCount = 0;

  for (const key of allFieldKeys) {
    const val = (tender as any)[key];
    const isCritical = criticalFields.has(key);
    const override = tender.metadataOverrides.find(o => o.field === key);

    let status: MetadataFactStatus = "INVALID";

    if (override?.fieldState === "NOT_APPLICABLE") {
      status = "NOT_APPLICABLE";
    } else if (override?.fieldState === "USER_CONFIRMED") {
      status = "MANUAL_CONFIRMED";
      confirmedCount++;
    } else if (tender.metadataContaminated && key === "clientName") {
      status = "PORTAL_CONTAMINATION";
    } else if (containsMetadataPlaceholder(val)) {
      status = "INTERNAL_PLACEHOLDER";
    } else if (val) {
      extractedCount++;
      // Basic heuristic for grounding/ambiguity
      const isWeak = val.length < 5 || (key === "clientName" && !isValidClientName(val));
      status = isWeak ? "AMBIGUOUS_SOURCE_TEXT" : "EXTRACTED_AND_GROUNDED";
      if (status === "EXTRACTED_AND_GROUNDED") groundedCount++;
    }

    fields[key] = { status, value: val?.toString() ?? null, isCritical };
  }

  return {
    extractionCoverage: extractedCount / allFieldKeys.length,
    readinessScore: metaReport.overallRatio,
    groundingCoverage: groundedCount / Math.max(1, extractedCount),
    confirmationCoverage: confirmedCount / allFieldKeys.length,
    fields
  };
}
