// A requirement line that carries a page/section/quote tag must never be
// re-truncated into a broken tag by a downstream renderer.
//
// WHY THIS FILE EXISTS
// --------------------
// formatRequirementLine() always returns a COMPLETE, closed line — the tags
// are appended after their own values are sliced, so the function itself
// never produces a malformed "(§ …" or "(quote: "…" with no closing quote or
// paren. But three independent deterministic renderers — each with its own
// copy-pasted `take(lines, count, maxLen)` helper — RE-TRUNCATE that already-
// complete line with a raw `line.slice(0, maxLen - 1) + "…"`, with no idea it
// ends in structural syntax:
//
//   lib/engine/tender-response-blueprint.ts  take(input.requirements, 16, 320)
//   lib/engine/proposal-evaluator-matrix.ts  take(input.requirements, 14, 260)
//   lib/engine/proposal-quality-repair.ts    take(input.requirements, N, 180)
//
// Reproduced on the real Pharo tender WITH NO AI CALL — every section of that
// run fell back to the deterministic path (Gemini was rate-limited on every
// attempt), so formatRequirementLine's 506-character, well-formed line for
// "Specialized Healthcare Design Experience" was the actual input.
// tender-response-blueprint.ts's take(..., 16, 320) cut it at character 320 —
// inside the section-heading VALUE, before the tag's own closing paren — and
// that fragment reached the client-facing "Section E: Compliance Matrix" of
// the submitted DOCX and PDF, verbatim:
//
//   … Include reviewed healthcare project references. [p.7]
//   (§ QUALIFICATIONS AND APP EXTR…
//
// truncateDisplayLine() is the fix: it recognises the trailing
// [p.N] / (§ …) / (quote: "…") tags formatRequirementLine produces, and never
// prints one partially — either the core text plus the FULL tag fits (nothing
// is touched), the tags are dropped WHOLESALE so the core survives untruncated
// (provenance is grounding metadata for a writer, not a client-facing fact),
// or — only when the bare core itself is too long — the core is cut at the
// last word boundary before the limit.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { formatRequirementLine, truncateDisplayLine } from "../lib/engine/proposal-labels";
import { buildTenderResponseBlueprint } from "../lib/engine/tender-response-blueprint";

// The exact real requirement, verbatim from the Pharo tender, whose
// formatRequirementLine() output is 506 characters — long enough to trip
// every one of the three known maxLen budgets (320 / 260 / 220 / 180).
const REAL_REQUIREMENT = {
  title: "Specialized Healthcare Design Experience",
  description:
    "Demonstrate proven experience specifically in designing healthcare facilities, backed by a relevant "
    + "design portfolio and client references to illustrate capability in this specialized sector. Include "
    + "reviewed healthcare project references.",
  sourcePageNumber: 7,
  sourceSectionHeading: "QUALIFICATIONS AND APP EXTRACTION RULES",
  sourceExactQuote:
    "Proven experience in designing healthcare facilities; Relevant healthcare design portfolio and client "
    + "references; Required reviewed healthcare project references.",
};

function balanced(text: string): boolean {
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  const brOpens = (text.match(/\[/g) ?? []).length;
  const brCloses = (text.match(/\]/g) ?? []).length;
  const unterminatedQuote = /\(quote:\s*"[^"]*$/.test(text);
  return opens === closes && brOpens === brCloses && !unterminatedQuote;
}

describe("formatRequirementLine produces a complete line on its own", () => {
  it("is a single well-formed line with all three tags closed", () => {
    const line = formatRequirementLine(REAL_REQUIREMENT);
    assert.ok(line.length > 320, `fixture must exceed every known maxLen; got ${line.length}`);
    assert.ok(balanced(line), line);
    assert.match(line, /\[p\.7\]/);
    assert.match(line, /\(§ QUALIFICATIONS AND APP EXTRACTION RULES\)/);
    assert.match(line, /\(quote: "Proven experience[^)]*"\)$/);
  });
});

describe("truncateDisplayLine never half-prints a tag it did not build", () => {
  const line = formatRequirementLine(REAL_REQUIREMENT);

  for (const maxLen of [320, 260, 220, 180, 100]) {
    it(`stays balanced at maxLen=${maxLen} (the exact budgets the three real renderers use)`, () => {
      const truncated = truncateDisplayLine(line, maxLen);
      assert.ok(balanced(truncated), `unbalanced output at maxLen=${maxLen}: ${JSON.stringify(truncated)}`);
    });
  }

  it("reproduces the historical defect at maxLen=320 as CLOSED, not the recorded broken fragment", () => {
    const truncated = truncateDisplayLine(line, 320);
    assert.equal(
      truncated.includes("QUALIFICATIONS AND APP EXTR…"),
      false,
      "the exact broken fragment shipped to the real client document must never recur",
    );
  });

  it("drops the tags wholesale rather than half-printing them when they do not fit", () => {
    const truncated = truncateDisplayLine(line, 320);
    // The core requirement statement survives in full.
    assert.match(truncated, /Include reviewed healthcare project references\.$/);
    // No dangling "[p." / "(§" / "(quote:" fragment.
    assert.equal(/\[p\.\s*\d*$/.test(truncated), false, truncated);
    assert.equal(/\(§[^)]*$/.test(truncated), false, truncated);
    assert.equal(/\(quote:[^)]*$/.test(truncated), false, truncated);
  });

  it("returns the line completely unchanged when it already fits", () => {
    const short = "Company Legal Standing — provide a valid trade license.";
    assert.equal(truncateDisplayLine(short, 260), short);
  });

  it("never cuts a real word in half when the bare core itself must be shortened", () => {
    const longCoreNoTags = "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";
    const truncated = truncateDisplayLine(longCoreNoTags, 40);
    assert.ok(truncated.endsWith("…"));
    const withoutEllipsis = truncated.slice(0, -1);
    assert.ok(
      longCoreNoTags.startsWith(withoutEllipsis),
      `truncated text must be a clean prefix of the original: ${JSON.stringify(truncated)}`,
    );
    assert.equal(longCoreNoTags[withoutEllipsis.length], " ", "must cut exactly at a word boundary, not mid-word");
  });

  it("still hard-cuts a single token longer than the whole budget, staying within it", () => {
    const truncated = truncateDisplayLine("Supercalifragilisticexpialidocious", 10);
    assert.ok(truncated.length <= 10, `output exceeded maxLen: ${JSON.stringify(truncated)}`);
    assert.ok(truncated.endsWith("…"));
    assert.ok("Supercalifragilisticexpialidocious".startsWith(truncated.slice(0, -1)));
  });
});

describe("the real end-to-end blueprint path never ships a broken tag", () => {
  it("every requirement in a real blueprint (16-item cap, maxLen=320) is balanced", () => {
    // The exact call shape tender-response-blueprint.ts uses in production:
    // take(input.requirements, 16, 320) against formatRequirementLine output.
    const requirementLines = [
      formatRequirementLine(REAL_REQUIREMENT),
      formatRequirementLine({
        title: "Company Legal Standing & Registration",
        description: "Provide evidence of a valid business license and registration in Ethiopia to demonstrate legal eligibility to operate and provide services.",
        sourcePageNumber: 7,
        sourceSectionHeading: "QUALIFICATIONS AND APP EXTRACTION RULES",
        sourceExactQuote: null,
      }),
    ];
    const blueprint = buildTenderResponseBlueprint({
      tenderTitle: "Architectural Consultancy Services",
      clientName: "Pharo Ventures",
      requirements: requirementLines,
      expertLines: [],
      projectLines: [],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
    });
    for (const item of blueprint) {
      assert.ok(balanced(item.requirement), `broken requirement text reached the blueprint: ${JSON.stringify(item.requirement)}`);
    }
  });
});
