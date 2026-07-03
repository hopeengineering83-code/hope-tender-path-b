import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSourceContentHash } from "../lib/engine/persisted-submission-plan";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260630000000_persisted_submission_plan_evidence/migration.sql", "utf8");
const planService = readFileSync("lib/engine/persisted-submission-plan.ts", "utf8");
const gateSource = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
const buildRoute = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
const confirmRoute = readFileSync("app/api/tenders/[id]/confirm-plan/route.ts", "utf8");
const evidenceService = readFileSync("lib/engine/requirement-evidence.ts", "utf8");
const evidenceActionRoute = readFileSync("app/api/tenders/[id]/evidence-decisions/[decisionId]/route.ts", "utf8");

describe("persisted release plan model hardening", () => {
  it("uses SubmissionPlanRevision as the only release-plan authority with safe revision uniqueness", () => {
    assert.match(schema, /model SubmissionPlanRevision[\s\S]*@@unique\(\[tenderId, revision\]\)/);
    assert.doesNotMatch(schema, /@@unique\(\[tenderId, status\]\)/);
    assert.match(migration, /SubmissionPlanRevision_one_working_plan[\s\S]*WHERE "status" IN \('DRAFT', 'REVIEW_REQUIRED'\)/);
    assert.match(migration, /SubmissionPlanRevision_one_confirmed_plan[\s\S]*WHERE "status" = 'CONFIRMED'/);
  });

  it("stores plan item requirement and citation mappings as relational FKs, not authoritative JSON strings", () => {
    assert.match(schema, /model SubmissionPlanItemRequirement[\s\S]*tenderRequirement\s+TenderRequirement\s+@relation/);
    assert.match(schema, /model SubmissionPlanItemCitation[\s\S]*tenderFile\s+TenderFile\s+@relation/);
    assert.doesNotMatch(schema, /sourceRequirementIds\s+String/);
    assert.doesNotMatch(schema, /sourceFileCitations\s+String/);
    assert.match(migration, /SubmissionPlanItemRequirement_requirement_fkey/);
    assert.match(migration, /SubmissionPlanItemCitation_meaningful_quote/);
  });

  it("allows unlimited SUPERSEDED history while limiting active draft and confirmed revisions", () => {
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_one_working_plan"/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_one_confirmed_plan"/);
  });

  it("build plan persists a DRAFT revision and still creates zero GeneratedDocument rows", () => {
    assert.match(buildRoute, /buildPersistedSubmissionPlan/);
    assert.doesNotMatch(buildRoute, /prisma\.generatedDocument\.create\(/);
    assert.match(buildRoute, /confirmationRequired/);
  });

  it("confirmation checks request hashes and draft hashes against current source and requirements hashes", () => {
    assert.match(planService, /expectedSourceContentHash !== currentSourceHash/);
    assert.match(planService, /expectedRequirementsHash !== currentRequirementsHash/);
    assert.match(planService, /draft\.sourceContentHash !== currentSourceHash/);
    assert.match(planService, /draft\.requirementsHash !== currentRequirementsHash/);
    assert.match(planService, /PLAN_STALE_REBUILD_REQUIRED/);
    assert.match(confirmRoute, /PLAN_STALE_REBUILD_REQUIRED/);
  });

  it("uses serializable transactions, row locking, and transient-conflict retry around plan updates", () => {
    assert.match(planService, /isolationLevel:\s*"Serializable"/);
    assert.match(planService, /FOR UPDATE/);
    assert.match(planService, /P2034|40001|40P01/);
    assert.match(planService, /withSerializableRetry/);
  });

  it("stores full sha256 confirmation hashes and deterministic immutable snapshots", () => {
    assert.match(planService, /confirmationSnapshot/);
    assert.match(planService, /confirmationHash/);
    assert.match(planService, /digest\("hex"\)/);
    assert.doesNotMatch(planService, /confirmationHash[\s\S]{0,80}slice\(0,\s*16\)/);
  });

  it("source hashing does not use extracted text length and includes active file identity and state", () => {
    const source = computeSourceContentHash.toString();
    assert.doesNotMatch(source, /\.length/);
    assert.match(source, /deletionStatus:\s*"ACTIVE"/);
    assert.match(source, /originalFileName/);
    assert.match(source, /classification/);
    assert.match(source, /extractionMethod/);
    assert.match(source, /contentSha256/);
  });

  it("release gate uses confirmed persisted plan and approved evidence instead of GeneratedDocument plan rows", () => {
    assert.match(gateSource, /hasConfirmedPersistedPlan/);
    assert.match(gateSource, /hasAllMandatoryEvidenceApproved/);
    assert.match(gateSource, /REQUIREMENT_EVIDENCE_MISSING/);
    assert.doesNotMatch(gateSource, /generatedDocument\.count\(\{\s*where:\s*\{ tenderId, generationStatus: \{ not: "SUPERSEDED" \}/);
  });

  it("pure release gate blocks unconfirmed plans and missing evidence", () => {
    const base = {
      purpose: "generate" as const,
      tenderExistsAndOwned: true,
      activeFileCount: 1,
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
      analysisState: "AI_SUCCEEDED" as const,
      canonicalJobId: "job-1",
      latestJobHash: "hash",
      currentContentHash: "hash",
      fallbackApprovalBound: false,
      currentHashChunks: [],
      requirementCount: 1,
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "A meaningful exact tender quote", sourceFileActiveInTender: true }],
      criticalMetadataOk: true,
      hasConfirmedPersistedPlan: false,
      confirmedPlanDocumentsOk: true,
    };
    assert.equal(evaluateGenerationReadiness(base).blockerCode, "SUBMISSION_PLAN_MISSING");
    assert.equal(evaluateGenerationReadiness({ ...base, hasCurrentConfirmedBuildPlan: true, hasApprovedRequirementEvidence: false }).blockerCode, "REQUIREMENT_EVIDENCE_MISSING");
  });

  it("uses real foreign keys for supported requirement-evidence asset references", () => {
    assert.match(schema, /expert\s+Expert\?\s+@relation\(fields: \[expertId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(schema, /project\s+Project\?\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(schema, /legalRecord\s+LegalRecord\?\s+@relation\(fields: \[legalRecordId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(schema, /companyComplianceRecord\s+CompanyComplianceRecord\?\s+@relation\(fields: \[companyComplianceRecordId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(schema, /companyAsset\s+CompanyAsset\?\s+@relation\("RequirementEvidenceCompanyAsset", fields: \[companyAssetId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(schema, /originalUpload\s+CompanyAsset\?\s+@relation\("RequirementEvidenceOriginalUpload", fields: \[originalUploadId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(migration, /RequirementEvidenceDecision_expert_fkey/);
    assert.match(migration, /RequirementEvidenceDecision_originalUpload_fkey/);
  });

  it("scopes evidence actions to the tender route instead of approving by global decision id", () => {
    assert.match(evidenceService, /findFirst\(\{\s*where:\s*\{\s*id: decisionId,\s*tenderId\s*\}/);
    assert.match(evidenceActionRoute, /approveEvidenceDecision\(tenderId, decisionId/);
    assert.match(evidenceActionRoute, /rejectEvidenceDecision\(tenderId, decisionId/);
    assert.match(evidenceActionRoute, /invalidateEvidenceDecision\(tenderId, decisionId/);
  });
});