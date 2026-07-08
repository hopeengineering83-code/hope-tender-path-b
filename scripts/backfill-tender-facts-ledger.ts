/**
 * Backfill TenderFactsLedger from legacy Tender scalar columns.
 *
 * SAFETY:
 *   • Default mode is DRY-RUN — no writes unless --apply is passed.
 *   • Never labels legacy data as SOURCE_GROUNDED_CONFIRMED without
 *     verified source evidence. Uses CANDIDATE_NEEDS_REVIEW (the existing
 *     non-authoritative/unverified provenance state) for legacy scalars
 *     that lack source-file/page/quote evidence.
 *   • Idempotent: skips semanticKeys that already exist for a tender.
 *   • Does NOT modify Tender scalar columns.
 *   • Does NOT run migrations or touch AI settings.
 *   • Does NOT create a duplicate TenderFact table.
 *
 * USAGE:
 *   npx tsx scripts/backfill-tender-facts-ledger.ts              # dry-run (default)
 *   npx tsx scripts/backfill-tender-facts-ledger.ts --apply      # apply (non-production only)
 *
 * The --apply flag is refused when NODE_ENV=production to prevent
 * accidental production execution. Use an explicit staging/dev
 * environment to run the backfill, then verify the results before
 * pointing the script at production.
 */

import { prisma, prismaReady } from "../lib/prisma";
import { normalizeSubmissionMethod } from "../lib/engine/submission-method-policy";
import {
  isValidReferenceNumber,
  isValidClientName,
  containsMetadataPlaceholder,
} from "../lib/engine/metadata-validators";

// ─── Authority state for legacy scalars ──────────────────────────────────────
// Legacy Tender scalar columns don't carry source-file/page/quote evidence.
// They MUST NOT be labeled SOURCE_GROUNDED_CONFIRMED — that state is reserved
// for facts with verified source evidence (active file + page + contained quote).
//
// The existing non-authoritative state is CANDIDATE_NEEDS_REVIEW — the fact
// has a value but needs human review before it can be promoted to a grounded
// or confirmed state. This is the safest default for legacy data.
const LEGACY_AUTHORITY_STATE = "CANDIDATE_NEEDS_REVIEW";

async function backfill() {
  const isApply = process.argv.includes("--apply");
  const isProduction = process.env.NODE_ENV === "production";

  // ── Flag parsing ────────────────────────────────────────────────────────
  // --tender-id <id>   : limit to a specific tender (for targeted staging repair)
  // --limit <n>        : limit the number of tenders to process (for safe staged runs)
  // --updated-after <iso>: only process tenders updated after this date
  const tenderIdFlag = (() => {
    const idx = process.argv.indexOf("--tender-id");
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  })();
  const limitFlag = (() => {
    const idx = process.argv.indexOf("--limit");
    return idx >= 0 ? parseInt(process.argv[idx + 1] ?? "0", 10) : undefined;
  })();
  const updatedAfterFlag = (() => {
    const idx = process.argv.indexOf("--updated-after");
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  })();

  console.log("=== TenderFactsLedger Backfill ===");
  console.log(`Mode: ${isApply ? "APPLY" : "DRY-RUN (no writes)"}`);
  console.log(`Environment: ${process.env.NODE_ENV ?? "(unset)"}`);
  if (tenderIdFlag) console.log(`Filter: tender-id=${tenderIdFlag}`);
  if (limitFlag) console.log(`Limit: ${limitFlag} tender(s)`);
  if (updatedAfterFlag) console.log(`Updated after: ${updatedAfterFlag}`);

  if (isApply && isProduction) {
    console.error("\n✗ REFUSED: --apply is not allowed in NODE_ENV=production.");
    console.error("  Run this script in a staging/dev environment, verify the");
    console.error("  results, then manually apply to production after review.");
    process.exit(1);
  }

  await prismaReady;

  // Build where clause from flags
  const where: { id?: string; updatedAt?: { gt: Date } } = {};
  if (tenderIdFlag) {
    where.id = tenderIdFlag;
  }
  if (updatedAfterFlag) {
    const d = new Date(updatedAfterFlag);
    if (!isNaN(d.getTime())) {
      where.updatedAt = { gt: d };
    }
  }

  const tenders = await prisma.tender.findMany({
    where,
    ...(limitFlag && limitFlag > 0 ? { take: limitFlag } : {}),
    select: {
      id: true,
      title: true,
      reference: true,
      clientName: true,
      procuringEntityName: true,
      deadline: true,
      submissionMethod: true,
      submissionEmails: true,
      submissionAddress: true,
      country: true,
      category: true,
      userId: true,
      // Source evidence columns — if these are populated, the fact has
      // verified source grounding and CAN use SOURCE_GROUNDED_CONFIRMED.
      clientNameSourceFileId: true,
      clientNameSourcePage: true,
      clientNameSourceQuote: true,
      deadlineSourceFileId: true,
      deadlineSourcePage: true,
      deadlineSourceQuote: true,
      titleSourceFileId: true,
      titleSourcePage: true,
      titleSourceQuote: true,
      referenceSourceFileId: true,
      referenceSourcePage: true,
      referenceSourceQuote: true,
      submissionMethodSourceFileId: true,
      submissionMethodSourcePage: true,
      submissionMethodSourceQuote: true,
    },
  });

  console.log(`\nScanning ${tenders.length} tender(s)...`);

  let totalCandidates = 0;
  let totalSkipped = 0;
  let totalGrounded = 0;
  let totalCandidate = 0;
  const skippedTenders: Array<{ tenderId: string; reason: string }> = [];

  for (const tender of tenders) {
    const existing = await prisma.tenderFactsLedger.findMany({
      where: { tenderId: tender.id },
      select: { semanticKey: true },
    });
    const existingKeys = new Set(existing.map((e) => e.semanticKey));

    type CandidateEntry = {
      semanticKey: string;
      displayLabel: string;
      category: string;
      valueType: string;
      normalizedValue: string | null;
      rawSourceValue: string | null;
      authorityState: string;
      confidence: number;
      relevance: string;
      sourceFileId: string | null;
      sourcePage: number | null;
      sourceQuote: string | null;
    };

    const entries: CandidateEntry[] = [];

    // Helper: determine authority state based on whether source evidence exists
    function resolveAuthority(
      sourceFileId: string | null,
      sourcePage: number | null,
      sourceQuote: string | null,
    ): { authorityState: string; sourceFileId: string | null; sourcePage: number | null; sourceQuote: string | null } {
      if (sourceFileId && sourcePage !== null && sourceQuote) {
        totalGrounded++;
        return {
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          sourceFileId,
          sourcePage,
          sourceQuote,
        };
      }
      totalCandidate++;
      return {
        authorityState: LEGACY_AUTHORITY_STATE,
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
      };
    }

    // ── title ──────────────────────────────────────────────────────
    if (tender.title && !existingKeys.has("title")) {
      const auth = resolveAuthority(tender.titleSourceFileId, tender.titleSourcePage, tender.titleSourceQuote);
      entries.push({
        semanticKey: "title",
        displayLabel: "Tender Title",
        category: "tender-identity",
        valueType: "TEXT",
        normalizedValue: tender.title,
        rawSourceValue: tender.title,
        authorityState: auth.authorityState,
        confidence: auth.authorityState === "SOURCE_GROUNDED_CONFIRMED" ? 0.8 : 0.5,
        relevance: "critical",
        sourceFileId: auth.sourceFileId,
        sourcePage: auth.sourcePage,
        sourceQuote: auth.sourceQuote,
      });
    }

    // ── reference ──────────────────────────────────────────────────
    if (tender.reference && !existingKeys.has("reference")) {
      if (isValidReferenceNumber(tender.reference)) {
        const auth = resolveAuthority(tender.referenceSourceFileId, tender.referenceSourcePage, tender.referenceSourceQuote);
        entries.push({
          semanticKey: "reference",
          displayLabel: "Reference Number",
          category: "tender-identity",
          valueType: "TEXT",
          normalizedValue: tender.reference,
          rawSourceValue: tender.reference,
          authorityState: auth.authorityState,
          confidence: auth.authorityState === "SOURCE_GROUNDED_CONFIRMED" ? 0.8 : 0.5,
          relevance: "informational",
          sourceFileId: auth.sourceFileId,
          sourcePage: auth.sourcePage,
          sourceQuote: auth.sourceQuote,
        });
      }
    }

    // ── clientName / procuringEntityName ───────────────────────────
    const clientName = tender.procuringEntityName ?? tender.clientName;
    if (clientName && !existingKeys.has("clientName")) {
      if (isValidClientName(clientName) && !containsMetadataPlaceholder(clientName)) {
        const auth = resolveAuthority(tender.clientNameSourceFileId, tender.clientNameSourcePage, tender.clientNameSourceQuote);
        entries.push({
          semanticKey: "clientName",
          displayLabel: "Client Name",
          category: "procuring-entity",
          valueType: "TEXT",
          normalizedValue: clientName,
          rawSourceValue: clientName,
          authorityState: auth.authorityState,
          confidence: auth.authorityState === "SOURCE_GROUNDED_CONFIRMED" ? 0.8 : 0.5,
          relevance: "critical",
          sourceFileId: auth.sourceFileId,
          sourcePage: auth.sourcePage,
          sourceQuote: auth.sourceQuote,
        });
      }
    }

    // ── deadline ───────────────────────────────────────────────────
    if (tender.deadline && !existingKeys.has("deadline")) {
      const auth = resolveAuthority(tender.deadlineSourceFileId, tender.deadlineSourcePage, tender.deadlineSourceQuote);
      entries.push({
        semanticKey: "deadline",
        displayLabel: "Submission Deadline",
        category: "submission",
        valueType: "DATE",
        normalizedValue: tender.deadline.toISOString().split("T")[0],
        rawSourceValue: tender.deadline.toISOString(),
        authorityState: auth.authorityState,
        confidence: auth.authorityState === "SOURCE_GROUNDED_CONFIRMED" ? 0.8 : 0.5,
        relevance: "critical",
        sourceFileId: auth.sourceFileId,
        sourcePage: auth.sourcePage,
        sourceQuote: auth.sourceQuote,
      });
    }

    // ── submissionMethod ───────────────────────────────────────────
    if (tender.submissionMethod && !existingKeys.has("submissionMethod")) {
      const normalized = normalizeSubmissionMethod(tender.submissionMethod);
      if (normalized !== "UNKNOWN") {
        const auth = resolveAuthority(tender.submissionMethodSourceFileId, tender.submissionMethodSourcePage, tender.submissionMethodSourceQuote);
        entries.push({
          semanticKey: "submissionMethod",
          displayLabel: "Submission Method",
          category: "submission",
          valueType: "ENUM",
          normalizedValue: normalized,
          rawSourceValue: tender.submissionMethod,
          authorityState: auth.authorityState,
          confidence: auth.authorityState === "SOURCE_GROUNDED_CONFIRMED" ? 0.8 : 0.5,
          relevance: "critical",
          sourceFileId: auth.sourceFileId,
          sourcePage: auth.sourcePage,
          sourceQuote: auth.sourceQuote,
        });
      }
    }

    // ── submissionEmails ───────────────────────────────────────────
    if (tender.submissionEmails && !existingKeys.has("submissionEmails")) {
      const emails = tender.submissionEmails
        .split("|")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      if (emails.length > 0) {
        // No source evidence columns for submissionEmails specifically —
        // use the unverified state.
        totalCandidate++;
        entries.push({
          semanticKey: "submissionEmails",
          displayLabel: "Submission Emails",
          category: "submission",
          valueType: "EMAIL_LIST",
          normalizedValue: emails.join(", "),
          rawSourceValue: tender.submissionEmails,
          authorityState: LEGACY_AUTHORITY_STATE,
          confidence: 0.5,
          relevance: "critical",
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
        });
      }
    }

    // ── submissionAddress ──────────────────────────────────────────
    if (tender.submissionAddress && !existingKeys.has("submissionAddress")) {
      if (!containsMetadataPlaceholder(tender.submissionAddress)) {
        // No source evidence columns for submissionAddress — use unverified.
        totalCandidate++;
        entries.push({
          semanticKey: "submissionAddress",
          displayLabel: "Submission Address",
          category: "submission",
          valueType: "ADDRESS",
          normalizedValue: tender.submissionAddress,
          rawSourceValue: tender.submissionAddress,
          authorityState: LEGACY_AUTHORITY_STATE,
          confidence: 0.5,
          relevance: "informational",
          sourceFileId: null,
          sourcePage: null,
          sourceQuote: null,
        });
      }
    }

    // ── country ────────────────────────────────────────────────────
    if (tender.country && !existingKeys.has("country")) {
      // No source evidence columns for country — use unverified.
      totalCandidate++;
      entries.push({
        semanticKey: "country",
        displayLabel: "Country",
        category: "site-location",
        valueType: "TEXT",
        normalizedValue: tender.country,
        rawSourceValue: tender.country,
        authorityState: LEGACY_AUTHORITY_STATE,
        confidence: 0.5,
        relevance: "informational",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
      });
    }

    // ── category ───────────────────────────────────────────────────
    if (tender.category && !existingKeys.has("category")) {
      // No source evidence columns for category — use unverified.
      totalCandidate++;
      entries.push({
        semanticKey: "category",
        displayLabel: "Tender Category",
        category: "tender-identity",
        valueType: "TEXT",
        normalizedValue: tender.category,
        rawSourceValue: tender.category,
        authorityState: LEGACY_AUTHORITY_STATE,
        confidence: 0.5,
        relevance: "informational",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
      });
    }

    totalCandidates += entries.length;

    if (entries.length === 0) {
      totalSkipped++;
      skippedTenders.push({ tenderId: tender.id, reason: "all keys already exist or values invalid/empty" });
      continue;
    }

    if (isApply) {
      try {
        await prisma.$transaction(
          entries.map((entry) =>
            prisma.tenderFactsLedger.create({
              data: {
                tenderId: tender.id,
                ...entry,
                createdBy: tender.userId,
              },
            }),
          ),
        );
        console.log(`  ✓ Tender ${tender.id}: +${entries.length} entries (${entries.filter(e => e.authorityState === "SOURCE_GROUNDED_CONFIRMED").length} grounded, ${entries.filter(e => e.authorityState === LEGACY_AUTHORITY_STATE).length} candidate)`);
      } catch (err) {
        console.error(`  ✗ Tender ${tender.id}: backfill failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log(`  [DRY-RUN] Tender ${tender.id}: would create ${entries.length} entries (${entries.filter(e => e.authorityState === "SOURCE_GROUNDED_CONFIRMED").length} grounded, ${entries.filter(e => e.authorityState === LEGACY_AUTHORITY_STATE).length} candidate)`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Tenders scanned: ${tenders.length}`);
  console.log(`Tenders skipped (all keys exist): ${totalSkipped}`);
  console.log(`Total candidate entries: ${totalCandidates}`);
  console.log(`  - SOURCE_GROUNDED_CONFIRMED (has evidence): ${totalGrounded}`);
  console.log(`  - CANDIDATE_NEEDS_REVIEW (no evidence, needs review): ${totalCandidate}`);
  console.log(`Mode: ${isApply ? "APPLY (writes performed)" : "DRY-RUN (no writes)"}`);

  // ── JSON summary artifact (stdout) ──────────────────────────────────────
  // Write a machine-readable JSON summary so CI/staging can capture and
  // archive the backfill result. The summary includes all skipped reasons
  // so operators can audit what was rejected and why.
  const summary = {
    timestamp: new Date().toISOString(),
    mode: isApply ? "APPLY" : "DRY-RUN",
    environment: process.env.NODE_ENV ?? "(unset)",
    filters: {
      tenderId: tenderIdFlag ?? null,
      limit: limitFlag ?? null,
      updatedAfter: updatedAfterFlag ?? null,
    },
    totals: {
      tendersScanned: tenders.length,
      tendersSkipped: totalSkipped,
      candidateEntries: totalCandidates,
      grounded: totalGrounded,
      candidate: totalCandidate,
    },
    skippedTenders,
  };
  console.log(`\n=== JSON Summary ===`);
  console.log(JSON.stringify(summary, null, 2));

  if (!isApply) {
    console.log(`\nTo apply these changes, run: npx tsx scripts/backfill-tender-facts-ledger.ts --apply`);
    console.log(`(Only allowed in non-production environments)`);
    console.log(`\nFor targeted staging repair: npx tsx scripts/backfill-tender-facts-ledger.ts --apply --tender-id <id>`);
    console.log(`For safe staged runs: npx tsx scripts/backfill-tender-facts-ledger.ts --apply --limit 10`);
  }

  await prisma.$disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
