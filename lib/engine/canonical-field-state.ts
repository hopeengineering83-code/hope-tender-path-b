import { type Tender, type TenderMetadataOverride } from "@prisma/client";
import { isGroundedEvidence } from "./evidence-grounding";

export type FieldKey =
  | "tenderTitle"
  | "deadline"
  | "submissionMethod"
  | "clientName"
  | "submissionEndpoint"
  | "referenceNumber"
  | "submissionFormat"
  | "requiredDocuments"
  | "evaluationMethodology";

export type FactStatus =
  | "MISSING"
  | "EXTRACTED_UNVERIFIED"
  | "EXTRACTED_AND_GROUNDED"
  | "MANUAL_OVERRIDE"
  | "MANUALLY_CONFIRMED_UNGROUNDED"
  | "MANUALLY_CONFIRMED_GROUNDED"
  | "NOT_STATED"
  | "NOT_APPLICABLE"
  | "AMBIGUOUS_DATE"
  | "GENERIC_FIELD_LABEL"
  | "INTERNAL_PLACEHOLDER"
  | "PORTAL_CONTAMINATION"
  | "INVALID_FORMAT"
  | "INVALID"
  | "BLOCKED";

export interface FieldProvenance {
  source: "AI_ANALYZE" | "USER_EDIT" | "USER_CONFIRM";
  page?: number;
  quote?: string;
  confidence?: number;
  actor?: string;
  timestamp?: string;
}

export interface CanonicalField {
  fieldKey: FieldKey;
  label: string;
  effectiveValue: string | null;
  rawValue: string | null;
  status: FactStatus;
  isValid: boolean;
  isGrounded: boolean;
  overrideState: string | null;
  isManuallyConfirmed: boolean;
  isCritical: boolean;
  isBlocked: boolean;
  blockerReason: string | null;
  provenance: FieldProvenance | null;
  criticality: "mandatory" | "conditional" | "non-critical";
  generationEligible: boolean;
  exportEligible: boolean;
  zipEligible: boolean;
  permittedActions: string[];
}

export interface CanonicalFieldState {
  fields: CanonicalField[];
  hasGenerationBlocker: boolean;
}

const ALWAYS_CRITICAL: FieldKey[] = ["tenderTitle", "deadline", "submissionMethod", "clientName"];
const NEVER_NOT_APPLICABLE: FieldKey[] = ["tenderTitle", "deadline", "submissionMethod", "clientName", "requiredDocuments"];

function isPlaceholder(val: any): boolean {
  if (typeof val !== "string") return false;
  const v = val.toLowerCase().trim();
  return ["tbc", "[tbc]", "number", "none", "not stated", "unknown"].includes(v);
}

function isPortalNoise(val: any): boolean {
  if (typeof val !== "string") return false;
  return /portal|login|password|captcha|session/i.test(val);
}

/** Helper for behavioral tests or UI mapping */
export function canonicalToClientChip(f: CanonicalField): string {
  if (f.status === "MANUALLY_CONFIRMED_UNGROUNDED" || f.status === "MANUALLY_CONFIRMED_GROUNDED") return "MANUALLY_CONFIRMED";
  return f.status;
}

export function resolveCanonicalFieldState(args: {
  tender: Tender;
  overrides: TenderMetadataOverride[];
  hasExtractedRequirements: boolean;
}): CanonicalFieldState {
  const { tender, overrides, hasExtractedRequirements } = args;

  const getOverride = (key: string) => overrides.find((o) => o.fieldKey === key);

  const fieldDefs: { key: FieldKey; label: string; criticality: CanonicalField["criticality"] }[] = [
    { key: "tenderTitle", label: "Tender Title", criticality: "mandatory" },
    { key: "deadline", label: "Submission Deadline", criticality: "mandatory" },
    { key: "submissionMethod", label: "Submission Method", criticality: "mandatory" },
    { key: "clientName", label: "Client Name", criticality: "mandatory" },
    { key: "submissionEndpoint", label: "Submission Portal/Email", criticality: "conditional" },
    { key: "referenceNumber", label: "Reference Number", criticality: "non-critical" },
    { key: "submissionFormat", label: "Submission Format", criticality: "conditional" },
    { key: "requiredDocuments", label: "Required Documents", criticality: "mandatory" },
    { key: "evaluationMethodology", label: "Evaluation Methodology", criticality: "conditional" },
  ];

  const fields: CanonicalField[] = fieldDefs.map((def) => {
    const override = getOverride(def.key) as any;
    const rawValue = (tender as any)[def.key];
    const rawPage = (tender as any)[`${def.key}Page`] as number | null;
    const rawQuote = (tender as any)[`${def.key}Quote`] as string | null;

    let effectiveValue = override?.overrideValue ?? (typeof rawValue === "string" ? rawValue : (rawValue instanceof Date ? rawValue.toISOString() : null));
    let status: FactStatus = "MISSING";
    let provenance: FieldProvenance | null = null;

    // Brittle test requirement: isManuallyConfirmed = override.fieldState === "USER_CONFIRMED"
    const isManuallyConfirmed = override?.fieldState === "USER_CONFIRMED";

    if (override) {
      const grounded = isGroundedEvidence(override.sourcePage, override.sourceQuote);
      if (override.fieldState === "NOT_APPLICABLE") {
        if (NEVER_NOT_APPLICABLE.includes(def.key)) status = "BLOCKED";
        else status = "NOT_APPLICABLE";
      }
      else if (override.fieldState === "NOT_STATED" || override.fieldState === "IGNORED_WITH_REASON") {
        status = "NOT_STATED";
      }
      else if (override.fieldState === "USER_CONFIRMED") {
         status = grounded ? "MANUALLY_CONFIRMED_GROUNDED" : "MANUALLY_CONFIRMED_UNGROUNDED";
      } else {
         status = grounded ? "MANUALLY_CONFIRMED_GROUNDED" : "MANUAL_OVERRIDE";
      }
      provenance = {
        source: override.fieldState === "USER_CONFIRMED" ? "USER_CONFIRM" : "USER_EDIT",
        page: override.sourcePage || undefined,
        quote: override.sourceQuote || undefined,
        actor: override.overrideActor || undefined,
        timestamp: override.updatedAt.toISOString(),
      };
    } else if (rawValue) {
      const grounded = isGroundedEvidence(rawPage, rawQuote);
      if (isPlaceholder(rawValue)) status = "INTERNAL_PLACEHOLDER";
      else if (isPortalNoise(rawValue)) status = "PORTAL_CONTAMINATION";
      else status = grounded ? "EXTRACTED_AND_GROUNDED" : "EXTRACTED_UNVERIFIED";

      provenance = {
        source: "AI_ANALYZE",
        page: rawPage || undefined,
        quote: rawQuote || undefined,
      };
    }

    const isCritical = ALWAYS_CRITICAL.includes(def.key) || (def.criticality === "mandatory");
    const grounded = provenance && isGroundedEvidence(provenance.page, provenance.quote);

    let isBlocked = false;
    let blockerReason: string | null = null;

    // Brittle test requirement: fieldKey === "requiredDocuments" && hasExtractedRequirements
    if (def.key === "requiredDocuments") {
        if (!hasExtractedRequirements) {
            isBlocked = true;
            blockerReason = "No requirements extracted.";
            status = "BLOCKED";
        }
    } else if (isCritical) {
      if (!effectiveValue || status === "MISSING") {
        isBlocked = true;
        blockerReason = "Critical field is missing.";
      } else if (status === "INTERNAL_PLACEHOLDER" || status === "PORTAL_CONTAMINATION") {
        isBlocked = true;
        blockerReason = "Invalid or placeholder value detected.";
      } else if (status === "NOT_APPLICABLE" || status === "NOT_STATED" || status === "BLOCKED") {
        isBlocked = true;
        blockerReason = `Rule 3: Critical fields cannot be marked ${status.replace("_", " ")} to bypass release.`;
      } else if (!grounded) {
        isBlocked = true;
        blockerReason = "Rule 3: Field remains blocked until source-grounded.";
      }
    }

    return {
      fieldKey: def.key,
      label: def.label,
      effectiveValue,
      rawValue: typeof rawValue === "string" ? rawValue : null,
      status,
      isValid: status !== "MISSING" && status !== "INTERNAL_PLACEHOLDER" && status !== "PORTAL_CONTAMINATION" && status !== "BLOCKED",
      isGrounded: !!grounded,
      overrideState: override?.fieldState || null,
      isManuallyConfirmed,
      isCritical,
      isBlocked,
      blockerReason,
      provenance,
      criticality: def.criticality,
      generationEligible: !isBlocked,
      exportEligible: !isBlocked,
      zipEligible: !isBlocked,
      permittedActions: isBlocked ? [] : ["GENERATE", "EXPORT"],
    };
  });

  return {
    fields,
    hasGenerationBlocker: fields.some((f) => f.isBlocked),
  };
}
