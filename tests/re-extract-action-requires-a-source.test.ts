// Regression test: the Tender Detail panel must not offer "Re-extract from PDF"
// on a tender that has no uploaded source.
//
// Found by running the app, not by reading it. On a seeded tender with zero
// files, Command Center correctly showed exactly one canonical action —
// "Upload tender document. No tender file has been uploaded." — while the
// Tender Detail panel directly below it offered "Re-extract from PDF". The two
// panels contradicted each other on the same screen, and the owner could only
// discover the second was impossible by clicking it.
//
// The route was never the problem and is unchanged: POST
// /api/tenders/[id]/re-extract-metadata answers 400 with "Tender has no
// uploaded files to re-extract from. Upload tender documents first." So this is
// not a successful no-op — it is an unreachable action being advertised, which
// is the class of contradiction this PR exists to remove. Gating the button
// hides an action that cannot succeed; it relaxes no gate.
//
// Verified live before and after in the running app: 0 buttons on a tender with
// no files, 1 button on a tender with one file.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const panel = readFileSync("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx", "utf8");
const route = readFileSync("app/api/tenders/[id]/re-extract-metadata/route.ts", "utf8");

describe("Re-extract is offered only when there is a source to re-extract from", () => {
  it("derives reachability from the tender's own files", () => {
    assert.match(
      panel,
      /const hasSourceFile\s*=\s*Array\.isArray\(tender\.files\)\s*&&\s*tender\.files\.length\s*>\s*0/,
      "the panel must decide from the file list the page already passes it",
    );
  });

  it("renders the button only when a source file exists", () => {
    assert.match(
      panel,
      /\{hasSourceFile\s*&&\s*<ReExtractMetadataButton/,
      "the button must be gated on hasSourceFile",
    );
    // An ungated render is exactly the regression this test exists to catch.
    assert.doesNotMatch(
      panel,
      /(?<!hasSourceFile\s*&&\s*)<ReExtractMetadataButton\s+tenderId=\{tender\.id\}\s*\/>\s*(?!\})/,
      "the button must never be rendered unconditionally",
    );
  });

  it("keeps the route fail-closed regardless of what the UI shows", () => {
    // The gate that actually protects the operation is server-side and must
    // stay. Hiding a button is presentation; this is the guarantee.
    assert.match(
      route,
      /no uploaded files to re-extract from/i,
      "the route must still refuse when the tender has no files",
    );
  });
});
