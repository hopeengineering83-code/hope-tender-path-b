// Regression test: the "new tender" intake page and the tender-detail source-files
// panel showed inconsistent file-format guidance for the same upload restriction
// ("PDF, DOCX, XLSX, TXT, or CSV" vs "PDF, DOCX, XLSX, TXT, and CSV"). This is exactly
// the class of app-wide contradiction users hit — the same fact worded two different
// ways in two entry points to the same feature. e2e/production-smoke.spec.ts asserts
// the "and" wording specifically, so the "or" copy on the intake page also made that
// smoke test fail.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("tender intake upload guidance — consistent wording across entry points", () => {
  it("new-tender page's upload-help text uses the same 'and CSV' phrasing as the tender-detail source-files panel", () => {
    const newTenderPage = read("app/dashboard/tenders/new/page.tsx");
    const sourceFilesPanel = read("components/tender-source-files-panel.tsx");
    // The upload-help paragraph (id=uploadHelpId) is the guidance text shown next to
    // the file picker — this is what e2e/production-smoke.spec.ts asserts is visible.
    // Allow whitespace/line-wrapping between the tag's closing '>' and its text:
    // the secure large-package batching incorporation reformatted this paragraph
    // onto its own line without changing the rendered wording (HTML collapses the
    // whitespace regardless), and a literal-adjacency regex shouldn't fail on that.
    assert.match(
      newTenderPage,
      /id=\{uploadHelpId\}[^>]*>\s*PDF, DOCX, XLSX, TXT, and CSV\./,
      "the upload-help paragraph must use 'and CSV', matching the source-files panel",
    );
    assert.match(sourceFilesPanel, /PDF, DOCX, XLSX, TXT, and CSV/);
    // A separate, unrelated "or CSV" legitimately exists elsewhere in this file — the
    // rejected-file error message ("Use PDF, DOCX, XLSX, TXT, or CSV.") — which is
    // correct as "or" there (listing acceptable alternatives for a rejected upload),
    // not a contradiction with the upload-help guidance text.
  });
});
