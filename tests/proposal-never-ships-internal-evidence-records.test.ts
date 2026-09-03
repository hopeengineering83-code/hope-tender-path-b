/**
 * The engine's own bookkeeping must never reach the client's proposal.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real Pharo generation produced a 10,758-word Technical Proposal that
 * contained, verbatim, inside the document the evaluator reads:
 *
 *   FULL: Submission Format & Document Control | PACKAGECONFORMANCE from
 *   AUTOPACKAGECONFORMANCE | ref: Current submission package —
 *   automatic-requirement-evidence:v1:{"version":1,"evidenceKey":"...",
 *   "requirementSourceQuoteHash":"e01d032c...","sourceContentHash":"49d9a3a6...",
 *   "linkageScore":100,...}
 *
 * ComplianceMatrix.notes carries that serialized record for reconciliation.
 * automatic-requirement-coverage.ts owns the marker and already exports
 * clientSafeComplianceNote() to strip it, stating that every consumer which
 * renders a note to a human must read it through that function. The proposal
 * builder appended `m.notes` raw instead, so document UUIDs, content hashes
 * and linkage scores were written into a client deliverable — and the hygiene
 * gate then blocked the required PDF, and with it the whole export.
 *
 * The fix is to use the helper that already exists. These tests pin the
 * behaviour rather than the call, so a future rewrite that re-introduces the
 * raw note fails here.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clientSafeComplianceNote,
  serializeAutomaticRequirementEvidence,
  AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX,
} from "../lib/engine/automatic-requirement-coverage";

describe("a compliance note rendered for a human carries no evidence record", () => {
  const serialized = serializeAutomaticRequirementEvidence({
    version: 1,
    evidenceKey: "PACKAGE_CONFORMANCE:FINANCIAL_SEPARATION:49d9a3a6",
    recordType: "PACKAGE_CONFORMANCE",
    recordId: "tender:FINANCIAL_SEPARATION",
    label: "Current submission package",
    requirementId: "9bd7ae35-2b37-4f31-878c-51f41535f8ab",
    requirementSourceFileId: "307a4e36-f064-4e0a-b72f-22881c555dd2",
    requirementSourceQuoteHash: "e01d032c044619a8e239c9d50e12b0c118bba719",
    sourceDocumentId: null,
    sourceContentHash: "49d9a3a6a6c85e7f2233aeb8d8c32a26ef3f7cd2",
    sourceByteLength: 42,
    sourceFileName: "Current submission package",
    sourceSection: "FINANCIAL_SEPARATION",
    sourceQuote: "the financial-separation rule is obeyed by construction.",
    matchedFacets: [],
    missingFacets: [],
    sourceRevision: "1266f5a2",
    evidenceRevision: "49d9a3a6",
    linkageScore: 100,
    linkageReasons: [],
    state: "ACTIVE",
  } as never);

  it("strips the serialized record from a note that carries one", () => {
    const note = `The package obeys the rule. ${serialized}`;
    const safe = clientSafeComplianceNote(note);
    assert.ok(!safe.includes(AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX));
    assert.ok(!safe.includes("linkageScore"));
    assert.ok(!safe.includes("requirementSourceQuoteHash"));
  });

  it("keeps the human-readable part of the note", () => {
    // Stripping must not silently delete the reviewer's actual sentence.
    assert.equal(clientSafeComplianceNote(`The package obeys the rule. ${serialized}`).trim(),
      "The package obeys the rule.");
  });

  it("leaves an ordinary note untouched", () => {
    assert.equal(clientSafeComplianceNote("Tax clearance verified against the uploaded certificate."),
      "Tax clearance verified against the uploaded certificate.");
  });
});

describe("the proposal builder reads notes through the helper", () => {
  const SRC = readFileSync(path.join(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");

  it("never interpolates ComplianceMatrix.notes directly into a proposal line", () => {
    // This is the exact shape that shipped the JSON blob to a client.
    assert.ok(
      !/\$\{m\.notes \? ` — \$\{m\.notes\}` : ""\}/.test(SRC),
      "the raw note must not be interpolated into a rendered compliance line",
    );
  });

  it("routes the whole compliance row through the owning module's client-safe renderer", () => {
    // This asserted `clientSafeComplianceNote(m.notes)` verbatim, which pinned
    // the note field alone. The other four fields on the same line were just
    // as internal and leaked into a real client proposal — the evidence-kind
    // enum (PROPOSAL_RESPONSE, PACKAGE_CONFORMANCE), the drafting-state source
    // (AUTO_BYTE_VERIFIED_VAULT_DOCUMENT, "Company evidence available for
    // drafting") and a stored Company Vault filename in the reference.
    //
    // The guarantee is therefore stated over the WHOLE row, and the raw-field
    // check below makes this strictly stronger than the assertion it replaces:
    // sanitising the note is no longer enough to pass.
    const start = SRC.indexOf("const complianceLines = [");
    assert.ok(start > 0, "complianceLines must exist");
    const block = SRC.slice(start, start + 1400);
    assert.ok(
      block.includes("clientSafeComplianceEvidence(m)"),
      "compliance lines must be sanitised through the owning module's helper",
    );
    for (const field of ["m.evidenceType", "m.evidenceSource", "m.evidenceReference", "m.supportLevel", "m.notes"]) {
      assert.equal(
        block.includes(`\${${field}}`),
        false,
        `${field} must not be interpolated raw into a client-facing compliance line`,
      );
    }
  });
});
