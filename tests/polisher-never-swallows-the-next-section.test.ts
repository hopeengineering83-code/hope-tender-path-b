import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { polishBenchmarkOutput } from "../lib/engine/benchmark-output-polisher";

// ─── What this file proves ───────────────────────────────────────────────────
//
// polishBenchmarkOutput carried the rule
//
//     .replace(/\s+\|\s+#/g, " — ")
//
// and `\s` matches newlines. So wherever a markdown table was followed by a
// section, the rule reached across the blank line and replaced the row's
// closing "|", the paragraph break and the next heading's "#" with " — ",
// pulling the entire following section into the last table cell.
//
// Measured on a real generated Technical Proposal: "## A.6 Biomedical
// Engineering Specialist Engagement Plan" — the section that tells the
// evaluator the firm will engage a licensed specialist for a discipline its own
// reviewed team does not hold — ended up inside the last row of the A.5
// Team-to-Project Mapping table. It never appeared as a heading, never reached
// the table of contents, and the proposal's one honest statement about the
// tender's biomedical requirement was invisible while its text corrupted a
// table. That requirement must be reported, never fabricated and never lost.

const TABLE_THEN_SECTION = [
  "| Expert & Role | Role Previously Performed | Previous Comparable Project | Key Technical Contribution |",
  "|---|---|---|---|",
  "| A. Architect, Architect | Senior Architect | Northern Referral Hospital | Design lead for clinical zoning |",
  "",
  "## A.6 Biomedical Engineering Specialist Engagement Plan",
  "",
  "The tender explicitly requires availability of a biomedical engineering specialist. The firm will engage a licensed specialist for this assignment.",
  "",
  "## A.7 In-House Capabilities",
  "",
  "In-house survey, geotechnical and materials-testing capability.",
].join("\n");

describe("the output polisher never swallows the section after a table", () => {
  const polished = polishBenchmarkOutput(TABLE_THEN_SECTION);

  it("keeps the following section's heading a heading", () => {
    assert.match(polished, /^##\s+A\.6 Biomedical Engineering Specialist Engagement Plan$/m, `the section heading was destroyed:\n${polished}`);
    assert.match(polished, /^##\s+A\.7 In-House Capabilities$/m);
  });

  it("leaves the table row closed", () => {
    assert.match(polished, /\| Design lead for clinical zoning \|$/m, `the table row lost its closing pipe:\n${polished}`);
  });

  it("does not glue the section into a table cell", () => {
    assert.doesNotMatch(polished, /Design lead for clinical zoning — #/, "a section was pulled into the last cell");
  });

  it("still collapses the inline artefact the rule was written for", () => {
    // The rule exists to tidy a stray "text | #ref" fragment on ONE line.
    assert.match(polishBenchmarkOutput("Requirement text | #4 follow-up"), /Requirement text — 4 follow-up/);
  });
});

// ─── Vault bookkeeping is not client-facing text ─────────────────────────────
//
// persistOnce prefixes an unverified record's profile/summary with its own
// trust marker so the app can see the state. A real proposal printed that
// marker to the evaluator, together with the extraction scaffolding around it —
// including inside a table cell, where the collapsed newlines put it out of
// reach of the standalone-bracket rule in client-text-sanitizer.

describe("vault bookkeeping never reaches the evaluator", () => {
  const CELL = "**Profile.** [REGEX_DRAFT — AUTOMATIC SOURCE VERIFICATION PENDING] Expert: S. Architect Primary position: Architect Source pages: 136-140 Extraction method: PDF embedded text extraction, page-order preserved. ===== SOURCE PAGE 136 ===== S. ARCHITECT";
  const polished = polishBenchmarkOutput(CELL);

  it("removes the trust marker even mid-line", () => {
    assert.doesNotMatch(polished, /REGEX_DRAFT|AUTOMATIC SOURCE VERIFICATION PENDING/i, polished);
  });

  it("removes the extraction page markers the earlier rule missed", () => {
    assert.doesNotMatch(polished, /SOURCE PAGE \d+|=====/, polished);
  });

  it("removes the extraction bookkeeping labels", () => {
    assert.doesNotMatch(polished, /Source pages:|Extraction method:/i, polished);
  });

  it("keeps the person and their role", () => {
    assert.match(polished, /S\. Architect/);
    assert.match(polished, /Primary position: Architect/);
  });
});
