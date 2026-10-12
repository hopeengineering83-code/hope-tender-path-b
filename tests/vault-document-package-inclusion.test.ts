// Official Vault bytes in a client package: ADMIN only, and nothing invented.
//
// A verified Company Vault upload IS an official company document, and putting
// its exact bytes into the submission package is legitimate. How the two
// link-vault-evidence routes did it was not:
//
//   - Any PROPOSAL_MANAGER could place official company documents into a
//     package that goes to a client.
//   - The row was written straight to VALIDATED + READY_FOR_EXPORT whenever a
//     filename-and-text hygiene heuristic found nothing to complain about. No
//     canonical validation had run; no person had approved anything.
//   - A DocumentReview row was created naming the actor as reviewer with
//     action READY_FOR_EXPORT. Clicking "link" is not reviewing. That row is a
//     fabricated human record sitting in the audit trail.
//   - Bytes were assigned to fileContent directly, so contentSha256,
//     contentByteLength and the legacy sha256/byteSize columns kept whatever
//     the document held BEFORE. The digest then described bytes that were no
//     longer there — the exact condition the final-ZIP verifier exists to catch.
//   - With no bytes available, a DOCX was manufactured from extracted text and
//     attached as if it were the official document. A generated approximation
//     of a licence is not a licence.
//
// These tests pin all five.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { describeVaultInclusionProvenance, INCLUDABLE_VAULT_DOCUMENT_WHERE } from "../lib/engine/vault-document-package-inclusion";

const MODULE = readFileSync("lib/engine/vault-document-package-inclusion.ts", "utf8");
const SINGLE = readFileSync("app/api/tenders/[id]/link-vault-evidence/route.ts", "utf8");
const AUTO = readFileSync("app/api/tenders/[id]/link-vault-evidence-auto/route.ts", "utf8");

describe("only ADMIN may place official company documents in a client package", () => {
  it("the single-document route is ADMIN-only on POST", () => {
    const post = SINGLE.slice(SINGLE.indexOf("export async function POST"));
    assert.match(post, /requireRole\("ADMIN"\)/);
    assert.doesNotMatch(post.slice(0, 400), /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("the auto route is ADMIN-only", () => {
    const post = AUTO.slice(AUTO.indexOf("export async function POST"));
    assert.match(post.slice(0, 400), /requireRole\("ADMIN"\)/);
    assert.doesNotMatch(post.slice(0, 400), /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });
});

describe("inclusion never fabricates validation, approval or a human reviewer", () => {
  it("writes PENDING validation and PENDING review, nothing stronger", () => {
    const update = MODULE.slice(MODULE.indexOf("client.generatedDocument.update"));
    const body = update.slice(0, update.indexOf("});"));
    assert.match(body, /validationStatus: "PENDING"/);
    assert.match(body, /reviewStatus: "PENDING"/);
    assert.doesNotMatch(body, /VALIDATED/);
    assert.doesNotMatch(body, /READY_FOR_EXPORT/);
    assert.doesNotMatch(body, /APPROVED/);
  });

  it("creates no DocumentReview anywhere in the inclusion path", () => {
    // Including a file is not reviewing it. A review row here would put a
    // person's name against an approval they never gave.
    for (const [label, src] of [["module", MODULE], ["single route", SINGLE], ["auto route", AUTO]] as const) {
      assert.doesNotMatch(src, /documentReview\.create/, `${label} must not fabricate a review record`);
    }
  });

  it("never writes reviewer or approver identity fields", () => {
    for (const forbidden of ["reviewedBy", "reviewedAt", "approvedBy", "approvedAt", "reviewerId"]) {
      assert.doesNotMatch(MODULE, new RegExp(forbidden), `inclusion must never write ${forbidden}`);
    }
  });

  it("the result message does not claim the document is ready for export", () => {
    assert.doesNotMatch(AUTO, /linked and ready for export/);
    assert.match(AUTO, /still need canonical validation and approval before final export/);
  });
});

describe("the bytes and their digest describe the same file", () => {
  it("persists through the digest-computing path instead of assigning fileContent", () => {
    assert.match(MODULE, /persistGeneratedDocumentContent\(\{/);
    // A direct fileContent assignment is what left stale digests behind.
    const update = MODULE.slice(MODULE.indexOf("client.generatedDocument.update"));
    assert.doesNotMatch(update.slice(0, update.indexOf("});")), /fileContent/);
    for (const [label, src] of [["single route", SINGLE], ["auto route", AUTO]] as const) {
      assert.doesNotMatch(src, /generatedDocument\.update/, `${label} must go through the shared inclusion authority`);
    }
  });

  it("refuses bytes whose digest no longer matches the verified record", () => {
    assert.match(MODULE, /vault\.contentSha256 && vault\.contentSha256 !== sha256/);
    assert.match(MODULE, /CONTENT_HASH_MISMATCH/);
  });

  it("requires the Vault document to have passed byte verification", () => {
    assert.match(MODULE, /vault\.integrityStatus !== "VERIFIED"/);
  });
});

describe("nothing is manufactured in place of the official document", () => {
  it("no DOCX is built from extracted text in either route", () => {
    for (const [label, src] of [["single route", SINGLE], ["auto route", AUTO], ["module", MODULE]] as const) {
      assert.doesNotMatch(src, /extractedTextDocx/, `${label} must not manufacture a stand-in document`);
      assert.doesNotMatch(src, /from "docx"/, `${label} must not build documents at all`);
    }
  });

  it("a Vault document with no stored bytes is refused, not approximated", () => {
    assert.match(MODULE, /has no stored file bytes to include/);
  });
});

describe("the candidate list only offers what inclusion accepts", () => {
  it("requires verified integrity and real stored bytes", () => {
    assert.equal(INCLUDABLE_VAULT_DOCUMENT_WHERE.integrityStatus, "VERIFIED");
    assert.equal(INCLUDABLE_VAULT_DOCUMENT_WHERE.OR.length, 2, "either external storage or inline bytes");
  });

  it("both routes build candidates from that one filter", () => {
    for (const [label, src] of [["single route", SINGLE], ["auto route", AUTO]] as const) {
      assert.match(src, /INCLUDABLE_VAULT_DOCUMENT_WHERE/, `${label} must filter candidates the same way`);
      // Offering an extractedText-only document would be an option guaranteed
      // to fail the moment the user picked it.
      assert.doesNotMatch(src, /extractedText/, `${label} must not treat extracted text as a candidate`);
    }
  });
});

describe("provenance is recorded and does not read as approval", () => {
  it("names the source, digest, size and type", () => {
    const line = describeVaultInclusionProvenance({
      vaultDocumentId: "vault-9",
      vaultFileName: "Trade Licence 2026.pdf",
      sha256: "c".repeat(64),
      byteLength: 8421,
      mimeType: "application/pdf",
    });
    assert.match(line, /source=Trade Licence 2026\.pdf \(vault id vault-9\)/);
    assert.match(line, new RegExp(`sha256=${"c".repeat(64)}`));
    assert.match(line, /bytes=8421/);
    assert.match(line, /mime=application\/pdf/);
  });

  it("states that it is neither validated nor reviewed", () => {
    const line = describeVaultInclusionProvenance({
      vaultDocumentId: "v", vaultFileName: "n", sha256: "s", byteLength: 1, mimeType: "application/pdf",
    });
    assert.match(line, /Not validated and not reviewed/);
  });
});
