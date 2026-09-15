// Stage-aware Release Status copy.
//
// GAP C
// ─────
// The Release Status panel had one sentence for every automatic state:
//
//   "The workflow is running. Byte verification, extraction, analysis,
//    matching, generation, validation, PDF finalization, and package
//    reconciliation proceed automatically."
//
// Read at a tender that has been extracted but never analyzed, that sentence
// promises the app will analyze the document on its own. It will not. AI
// Analyze and Run Engine are authenticated manual actions — the owner has to
// press them — so a single global "everything is automatic" claim is false on
// both sides of both gates.
//
// WHAT THIS MODULE IS, AND IS NOT
// ───────────────────────────────
// It is a PURE mapping from inputs the caller already holds to a label and an
// explanation. It is NOT a second stage detector: it performs no I/O, reads no
// tender, and infers nothing about the workflow that the canonical decision
// has not already stated.
//
// Its inputs are exactly three, and each comes from an existing authority:
//
//   status         classifyReleaseStatus() — the canonical release
//                  classification (lib/release-status-classifier.ts)
//   canonicalAction  CanonicalWorkflowDecision.nextRequiredAction, after
//                  presentTwoActionWorkflowDecision — the same value the
//                  Next Required Action header renders
//   activeWork     the durable AiJob row that is QUEUED or RUNNING right now
//
// The third input is what makes "running" a fact rather than a guess. A stage
// is only described as in progress when a job row for it actually exists.

import type { ReleaseStatus } from "../release-status-classifier";

/**
 * The classifier's six statuses plus MANUAL_ACTION_REQUIRED, which the
 * Generation Action panel adds when the canonical decision is stopped at a
 * gate only a person can open. The classifier itself never returns it — it
 * has no access to the workflow decision — so the superset lives here rather
 * than widening the classifier's contract.
 */
export type PanelReleaseStatus = ReleaseStatus | "MANUAL_ACTION_REQUIRED";

/**
 * The kind of durable work currently QUEUED or RUNNING for this tender,
 * derived from AiJob.jobType by the caller. `null` means: no job row —
 * therefore nothing is running, and no copy may say otherwise.
 */
export type ActiveWorkKind =
  | "EXTRACTION"
  | "AI_ANALYZE"
  | "ENGINE_RUN"
  | "DOWNSTREAM";

/**
 * Map an AiJob.jobType string to the work kind this module understands.
 * Returns null for job types that are not part of the tender workflow (e.g.
 * VAULT_INGEST), so an unrelated job can never make the panel claim the
 * tender pipeline is moving.
 */
export function activeWorkKindForJobType(jobType: string | null | undefined): ActiveWorkKind | null {
  switch ((jobType ?? "").toUpperCase()) {
    case "EXTRACT_TEXT":
      return "EXTRACTION";
    case "AI_ANALYZE":
      return "AI_ANALYZE";
    case "ENGINE_RUN":
      return "ENGINE_RUN";
    case "PROPOSAL_GENERATION":
    case "AUTO_FINALIZE":
      return "DOWNSTREAM";
    default:
      return null;
  }
}

/** AiJob.jobType values this panel treats as tender-workflow work. */
export const WORKFLOW_JOB_TYPES = [
  "EXTRACT_TEXT",
  "AI_ANALYZE",
  "ENGINE_RUN",
  "PROPOSAL_GENERATION",
  "AUTO_FINALIZE",
] as const;

/**
 * The presentation stage the Release Status panel describes.
 *
 * These are the states the audit requires to be distinguishable. They are a
 * rendering of the canonical decision, not an alternative to it: eligibility,
 * blockers and export gates are unchanged by anything in this file.
 */
export type ReleasePresentationStage =
  /** 1. Loading / checking. */
  | "CHECKING"
  /** 2. Status unavailable or errored. */
  | "STATUS_UNAVAILABLE"
  /** Automatic source verification and extraction are running. */
  | "EXTRACTION_RUNNING"
  /** 3. Extraction is done; the manual AI Analyze gate is open and waiting. */
  | "WAITING_FOR_MANUAL_AI_ANALYZE"
  /** 4 + 5. AI Analyze is queued or running after the owner started it. */
  | "AI_ANALYZE_RUNNING"
  /** 5. AI Analyze is current; the manual Run Engine gate is waiting. */
  | "WAITING_FOR_MANUAL_RUN_ENGINE"
  /** 6. Engine is queued or running after the owner started it. */
  | "ENGINE_RUNNING"
  /** 7. Post-Engine automatic downstream processing. */
  | "POST_ENGINE_AUTOMATIC_PROCESSING"
  /** 8. A genuine source blocker the owner must resolve. */
  | "GENUINE_SOURCE_BLOCKER"
  /** A manual gate that is neither of the two workflow gates (metadata, etc). */
  | "MANUAL_ACTION_REQUIRED"
  /** 9. Legal signature / declaration / ADMIN release. */
  | "LEGAL_RELEASE_BLOCKER"
  /** 10. Security or integrity failure. */
  | "SECURITY_INTEGRITY_FAILURE"
  /** 11 + 12. Final ZIP is ready to download. */
  | "EXPORT_READY";

export type ReleaseStageInput = {
  /** The canonical release classification. */
  status: PanelReleaseStatus;
  /**
   * CanonicalWorkflowDecision.nextRequiredAction (presented form), or null
   * when the canonical decision could not be resolved.
   */
  canonicalAction: string | null;
  /** The durable job currently QUEUED/RUNNING, or null when none exists. */
  activeWork: ActiveWorkKind | null;
  /** True while the panel is still loading its inputs. */
  loading?: boolean;
};

const AI_ANALYZE_ACTIONS = new Set(["RUN_AI_ANALYZE", "RESUME_AI_ANALYZE"]);
const RUN_ENGINE_ACTIONS = new Set(["RUN_ENGINE", "BUILD_SUBMISSION_PLAN"]);
const AUTOMATIC_ACTIONS = new Set(["AUTOMATIC_PROCESSING", "EXPORT_READY", "GENERATE_DOCUMENTS", "VALIDATE_DOCS"]);

/**
 * Resolve the presentation stage. Pure — same inputs, same answer.
 *
 * Ordering matters and is deliberate:
 *
 *   Terminal and failure statuses win first, because they are conclusions the
 *   canonical classifier already reached and nothing downstream may soften.
 *
 *   A live job row wins next. If AI Analyze is RUNNING then AI Analyze is
 *   running, whatever the blocker list still says — the blocker list describes
 *   the state the job is in the middle of changing.
 *
 *   Only then do we read the canonical next action, which names the gate the
 *   workflow is stopped at when nothing is running.
 */
export function resolveReleasePresentationStage(input: ReleaseStageInput): ReleasePresentationStage {
  if (input.loading) return "CHECKING";

  if (input.status === "FAILED_SECURITY_OR_INTEGRITY") return "SECURITY_INTEGRITY_FAILURE";
  if (input.status === "STATUS_UNAVAILABLE") return "STATUS_UNAVAILABLE";
  if (input.status === "READY_TO_DOWNLOAD") return "EXPORT_READY";
  if (input.status === "LEGAL_RELEASE_REQUIRED") return "LEGAL_RELEASE_BLOCKER";

  // Proven work beats every inference below it.
  if (input.activeWork === "AI_ANALYZE") return "AI_ANALYZE_RUNNING";
  if (input.activeWork === "ENGINE_RUN") return "ENGINE_RUNNING";
  if (input.activeWork === "EXTRACTION") return "EXTRACTION_RUNNING";
  if (input.activeWork === "DOWNSTREAM") return "POST_ENGINE_AUTOMATIC_PROCESSING";

  if (input.status === "GENUINE_SOURCE_BLOCKED") return "GENUINE_SOURCE_BLOCKER";

  // An upload or extraction stop stays MANUAL_ACTION_REQUIRED, as it was
  // before this module existed. GENUINE_SOURCE_BLOCKER is the classifier's own
  // conclusion about missing source EVIDENCE, and widening it to cover missing
  // source FILES would relabel a different stop with the wrong sentence.
  const action = input.canonicalAction ?? "";
  if (AI_ANALYZE_ACTIONS.has(action)) return "WAITING_FOR_MANUAL_AI_ANALYZE";
  if (RUN_ENGINE_ACTIONS.has(action)) return "WAITING_FOR_MANUAL_RUN_ENGINE";
  if (AUTOMATIC_ACTIONS.has(action)) return "POST_ENGINE_AUTOMATIC_PROCESSING";

  if (input.status === "MANUAL_ACTION_REQUIRED") return "MANUAL_ACTION_REQUIRED";

  // PROCESSING_AUTOMATICALLY with no canonical action to name the stage. The
  // classifier saw resolved readiness with automatic-work-pending blockers, so
  // downstream processing is the honest reading — but nothing here invents a
  // running job, and the copy below says only that the server owns the stage.
  if (input.canonicalAction === null) return "STATUS_UNAVAILABLE";
  return "POST_ENGINE_AUTOMATIC_PROCESSING";
}

/**
 * The only sentence in the app that may claim the rest of the pipeline runs by
 * itself. It is reachable exclusively from POST_ENGINE_AUTOMATIC_PROCESSING —
 * i.e. after a successful Engine run — because that is the only point at which
 * it is true.
 */
export const POST_ENGINE_AUTOMATIC_COPY =
  "Matching, Build Plan reconciliation, generation, validation and package finalization continue automatically until a genuine blocker or final completion.";

export type ReleaseStageCopy = { label: string; explanation: string };

/**
 * Stage-specific label + explanation.
 *
 * `canonicalLabel` / `canonicalReason` come from the canonical decision and are
 * preferred wherever the canonical authority has already worded the stop, so
 * this panel and the Next Required Action header cannot state different
 * reasons for the same stop.
 */
export function releaseStageCopy(
  stage: ReleasePresentationStage,
  canonical?: { label?: string | null; reason?: string | null },
): ReleaseStageCopy {
  switch (stage) {
    case "CHECKING":
      return {
        label: "Checking status",
        explanation: "Reading the current workflow state for this tender.",
      };

    case "STATUS_UNAVAILABLE":
      return {
        label: "Status unavailable",
        explanation:
          "The current workflow status could not be verified. This does not mean work is running, and it does not mean the tender is ready. Reload the page; if the status stays unavailable, the readiness service needs attention before you rely on any figure on this page.",
      };

    case "EXTRACTION_RUNNING":
      return {
        label: "Extraction running",
        explanation:
          "Source verification and extraction are running automatically. AI Analyze will require your action when extraction completes.",
      };

    case "WAITING_FOR_MANUAL_AI_ANALYZE":
      return {
        label: canonical?.label || "Run AI Analyze",
        explanation:
          canonical?.reason
          || "Extraction is complete. Run AI Analyze to create the grounded analysis for the current source revision. Nothing is running until you start it.",
      };

    case "AI_ANALYZE_RUNNING":
      return {
        label: "AI Analyze running",
        explanation:
          "AI Analyze is running after you started it. You may close or refresh this page — this job continues server-side. Run Engine will require your action when it completes.",
      };

    case "WAITING_FOR_MANUAL_RUN_ENGINE":
      return {
        label: canonical?.label || "Run Engine",
        explanation:
          "AI Analyze is current. Run Engine to continue. Nothing is running until you start it.",
      };

    case "ENGINE_RUNNING":
      return {
        label: "Run Engine processing",
        explanation:
          "Run Engine is processing the current source revision after you started it. You may close or refresh this page — this job continues server-side.",
      };

    case "POST_ENGINE_AUTOMATIC_PROCESSING":
      return {
        label: "Processing automatically",
        explanation: `${POST_ENGINE_AUTOMATIC_COPY} You may close or refresh this page — processing continues server-side.`,
      };

    case "GENUINE_SOURCE_BLOCKER":
      // The label is fixed and unchanged: this panel reports release STATUS,
      // and "Blocked — …" is the word that tells the reader release is
      // stopped. The header directly above already carries the canonical
      // ACTION. Substituting the canonical label here would make both lines
      // say the same thing and quietly delete "blocked" from the page.
      return {
        label: "Blocked — source evidence required",
        explanation:
          canonical?.reason
          || "The workflow is stopped at its first authoritative blocker. Add genuine owned source evidence for unsupported requirements.",
      };

    case "MANUAL_ACTION_REQUIRED":
      return {
        label: canonical?.label ? `Waiting for you — ${canonical.label}` : "Waiting for you",
        explanation:
          canonical?.reason
          || "The workflow is stopped until you take the required action. Nothing is running server-side.",
      };

    case "LEGAL_RELEASE_BLOCKER":
      return {
        label: "Legal release required",
        explanation:
          "A legal signature, declaration, or ADMIN release decision is required. No further automatic processing can occur until this is resolved.",
      };

    case "SECURITY_INTEGRITY_FAILURE":
      return {
        label: "Security or integrity failure",
        explanation:
          "A security or integrity failure occurred. The package cannot be downloaded. Contact support with the request ID.",
      };

    case "EXPORT_READY":
      return {
        label: "Ready to download",
        explanation: "The final ZIP package is ready. Download it below.",
      };
  }
}
