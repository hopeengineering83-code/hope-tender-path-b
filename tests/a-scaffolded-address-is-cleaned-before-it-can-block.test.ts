// 2026-09-23, Preview: Run Engine completed and every downstream stage paused:
//   Field "Submission address": Value contains extractor field-label
//   scaffolding or internal extraction instructions ...
// (and the same for Client address and Pre-bid meeting location). The stored
// submission address was, verbatim:
const LIVE = "/ Portal: No physical address or portal is provided. Use email submission only. Financial Proposal: Not required at this stage. Do not generate a financial proposal. Bid Bond / Bid";
// Three gaps let it block: the upload-time extractor stored it unguarded; the
// engine route's cleanup listed only name-type fields as invalid, so it never
// applied the patch that would clear it; and the engine route did not even
// select the address fields.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../lib/engine/sanitize-stored-metadata";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";

describe("a scaffolded address is cleaned before it can block", () => {
  it("is listed as invalid, so the cleanup actually runs", () => {
    const tender = { clientName: "Pharo Ventures", submissionAddress: LIVE, clientAddress: LIVE, preBidMeetingLocation: LIVE } as any;
    const listed = listInvalidStoredFields(tender);
    for (const field of ["submissionAddress", "clientAddress", "preBidMeetingLocation"]) {
      assert.ok(listed.includes(field), `${field} not listed: ${listed.join(", ")}`);
    }
    const patch = computeStoredMetadataPatch(tender) as Record<string, unknown>;
    assert.equal(patch.submissionAddress, null);
  });

  it("leaves a real address alone", () => {
    const tender = { submissionAddress: "Bole Road, Addis Ababa, Ethiopia" } as any;
    assert.ok(!listInvalidStoredFields(tender).includes("submissionAddress"));
  });

  it("the engine route loads the fields its cleanup inspects", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    for (const field of ["submissionAddress", "clientAddress", "preBidMeetingLocation"]) {
      assert.match(route, new RegExp(`\\b${field}: true`), `${field} is not selected`);
    }
  });

  it("the upload-time extractor does not store a worksheet as an address", () => {
    const text = [
      "REQUEST FOR PROPOSAL",
      "Procuring Entity / Client Name: Pharo Ventures",
      "Submission Address / Portal: No physical address or portal is provided. Use email submission only. Financial Proposal: Not required at this stage. Do not generate a financial proposal. Bid Bond / Bid Security: Not required.",
      "Client Address / Portal: No physical address or portal is provided. Use email submission only. Financial Proposal: Not required.",
      "The consultant shall prepare the architectural and MEP design of the hospital building. ".repeat(12),
    ].join("\n");
    const draft = inferTenderMetadata(text, "tender.pdf");
    for (const field of ["submissionAddress", "clientAddress", "preBidMeetingLocation"] as const) {
      const value = draft[field];
      assert.ok(value == null || !/financial proposal|use email submission only/i.test(value), `${field} stored scaffolding: ${value}`);
    }
  });
});
