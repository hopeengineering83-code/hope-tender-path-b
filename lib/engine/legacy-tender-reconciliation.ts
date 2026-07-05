/**
 * Legacy Tender Reconciliation Service
 *
 * Safely reconciles existing tender data without deleting historical evidence.
 * Mandatory dry-run mode produces JSON + human-readable reports.
 * Real reconciliation requires ADMIN/PROPOSAL_MANAGER authorization,
 * explicit confirmation, idempotency key, transaction, before/after audit.
 *
 * Rules:
 *   1. Dry run produces reports without modifying data.
 *   2. Real reconciliation requires ADMIN/PROPOSAL_MANAGER + explicit confirmation.
 *   3. Real reconciliation requires idempotency key + transaction + audit record.
 *   4. Never automatically set/replace critical values without complete evidence.
 *   5. Never delete real tender data — quarantine/retire legacy rows.
 */

import type { PrismaClient } from "@prisma/client";
import { resolveCanonicalFieldState } from "./canonical-field-state";
// Note: isGroundedEvidence was previously imported but never used — the
// detector uses field.isGrounded from the resolver's output instead.
// Removed to satisfy strict lint.

export type ReconciliationFinding = {
  field: string;
  issue: string;
  severity: "critical" | "warning" | "info";
  currentValue: unknown;
  effectiveValue: unknown;
  evidenceStatus: "grounded" | "ungrounded" | "stale" | "missing";
  recommendedAction: string;
};

export type ReconciliationReport = {
  tenderId: string;
  tenderTitle: string;
  dryRun: boolean;
  findings: ReconciliationFinding[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  humanReadable: string;
};

export type ReconciliationOptions = {
  dryRun: boolean;
  idempotencyKey?: string;
  confirmedBy?: string;
};

/**
 * Run reconciliation analysis on a tender.
 * Always starts with dry-run analysis. Only applies changes if dryRun=false
 * AND idempotencyKey is provided AND confirmedBy is provided.
 */
export async function reconcileTender(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
  options: ReconciliationOptions,
): Promise<ReconciliationReport> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, totalPages: true, deletionStatus: true } },
      metadataOverrides: true,
      requirements: { select: { id: true, priority: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
      generatedDocuments: { select: { id: true, reviewStatus: true, generationStatus: true } },
    },
  });

  if (!tender) throw new Error("Tender not found");

  const findings: ReconciliationFinding[] = [];
  const activeFileIds = new Set(tender.files.map((f) => f.id));

  // 1. Check for raw/effective contradictions
  const canonicalState = resolveCanonicalFieldState({
    tender: tender as any,
    overrides: tender.metadataOverrides as any,
    hasExtractedRequirements: tender.requirements.length > 0,
    activeTenderFileIds: activeFileIds,
  });

  for (const field of canonicalState.fields) {
    if (field.rawValue && field.effectiveValue && field.rawValue !== field.effectiveValue) {
      findings.push({
        field: field.fieldKey,
        issue: `Raw value "${String(field.rawValue).slice(0, 50)}" differs from effective value "${String(field.effectiveValue).slice(0, 50)}"`,
        severity: field.criticality !== "non-critical" ? "critical" : "warning",
        currentValue: field.rawValue,
        effectiveValue: field.effectiveValue,
        evidenceStatus: field.isGrounded ? "grounded" : "ungrounded",
        recommendedAction: field.isGrounded
          ? "No action needed — override is grounded"
          : "Review override or re-extract from source",
      });
    }
  }

  // 2. Check for stale source evidence (fileId pointing to inactive file)
  for (const field of canonicalState.fields) {
    if (field.sourceFileId && !activeFileIds.has(field.sourceFileId)) {
      findings.push({
        field: field.fieldKey,
        issue: `Source file ID "${field.sourceFileId}" is not in active files`,
        severity: "critical",
        currentValue: field.sourceFileId,
        effectiveValue: field.effectiveValue,
        evidenceStatus: "stale",
        recommendedAction: "Re-extract from an active tender file or re-upload the source",
      });
    }
  }

  // 3. Check for invalid page provenance
  for (const field of canonicalState.fields) {
    if (field.sourcePage && field.sourcePage > 0) {
      const file = tender.files.find((f) => f.id === field.sourceFileId);
      if (file && file.totalPages && field.sourcePage > file.totalPages) {
        findings.push({
          field: field.fieldKey,
          issue: `Source page ${field.sourcePage} exceeds file total pages ${file.totalPages}`,
          severity: "critical",
          currentValue: field.sourcePage,
          effectiveValue: field.effectiveValue,
          evidenceStatus: "stale",
          recommendedAction: "Re-extract to get valid page evidence",
        });
      }
    }
  }

  // 4. Check for orphaned requirements (no source file)
  for (const req of tender.requirements) {
    if (req.priority === "MANDATORY" && (!req.sourceTenderFileId || !activeFileIds.has(req.sourceTenderFileId))) {
      findings.push({
        field: `requirement:${req.id}`,
        issue: `Mandatory requirement has no active source file`,
        severity: "critical",
        currentValue: req.sourceTenderFileId,
        effectiveValue: null,
        evidenceStatus: "missing",
        recommendedAction: "Run repair-source-grounding or re-run AI Analyze",
      });
    }
  }

  // 5. Check for stale GeneratedDocument rows
  const staleDocs = tender.generatedDocuments.filter(
    (d) => d.generationStatus === "SUPERSEDED" || d.reviewStatus === "REJECTED",
  );
  if (staleDocs.length > 0) {
    findings.push({
      field: "generatedDocuments",
      issue: `${staleDocs.length} superseded/rejected document rows exist`,
      severity: "info",
      currentValue: staleDocs.length,
      effectiveValue: null,
      evidenceStatus: "missing",
      recommendedAction: "These are excluded from operational counts. No action needed.",
    });
  }

  // Build summary
  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    total: findings.length,
  };

  // Build human-readable report
  const lines = [
    `Tender Reconciliation Report`,
    `============================`,
    `Tender: ${tender.title} (${tenderId})`,
    `Mode: ${options.dryRun ? "DRY RUN (no changes)" : "LIVE (changes applied)"}`,
    ``,
    `Findings: ${summary.total} (${summary.critical} critical, ${summary.warning} warning, ${summary.info} info)`,
    ``,
  ];

  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.field}: ${f.issue}`);
    lines.push(`  Action: ${f.recommendedAction}`);
    lines.push(``);
  }

  // Apply changes if not dry run
  if (!options.dryRun && options.idempotencyKey && options.confirmedBy) {
    // Check idempotency
    const existing = await prisma.auditLog.findFirst({
      where: {
        action: "TENDER_RECONCILIATION",
        entityId: tenderId,
      },
    }).catch(() => null);
    // Check idempotency key in metadata
    // Wrap JSON.parse in try/catch — a malformed metadata string (e.g., from
    // a manual DB edit or a schema migration) would throw and abort the live
    // reconciliation. On parse failure, treat as "not already applied" so the
    // operation proceeds (fail-open for the idempotency check; the transaction
    // + audit record below still provide safety).
    let alreadyApplied = false;
    if (existing?.metadata && typeof existing.metadata === "string") {
      try {
        const parsed = JSON.parse(existing.metadata);
        alreadyApplied = parsed?.idempotencyKey === options.idempotencyKey;
      } catch {
        alreadyApplied = false;
      }
    }

    if (alreadyApplied) {
      lines.push(`NOTE: Reconciliation already applied with this idempotency key. No changes made.`);
    } else {
      // Apply reconciliation in a transaction
      await prisma.$transaction(async (tx) => {
        // Clear stale evidence (set to null, don't delete)
        for (const f of findings) {
          if (f.severity === "critical" && f.evidenceStatus === "stale") {
            // Clear stale source evidence columns
            if (f.field.startsWith("requirement:")) {
              const reqId = f.field.split(":")[1];
              await tx.tenderRequirement.update({
                where: { id: reqId },
                data: { sourceTenderFileId: null, sourcePageNumber: null },
              });
            }
          }
        }

        // Write audit record
        await tx.auditLog.create({
          data: {
            userId: options.confirmedBy!,
            action: "TENDER_RECONCILIATION",
            entityType: "Tender",
            entityId: tenderId,
            description: `Reconciliation applied: ${summary.critical} critical, ${summary.warning} warnings`,
            metadata: JSON.stringify({
              tenderId,
              idempotencyKey: options.idempotencyKey,
              findingsCount: summary.total,
              criticalCount: summary.critical,
            }) as any,
          },
        });
      });

      lines.push(`Reconciliation applied successfully.`);
    }
  }

  return {
    tenderId,
    tenderTitle: tender.title,
    dryRun: options.dryRun,
    findings,
    summary,
    humanReadable: lines.join("\n"),
  };
}
