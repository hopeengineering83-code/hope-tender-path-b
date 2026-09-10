// The placeholder gate must catch unfilled slots without blocking on the
// tender's own English.
//
// Reproduced defect (live Preview, tender 08e250af, read-only inspect of
// 2026-09-10). Company Profile.docx, quality 75, recommendedStatus
// QUALITY_FAILED, and the whole export blocked behind
// GENERATED_DOCUMENT_QUALITY_FAILED. The gate reported:
//
//   BID_TEAM_TO_CONFIRM: Document contains 1 internal placeholder
//   reference(s): "not available".
//
// The single match was inside requirement 3fcaffcf ("Email Submission Only"),
// which narrativeDraftContent() quotes verbatim under "Tender requirements
// addressed":
//
//   "…through email to the designated contacts only. Hard copy submissions or
//    portal uploads are not available."
//
// That is the procuring entity's own sentence describing which submission
// channels exist. Nothing in the document was unfilled. One ordinary English
// phrase, quoted from the source, blocked a whole package.
//
// METADATA_PLACEHOLDER_PATTERNS is right for what it was written for —
// checking one extracted FIELD VALUE, where a bare "not available" really is
// a placeholder. Scanning a document's running prose is a different problem.
// So the ambiguous half of the vocabulary now applies only in value position;
// the unambiguous half still matches anywhere. This narrows WHERE, never
// WHETHER.
//
// Cross-sector by construction: the negative cases below are water, roads,
// geotechnical, EOI and construction-supervision prose, not healthcare. Pharo
// is the benchmark that exposed this, not the subject of the fix.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";
import { valuePositionPlaceholderMatches } from "../lib/engine/detection-patterns";
import { looksLikeMetadataPlaceholder } from "../lib/engine/tender-metadata-completeness";

const THE_REPRODUCED_SENTENCE =
  "Proposals shall be submitted through email to the designated contacts only. " +
  "Hard copy submissions or portal uploads are not available.";

function bidTeamIssue(visibleText: string) {
  const result = assessGeneratedDocumentQuality({
    doc: {
      name: "Company Profile.docx",
      exactFileName: "Company Profile.docx",
      documentType: "COMPANY_PROFILE",
      format: "DOCX",
    },
    visibleText,
    hasStoragePath: true,
  } as Parameters<typeof assessGeneratedDocumentQuality>[0]);
  return result.issues.find((i) => i.code === "BID_TEAM_TO_CONFIRM") ?? null;
}

describe("placeholder gate: value position, not vocabulary alone", () => {
  // ── NEGATIVE: legitimate client-facing prose must pass ──────────────────
  it("the exact reproduced sentence no longer raises BID_TEAM_TO_CONFIRM", () => {
    assert.equal(
      valuePositionPlaceholderMatches(THE_REPRODUCED_SENTENCE).length,
      0,
      "the tender's own submission-channel sentence is not a placeholder",
    );
  });

  const LEGITIMATE_PROSE: ReadonlyArray<[string, string]> = [
    ["water/hydraulic", "Continuous flow data for the upper catchment are not available for the 1998-2003 period, so the model is calibrated on the 2004-2024 record."],
    ["roads/infrastructure", "Utility as-built drawings are not available from the municipality; the survey therefore includes trial pits at every proposed crossing."],
    ["geotechnical", "Borehole logs deeper than 30 m are not available, and additional drilling is included in the inception phase."],
    ["EOI/consultant selection", "Award of the framework is pending completion of the client's internal approval process."],
    ["construction supervision", "The resident engineer certifies each milestone before payment; works to be completed under Phase 2 are listed in Annex B."],
    ["industrial/building", "Where a manufacturer's certificate is unknown at tender stage, the contractor submits it before installation."],
    ["urban/master planning", "Cadastral coverage of the eastern expansion area is not specified in the available records and will be surveyed."],
  ];
  for (const [sector, prose] of LEGITIMATE_PROSE) {
    it(`${sector}: ordinary prose passes`, () => {
      assert.equal(valuePositionPlaceholderMatches(prose).length, 0, `blocked legitimate ${sector} prose: ${prose}`);
      assert.equal(bidTeamIssue(prose), null, `gate raised BID_TEAM_TO_CONFIRM on legitimate ${sector} prose`);
    });
  }

  // ── POSITIVE: genuine unfilled slots must still fail ────────────────────
  const GENUINE_PLACEHOLDERS: ReadonlyArray<[string, string]> = [
    ["labelled field, missing value", "Client: not available"],
    ["labelled contact", "Contact person: unknown"],
    ["labelled deadline", "Submission deadline: to be confirmed"],
    ["bare table cell", "Country\nEthiopia\nContract value\nN/A\nDuration\n18 months"],
    ["bracketed slot", "The employer is [not specified] at this stage."],
    ["labelled with trailing period", "Reference number: not provided."],
  ];
  for (const [label, text] of GENUINE_PLACEHOLDERS) {
    it(`still catches: ${label}`, () => {
      assert.ok(
        valuePositionPlaceholderMatches(text).length > 0,
        `value-position placeholder went undetected: ${text}`,
      );
    });
  }

  it("unambiguous markers still match anywhere, mid-sentence included", () => {
    for (const text of [
      "The project schedule will be issued once Bid-Team to confirm the mobilisation date.",
      "Delivery dates are TBD and will follow contract signature.",
      "This paragraph is a placeholder for the executive summary.",
      "Please fill in the remaining rows before issue.",
    ]) {
      const issue = bidTeamIssue(text);
      assert.notEqual(issue, null, `unambiguous placeholder missed: ${text}`);
    }
  });

  it("the gate names the phrases it matched", () => {
    const issue = bidTeamIssue("Client: not available");
    assert.notEqual(issue, null);
    assert.match(issue!.message, /"not available"/, "message must quote what it matched");
  });

  it("field-value checking is unchanged — a bare value is still a placeholder", () => {
    // looksLikeMetadataPlaceholder() receives ONE field value, where the
    // ambiguity does not exist. Narrowing the document gate must not touch it.
    for (const value of ["not available", "unknown", "N/A", "to be confirmed", "pending"]) {
      assert.ok(
        looksLikeMetadataPlaceholder(value),
        `metadata field-value detection regressed for ${value!}`,
      );
    }
  });

  it("no second copy of the placeholder rule scans whole prose", () => {
    // The audit route derived its bidTeamToConfirmIssue flag from its own
    // scan of the full METADATA_PLACEHOLDER_PATTERNS list, matching anywhere.
    // After the gate learned value position, the two disagreed about the same
    // bytes on live Preview: Company Profile.docx came back qualityScore=100
    // recommended=PASSED with no BID_TEAM_TO_CONFIRM issue, and
    // bidTeamToConfirmIssue=true printed right beside it. An audit whose job
    // is catching surfaces that contradict each other must not be one.
    const src = readFileSync("app/api/admin/generated-proposals/audit/route.ts", "utf8");
    const flag = src.slice(
      src.indexOf("const bidTeamToConfirmIssue"),
      src.indexOf("const genericContentIssue"),
    );
    assert.ok(flag.length > 0, "bidTeamToConfirmIssue assignment not found");
    assert.doesNotMatch(
      flag,
      /METADATA_PLACEHOLDER_PATTERNS/,
      "the audit must not re-scan prose with the whole field-value pattern list",
    );
    assert.match(
      flag,
      /issueCodes\.has\("BID_TEAM_TO_CONFIRM"\)/,
      "the audit must derive from the gate's verdict",
    );
  });

  it("a document mixing both gets flagged for the real one only", () => {
    const mixed = `${THE_REPRODUCED_SENTENCE}\nContact person: unknown`;
    const issue = bidTeamIssue(mixed);
    assert.notEqual(issue, null, "the genuine placeholder must still fail the document");
    assert.match(issue!.message, /"unknown"/);
    assert.doesNotMatch(issue!.message, /"not available"/, "must not report the tender's own sentence");
  });
});
