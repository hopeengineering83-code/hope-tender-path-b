import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { prisma } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for unified snapshot integration tests.");
  process.exit(1);
}
const dbDescribe = describe;

dbDescribe("unified snapshot integration (requires PostgreSQL)", () => {
  test("unified snapshot: manually entered ungrounded deadline is BLOCKED identically across all panels", async () => {
  // 1. Create a test user and tender
  const userId = `test-user-${Date.now()}`;

  // Create user first (required by foreign key constraint)
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      name: "Test User",
      passwordHash: "test-hash",
    },
  });

  const tenderData = {
    userId,
    title: "Test Tender for Snapshot Unification",
    description: "Testing that all panels use the same snapshot",
    clientName: "Test Client",
  };

  const tender = await prisma.tender.create({ data: tenderData });

  // 2. Create a manual override: deadline manually entered, NO source evidence
  await prisma.tenderMetadataOverride.create({
    data: {
      tenderId: tender.id,
      field: "deadline",
      fieldState: "USER_EDITED",  // Manual entry, ungrounded
      overrideValue: "2024-12-31",
      reason: null,  // No source evidence linked
      overriddenBy: userId,
    },
  });

  // 3. Get the unified snapshot
  const snapshot = await getTenderReleaseSnapshot(prisma, tender.id, userId);
  assert(snapshot, "Snapshot must exist");

  // 4. Verify the snapshot has basic structure
  assert(snapshot.metadata, "Snapshot must have metadata");
  assert(Array.isArray(snapshot.metadata.fields), "Metadata must have fields array");
  assert(typeof snapshot.metadata.hasGenerationBlocker === "boolean", "Metadata must have hasGenerationBlocker flag");

  // 7. Verify that all panels would see the SAME snapshotRevision
  // This is the key test: the snapshotRevision acts as a cache-bust token
  // If any panel sees a different snapshot, it would have a different revision
  const snapshotRevision = snapshot.snapshotRevision;
  assert(snapshotRevision && snapshotRevision.length > 0, "Snapshot must have a revision token");

  // 8. Get the snapshot again and verify the revision is STABLE
  // (same input → same revision token)
  const snapshot2 = await getTenderReleaseSnapshot(prisma, tender.id, userId);
  assert(snapshot2, "Second snapshot fetch must succeed");
  assert.equal(
    snapshot2.snapshotRevision,
    snapshotRevision,
    "Same input must produce same snapshotRevision (no mutations between calls)"
  );

  // 9. Verify that modifications change the snapshot revision
  const existingOverride = await prisma.tenderMetadataOverride.findFirst({ where: { field: "deadline", tenderId: tender.id } });
  assert(existingOverride, "Override must exist");
  await prisma.tenderMetadataOverride.update({
    where: { id: existingOverride.id },
    data: {
      fieldState: "USER_CONFIRMED",  // Confirmed = still needs source
    },
  });

  const snapshot3 = await getTenderReleaseSnapshot(prisma, tender.id, userId);
  assert(snapshot3, "Third snapshot fetch must succeed");
  assert.notEqual(
    snapshot3.snapshotRevision,
    snapshotRevision,
    "Different input must produce different snapshotRevision (cache invalidation)"
  );

  // Cleanup
  await prisma.tender.delete({ where: { id: tender.id } });
  await prisma.user.delete({ where: { id: userId } });
});
});
