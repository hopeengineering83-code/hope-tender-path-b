// 2026-09-23, Preview. The tender text arrived flattened, one line:
//   "... Issuing Entity / Client: Pharo Ventures Procuring Entity / Client Name:
//    Pharo Ventures Legal Client Name: Pharo Ventures Project Name: ..."
// The label cutter required a colon straight after a base label word, so every
// compound label ("Procuring Entity / Client Name:", "Legal Client Name:")
// was read as part of the value. The client name became a run-on string, was
// correctly flagged as contaminated and cleared, and Run Engine then stopped on
// "Critical tender details field clientName has no value".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { cutAtNextFieldLabel } from "../lib/engine/tender-field-extractors";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";

const LIVE = "CLIENT DETAILS AND TENDER METADATA Tender Title: Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center Tender Type: Request for Technical Proposal / RFP Issuing Entity / Client: Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal Client Name: Pharo Ventures Project Name: Pharo Health Ethiopia Specialty Medical Center Country: Ethiopia City / Location: Addis Ababa Tender Status: Open Financial Proposal Required: No.";

describe("a compound label ends the value before it", () => {
  for (const [input, expected] of [
    ["Pharo Ventures Procuring Entity / Client Name: Pharo Ventures", "Pharo Ventures"],
    ["Pharo Ventures Legal Client Name: Pharo Ventures", "Pharo Ventures"],
    ["Ministry of Health Project Name: New Hospital", "Ministry of Health"],
    ["Addis Ababa Tender Status: Open", "Addis Ababa"],
    ["Ministry of Health Client: X", "Ministry of Health"],
  ] as const) {
    it(`"${input}" → "${expected}"`, () => assert.equal(cutAtNextFieldLabel(input), expected));
  }

  it("does not cut a value that merely contains a label word", () => {
    assert.equal(cutAtNextFieldLabel("Client Services Agency of Ethiopia"), "Client Services Agency of Ethiopia");
    assert.equal(cutAtNextFieldLabel("Project Management Unit, Ministry of Water"), "Project Management Unit, Ministry of Water");
  });

  it("extracts the live tender's client as the client", () => {
    const text = LIVE + "\n" + "The consultant shall support Pharo Ventures in identifying suitable premises. ".repeat(20);
    assert.equal(inferTenderMetadata(text, "tender.pdf").clientName, "Pharo Ventures");
  });

  it("Run Engine refills empty fields from source after clearing contaminated ones", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    const cleanAt = route.indexOf("computeStoredMetadataPatch(tender)");
    const refillAt = route.indexOf("autoFillTenderMetadata(");
    assert.ok(cleanAt > 0 && refillAt > cleanAt, "refill must run after the contamination cleanup");
  });
});

describe("the Run Engine refill never touches the analysis input", () => {
  // tender-analysis-content.ts hashes title + description + intakeSummary +
  // source text. Filling an empty description during Run Engine changed that
  // hash and the route answered 422 CURRENT_ANALYSIS_REQUIRED — the refill
  // would have demanded a fresh AI Analyze from the owner.
  it("preserveAnalysisInputs drops title/description/intakeSummary from the write", async () => {
    const { autoFillTenderMetadata, ANALYSIS_INPUT_FIELDS } = await import("../lib/engine/auto-fill-tender-metadata");
    assert.deepEqual([...ANALYSIS_INPUT_FIELDS], ["title", "description", "intakeSummary"]);
    const writes: Array<Record<string, unknown>> = [];
    const prisma = { tender: { update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return {}; } } } as any;
    const text = LIVE + "\n" + "The consultant shall support Pharo Ventures in identifying suitable premises. ".repeat(20);
    await autoFillTenderMetadata(
      { id: "t", title: null, description: null, intakeSummary: null, clientName: null, files: [{ extractedText: text, originalFileName: "t.pdf" }] },
      prisma,
      { preserveAnalysisInputs: true },
    );
    const written = Object.assign({}, ...writes);
    for (const field of ANALYSIS_INPUT_FIELDS) assert.ok(!(field in written), `${field} was written`);
    assert.equal(written.clientName, "Pharo Ventures");
  });

  it("the engine route asks for it", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    assert.match(route, /preserveAnalysisInputs: true/);
  });
});

describe("a tender that says it has no reference has no reference", () => {
  // 2026-09-24, Preview: Run Engine stopped on "Automatic Build Plan
  // verification blocked (TENDER_FACTS_INVALID): ... Critical metadata field
  // reference has a placeholder value (\"Not\")" — the second-pass extractor
  // read "Tender Reference: Not provided" as the reference "Not".
  it("the second-pass reference extractor refuses negations and placeholders", async () => {
    const { extractReference } = await import("../lib/engine/tender-field-extractors");
    const body = " The consultant shall support the client in identifying suitable premises.".repeat(20);
    for (const line of ["Tender Reference: Not provided.", "Reference Number: Not stated", "RFP Reference: None", "Reference No.: N/A"]) {
      const r = extractReference({ files: [{ fileName: "t.pdf", extractedText: "Tender Title: X " + line + body, totalPages: 1 }] } as any);
      assert.equal(r.found ? r.value : null, null, line);
    }
    const ok = extractReference({ files: [{ fileName: "t.pdf", extractedText: "Tender Reference: PV-RFP-2026-014" + body, totalPages: 1 }] } as any);
    assert.equal(ok.found ? ok.value : null, "PV-RFP-2026-014");
  });

  it("the refill never writes a placeholder string", () => {
    const source = readFileSync("lib/engine/auto-fill-tender-metadata.ts", "utf8");
    const fn = source.slice(source.indexOf("function trySecondPassScalar"), source.indexOf("function trySecondPassScalar") + 900);
    assert.match(fn, /containsMetadataPlaceholder\(extracted\)/);
  });
});
