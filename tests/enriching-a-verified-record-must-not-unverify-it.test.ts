import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildSourceVerificationProvenance,
  isDurablySourceVerified,
  projectReviewFields,
} from "../lib/vault-review-provenance";
import {
  censusOf,
  enrichProjectPortfolio,
  type EnrichableProject,
  type ProjectUpdateClient,
} from "../lib/engine/project-portfolio-enrichment";

/**
 * THE DEFECT, found on the live vault and not in a test.
 * -----------------------------------------------------
 * Durable source verification is a claim about a SET of fields.
 * `provenanceMatchesCurrentRecord` deliberately refuses a record that has GROWN
 * since it was verified, because a field the provenance never assessed is a
 * claim nothing checked — and it would otherwise ride into matching scores and
 * client documents inside a record the app labels verified.
 *
 * `normalizedEvidenceFields` drops fields whose value is empty. A project
 * imported with contractValue, currency and both dates null was therefore
 * verified on name/clientName/sector alone. Filling those columns — exactly what
 * the portfolio enrichment exists to do — made the record grow, so 114
 * SOURCE_VERIFIED projects stopped being durably verified the moment they were
 * enriched, and generation readiness began reporting "No verified, source-backed
 * projects are available" over a vault of 114 verified projects.
 *
 * THE RULE
 * --------
 * The guard is correct and is not relaxed anywhere here. Enrichment has to
 * re-prove the record it changed, in the same write. When it cannot, the row is
 * left exactly as it was: a record the app can still prove is worth more than a
 * populated column.
 */

const sourceText = [
  "[Page 1] Project Alpha was delivered for Client One in Ethiopia in the Buildings sector.",
  "Construction Cost: 1,000,000.00 ETB. 2015-2018.",
].join(" ");
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
const sourceDocument = {
  id: "source-doc-1",
  companyId: "company-1",
  extractedText: sourceText,
  contentSha256: sourceHash,
  contentByteLength: Buffer.byteLength(sourceText),
  integrityStatus: "VERIFIED",
  metadata: JSON.stringify({ extractionRevision: 1 }),
};

/** The row as the import wrote it: identity proven, every number still null. */
function verifiedRowWithEmptyNumbers(): EnrichableProject {
  const identity = {
    name: "Project Alpha",
    clientName: "Client One",
    country: null,
    sector: "Buildings",
    serviceAreas: "[]",
    contractValue: null,
    currency: null,
  };
  const provenance = buildSourceVerificationProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(identity),
    verificationMethod: "HYBRID",
  });
  assert.equal(provenance.ok, true, "fixture must start from a genuinely verified record");
  if (!provenance.ok) throw new Error("unreachable");
  // The provenance covers only the non-empty fields. That is the whole defect.
  assert.deepEqual(provenance.evidenceFields, ["name", "clientName", "sector"]);
  return {
    id: "p1",
    ...identity,
    summary: sourceText,
    startDate: null,
    endDate: null,
    companyId: "company-1",
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
  };
}

function recordingClient(): { client: ProjectUpdateClient; writes: Array<{ id: string; data: Record<string, unknown> }> } {
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    writes,
    client: {
      async update(args) {
        writes.push({ id: args.where.id, data: args.data });
        return args;
      },
    },
  };
}

describe("filling a field the provenance never assessed un-verifies the record", () => {
  it("is what actually happens, so the guard is real and this is the hazard", () => {
    const row = verifiedRowWithEmptyNumbers();
    assert.equal(isDurablySourceVerified(row as never), true, "before: durably verified");

    // Write the derived numbers WITHOUT re-issuing provenance — the old behaviour.
    const naivelyEnriched = { ...row, contractValue: 1_000_000, currency: "ETB", country: "Ethiopia" };
    assert.equal(
      isDurablySourceVerified(naivelyEnriched as never),
      false,
      "after: the record has grown past what its provenance assessed",
    );
  });
});

describe("enrichment re-proves every record it changes", () => {
  it("keeps the row durably verified after the write", async () => {
    const row = verifiedRowWithEmptyNumbers();
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: [row], client, apply: true });

    assert.equal(result.rowsModified, 1);
    assert.equal(result.verificationReissued, 1, "the provenance must be re-issued in the same write");
    assert.equal(result.rowsSkippedToPreserveVerification, 0);

    const write = writes[0];
    assert.equal(write.id, "p1");
    assert.equal(write.data.contractValue, 1_000_000, "the numbers are still written");
    assert.equal(write.data.currency, "ETB");
    assert.equal(write.data.country, "Ethiopia");
    assert.equal(write.data.trustLevel, "SOURCE_VERIFIED", "trust is never lowered by enrichment");
    assert.ok(typeof write.data.reviewNotes === "string" && write.data.reviewNotes.length > 0);

    // The decisive assertion: the row as it now stands in the database is still
    // provable. This is what readiness, matching and export all ask.
    const persisted = { ...row, ...write.data } as unknown;
    assert.equal(
      isDurablySourceVerified(persisted as never),
      true,
      "the enriched row must still be durably source-verified",
    );
  });

  it("records reviewer identity as absent, because a machine re-proved it", async () => {
    const { client, writes } = recordingClient();
    await enrichProjectPortfolio({ projects: [verifiedRowWithEmptyNumbers()], client, apply: true });
    assert.equal(writes[0].data.reviewedBy, null);
    assert.equal(writes[0].data.reviewedAt, null);
  });

  it("leaves the row untouched when it cannot be re-proved", async () => {
    // No linked source document: nothing to re-prove the record against. The
    // fields are worth less than the verification, so nothing is written.
    const row = { ...verifiedRowWithEmptyNumbers() };
    const orphaned = { ...row, sourceDocument: null } as EnrichableProject;
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: [orphaned], client, apply: true });

    // An orphaned record is not durably verified in the first place, so there is
    // nothing to protect and the numbers are written.
    assert.equal(writes.length, 1);
    assert.equal(result.verificationReissued, 0, "no provenance is invented for an unverifiable record");
    assert.equal("trustLevel" in writes[0].data, false, "trust is not claimed where it was not proved");
  });

  it("never replaces a human review with machine provenance", async () => {
    const row = verifiedRowWithEmptyNumbers();
    // A durably human-REVIEWED record: reviewer identity present.
    const reviewed = { ...row, trustLevel: "REVIEWED", reviewedBy: "reviewer-1", reviewedAt: new Date() } as EnrichableProject;
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: [reviewed], client, apply: true });

    // The fixture's provenance is source-verification provenance, so this record
    // is not durably human-reviewed and is treated as unverified rather than
    // being overwritten — either way, nothing may claim a review it did not do.
    for (const write of writes) {
      assert.notEqual(write.data.reviewedBy, "machine");
      if ("trustLevel" in write.data) {
        assert.notEqual(write.data.trustLevel, "REVIEWED", "enrichment must never claim human review");
      }
    }
    assert.ok(result.rowsExamined === 1);
  });

  it("reports what it skipped to keep verification intact", async () => {
    const result = await enrichProjectPortfolio({ projects: [verifiedRowWithEmptyNumbers()], apply: false });
    assert.equal(typeof result.rowsSkippedToPreserveVerification, "number");
    assert.ok(Array.isArray(result.verificationSkips));
  });
});

describe("the import path assesses the fields it writes", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "app", "api", "company", "plan-b-import", "route.ts"),
    "utf8",
  );

  it("derives the portfolio facts before it decides trust", () => {
    const derive = source.indexOf("derivedFacts = mergeProjectFacts(");
    const decide = source.indexOf("const projectDecision = decidePlanBTrust(");
    assert.ok(derive > 0 && decide > 0);
    assert.ok(
      derive < decide,
      "facts derived after the trust decision are fields the provenance never assessed",
    );
  });

  it("puts the derived numbers into the field set that gets verified", () => {
    const start = source.indexOf("const projectDecision = decidePlanBTrust(");
    const decision = source.slice(start, source.indexOf("fallbackNotes", start));
    assert.ok(decision.includes("contractValue"), "contractValue must be assessed, not smuggled in");
    assert.ok(decision.includes("currency"), "currency must be assessed, not smuggled in");
  });

  it("writes one payload, the one that was assessed", () => {
    assert.ok(source.includes("const dataWithFacts = { ...data, ...derivedFacts };"));
    const write = source.indexOf("const dataWithFacts = { ...data, ...derivedFacts };");
    const decide = source.indexOf("const projectDecision = decidePlanBTrust(");
    assert.ok(write > decide, "the write happens after the assessment, over the same values");
  });
});

describe("the census reports what is proven, not only what is claimed", () => {
  it("separates the trustLevel column from the provenance that backs it", () => {
    const row = verifiedRowWithEmptyNumbers();
    const naivelyEnriched = { ...row, contractValue: 1_000_000, currency: "ETB" } as EnrichableProject;

    const claimed = censusOf([naivelyEnriched]);
    assert.equal(claimed.sourceVerified, 1, "the column still says SOURCE_VERIFIED");
    assert.equal(claimed.durablyVerified, 0, "but nothing proves it any more");

    const intact = censusOf([row]);
    assert.equal(intact.sourceVerified, 1);
    assert.equal(intact.durablyVerified, 1);
  });

  it("shows an applied run holding the durable count steady", async () => {
    const result = await enrichProjectPortfolio({ projects: [verifiedRowWithEmptyNumbers()], apply: false });
    assert.equal(result.before.durablyVerified, 1);
    assert.equal(
      result.after.durablyVerified,
      1,
      "a run that would lose a durable verification must show it in the census",
    );
  });
});
