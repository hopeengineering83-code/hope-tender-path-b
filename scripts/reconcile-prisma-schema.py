#!/usr/bin/env python3
"""Reconcile prisma/schema.prisma with the already-applied migration history.

This script is intentionally exact and fail-closed. It restores models created by
20260630000000_persisted_submission_plan_evidence, aligns raw-SQL defaults and
native timestamp types, and creates a forward migration only for indexes that
are declared in Prisma but absent from the migration history.
"""

from pathlib import Path

SCHEMA = Path("prisma/schema.prisma")
MIGRATION_DIR = Path("prisma/migrations/20260717165000_reconcile_schema_history_indexes")
MIGRATION = MIGRATION_DIR / "migration.sql"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_model_default(text: str, model: str) -> str:
    start = text.index(f"model {model} {{")
    end = text.index("\n}", start) + 2
    block = text[start:end]
    old = "@default(uuid())"
    if block.count(old) != 1:
        raise RuntimeError(f"{model}: expected one uuid() default")
    block = block.replace(old, '@default(dbgenerated("(gen_random_uuid())::text"))', 1)
    return text[:start] + block + text[end:]


def main() -> None:
    text = SCHEMA.read_text(encoding="utf-8")

    if "model SubmissionPlanRevision {" in text:
        raise RuntimeError("Schema already contains reconciliation models; refusing to run twice")

    text = replace_once(
        text,
        """  metadataOverrides    TenderMetadataOverride[]
  passwordResetTokens  PasswordResetToken[]
  createdAt    DateTime    @default(now())
""",
        """  metadataOverrides    TenderMetadataOverride[]
  passwordResetTokens  PasswordResetToken[]
  submissionPlansCreated    SubmissionPlanRevision[]      @relation("SubmissionPlanCreatedBy")
  submissionPlansConfirmed  SubmissionPlanRevision[]      @relation("SubmissionPlanConfirmedBy")
  evidenceDecisionsReviewed RequirementEvidenceDecision[] @relation("RequirementEvidenceReviewer")
  createdAt    DateTime    @default(now())
""",
        "User back-relations",
    )

    text = replace_once(
        text,
        """  submissionPlanState   SubmissionPlanState?
  aiUsageRecords        AiUsageRecord[]
  buildPlan             BuildPlan?
""",
        """  submissionPlanState     SubmissionPlanState?
  submissionPlanRevisions SubmissionPlanRevision[]
  aiUsageRecords          AiUsageRecord[]
  buildPlan               BuildPlan?
""",
        "Tender submission plan relation",
    )

    text = replace_once(
        text,
        """  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([tenderId])
  @@index([tenderId, deletionStatus]) // Compound — 20+ queries filter by both
  @@unique([tenderId, contentHash]) // Prevents duplicate uploads of same content
  @@index([integrityStatus])
""",
        """  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  requirementEvidenceDecisions RequirementEvidenceDecision[]

  @@index([tenderId])
  @@index([tenderId, deletionStatus]) // Compound — 20+ queries filter by both
  // Partial unique index on (tenderId, contentHash) is migration-managed so
  // empty/NULL legacy hashes remain compatible; Prisma cannot express its WHERE clause.
  @@index([integrityStatus])
""",
        "TenderFile relations and partial index",
    )

    text = replace_once(
        text,
        """  complianceMatrixRows ComplianceMatrix[]
  createdAt            DateTime           @default(now())
""",
        """  complianceMatrixRows ComplianceMatrix[]
  evidenceDecisions    RequirementEvidenceDecision[]
  createdAt            DateTime           @default(now())
""",
        "TenderRequirement evidence relation",
    )

    text = replace_once(
        text,
        """  reviews          DocumentReview[]
  comments         DocumentComment[]
  createdAt        DateTime  @default(now())
""",
        """  reviews             DocumentReview[]
  comments            DocumentComment[]
  submissionPlanItems SubmissionPlanItem[]
  createdAt           DateTime  @default(now())
""",
        "GeneratedDocument plan-item relation",
    )

    text = replace_once(
        text,
        """  // Partial unique index — only enforces uniqueness among non-SUPERSEDED rows.
  // The full @@unique was replaced because the engine supersedes documents while
  // preserving exactFileName, then inserts new rows with the same name.
  // See migration 20260705000000_generated_document_partial_unique_index.
  @@index([tenderId, exactFileName])
  @@index([integrityStatus])
""",
        """  // Partial unique index on (tenderId, exactFileName) for non-SUPERSEDED rows
  // is migration-managed because Prisma cannot express the WHERE clause.
  @@index([integrityStatus])
""",
        "GeneratedDocument partial index",
    )

    text = replace_once(
        text,
        """  // Audit DB-002 (2026-06-20): export-package list loads by tenderId.
  @@index([tenderId])
}
""",
        """  // Audit DB-002 (2026-06-20): export-package list loads by tenderId.
  @@index([tenderId])
  @@index([integrityStatus])
}
""",
        "ExportPackage integrity index",
    )

    marker = """// DB-005 FIX: This table was created by migration 20260613190000 but had no
// Prisma model, meaning prisma db push would drop it.
model SubmissionPlanState {
"""
    models = '''// Persisted, revisioned submission-plan authority created by migration
// 20260630000000_persisted_submission_plan_evidence. Unlike the BuildPlan
// compatibility projection, this model records immutable reviewed revisions.
model SubmissionPlanRevision {
  id                 String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  tenderId           String
  tender             Tender    @relation(fields: [tenderId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  revision           Int
  status             String    @default("DRAFT")
  sourceContentHash  String
  requirementsHash   String
  createdById        String
  createdBy          User      @relation("SubmissionPlanCreatedBy", fields: [createdById], references: [id], onDelete: Restrict, onUpdate: Cascade)
  confirmedById      String?
  confirmedBy        User?     @relation("SubmissionPlanConfirmedBy", fields: [confirmedById], references: [id], onDelete: SetNull, onUpdate: Cascade)
  createdAt          DateTime  @default(now()) @db.Timestamptz(6)
  confirmedAt        DateTime? @db.Timestamptz(6)
  supersededAt       DateTime? @db.Timestamptz(6)
  invalidatedAt      DateTime? @db.Timestamptz(6)
  invalidationReason String?
  confirmationHash   String?
  items              SubmissionPlanItem[]

  @@unique([tenderId, revision])
  @@index([tenderId])
  @@index([status])
}

model SubmissionPlanItem {
  id                     String                 @id @default(dbgenerated("(gen_random_uuid())::text"))
  submissionPlanId       String
  submissionPlan         SubmissionPlanRevision @relation(fields: [submissionPlanId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  exactFileName          String
  exactOrder             Int
  documentType           String                 @default("TENDER_REQUIRED_FILE")
  format                 String                 @default("DOCX")
  envelope               String                 @default("TECHNICAL")
  status                 String                 @default("PLANNED")
  sourceRequirementIds   String                 @default("[]")
  sourceFileCitations    String                 @default("[]")
  requiresOriginalUpload Boolean                @default(false)
  generatedDocumentId    String?
  generatedDocument      GeneratedDocument?     @relation(fields: [generatedDocumentId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  createdAt              DateTime               @default(now()) @db.Timestamptz(6)
  updatedAt              DateTime               @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([submissionPlanId])
  @@index([generatedDocumentId])
}

model RequirementEvidenceDecision {
  id                   String            @id @default(dbgenerated("(gen_random_uuid())::text"))
  tenderRequirementId  String
  tenderRequirement    TenderRequirement @relation(fields: [tenderRequirementId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  tenderFileId         String
  tenderFile           TenderFile        @relation(fields: [tenderFileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  pageNumber           Int
  exactQuote           String
  evidenceType         String
  companyAssetType     String
  companyAssetId       String
  relevanceExplanation String
  reviewerId           String
  reviewer             User              @relation("RequirementEvidenceReviewer", fields: [reviewerId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  decisionStatus       String             @default("DRAFT")
  sourceContentHash    String
  companyEvidenceHash  String?
  createdAt            DateTime           @default(now()) @db.Timestamptz(6)
  updatedAt            DateTime           @default(now()) @updatedAt @db.Timestamptz(6)
  invalidatedAt        DateTime?          @db.Timestamptz(6)
  invalidationReason   String?

  @@index([tenderRequirementId])
  @@index([decisionStatus])
  @@index([companyAssetId])
}

// DB-005 FIX: This table was created by migration 20260613190000 but had no
// Prisma model, meaning prisma db push would drop it.
model SubmissionPlanState {
'''
    text = replace_once(text, marker, models, "authoritative submission models")

    text = replace_once(
        text,
        """model SubmissionPlanState {
  tenderId            String    @id
  tender              Tender    @relation(fields: [tenderId], references: [id], onDelete: Cascade)
  provenance          String    @default("NONE")
  confirmationStatus  String    @default("NOT_REQUIRED")
  derivedDocumentCount Int      @default(0)
  activeDocumentCount Int       @default(0)
  confirmedAt         DateTime?
  updatedAt           DateTime  @default(now()) @updatedAt
}
""",
        """model SubmissionPlanState {
  tenderId             String    @id
  tender               Tender    @relation(fields: [tenderId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  provenance           String    @default("NONE")
  confirmationStatus   String    @default("NOT_REQUIRED")
  derivedDocumentCount Int       @default(0)
  activeDocumentCount  Int       @default(0)
  confirmedAt          DateTime? @db.Timestamptz(6)
  updatedAt            DateTime  @default(now()) @updatedAt @db.Timestamptz(6)
}
""",
        "SubmissionPlanState native types",
    )

    for model in ("AiUsageRecord", "FallbackApprovalRecord", "ExtractionQualityOverride"):
        text = replace_model_default(text, model)

    text = replace_once(
        text,
        """  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([companyId, tenderId, operation, idempotencyKey])
""",
        """  createdAt      DateTime @default(now())
  updatedAt      DateTime @default(now()) @updatedAt

  @@unique([companyId, tenderId, operation, idempotencyKey], map: "TenderWorkflowRun_companyId_tenderId_operation_idempotencyKey_key")
""",
        "TenderWorkflowRun default and index map",
    )

    SCHEMA.write_text(text, encoding="utf-8")

    MIGRATION_DIR.mkdir(parents=True, exist_ok=True)
    MIGRATION.write_text(
        '''-- Reconcile indexes and revision uniqueness that are declared in the
-- authoritative Prisma schema but were absent from earlier raw-SQL migrations.
-- This migration is additive and fails closed if legacy revision duplicates exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SubmissionPlanRevision"
    GROUP BY "tenderId", "revision"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate SubmissionPlanRevision (tenderId, revision) rows must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_revision_key"
  ON "SubmissionPlanRevision" ("tenderId", "revision");

CREATE INDEX IF NOT EXISTS "TenderFile_tenderId_deletionStatus_idx"
  ON "TenderFile" ("tenderId", "deletionStatus");

CREATE INDEX IF NOT EXISTS "TenderRequirement_tenderId_priority_idx"
  ON "TenderRequirement" ("tenderId", "priority");
''',
        encoding="utf-8",
    )

    print(f"Reconciled {SCHEMA} and wrote {MIGRATION}")


if __name__ == "__main__":
    main()
