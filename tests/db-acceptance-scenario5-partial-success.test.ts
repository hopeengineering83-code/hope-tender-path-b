// DB-backed release acceptance — Scenario 5: AI evidence matching failure.
//
// Tender-source quotations define buyer requirements. They are diagnostics,
// never Company Vault evidence. AI matching failure must therefore create zero
// compliance-matrix evidence rows and zero GeneratedDocument rows.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dbDescribe,
  getPrisma,
  testSuffix,
  seedUser,
  seedCompany,
  seedTender,
  seedTenderFile,
  seedRequirement,
  cleanupTender,
  cleanupUser,
} from "./helpers/db-acceptance-harness";
import {
  buildDeterministicFallbackRows,
  mergeFallbackRows,
} from "../lib/engine/deterministic-fallback-rows";

dbDescribe("DB Acceptance — Scenario 5: unmatched requirement diagnostics", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: { id: string; role: string };
  let tender: { id: string };
  let file: { id: string };
  let requirement: { id: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    await seedCompany(prisma, user.id, suffix);
    tender = await seedTender(prisma, {
      userId: user.id,
      suffix,
      title: `Evidence Boundary Tender ${suffix}`,
      status: "MATCHED",
      stage: "COMPLIANCE",
    });
    file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      extractedText: "The bidder shall provide audited accounts.",
    });
    requirement = await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Provide audited accounts",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
      sourcePageNumber: 12,
      sourceExactQuote: "The bidder shall provide audited accounts.",
      sourceConfidence: 0.95,
    });
  });

  after(async () => {
    await cleanupTender(prisma, tender.id);
    await cleanupUser(prisma, user.id);
  });

  it("returns a non-evidentiary unmatched-requirement diagnostic", async () => {
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(reqs.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      requirementType: r.requirementType,
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
      sourcePageNumber: r.sourcePageNumber,
      sourceExactQuote: r.sourceExactQuote,
      sourceConfidence: r.sourceConfidence ?? 0,
    })));

    assert.equal(fallback.rows.length, 1);
    assert.equal(fallback.rows[0].requirementId, requirement.id);
    assert.equal(fallback.rows[0].evidenceType, "UNMATCHED_REQUIREMENT_DIAGNOSTIC");
    assert.equal(fallback.rows[0].evidenceSource, "NO_COMPANY_VAULT_EVIDENCE");
    assert.equal(fallback.rows[0].evidenceReference, undefined);
    assert.equal(fallback.blockerCode, "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED");
  });

  it("never merges diagnostics into compliance matrices", async () => {
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(reqs.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      requirementType: r.requirementType,
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
      sourcePageNumber: r.sourcePageNumber,
      sourceExactQuote: r.sourceExactQuote,
      sourceConfidence: r.sourceConfidence ?? 0,
    })));

    const existing = { matrices: [], gaps: [] };
    const merged = mergeFallbackRows(existing, fallback.rows);
    assert.equal(merged, existing);
    assert.equal(merged.matrices.length, 0);

    const persistedEvidence = await prisma.complianceMatrix.count({
      where: { tenderId: tender.id },
    });
    assert.equal(persistedEvidence, 0);
  });

  it("creates zero GeneratedDocument rows while evidence matching is unresolved", async () => {
    const count = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
    assert.equal(count, 0);
  });
});
