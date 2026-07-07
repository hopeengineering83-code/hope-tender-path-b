/**
 * Backfill TenderFactsLedger from legacy Tender scalar columns.
 *
 * This script is idempotent: it only creates ledger entries for semanticKeys
 * that don't already exist for a given tender. Run it once after deploying
 * the TenderFactsLedger migration to populate the ledger from existing
 * Tender scalars. Safe to re-run — skips tenders that already have ledger
 * entries for a given key.
 *
 * USAGE:
 *   npx tsx scripts/backfill-tender-facts-ledger.ts
 *
 * The script does NOT modify any existing Tender scalar columns, does NOT
 * run migrations, and does NOT touch AI settings. It only INSERTs new rows
 * into TenderFactsLedger.
 */

import { prisma, prismaReady } from "../lib/prisma";
import { createHash } from "node:crypto";
import { normalizeSubmissionMethod } from "../lib/engine/submission-method-policy";
import {
  isValidReferenceNumber,
  isValidClientName,
  containsMetadataPlaceholder,
} from "../lib/engine/metadata-validators";

async function backfill() {
  await prismaReady;

  const tenders = await prisma.tender.findMany({
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
    },
  });

  console.log(`Backfilling TenderFactsLedger for ${tenders.length} tender(s)...`);

  let created = 0;
  let skipped = 0;

  for (const tender of tenders) {
    // Load existing ledger entries for this tender
    const existing = await prisma.tenderFactsLedger.findMany({
      where: { tenderId: tender.id },
      select: { semanticKey: true },
    });
    const existingKeys = new Set(existing.map((e) => e.semanticKey));

    const entries: Array<{
      semanticKey: string;
      displayLabel: string;
      category: string;
      valueType: string;
      normalizedValue: string | null;
      rawSourceValue: string | null;
      authorityState: string;
      confidence: number;
      relevance: string;
      createdBy: string;
    }> = [];

    // ── title ──────────────────────────────────────────────────────
    if (tender.title && !existingKeys.has("title")) {
      entries.push({
        semanticKey: "title",
        displayLabel: "Tender Title",
        category: "tender-identity",
        valueType: "TEXT",
        normalizedValue: tender.title,
        rawSourceValue: tender.title,
        authorityState: "SOURCE_GROUNDED_CONFIRMED",
        confidence: 0.8,
        relevance: "critical",
        createdBy: tender.userId,
      });
    }

    // ── reference ──────────────────────────────────────────────────
    if (tender.reference && !existingKeys.has("reference")) {
      if (isValidReferenceNumber(tender.reference)) {
        entries.push({
          semanticKey: "reference",
          displayLabel: "Reference Number",
          category: "tender-identity",
          valueType: "TEXT",
          normalizedValue: tender.reference,
          rawSourceValue: tender.reference,
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          confidence: 0.8,
          relevance: "informational",
          createdBy: tender.userId,
        });
      }
    }

    // ── clientName / procuringEntityName ───────────────────────────
    const clientName = tender.procuringEntityName ?? tender.clientName;
    if (clientName && !existingKeys.has("clientName")) {
      if (isValidClientName(clientName) && !containsMetadataPlaceholder(clientName)) {
        entries.push({
          semanticKey: "clientName",
          displayLabel: "Client Name",
          category: "procuring-entity",
          valueType: "TEXT",
          normalizedValue: clientName,
          rawSourceValue: clientName,
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          confidence: 0.8,
          relevance: "critical",
          createdBy: tender.userId,
        });
      }
    }

    // ── deadline ───────────────────────────────────────────────────
    if (tender.deadline && !existingKeys.has("deadline")) {
      entries.push({
        semanticKey: "deadline",
        displayLabel: "Submission Deadline",
        category: "submission",
        valueType: "DATE",
        normalizedValue: tender.deadline.toISOString().split("T")[0],
        rawSourceValue: tender.deadline.toISOString(),
        authorityState: "SOURCE_GROUNDED_CONFIRMED",
        confidence: 0.8,
        relevance: "critical",
        createdBy: tender.userId,
      });
    }

    // ── submissionMethod ───────────────────────────────────────────
    if (tender.submissionMethod && !existingKeys.has("submissionMethod")) {
      const normalized = normalizeSubmissionMethod(tender.submissionMethod);
      if (normalized !== "UNKNOWN") {
        entries.push({
          semanticKey: "submissionMethod",
          displayLabel: "Submission Method",
          category: "submission",
          valueType: "ENUM",
          normalizedValue: normalized,
          rawSourceValue: tender.submissionMethod,
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          confidence: 0.8,
          relevance: "critical",
          createdBy: tender.userId,
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
        entries.push({
          semanticKey: "submissionEmails",
          displayLabel: "Submission Emails",
          category: "submission",
          valueType: "EMAIL_LIST",
          normalizedValue: emails.join(", "),
          rawSourceValue: tender.submissionEmails,
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          confidence: 0.8,
          relevance: "critical",
          createdBy: tender.userId,
        });
      }
    }

    // ── submissionAddress ──────────────────────────────────────────
    if (tender.submissionAddress && !existingKeys.has("submissionAddress")) {
      if (!containsMetadataPlaceholder(tender.submissionAddress)) {
        entries.push({
          semanticKey: "submissionAddress",
          displayLabel: "Submission Address",
          category: "submission",
          valueType: "ADDRESS",
          normalizedValue: tender.submissionAddress,
          rawSourceValue: tender.submissionAddress,
          authorityState: "SOURCE_GROUNDED_CONFIRMED",
          confidence: 0.7,
          relevance: "informational",
          createdBy: tender.userId,
        });
      }
    }

    // ── country ────────────────────────────────────────────────────
    if (tender.country && !existingKeys.has("country")) {
      entries.push({
        semanticKey: "country",
        displayLabel: "Country",
        category: "site-location",
        valueType: "TEXT",
        normalizedValue: tender.country,
        rawSourceValue: tender.country,
        authorityState: "SOURCE_GROUNDED_CONFIRMED",
        confidence: 0.8,
        relevance: "informational",
        createdBy: tender.userId,
      });
    }

    // ── category ───────────────────────────────────────────────────
    if (tender.category && !existingKeys.has("category")) {
      entries.push({
        semanticKey: "category",
        displayLabel: "Tender Category",
        category: "tender-identity",
        valueType: "TEXT",
        normalizedValue: tender.category,
        rawSourceValue: tender.category,
        authorityState: "SOURCE_GROUNDED_CONFIRMED",
        confidence: 0.7,
        relevance: "informational",
        createdBy: tender.userId,
      });
    }

    // Insert all new entries for this tender in a transaction
    if (entries.length > 0) {
      try {
        await prisma.$transaction(
          entries.map((entry) =>
            prisma.tenderFactsLedger.create({
              data: {
                tenderId: tender.id,
                ...entry,
              },
            }),
          ),
        );
        created += entries.length;
        console.log(`  ✓ Tender ${tender.id}: +${entries.length} ledger entries`);
      } catch (err) {
        console.error(`  ✗ Tender ${tender.id}: backfill failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nBackfill complete: ${created} entries created, ${skipped} tenders skipped (already had entries).`);
  await prisma.$disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
