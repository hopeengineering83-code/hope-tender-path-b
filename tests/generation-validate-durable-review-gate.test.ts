// Real gap found while auditing every generation-adjacent consumer of
// Expert/Project trustLevel: lib/engine/validate.ts's validateTender()
// (a pre-generation validation pass run before documents are produced)
// checked `trustLevel !== "REVIEWED"` directly instead of isDurablyReviewed().
// A record stamped trustLevel="REVIEWED" without ever being bound to
// verified source-document bytes and a matching quote (missing
// sourceDocumentId/reviewedBy/reviewedAt, or a stale provenance mismatch)
// would pass this check as if genuinely human-reviewed, producing a
// false-positive "EXPERTS_ALL_REVIEWED" WARN that contradicts the Engine's
// and generate/route.ts's own durable evidence gate (both of which reject
// the same record). Fixed to use isDurablyReviewed(), matching every other
// generation-adjacent consumer.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { validateTender } from "../lib/engine/validate";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;
let tenderId: string;

describe("validateTender() gates on durable review, not the raw trustLevel column — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `validate-durable-${nonce}@example.test`, name: "Validate Durable Gate Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Validate Durable Gate Firm ${nonce}` } });
    companyId = company.id;
    const tender = await prisma.tender.create({
      data: { userId, title: "Durable Review Gate Test Tender", status: "MATCHED" },
    });
    tenderId = tender.id;
  });

  after(async () => {
    await prisma.tenderExpertMatch.deleteMany({ where: { tenderId } });
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("does not emit EXPERTS_ALL_REVIEWED for a REVIEWED-flagged expert with no durable provenance", async () => {
    const expert = await prisma.expert.create({
      data: { companyId, fullName: "Stale Reviewed Expert For Validate Gate", trustLevel: "REVIEWED" },
    });
    await prisma.tenderExpertMatch.create({
      data: { tenderId, expertId: expert.id, isSelected: true, score: 0.9 },
    });

    const report = await validateTender(tenderId);
    assert.ok(
      !report.issues.some((issue) => issue.code === "EXPERTS_ALL_REVIEWED"),
      "a stale/non-durable REVIEWED expert must not produce a false-positive EXPERTS_ALL_REVIEWED",
    );
  });
});
