/**
 * A scored experience criterion the firm cannot evidence costs points; it does
 * not stop the bid.
 *
 * 2026-09-30, Preview, a telecom-tower EOI: every one of the firm's building
 * projects was correctly hard-excluded for "Previous Telecommunications Tower
 * Experience" (SCORED). checkEnginePostconditions reported
 * NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE, the Engine run completed
 * WITH_BLOCKERS, and Proposal Generation never started. A MANDATORY experience
 * requirement with no selection still blocks.
 */
import { after, before, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  cleanupTender, cleanupUser, dbDescribe, getPrisma, seedComplianceRow, seedRequirement, seedTender, seedUser, testSuffix,
} from "./helpers/db-acceptance-harness";
import { checkEnginePostconditions } from "../lib/engine/engine-postconditions";

dbDescribe("an unevidenced SCORED experience criterion does not block the Engine", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let userId = "";
  let tenderId = "";

  before(async () => {
    userId = (await seedUser(prisma, suffix)).id;
    tenderId = (await seedTender(prisma, { userId, suffix, title: "Maintenance of Communication Masts" })).id;
  });
  after(async () => {
    await cleanupTender(prisma, tenderId);
    await cleanupUser(prisma, userId);
  });

  it("a SCORED experience row with no selected project is not a blocker", async () => {
    const req = await seedRequirement(prisma, { tenderId, title: "Previous mast maintenance experience", requirementType: "PROJECT_EXPERIENCE", priority: "SCORED" });
    await seedComplianceRow(prisma, { tenderId, requirementId: req.id });
    const result = await checkEnginePostconditions(tenderId);
    assert.equal(result.blockers.some((b) => /PROJECT/.test(b)), false, result.blockers.join(", "));
  });

  it("a MANDATORY experience row with no selected project still blocks", async () => {
    const req = await seedRequirement(prisma, { tenderId, title: "Three similar mast contracts", requirementType: "PROJECT_EXPERIENCE", priority: "MANDATORY" });
    await seedComplianceRow(prisma, { tenderId, requirementId: req.id });
    const result = await checkEnginePostconditions(tenderId);
    assert.equal(result.blockers.some((b) => /PROJECT/.test(b)), true, result.blockers.join(", "));
  });
});
