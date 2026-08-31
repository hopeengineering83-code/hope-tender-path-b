/**
 * Machine-verified vault evidence must reach the matcher.
 *
 * Found by setting a vault up the way an owner does and driving a tender
 * through the two owner gates. The engine finished and reported:
 *
 *   ENGINE_COMPLETED_WITH_BLOCKERS
 *   NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE
 *   totalExpertMatches: 4   selectedReviewedExperts: 0
 *
 * Four SOURCE_VERIFIED experts, every one scored 0.00, every match labelled
 * "[⚠ Provenance required]". The package never generated.
 *
 * The cause was one omitted column. checkMatchingEligibility accepts a
 * machine-SOURCE_VERIFIED record only when its stored provenance still
 * matches the document, and part of that comparison is
 * sourceExtractionRevision(), which reads `sourceDocument.metadata`. The
 * engine hand-wrote its own `select` for that relation and left `metadata`
 * out, so the function fell back to its default "revision:1" while the
 * stored provenance said "revision:6" — the revision a document reaches
 * after being re-extracted. Mismatch, NO_DURABLE_PROVENANCE, score 0.
 *
 * It fails closed and silently: the owner sees "Provenance required" on
 * evidence they uploaded and verified, with nothing to act on, and only
 * human-REVIEWED records (which qualify through reviewedBy/reviewedAt
 * instead) keep working — so a vault built by hand looks fine and a vault
 * built by ingestion does not.
 *
 * A correct shared select already existed. The engine is now the only caller
 * of the exported constant rather than a second, shorter copy of it, and
 * these cases pin both halves: the constant carries every field the
 * authority reads, and the engine selects through it.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { VAULT_SOURCE_DOCUMENT_SELECT, buildSourceVerificationProvenance } from "../lib/vault-review-provenance";

/** Every field the runtime authority reads off a source document. */
const REQUIRED_SOURCE_DOCUMENT_FIELDS = [
  "id",
  "companyId",
  "extractedText",
  "contentSha256",
  "contentByteLength",
  "integrityStatus",
  "metadata",
] as const;

const DOCUMENT_AT_REVISION_6 = {
  id: "doc-1",
  fileName: "Key-Experts-CVs.txt",
  companyId: "company-1",
  extractedText: "ENG. DANIEL WOLDU — Senior Architect. ".repeat(10),
  contentSha256: "a".repeat(64),
  contentByteLength: 928,
  integrityStatus: "VERIFIED",
  metadata: JSON.stringify({ extractionRevision: 6, reExtractedAt: "2026-08-31T13:18:44.335Z" }),
};

describe("the engine's view of vault evidence", () => {
  it("carries every field the runtime authority reads", () => {
    for (const field of REQUIRED_SOURCE_DOCUMENT_FIELDS) {
      assert.equal(
        (VAULT_SOURCE_DOCUMENT_SELECT as Record<string, unknown>)[field],
        true,
        `${field} must be selected, or the authority silently answers from a default`,
      );
    }
  });

  it("selects through the shared constant instead of a second hand-written list", () => {
    const source = readFileSync("lib/engine/run-tender-engine.ts", "utf8");
    // Both the expert and the project relation.
    const uses = source.split("sourceDocument: { select: VAULT_SOURCE_DOCUMENT_SELECT }").length - 1;
    assert.equal(uses, 2, "both vault relations must select through the shared constant");
    assert.doesNotMatch(
      source,
      /sourceDocument:\s*\{\s*\n?\s*select:\s*\{\s*id:\s*true/,
      "a hand-written source-document select is how metadata went missing",
    );
  });

  it("derives a different revision when metadata is not selected", () => {
    // The mechanism, through the app's own provenance builder: the revision a
    // record is bound to comes from sourceDocument.metadata. Omit the column
    // and the same document reads as revision 1 — so a record verified after
    // any re-extraction can never match itself again.
    const withMetadata = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: DOCUMENT_AT_REVISION_6 as never,
      fields: [{ field: "fullName", value: "DANIEL WOLDU" }] as never,
      verificationMethod: "DETERMINISTIC",
    });
    assert.ok(withMetadata.ok, `provenance must build: ${JSON.stringify(withMetadata)}`);
    assert.equal(withMetadata.sourceExtractionRevision, "revision:6");

    // Exactly the engine's old select: same document, metadata dropped.
    const asEngineSawIt = { ...DOCUMENT_AT_REVISION_6 } as Record<string, unknown>;
    delete asEngineSawIt.metadata;
    delete asEngineSawIt.fileName;
    const withoutMetadata = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: asEngineSawIt as never,
      fields: [{ field: "fullName", value: "DANIEL WOLDU" }] as never,
      verificationMethod: "DETERMINISTIC",
    });
    assert.ok(withoutMetadata.ok);
    assert.equal(
      withoutMetadata.sourceExtractionRevision,
      "revision:1",
      "the omitted column is what made the revision disagree",
    );
    assert.notEqual(
      withMetadata.sourceExtractionRevision,
      withoutMetadata.sourceExtractionRevision,
      "one document must not read as two different revisions",
    );
  });

  it("reads the revision a re-extracted document actually reached", () => {
    for (const [revision, expected] of [[1, "revision:1"], [2, "revision:2"], [6, "revision:6"]] as const) {
      const built = buildSourceVerificationProvenance({
        recordType: "EXPERT",
        sourceDocument: { ...DOCUMENT_AT_REVISION_6, metadata: JSON.stringify({ extractionRevision: revision }) } as never,
        fields: [{ field: "fullName", value: "DANIEL WOLDU" }] as never,
        verificationMethod: "DETERMINISTIC",
      });
      assert.ok(built.ok);
      assert.equal(built.sourceExtractionRevision, expected);
    }
  });

  it("still refuses to build provenance from unverified bytes", () => {
    // Restoring sight must not weaken the gate: a document whose bytes are
    // not verified still cannot back a source-verified record.
    const built = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: { ...DOCUMENT_AT_REVISION_6, integrityStatus: "UNKNOWN" } as never,
      fields: [{ field: "fullName", value: "DANIEL WOLDU" }] as never,
      verificationMethod: "DETERMINISTIC",
    });
    assert.equal(built.ok, false);
  });
});
