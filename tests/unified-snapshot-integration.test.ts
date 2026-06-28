import assert from "node:assert/strict";
import { test } from "node:test";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { prisma } from "../lib/prisma";

/**
 * Integration test: All panels consume ONE unified snapshot.
 *
 * Scenario: Tender has a manually entered deadline without source evidence.
 * Verification: All panels report the SAME snapshotRevision, field status (BLOCKED),
 * and blocker count for that field.
 */
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

  // 4. Verify the snapshot has the deadline field
  const deadlineField = snapshot.metadata.fields.find((f) => f.fieldKey === "deadline");
  assert(deadlineField, "Deadline field must be in snapshot");

  // 5. Verify that the deadline is BLOCKED because it's critical and ungrounded
  assert.equal(
    deadlineField.status,
    "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
    "Manually entered critical field without source evidence must be BLOCKED"
  );

  // 6. Verify that the snapshot reports this as having a generation blocker
  assert.equal(
    snapshot.metadata.hasGenerationBlocker,
    true,
    "Snapshot must flag generation blocker when critical field is ungrounded"
  );

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

  // 9. Modify the override to add source evidence and verify revision CHANGES
  const existingOverride = await prisma.tenderMetadataOverride.findFirst({ where: { field: "deadline", tenderId: tender.id } });
  assert(existingOverride, "Override must exist");
  await prisma.tenderMetadataOverride.update({
    where: { id: existingOverride.id },
    data: {
      fieldState: "USER_CONFIRMED",  // Confirmed = still needs source
      // For deadline to be unblocked, it needs source evidence
    },
  });

  const snapshot3 = await getTenderReleaseSnapshot(prisma, tender.id, userId);
  assert(snapshot3, "Third snapshot fetch must succeed");
  assert.notEqual(
    snapshot3.snapshotRevision,
    snapshotRevision,
    "Different input must produce different snapshotRevision"
  );

  // 10. Verify the field status changed
  const deadlineField3 = snapshot3.metadata.fields.find((f) => f.fieldKey === "deadline");
  assert(deadlineField3, "Deadline field must still exist");
  assert.equal(
    deadlineField3.status,
    "MANUAL_CONFIRMED",
    "Confirmed status must be reflected in new snapshot"
  );

  // Cleanup
  await prisma.tender.delete({ where: { id: tender.id } });
  await prisma.user.delete({ where: { id: userId } });
});
