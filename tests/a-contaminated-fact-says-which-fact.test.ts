// ─── A contaminated fact says WHICH fact ────────────────────────────────────
//
// THE DEFECT. `resolveCanonicalFieldState` writes eleven blocker reasons.
// Ten of them name the field:
//
//   Field "Deadline" has a value but is not yet source-grounded ...
//   Field "Client Name" appears contaminated by tender-portal navigation ...
//   Missing critical field: Submission Method.
//
// One did not:
//
//   blockerReason = validation.reason;
//
// and `validateFieldFormat` is deliberately field-agnostic, so that branch
// emitted a sentence about a value without saying whose value it was. It is
// also the branch that fires on contaminated extraction -- the exact
// condition CLAUDE.md requires to block final generation.
//
// On the exact-head Preview (tender d2b85e2a) it was the ENTIRE reason the
// ZIP was locked, three times over, verbatim:
//
//   AUTHORITY_OR_QUALITY_BLOCKERS: Authority or document quality blockers
//   remain: Value contains extractor field-label scaffolding or internal
//   extraction instructions and must be re-extracted as a single field
//   value. Value contains extractor field-label scaffolding or internal
//   extraction instructions and must be re-extracted as a single field
//   value. Value contains extractor field-label scaffolding or internal
//   extraction instructions and must be re-extracted as a single field
//   value.
//
// Three blocked facts, three identical anonymous sentences, and nothing to
// tell the owner which three.
//
// WHAT IS NOT CHANGED. The gate. A contaminated value still blocks final
// export exactly as before; only the sentence naming it was incomplete.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Test Tender",
    reference: "REF-2026-001",
    clientName: "Example Procuring Authority",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Testland",
    submissionMethod: "Email",
    submissionAddress: "bids@example.test",
    submissionEmails: "bids@example.test",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Example Procuring Authority is the procuring entity",
    clientNameSourceFileId: "file-active",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email",
    submissionMethodSourceFileId: "file-active",
    submissionAddressSourcePage: 2,
    submissionAddressSourceQuote: "Submit to this address",
    submissionAddressSourceFileId: "file-active",
    submissionEmailSourcePage: 2,
    submissionEmailSourceFileId: "file-active",
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function resolve(tender: Partial<CanonicalResolverInput["tender"]>) {
  return resolveCanonicalFieldState({
    tender: makeTender(tender),
    overrides: [],
    hasExtractedRequirements: true,
    activeTenderFileIds: new Set(["file-active"]),
  });
}

function field(result: ReturnType<typeof resolveCanonicalFieldState>, key: string) {
  const found = result.fields.find((f) => f.fieldKey === key);
  assert.ok(found, `field ${key} not found`);
  return found;
}

describe("a contaminated fact says which fact", () => {
  it("names the field when a value carries extractor scaffolding", () => {
    // A single column holding the extractor's own labels instead of one value.
    const scaffolded = "Client Name: Example Authority Procurement Reference: REF-1 Deadline: 2026-12-11";
    const clientName = field(resolve({ clientName: scaffolded }), "clientName");
    assert.ok(clientName.blockerReason, "a contaminated value must still produce a blocker reason");
    assert.match(clientName.blockerReason!, /Field "[^"]+"/,
      "the blocker reason must name the field it is about");
    assert.match(clientName.blockerReason!, /scaffolding|placeholder|generic field label|invalid/i,
      "the blocker reason must still carry the validator's cause");
  });

  it("still blocks final export, exactly as before", () => {
    const scaffolded = "Client Name: Example Authority Procurement Reference: REF-1 Deadline: 2026-12-11";
    const result = resolve({ clientName: scaffolded });
    assert.equal(result.hasExportBlocker, true, "a contaminated critical fact must block final export");
    assert.equal(field(result, "clientName").exportEligible, false);
  });

  it("distinguishes two contaminated facts instead of repeating one sentence", () => {
    // The live reading showed the same sentence three times over. Two
    // different blocked facts must now be distinguishable from each other.
    const result = resolve({
      clientName: "Client Name: Example Authority Procurement Reference: REF-1",
      title: "Tender Title: Some Project Reference Number: REF-1",
    });
    const a = field(result, "clientName").blockerReason;
    const b = field(result, "title").blockerReason;
    if (a && b) assert.notEqual(a, b, "two different blocked facts still read identically");
  });

  it("says nothing about a fact whose value is clean", () => {
    // Scoped to the fact under test on purpose: this minimal fixture does not
    // ground every critical field, so the tender as a whole still carries an
    // export blocker. What matters here is that a clean value produces no
    // blocker reason of its own and stays export-eligible.
    const result = resolve({});
    const clientName = field(result, "clientName");
    assert.equal(clientName.blockerReason, null);
    assert.equal(clientName.exportEligible, true);
  });

  it("carries no tender, sector, client or benchmark knowledge", () => {
    const reason = field(resolve({ clientName: "Client Name: X Reference: Y" }), "clientName").blockerReason;
    if (reason) assert.equal(/pharo|ethiop|addis|healthcare|architect|consultanc/i.test(reason), false);
  });
});
