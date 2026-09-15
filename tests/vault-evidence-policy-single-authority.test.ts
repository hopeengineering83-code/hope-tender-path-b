// One decision, one implementation.
//
// Vault usability had two live implementations of the same rule:
//
//   lib/vault-review-provenance.ts  canUseVaultRecord()
//   lib/vault-runtime-authority.ts  canUseVaultRecordSafely()
//
// Both did the same expiry check and the same two-way durability disjunction
// (durably REVIEWED or durably SOURCE_VERIFIED), just in opposite order. The
// consumers were split between them — canonical-tender-readiness,
// matching-quality, engine-postconditions and run-tender-engine called one;
// company-ingestion-readiness and matching-eligibility called the other.
//
// Nothing was broken, because the two copies agreed. They agreed by
// coincidence. Editing either alone — tightening expiry, adding a purpose
// carve-out, accepting a new trust level — would have split matching
// eligibility from generation readiness with no test failing anywhere, which
// is precisely the failure this codebase has spent a lot of effort removing
// elsewhere: a second authority for a decision that should have one.
//
// canUseVaultRecordSafely now delegates. These tests assert the two entry
// points cannot disagree, across the states that actually distinguish them,
// so a future edit to one is either reflected in both or fails here.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import {
  buildSourceVerificationProvenance,
  canUseVaultRecord,
  expertReviewFields,
  type ReviewRecordState,
} from "../lib/vault-review-provenance";
import { canUseVaultRecordSafely, type VaultRuntimePurpose } from "../lib/vault-runtime-authority";

const PURPOSES: VaultRuntimePurpose[] = ["MATCHING", "GENERATION", "EXPORT"];

const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 86_400_000);

/**
 * A record that genuinely passes durability, so the expiry branch has
 * something to actually gate. A fixture that fails durability anyway cannot
 * distinguish "expired" from "not durable" — both entry points return false
 * for the same reason and a dropped expiry check goes unnoticed.
 */
function durableExpert(expiryDate?: Date): ReviewRecordState {
  const fullName = "Durable Expert";
  const text = [
    "CURRICULUM VITAE",
    `Name of Key Expert: ${fullName}`,
    `${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services.`,
  ].join("\n");
  const sourceDocument = {
    id: "doc-durable",
    companyId: "co-1",
    extractedText: text,
    contentSha256: createHash("sha256").update(text).digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
    metadata: JSON.stringify({ extractionRevision: 1 }),
  };
  const fields = {
    fullName,
    title: "Senior Consultant",
    yearsExperience: 15,
    disciplines: JSON.stringify(["General Consultancy Services"]),
    sectors: JSON.stringify([]),
    certifications: JSON.stringify([]),
  };
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(fields),
    verificationMethod: "HYBRID",
  });
  if (!provenance.ok) throw new Error("fixture provenance failed to build");

  return {
    ...fields,
    id: "expert-durable",
    companyId: "co-1",
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    ...(expiryDate ? { expiryDate } : {}),
  } as unknown as ReviewRecordState;
}

/** States chosen to exercise every branch both implementations contained. */
const CASES: Array<{ name: string; record: ReviewRecordState }> = [
  { name: "regex draft", record: { trustLevel: "REGEX_DRAFT" } as ReviewRecordState },
  { name: "ai draft", record: { trustLevel: "AI_DRAFT" } as ReviewRecordState },
  { name: "manual draft", record: { trustLevel: "MANUAL_DRAFT" } as ReviewRecordState },
  { name: "unknown trust level", record: { trustLevel: "SOMETHING_NEW" } as ReviewRecordState },
  { name: "null trust level", record: { trustLevel: null } as unknown as ReviewRecordState },
  {
    name: "REVIEWED without reviewer identity",
    record: { trustLevel: "REVIEWED", sourceDocumentId: "doc-1", reviewedBy: null, reviewedAt: null } as ReviewRecordState,
  },
  {
    name: "REVIEWED without a source document",
    record: { trustLevel: "REVIEWED", sourceDocumentId: null, reviewedBy: "someone", reviewedAt: past } as ReviewRecordState,
  },
  {
    name: "SOURCE_VERIFIED with no stored provenance",
    record: { trustLevel: "SOURCE_VERIFIED", sourceDocumentId: "doc-1", reviewNotes: null } as ReviewRecordState,
  },
  {
    name: "SOURCE_VERIFIED carrying fabricated reviewer metadata",
    record: {
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: "doc-1",
      reviewedBy: "system",
      reviewedAt: past,
      reviewNotes: null,
    } as ReviewRecordState,
  },
  // Durable in every respect except the expiry date. These are the only two
  // cases that can catch an entry point dropping the expiry check, because
  // they are the only ones where durability alone would say "usable".
  { name: "durable but expired", record: durableExpert(past) },
  { name: "durable and unexpired", record: durableExpert(future) },
  { name: "durable with no expiry set", record: durableExpert() },
  { name: "empty record", record: {} as ReviewRecordState },
];

/** The states that must remain unusable regardless of entry point. */
const MUST_BE_UNUSABLE = new Set(["durable and unexpired", "durable with no expiry set"]);

describe("Vault usability has exactly one implementation", () => {
  for (const { name, record } of CASES) {
    for (const purpose of PURPOSES) {
      it(`agrees for ${name} (${purpose})`, () => {
        assert.equal(
          canUseVaultRecordSafely(record, purpose),
          canUseVaultRecord(record, purpose),
          `canUseVaultRecordSafely and canUseVaultRecord disagreed on "${name}" for ${purpose} — ` +
            `the rule must live in one place, not be reimplemented per entry point`,
        );
      });
    }
  }

  it("still fails closed on every non-durable state, including a durable record past its expiry", () => {
    for (const { name, record } of CASES) {
      if (MUST_BE_UNUSABLE.has(name)) continue;
      for (const purpose of PURPOSES) {
        assert.equal(
          canUseVaultRecordSafely(record, purpose),
          false,
          `"${name}" must not be usable for ${purpose}`,
        );
      }
    }
  });

  it("accepts a genuinely durable, unexpired record — the fixture proves the gate is not vacuous", () => {
    for (const purpose of PURPOSES) {
      assert.equal(canUseVaultRecordSafely(durableExpert(future), purpose), true);
      assert.equal(canUseVaultRecordSafely(durableExpert(), purpose), true);
      // …and the same record is rejected once expired, which is what makes the
      // "durable but expired" case above a real test of the expiry check.
      assert.equal(canUseVaultRecordSafely(durableExpert(past), purpose), false);
    }
  });

  it("never accepts a SOURCE_VERIFIED record wearing fabricated human-review metadata", () => {
    const fabricated = {
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: "doc-1",
      reviewedBy: "system",
      reviewedAt: new Date(),
      reviewNotes: null,
    } as ReviewRecordState;

    for (const purpose of PURPOSES) {
      assert.equal(canUseVaultRecordSafely(fabricated, purpose), false);
      assert.equal(canUseVaultRecord(fabricated, purpose), false);
    }
  });
});
