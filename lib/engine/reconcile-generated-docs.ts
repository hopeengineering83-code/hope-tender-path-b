// Reconcile GeneratedDocument rows against the current SubmissionPlan.
//
// PROBLEM (Gap 9)
// ───────────────
// After re-analysing a tender or shipping a new submission-plan
// classifier, old GeneratedDocument rows can remain "active" even when
// they no longer match the current planned files. The screenshot
// surfaced four such orphans:
//   • "Financial capacity and audited statement evidence.pdf"
//   • "Submission method, deadline and delivery rules.docx"
//   • "Tender forms and templates.docx"
//   • "Legal eligibility, registration and licensing evidence.docx"
//
// None mapped cleanly to the new plan, but they were still counted as
// "active docs = 4" in the Bid Control Verdict — misleading the
// readiness gate and the user.
//
// FIX
// ───
// Pure reconciler that decides one of four actions per generated doc:
//
//   KEEP_AS_PLANNED              — matches a planned file by canonical
//                                  key (exact filename or normalized
//                                  form) — leave the row as-is.
//   RELINK_TO_PLAN               — matches a planned file by semantic
//                                  category / document type — caller
//                                  should update exactFileName + order
//                                  and set status = NEEDS_REVALIDATION
//                                  so the user re-validates content.
//   MARK_SUPERSEDED              — no link to current plan. Exclude
//                                  from active counts / export.
//   MARK_NEEDS_REVALIDATION      — linked to plan but content may be
//                                  stale (e.g. re-analysis changed the
//                                  source requirements feeding it).
//
// The reconciler is a pure function (no DB) so we can test the matching
// logic exhaustively. A thin applier maps actions to prisma writes.

import type { SubmissionPlan, SubmissionPlanFile, GeneratedDocumentLike } from "./submission-plan";
import { COMPANY_PROFILE_DOC_NAME_RX } from "./document-type-normalizer";

export type ReconcileAction =
  | "KEEP_AS_PLANNED"
  | "RELINK_TO_PLAN"
  | "MARK_SUPERSEDED"
  | "MARK_NEEDS_REVALIDATION";

export type ReconcileDecision = {
  documentId: string;
  documentName: string;
  action: ReconcileAction;
  /** When action is RELINK_TO_PLAN, the canonicalId of the target plan file. */
  matchedPlanFileId?: string;
  matchedPlanFileName?: string;
  /** Why the reconciler picked this action (for audit log + UI tooltip). */
  rationale: string;
};

// ─── Key normalisation ───────────────────────────────────────────────

function normalise(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")           // drop extension
    .replace(/[_\-.]/g, " ")           // separators → space
    .replace(/[^\w\s]/g, "")           // strip punctuation
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

function tokenise(value: string): Set<string> {
  return new Set(normalise(value).split(/\s+/).filter((t) => t.length >= 3));
}

/** Jaccard similarity over token sets. 0.0–1.0 inclusive. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Semantic category inference ─────────────────────────────────────

/**
 * Lightweight semantic category — different from the submission-plan
 * classifier (which classifies REQUIREMENT rows). Here we bucket
 * GENERATED DOCUMENT names into broad themes so a doc named
 * "Financial capacity and audited statement evidence.pdf" still maps to
 * a plan file named "Audited Financial Statements" even though the
 * exact-name match fails.
 */
const SEMANTIC_CATEGORIES: Array<{ id: string; test: RegExp }> = [
  { id: "FINANCIAL_EVIDENCE",    test: /\b(financial|audited|turnover|revenue|profit|loss|capacity)\b/i },
  { id: "LEGAL_REGISTRATION",    test: /\b(legal|registration|incorporation|licen[cs]e|tin|vat|tax\s+clearance|grade\s+certificate|good\s+standing)\b/i },
  { id: "SUBMISSION_METHOD",     test: /\b(submission\s+method|deadline|delivery|portal|email\s+recipients?|envelope|where\s+to\s+submit)\b/i },
  { id: "TENDER_FORMS",          test: /\b(tender\s+forms?|forms?\s+and\s+templates|bid\s+form|price\s+schedule|schedule\s+of\s+(prices?|rates)|annexure|attachment\s+\d)\b/i },
  { id: "TECHNICAL_PROPOSAL",    test: /\b(technical\s+proposal|methodology|work\s+plan|approach\s+and\s+methodology|implementation\s+plan)\b/i },
  { id: "FINANCIAL_PROPOSAL",    test: /\b(financial\s+proposal|price\s+proposal|commercial\s+proposal|priced\s+offer)\b/i },
  { id: "COMPANY_PROFILE",       test: COMPANY_PROFILE_DOC_NAME_RX },
  { id: "EXPERT_CV",             test: /\b(expert\s+cvs?|cv\s+package|curriculum\s+vitae|key\s+experts?)\b/i },
  { id: "PROJECT_EXPERIENCE",    test: /\b(project\s+experience|relevant\s+experience|past\s+performance|reference\s+projects)\b/i },
  { id: "COVER_LETTER",          test: /\b(cover\s+letter|covering\s+letter|letter\s+of\s+transmittal)\b/i },
  { id: "BID_BOND",              test: /\b(bid\s+bond|tender\s+security|earnest\s+money|emd)\b/i },
  { id: "COMPLIANCE_DECLARATION",test: /\b(declaration|undertaking|integrity\s+pact|self[-\s]declaration|power\s+of\s+attorney)\b/i },
];

/**
 * Exported for the differential classifier test: the ONE semantic bucket
 * both the reconciler and the generate route must agree on through
 * COMPANY_PROFILE_DOC_NAME_RX (lib/engine/document-type-normalizer.ts).
 */
export function semanticCategory(text: string): string | null {
  for (const cat of SEMANTIC_CATEGORIES) {
    if (cat.test.test(text)) return cat.id;
  }
  return null;
}

// ─── Plan-file lookup keys ───────────────────────────────────────────

function planKeysFor(file: SubmissionPlanFile): { exactKey: string; normalisedKey: string; tokens: Set<string>; semanticId: string | null; docType: string } {
  const exactKey = (file.exactFileName ?? "").trim().toLowerCase();
  const normalisedKey = normalise(file.exactFileName);
  const text = `${file.exactFileName} ${file.documentType ?? ""}`.trim();
  return {
    exactKey,
    normalisedKey,
    tokens: tokenise(text),
    semanticId: semanticCategory(text),
    docType: (file.documentType ?? "").trim().toUpperCase(),
  };
}

function docKeysFor(doc: GeneratedDocumentLike): { exactKey: string; normalisedKey: string; tokens: Set<string>; semanticId: string | null; docType: string } {
  const exactKey = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
  const normalisedKey = normalise(doc.exactFileName ?? doc.name);
  const text = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""}`.trim();
  return {
    exactKey,
    normalisedKey,
    tokens: tokenise(text),
    semanticId: semanticCategory(text),
    docType: (doc.documentType ?? "").trim().toUpperCase(),
  };
}

// ─── Reconciler ──────────────────────────────────────────────────────

export type ReconcileInput = {
  plan: SubmissionPlan;
  generatedDocuments: GeneratedDocumentLike[];
  /**
   * Threshold for the token-Jaccard fallback match (0..1). Default 0.45 —
   * high enough to avoid false positives on short titles, low enough to
   * accept synonym variation ("Financial capacity..." ≈ "Audited Financial
   * Statements").
   */
  jaccardThreshold?: number;
};

/**
 * Reconcile each generated document against the current plan.
 *
 * Resolution order per document:
 *   1. Exact filename match              → KEEP_AS_PLANNED
 *   2. Normalised filename match         → KEEP_AS_PLANNED
 *   3. documentType match (one plan file only)
 *                                        → RELINK_TO_PLAN (NEEDS_REVALIDATION)
 *   4. Semantic category match (one plan file only)
 *                                        → RELINK_TO_PLAN
 *   5. Token-Jaccard ≥ threshold to a single plan file
 *                                        → RELINK_TO_PLAN
 *   6. Otherwise                         → MARK_SUPERSEDED
 *
 * "One plan file only" means we won't relink ambiguously — when multiple
 * plan files share a category, the doc stays SUPERSEDED so a human picks.
 */
export function reconcileGeneratedDocuments(input: ReconcileInput): ReconcileDecision[] {
  const threshold = input.jaccardThreshold ?? 0.45;
  const planFiles = input.plan.files.map((file) => ({ file, keys: planKeysFor(file) }));

  const decisions: ReconcileDecision[] = [];

  for (const doc of input.generatedDocuments) {
    const dk = docKeysFor(doc);
    const docId = doc.id ?? "";
    const docName = doc.name ?? doc.exactFileName ?? "(unnamed)";

    // 1. Exact filename match
    const exact = planFiles.find((p) => p.keys.exactKey && p.keys.exactKey === dk.exactKey);
    if (exact) {
      decisions.push({
        documentId: docId,
        documentName: docName,
        action: "KEEP_AS_PLANNED",
        matchedPlanFileId: exact.file.canonicalId,
        matchedPlanFileName: exact.file.exactFileName,
        rationale: "Exact filename matches the current submission plan.",
      });
      continue;
    }

    // 2. Normalised filename match
    const normMatch = planFiles.find((p) => p.keys.normalisedKey && p.keys.normalisedKey === dk.normalisedKey);
    if (normMatch) {
      decisions.push({
        documentId: docId,
        documentName: docName,
        action: "KEEP_AS_PLANNED",
        matchedPlanFileId: normMatch.file.canonicalId,
        matchedPlanFileName: normMatch.file.exactFileName,
        rationale: "Normalised filename matches the current submission plan (ignoring case/extension/separators).",
      });
      continue;
    }

    // 3. documentType match — only when EXACTLY one plan file has this type
    if (dk.docType.length > 0) {
      const typeMatches = planFiles.filter((p) => p.keys.docType === dk.docType);
      if (typeMatches.length === 1) {
        decisions.push({
          documentId: docId,
          documentName: docName,
          action: "RELINK_TO_PLAN",
          matchedPlanFileId: typeMatches[0].file.canonicalId,
          matchedPlanFileName: typeMatches[0].file.exactFileName,
          rationale: `documentType="${dk.docType}" uniquely matches the planned file.`,
        });
        continue;
      }
    }

    // 4. Semantic category — only when EXACTLY one plan file shares the category
    if (dk.semanticId) {
      const semMatches = planFiles.filter((p) => p.keys.semanticId === dk.semanticId);
      if (semMatches.length === 1) {
        decisions.push({
          documentId: docId,
          documentName: docName,
          action: "RELINK_TO_PLAN",
          matchedPlanFileId: semMatches[0].file.canonicalId,
          matchedPlanFileName: semMatches[0].file.exactFileName,
          rationale: `Semantic category "${dk.semanticId}" uniquely matches a planned file.`,
        });
        continue;
      }
    }

    // 5. Token-Jaccard — only when EXACTLY one plan file scores ≥ threshold
    let bestPair: { file: SubmissionPlanFile; score: number } | null = null;
    let tied = false;
    for (const p of planFiles) {
      const score = jaccard(dk.tokens, p.keys.tokens);
      if (score < threshold) continue;
      if (!bestPair || score > bestPair.score) {
        bestPair = { file: p.file, score };
        tied = false;
      } else if (bestPair && Math.abs(score - bestPair.score) < 1e-6) {
        tied = true;
      }
    }
    if (bestPair && !tied) {
      decisions.push({
        documentId: docId,
        documentName: docName,
        action: "RELINK_TO_PLAN",
        matchedPlanFileId: bestPair.file.canonicalId,
        matchedPlanFileName: bestPair.file.exactFileName,
        rationale: `Token similarity ${(bestPair.score * 100).toFixed(0)}% matches a single planned file.`,
      });
      continue;
    }

    // 6. No link found
    decisions.push({
      documentId: docId,
      documentName: docName,
      action: "MARK_SUPERSEDED",
      rationale: "No exact, normalised, documentType, semantic, or token match to any current planned file — likely produced before the plan changed.",
    });
  }

  return decisions;
}

// ─── DB applier (thin) ───────────────────────────────────────────────

/**
 * Apply reconciler decisions to GeneratedDocument rows via prisma.
 *
 * Type-loose on the prisma client so this module stays in lib/engine and
 * doesn't import @prisma/client (keeps the pure reconciler above
 * dependency-free for tests).
 */
export type ReconcilePrismaClient = {
  generatedDocument: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export type ApplyReconcileResult = {
  kept: number;
  relinked: number;
  superseded: number;
  needsRevalidation: number;
};

export async function applyReconcileDecisions(client: ReconcilePrismaClient, decisions: ReconcileDecision[]): Promise<ApplyReconcileResult> {
  let kept = 0;
  let relinked = 0;
  let superseded = 0;
  let needsRevalidation = 0;

  for (const decision of decisions) {
    if (!decision.documentId) continue;
    switch (decision.action) {
      case "KEEP_AS_PLANNED":
        kept += 1;
        // No-op — leave row as-is.
        break;
      case "RELINK_TO_PLAN":
        // Update the exactFileName to the plan's name and mark the doc
        // as NEEDS_REVALIDATION so the user re-reviews the content.
        await client.generatedDocument.update({
          where: { id: decision.documentId },
          data: {
            exactFileName: decision.matchedPlanFileName ?? null,
            validationStatus: "NEEDS_REVALIDATION",
            reviewNotes: `Auto-relinked to "${decision.matchedPlanFileName}" by submission-plan reconciliation. Reason: ${decision.rationale}`,
          },
        });
        relinked += 1;
        needsRevalidation += 1;
        break;
      case "MARK_SUPERSEDED":
        await client.generatedDocument.update({
          where: { id: decision.documentId },
          data: {
            generationStatus: "SUPERSEDED",
            validationStatus: "SUPERSEDED",
            reviewNotes: `Marked SUPERSEDED by submission-plan reconciliation. Reason: ${decision.rationale}`,
          },
        });
        superseded += 1;
        break;
      case "MARK_NEEDS_REVALIDATION":
        await client.generatedDocument.update({
          where: { id: decision.documentId },
          data: {
            validationStatus: "NEEDS_REVALIDATION",
            reviewNotes: `Marked NEEDS_REVALIDATION by submission-plan reconciliation. Reason: ${decision.rationale}`,
          },
        });
        needsRevalidation += 1;
        break;
    }
  }

  return { kept, relinked, superseded, needsRevalidation };
}
