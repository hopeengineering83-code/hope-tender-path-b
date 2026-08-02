// The Finalize PDF action is only offered when finalizing can actually work.
//
// components/finalize-required-pdf-button.tsx disables only on
// running/done, so it is clickable whenever it renders, and
// generation-readiness-panel.tsx renders it purely because a warning carries
// nextAction FINALIZE_REQUIRED_PDF. That warning used to fire on "a required
// PDF filename has no active document" alone — it never checked whether there
// was anything to finalize FROM.
//
// app/api/tenders/[id]/finalize-pdf/route.ts converts a GENERATED .docx whose
// base name matches the required PDF. With no such source it answers
// PDF_REQUIRED_CONVERSION_UNAVAILABLE. So whenever the source was absent the
// user got an enabled button whose only possible outcome was that rejection:
// click, error, nothing changes, click again — with no statement of what was
// actually missing.
//
// The warning now decides where the documents are already in hand, using the
// same normalizeFileBaseName the route uses, so the two cannot disagree about
// what is finalizable. When no source exists it names the real prerequisite
// and stops advertising an action that cannot succeed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { normalizeFileBaseName } from "../lib/engine/workflow/pdf-finalizer";

const READINESS = readFileSync("lib/tender-generation-readiness.ts", "utf8");
const ROUTE = readFileSync("app/api/tenders/[id]/finalize-pdf/route.ts", "utf8");
const PANEL = readFileSync("components/generation-readiness-panel.tsx", "utf8");
const BUTTON = readFileSync("components/finalize-required-pdf-button.tsx", "utf8");

describe("The warning that offers Finalize PDF checks a source exists", () => {
  it("splits missing PDFs into finalizable and not-finalizable", () => {
    assert.match(READINESS, /const finalizable = missingPdfNames\.filter/);
    assert.match(READINESS, /const notFinalizable = missingPdfNames\.filter/);
  });

  it("offers FINALIZE_REQUIRED_PDF only for names with a matching source", () => {
    const block = READINESS.slice(READINESS.indexOf("const finalizable ="), READINESS.indexOf("TENDER_PROHIBITS_BRANDING"));
    const finalizeBranch = block.slice(block.indexOf("if (finalizable.length > 0)"), block.indexOf("if (notFinalizable.length > 0)"));
    assert.match(finalizeBranch, /nextAction: "FINALIZE_REQUIRED_PDF"/);
    const blockedBranch = block.slice(block.indexOf("if (notFinalizable.length > 0)"));
    assert.doesNotMatch(blockedBranch, /nextAction: "FINALIZE_REQUIRED_PDF"/,
      "a PDF with no source must not advertise an action that returns 422 by design");
  });

  it("names the real prerequisite when nothing can be finalized", () => {
    assert.match(READINESS, /TENDER_REQUIRES_PDF_SOURCE_MISSING/);
    assert.match(READINESS, /no generated source document matches/);
    assert.match(READINESS, /generate the matching document first, or upload the tender-issued PDF/);
  });

  it("uses the same base-name rule as the route that does the work", () => {
    assert.match(READINESS, /import \{ normalizeFileBaseName \} from "\.\/engine\/workflow\/pdf-finalizer"/);
    assert.match(ROUTE, /normalizeFileBaseName/);
    // The shared rule, exercised: a DOCX source matches its required PDF.
    assert.equal(normalizeFileBaseName("Technical Proposal.docx"), normalizeFileBaseName("Technical Proposal.pdf"));
    assert.notEqual(normalizeFileBaseName("Financial Proposal.docx"), normalizeFileBaseName("Technical Proposal.pdf"));
  });

  it("only counts GENERATED .docx rows as sources", () => {
    const block = READINESS.slice(READINESS.indexOf("const docxSourceModel"), READINESS.indexOf("const finalizable ="));
    assert.match(block, /generationStatus: "GENERATED"/);
    assert.match(block, /\.toLowerCase\(\)\.endsWith\("\.docx"\)/);
  });
});

describe("The route remains the fail-closed authority", () => {
  it("still refuses when no source matches, so the UI is a filter and not a bypass", () => {
    assert.match(ROUTE, /PDF_REQUIRED_CONVERSION_UNAVAILABLE/);
    assert.match(ROUTE, /No approved generated source document matches/);
  });

  it("still rejects an explicitly chosen source whose name does not match", () => {
    assert.match(ROUTE, /PDF_SOURCE_NAME_MISMATCH/);
  });
});

describe("The button is reached only through the finalizable warning", () => {
  it("renders only for nextAction FINALIZE_REQUIRED_PDF", () => {
    assert.match(PANEL, /item\.nextAction === "FINALIZE_REQUIRED_PDF"\s*\?\s*<FinalizeRequiredPdfButton/);
  });

  it("is otherwise a plain link, so a non-finalizable warning cannot render it", () => {
    const region = PANEL.slice(PANEL.indexOf('item.nextAction === "FINALIZE_REQUIRED_PDF"'));
    assert.match(region.slice(0, 400), /: <Link/);
  });

  it("still guards against double submission while running", () => {
    assert.match(BUTTON, /disabled=\{state === "running" \|\| state === "done"\}/);
  });
});
