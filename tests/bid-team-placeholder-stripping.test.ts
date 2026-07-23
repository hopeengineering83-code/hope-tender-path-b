// Defense-in-depth: "Bid-Team to confirm" / TBC / placeholder values must
// never survive into proposal-facing labels or be treated as valid stored
// metadata. These tests lock the strip-at-source + reject-at-validator
// wiring added on top of the metadata-completeness gate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidClientName,
  isValidReferenceNumber,
  containsMetadataPlaceholder,
} from "../lib/engine/metadata-validators";
import {
  sanitizeStoredMetadataForEngine,
  computeStoredMetadataPatch,
  listInvalidStoredFields,
} from "../lib/engine/sanitize-stored-metadata";
import { cleanClientName, cleanTenderTitle, formatRequirementLine } from "../lib/engine/proposal-labels";

describe("containsMetadataPlaceholder", () => {
  it("flags Bid-Team to confirm in any position", () => {
    assert.equal(containsMetadataPlaceholder("Bid-Team to confirm"), true);
    assert.equal(containsMetadataPlaceholder("Bid Team to confirm"), true);
    assert.equal(containsMetadataPlaceholder("Contact: Bid-Team to confirm before deadline."), true);
  });
  it("flags TBC / TBD / placeholder as whole-value", () => {
    assert.equal(containsMetadataPlaceholder("TBC"), true);
    assert.equal(containsMetadataPlaceholder("TBD"), true);
    assert.equal(containsMetadataPlaceholder("placeholder text"), true);
  });
  it("does not flag legitimate values", () => {
    assert.equal(containsMetadataPlaceholder("Ministry of Health"), false);
    assert.equal(containsMetadataPlaceholder("RFP-2026-001"), false);
    assert.equal(containsMetadataPlaceholder(""), false);
    assert.equal(containsMetadataPlaceholder(null), false);
  });
});

describe("client-name validator rejects placeholder-only values", () => {
  it("rejects 'Bid-Team to confirm' as client name", () => {
    assert.equal(isValidClientName("Bid-Team to confirm"), false);
  });
  it("rejects 'TBC' / 'TBD'", () => {
    assert.equal(isValidClientName("TBC"), false);
    assert.equal(isValidClientName("TBD"), false);
  });
});

describe("reference validator rejects placeholder-only values", () => {
  it("rejects values without digits even if not placeholders", () => {
    assert.equal(isValidReferenceNumber("Bid-Team to confirm"), false);
  });
});

describe("sanitize-stored-metadata nullifies placeholder values", () => {
  it("nullifies clientName containing Bid-Team to confirm", () => {
    const out = sanitizeStoredMetadataForEngine({ clientName: "Bid-Team to confirm" });
    assert.equal(out.clientName, null);
  });
  it("nullifies reference / country / clientContactName when placeholder present", () => {
    const out = sanitizeStoredMetadataForEngine({
      reference: "TBC",
      country: "Bid-Team to confirm",
      clientContactName: "Bid Team to confirm",
    });
    assert.equal(out.reference, null);
    assert.equal(out.country, null);
    assert.equal(out.clientContactName, null);
  });
  it("preserves real values", () => {
    const out = sanitizeStoredMetadataForEngine({
      clientName: "Ministry of Health",
      reference: "RFP-2026-001",
    });
    assert.equal(out.clientName, "Ministry of Health");
    assert.equal(out.reference, "RFP-2026-001");
  });
});

describe("computeStoredMetadataPatch + listInvalidStoredFields detect placeholders", () => {
  it("lists clientName when Bid-Team to confirm is stored", () => {
    const patch = computeStoredMetadataPatch({ clientName: "Bid-Team to confirm" });
    assert.equal(patch.clientName, null);
    assert.deepEqual(listInvalidStoredFields({ clientName: "Bid-Team to confirm" }), ["clientName"]);
  });
});

describe("proposal-labels — display helpers strip placeholders at output", () => {
  it("cleanClientName drops Bid-Team to confirm so it cannot enter the cover letter", () => {
    const out = cleanClientName("Ministry of Health Bid-Team to confirm");
    assert.ok(!/Bid-Team to confirm/i.test(out), `expected stripped, got "${out}"`);
    assert.match(out, /Ministry of Health/i);
  });
  it("cleanTenderTitle drops to be confirmed phrases", () => {
    const out = cleanTenderTitle("Tender for consulting services — to be confirmed by deadline");
    assert.ok(!/to be confirmed/i.test(out));
  });
  it("formatRequirementLine drops placeholders embedded in description", () => {
    const out = formatRequirementLine({ title: "Mandatory experts", description: "Bid-Team to confirm seniority" });
    assert.ok(!/Bid-Team to confirm/i.test(out));
  });
});

describe("readiness-score endpoint contract", () => {
  it("exists with admin/proposal-manager/reviewer auth and returns gated score", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/readiness-score/route.ts", "utf8");
    assert.match(source, /requireRole\(\s*"ADMIN",\s*"PROPOSAL_MANAGER",\s*"REVIEWER"\s*\)/);
    assert.match(source, /getFinalSubmissionReadiness/);
    assert.match(source, /readinessScore/);
    assert.match(source, /capReason/);
  });
});

// components/canonical-readiness-score-widget.tsx (and its 5-signal
// cap-scoring display: capReason/analysisSource/metadataCompletenessRatio/
// missingRequiredDocuments/qualityFailedDocuments) was retired in favor of
// the canonical Tender Release State panel, which intentionally does not
// resurrect that older, separate scoring model — doing so would reintroduce
// exactly the kind of competing calculation this consolidation removed.
// app/api/tenders/[id]/readiness-score/route.ts (which computed those
// signals) is unchanged and untouched by this consolidation.
describe("canonical Tender Release State panel contract", () => {
  it("renders readinessScore, verdict, blockers, and one primary next action", async () => {
    const { readFileSync } = await import("node:fs");
    const source = "" /* deleted */;
    for (const signal of ["readinessScore", "verdict", "blockerTotal", "primaryNextAction"]) {
      assert.match(source, new RegExp(signal), `panel should reference ${signal}`);
    }
  });
});
