import "server-only";

import { prisma, prismaReady } from "./prisma";
import { getSystemReadiness, type ReadinessSeverity } from "./system-readiness";

export type GuardianSeverity = ReadinessSeverity;

export type GuardianCheck = {
  key: string;
  title: string;
  severity: GuardianSeverity;
  detail: string;
  automaticAction: string;
};

export type ReleaseGuardianReport = {
  safeToRelease: boolean;
  generatedAt: string;
  checks: GuardianCheck[];
  blockers: GuardianCheck[];
};

export const ZAI_MODEL_OVERRIDE_VARIABLES = [
  "ZAI_PROPOSAL_MODEL",
  "ZAI_ANALYSIS_MODEL",
  "ZAI_FAST_MODEL",
] as const;

// There is deliberately no hardcoded list of "rejected" Z.ai model names here.
//
// There used to be one — {glm-4.7-flash, glm-4-flash, glm-4} — recording models
// that had failed live diagnostics at some past moment. It became a second
// authority on which models are usable, and it contradicted the first: the
// provider registry's allowlist permitted only glm-4-flash, while this set
// rejected glm-4-flash and quarantined Z.ai. No value the operator could put in
// ZAI_PROPOSAL_MODEL satisfied both, so rank-1 Z.ai was unreachable by
// configuration.
//
// A model name that failed once is not permanently invalid: keys change, plans
// change, and providers ship new families. Whether this account can use a given
// model is a live fact, so the guardian reports that an override exists and
// defers to the live diagnostic instead of asserting a stale verdict.

// Every field emitted by canonical-analysis-update.ts and the durable promoter.
// The database check detects an un-applied migration before operators retry AI
// Analyze. The write-time contract remains the final authority.
export const REQUIRED_TENDER_PROMOTION_COLUMNS = [
  "analysisSummary",
  "title",
  "evaluationMethodology",
  "exactFileNaming",
  "exactFileOrder",
  "category",
  "notes",
  "status",
  "stage",
  "procuringEntityName",
  "clientName",
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "country",
  "clientAddress",
  "clientContactName",
  "clientContactTitle",
  "clientContactEmail",
  "clientContactPhone",
  "submissionAddress",
  "clientCity",
  "clientWebsite",
  "submissionEmailSubject",
  "preBidChannel",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "clientRepresentative",
  "reference",
  "submissionMethod",
  "submissionEmails",
  "clientNameSourcePage",
  "clientNameSourceQuote",
  "submissionEmailSourcePage",
  "contactDetailsSourceJson",
  "submissionMethodSourcePage",
  "submissionMethodSourceQuote",
  "submissionAddressSourcePage",
  "submissionAddressSourceQuote",
  "evaluationCriteriaSourceJson",
  "metadataContaminated",
  "analysisExtractionStatus",
] as const;

function has(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

/** Pure and testable: values are never returned, only variable names/status. */
export function inspectZaiModelOverrides(env: NodeJS.ProcessEnv = process.env): GuardianCheck {
  const configured = ZAI_MODEL_OVERRIDE_VARIABLES
    .map((name) => ({ name, value: env[name]?.trim() ?? "" }))
    .filter((entry) => entry.value.length > 0);

  if (configured.length > 0) {
    return {
      key: "zai_model_override",
      title: "Z.ai model override",
      severity: "WARNING",
      detail: `${configured.map((entry) => entry.name).join(", ")} overrides the code registry. Run a live provider check before any release; the guardian will not guess a replacement model.`,
      automaticAction: "Keep Z.ai review-required until live diagnostics passes.",
    };
  }

  return {
    key: "zai_model_override",
    title: "Z.ai model override",
    severity: has(env.ZAI_API_KEY) ? "WARNING" : "OK",
    detail: has(env.ZAI_API_KEY)
      ? "No Z.ai model override is set. The registry model still requires a live provider check before release."
      : "Z.ai is not configured, so no Z.ai model override can affect runtime behavior.",
    automaticAction: has(env.ZAI_API_KEY)
      ? "Use the live provider check; do not guess model names."
      : "Continue with the next configured provider in the canonical fallback chain.",
  };
}

async function tenderPromotionSchemaCheck(): Promise<GuardianCheck> {
  try {
    await prismaReady;
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Tender'`,
    );
    const found = new Set(rows.map((row) => row.column_name));
    const missing = REQUIRED_TENDER_PROMOTION_COLUMNS.filter((column) => !found.has(column));

    if (missing.length > 0) {
      return {
        key: "tender_promotion_schema",
        title: "AI Analyze persistence contract",
        severity: "CRITICAL",
        detail: `The deployed Tender table is missing required promotion columns: ${missing.join(", ")}.`,
        automaticAction: "Block canonical promotion, generation, and export until the reviewed migration is deployed.",
      };
    }

    return {
      key: "tender_promotion_schema",
      title: "AI Analyze persistence contract",
      severity: "OK",
      detail: "The deployed Tender table contains every column required by the canonical AI promotion mapper.",
      automaticAction: "Allow normal guarded AI Analyze processing.",
    };
  } catch (error) {
    return {
      key: "tender_promotion_schema",
      title: "AI Analyze persistence contract",
      severity: "CRITICAL",
      detail: `The guardian could not verify the Tender persistence contract (${error instanceof Error ? error.constructor.name : "UnknownError"}).`,
      automaticAction: "Fail closed: keep generation and export blocked until the database check is healthy.",
    };
  }
}

async function recentAiFailureCheck(): Promise<GuardianCheck> {
  try {
    await prismaReady;
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await prisma.aiJob.count({
      where: {
        jobType: "AI_ANALYZE",
        status: "FAILED",
        updatedAt: { gte: since },
      },
    });

    return {
      key: "recent_ai_failures",
      title: "Recent AI Analyze failures",
      severity: failed > 0 ? "WARNING" : "OK",
      detail: failed > 0
        ? `${failed} AI Analyze job(s) failed in the last hour. Review safe incident references before retrying.`
        : "No failed AI Analyze jobs were recorded in the last hour.",
      automaticAction: failed > 0
        ? "Do not repeatedly retry the same tender; run provider diagnostics and inspect the safe failure code."
        : "No containment action required.",
    };
  } catch (error) {
    return {
      key: "recent_ai_failures",
      title: "Recent AI Analyze failures",
      severity: "WARNING",
      detail: `Recent AI job history could not be checked (${error instanceof Error ? error.constructor.name : "UnknownError"}).`,
      automaticAction: "Treat AI Analyze as review-required until job history is available.",
    };
  }
}

export async function getReleaseGuardianReport(): Promise<ReleaseGuardianReport> {
  const readiness = await getSystemReadiness();
  const systemChecks: GuardianCheck[] = readiness.checks.map((check) => ({
    key: `system_${check.key}`,
    title: check.title,
    severity: check.severity,
    detail: check.detail,
    automaticAction: check.severity === "CRITICAL"
      ? "Fail closed for release-sensitive operations until this check is resolved."
      : check.severity === "WARNING"
        ? "Keep release review-required; do not treat this as production proof."
        : "No containment action required.",
  }));

  const checks = [
    inspectZaiModelOverrides(),
    await tenderPromotionSchemaCheck(),
    await recentAiFailureCheck(),
    ...systemChecks,
  ];

  const blockers = checks.filter((check) => check.severity === "CRITICAL");
  return {
    safeToRelease: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    blockers,
  };
}
