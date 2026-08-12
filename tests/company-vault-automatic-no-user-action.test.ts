// Company Vault is automatic end to end: upload → extraction →
// SOURCE_VERIFIED → Run Engine. Nothing in that path asks the user to
// navigate, review, approve, confirm, or attach anything.
//
// This replaces tests/company-vault-experts-projects-review-cta.test.ts,
// which asserted the opposite — that the Experts and Projects tabs each
// carried an "Automatic verification →" link into /dashboard/company/review.
// A link labelled "automatic" that a user is expected to click is a
// contradiction: it turns a pipeline stage into a destination, and the two
// banners were the last place in the Vault that implied a human step
// existed. They are gone, so the old assertions had to go with them rather
// than be relaxed.
//
// Recovery controls ("Re-extract & Re-import All", per-document
// "Re-extract") re-run work the pipeline already performs and already
// retries on its own. They are kept — a genuinely stuck document needs a
// manual lever — but collapsed into one "Diagnostics and Recovery"
// disclosure and removed from the document rows, because a re-extract
// button beside every file reads as a required step rather than an
// exception path.
//
// The UI facts below are asserted against app/dashboard/company/page.tsx's
// source. That is a live Next.js route module, not an unreachable file, so
// these are assertions about the page the user actually loads. The
// Vault→Engine authority facts are asserted by calling the real eligibility
// functions, because behaviour must be proven by behaviour.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { checkMatchingEligibility } from "../lib/engine/matching-eligibility";
import { isDurablySourceVerified } from "../lib/vault-review-provenance";

const VAULT_PAGE = "app/dashboard/company/page.tsx";
const page = readFileSync(VAULT_PAGE, "utf8");

/** Index of the single "Diagnostics and Recovery" disclosure. */
const detailsIndex = page.indexOf("<details");

/**
 * The Documents tab's rendered JSX, from the tab marker up to the recovery
 * disclosure's leading comment. Slicing the render region rather than the
 * whole file prefix matters: reimportAll() and reextractDoc() are declared
 * near the top of the module, and their bodies legitimately contain
 * "Re-extraction …" progress copy. What must stay clean is the markup the
 * user sees during normal use, not the recovery handlers those controls call.
 */
const DOCUMENTS_TAB_MARKER = "{/* Documents Tab */}";
const RECOVERY_BLOCK_MARKER = "{/* ── Diagnostics and Recovery";
const documentsTabStart = page.indexOf(DOCUMENTS_TAB_MARKER);
const recoveryBlockStart = page.indexOf(RECOVERY_BLOCK_MARKER);
const normalDocumentFlow = page.slice(documentsTabStart, recoveryBlockStart);

/** Every JSX call site of a recovery action (not its function definition). */
const RECOVERY_ACTION_HANDLERS = [
  "onClick={()=>void reimportAll()}",
  "onClick={()=>void reextractDoc(",
];

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return out;
}

describe("Company Vault requires no navigation, review, or approval", () => {
  it("has no link to the review route anywhere on the page", () => {
    assert.doesNotMatch(
      page,
      /\/dashboard\/company\/review/,
      `${VAULT_PAGE} must not route the user to a review surface: verification is automatic`,
    );
  });

  it("keeps the Experts and Projects tabs informational, with no call to action", () => {
    assert.match(page, /Run Engine automatically source-verifies eligible expert records/);
    assert.match(page, /Run Engine automatically source-verifies eligible project records/);
    assert.doesNotMatch(page, /Automatic verification →/);
    assert.doesNotMatch(page, /Review experts →|Review projects →|Review each file before using/);
  });

  it("uses no wording implying manual review, approval, confirmation, or source attachment", () => {
    // User-visible strings only: JSX text nodes and the pipeline badge
    // messages. Identifiers such as confirmingDeleteDocId and the delete
    // confirmation (a destructive-action guard, not an approval step) are
    // deliberately out of scope.
    //
    // Comments are stripped first. The `>…<` scrape cannot tell a JSX text
    // node from a prose comment that happens to contain both characters, so
    // without this a code comment explaining *why* nothing needs approval
    // would itself trip the /approve/i rule — failing the test for text no
    // user will ever see, and pressuring the next author to write a worse
    // comment instead of a better page.
    const rendered = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const userVisible = [
      ...occurrences(rendered, 'message: "').map((at) => rendered.slice(at + 10, rendered.indexOf('"', at + 10))),
      ...(rendered.match(/>[^<>{}]{12,}</g) ?? []),
    ].join("\n");

    for (const forbidden of [
      /Review Inbox/,
      /awaiting review/i,
      /needs? review/i,
      /approve/i,
      /attach the original/i,
      /link the source/i,
      /repair manually/i,
    ]) {
      assert.doesNotMatch(userVisible, forbidden, `Company Vault must not tell the user to ${forbidden}`);
    }
  });
});

describe("Company Vault recovery controls are an optional, collapsed exception path", () => {
  it("groups them in a single Diagnostics and Recovery disclosure", () => {
    assert.ok(detailsIndex !== -1, "expected a <details> recovery disclosure");
    assert.equal(occurrences(page, "<details").length, 1, "expected exactly one recovery disclosure");
    assert.match(page, /<summary[^>]*>\s*Diagnostics and Recovery/);
  });

  it("is collapsed by default", () => {
    assert.doesNotMatch(
      page,
      /<details[^>]*\sopen[\s>]/,
      "the recovery disclosure must not be open by default",
    );
  });

  it("puts every recovery control inside that disclosure and none in the document rows", () => {
    for (const handler of RECOVERY_ACTION_HANDLERS) {
      const sites = occurrences(page, handler);
      assert.equal(sites.length, 1, `${handler} should have exactly one call site`);
      assert.ok(
        sites[0] > detailsIndex,
        `${handler} must live inside Diagnostics and Recovery, not in the normal document flow`,
      );
    }
  });

  it("leaves the normal upload → extraction path with no recovery control", () => {
    assert.ok(documentsTabStart !== -1, "expected the Documents tab marker");
    assert.ok(recoveryBlockStart > documentsTabStart, "recovery block must come after the document rows");
    // The normal workflow — header, upload dropzone, pipeline badge, and the
    // document rows themselves — offers no way to re-run extraction, because
    // extraction is not something the user is asked to run.
    assert.doesNotMatch(normalDocumentFlow, /Re-extract/i, "the normal workflow must not surface a re-extract control");
    assert.doesNotMatch(normalDocumentFlow, /Re-import/i, "the normal workflow must not surface a re-import control");
    assert.match(page, /Ingestion extracts and source-verifies eligible evidence before Run Engine uses it for matching/);
  });
});

describe("automatic Vault-to-Engine authority is unchanged", () => {
  const sourceDocument = { id: "doc-1", companyId: "co-1", deletedAt: null } as never;

  it("still rejects a draft record fail-closed", () => {
    const result = checkMatchingEligibility({
      id: "e1",
      companyId: "co-1",
      fullName: "Draft Expert",
      trustLevel: "AI_DRAFT",
      sourceDocumentId: "doc-1",
      reviewedBy: null,
      reviewedAt: null,
      sourceDocument,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.reason, "NOT_REVIEWED");
  });

  it("still rejects a record with no source document", () => {
    const result = checkMatchingEligibility({
      id: "e2",
      companyId: "co-1",
      fullName: "Unsourced Expert",
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: null,
      reviewedBy: null,
      reviewedAt: null,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.reason, "NO_SOURCE_DOCUMENT");
  });

  it("still requires reviewer identity and timestamp when a record claims REVIEWED", () => {
    const result = checkMatchingEligibility({
      id: "e3",
      companyId: "co-1",
      fullName: "Claimed Reviewed Expert",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: null,
      reviewedAt: null,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false && result.reason, "NO_REVIEWER");
  });

  it("never treats fabricated human-review metadata as source verification", () => {
    // The automatic path must not be able to launder itself into REVIEWED by
    // stamping reviewedBy/reviewedAt onto a SOURCE_VERIFIED record.
    const fabricated = {
      id: "e4",
      companyId: "co-1",
      fullName: "Fabricated Expert",
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: "doc-1",
      reviewedBy: "system",
      reviewedAt: new Date(),
      reviewNotes: null,
      sourceDocument,
    } as never;
    assert.equal(isDurablySourceVerified(fabricated), false);
    assert.equal(checkMatchingEligibility(fabricated).eligible, false);
  });
});
