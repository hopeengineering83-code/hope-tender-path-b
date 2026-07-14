/**
 * getEffectiveTenderFacts — manual override wiring, DB integration test.
 *
 * Requires RUN_DB_INTEGRATION=true and an isolated PostgreSQL instance.
 * Skips cleanly when RUN_DB_INTEGRATION is not set.
 *
 * Regression coverage for a real bug: getEffectiveTenderFacts's own module
 * doc claimed it combines "manual overrides" as one of its four fact layers
 * (ledger, parser, manual overrides, scalar fallback), and its own
 * EffectiveTenderFactStatus/Source types define "resolved_from_manual_
 * override" / "manual" for exactly this — but no TenderMetadataOverride
 * row was ever queried or consulted. A user-confirmed override was
 * therefore invisible to this resolver (used by AnalysisQualityPanel and
 * runtime-readiness-facts.ts) while honored elsewhere (generation gates,
 * canonical-field-state.ts) — a live UI/gate disagreement.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("getEffectiveTenderFacts — manual override wiring (DB integration)", () => {
  const { PrismaClient } = require("@prisma/client");
  const { getEffectiveTenderFacts } = require("../lib/engine/effective-tender-facts");
  let prisma: InstanceType<typeof PrismaClient>;
  let testUserId: string;
  let testTenderId: string;

  before(async () => {
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!dbUrl.includes("test") && !dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1")) {
      throw new Error(`SAFETY: refusing to run DB integration tests against non-isolated database: ${dbUrl}`);
    }

    prisma = new PrismaClient();
    testUserId = `test-user-eftf-${Date.now()}`;
    testTenderId = `test-tender-eftf-${Date.now()}`;

    await prisma.user.create({
      data: {
        id: testUserId,
        email: `test-eftf-${Date.now()}@test.local`,
        name: "Test Admin",
        passwordHash: "$2a$10$test",
        role: "ADMIN",
      },
    });

    // A tender with NO clientName, NO reference, NO submissionMethod at the
    // scalar level, and no extracted text to feed the parser — so the only
    // way any of these fields can resolve is via a manual override.
    await prisma.tender.create({
      data: {
        id: testTenderId,
        userId: testUserId,
        title: "Tender Submission",
        clientName: null,
        reference: null,
        deadline: null,
        submissionMethod: null,
        submissionAddress: null,
        submissionEmails: null,
        submissionEmailSubject: null,
        country: null,
        currency: "USD",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
      },
    });
  });

  after(async () => {
    await prisma.tenderMetadataOverride.deleteMany({ where: { tenderId: testTenderId } }).catch(() => {});
    await prisma.tender.delete({ where: { id: testTenderId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("clientName resolves to missing before any override exists", async () => {
    const result = await getEffectiveTenderFacts(prisma, testTenderId, testUserId);
    assert.equal(result.clientOrProcuringEntity, null);
    const fact = result.facts.find((f: any) => f.key === "clientName");
    assert.equal(fact?.status, "missing");
  });

  it("a USER_CONFIRMED clientName override is honored as resolved_from_manual_override", async () => {
    await prisma.tenderMetadataOverride.create({
      data: {
        tenderId: testTenderId,
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Ministry of Water Resources",
        reason: "Confirmed via the procurement notice email invitation.",
        confirmationBasis: "EMAIL_INVITATION",
        overriddenBy: testUserId,
      },
    });

    const result = await getEffectiveTenderFacts(prisma, testTenderId, testUserId);
    assert.equal(result.clientOrProcuringEntity, "Ministry of Water Resources");
    const fact = result.facts.find((f: any) => f.key === "clientName");
    assert.equal(fact?.status, "resolved_from_manual_override");
    assert.equal(fact?.source, "manual");
  });

  it("a USER_EDITED submissionMethod override changes the normalized method", async () => {
    await prisma.tenderMetadataOverride.create({
      data: {
        tenderId: testTenderId,
        field: "submissionMethod",
        fieldState: "USER_EDITED",
        overrideValue: "Physical delivery to the tender box",
        overriddenBy: testUserId,
      },
    });

    const result = await getEffectiveTenderFacts(prisma, testTenderId, testUserId);
    assert.equal(result.submissionMethod, "Physical");
    assert.equal(result.physicalSubmissionRequired, true);
  });

  it("an IGNORED_WITH_REASON override does NOT resolve the field (audited absence, not a value)", async () => {
    await prisma.tenderMetadataOverride.create({
      data: {
        tenderId: testTenderId,
        field: "reference",
        fieldState: "IGNORED_WITH_REASON",
        reason: "Tender source never states a reference number.",
        overriddenBy: testUserId,
      },
    });

    const result = await getEffectiveTenderFacts(prisma, testTenderId, testUserId);
    assert.equal(result.referenceNumber, null);
    const fact = result.facts.find((f: any) => f.key === "reference");
    assert.notEqual(fact?.status, "resolved_from_manual_override");
  });
});
