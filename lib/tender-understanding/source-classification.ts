export const SOURCE_CLASSIFICATIONS = [
  "FOUND_AND_GROUNDED",
  "EXPLICITLY_NOT_REQUIRED",
  "NOT_STATED",
  "UNREADABLE",
  "EXTRACTION_FAILED",
  "CONFLICTING",
] as const;

export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

export type SourceDrivenFact<T = string> = {
  key: string;
  classification: SourceClassification;
  value: T | null;
  sourceIds: string[];
  sourceQuotes: string[];
  requiredForFinalDelivery: boolean;
  explanation: string;
};

export type SourceDrivenDisposition = {
  blocks: boolean;
  requiresUserInterruption: boolean;
  severity: "NONE" | "WARNING" | "BLOCKER";
  reason: string;
};

/**
 * Canonical fail-closed policy for tender facts.
 *
 * Optional facts that are not stated never block. A fact blocks only when it is
 * indispensable to final delivery and the source is unreadable, extraction
 * failed, or sources genuinely conflict. Unsupported claims remain governed by
 * the reviewed-evidence and export-integrity layers rather than rigid field
 * presence assumptions.
 */
export function classifySourceDisposition(
  fact: Pick<SourceDrivenFact, "classification" | "requiredForFinalDelivery" | "key">,
): SourceDrivenDisposition {
  if (fact.classification === "FOUND_AND_GROUNDED" || fact.classification === "EXPLICITLY_NOT_REQUIRED") {
    return { blocks: false, requiresUserInterruption: false, severity: "NONE", reason: "Source status is resolved." };
  }

  if (fact.classification === "NOT_STATED") {
    if (!fact.requiredForFinalDelivery) {
      return {
        blocks: false,
        requiresUserInterruption: false,
        severity: "NONE",
        reason: `${fact.key} is optional and not stated by the tender source.`,
      };
    }
    return {
      blocks: true,
      requiresUserInterruption: true,
      severity: "BLOCKER",
      reason: `${fact.key} is indispensable to final delivery but is not stated.`,
    };
  }

  if (!fact.requiredForFinalDelivery) {
    return {
      blocks: false,
      requiresUserInterruption: fact.classification !== "EXTRACTION_FAILED",
      severity: "WARNING",
      reason: `${fact.key} could not be conclusively resolved but is not required for final delivery.`,
    };
  }

  return {
    blocks: true,
    requiresUserInterruption: true,
    severity: "BLOCKER",
    reason: `${fact.key} is required for final delivery and is ${fact.classification.toLowerCase().replaceAll("_", " ")}.`,
  };
}

export function sourceDrivenBlockers(facts: SourceDrivenFact[]): SourceDrivenFact[] {
  return facts.filter((fact) => classifySourceDisposition(fact).blocks);
}
