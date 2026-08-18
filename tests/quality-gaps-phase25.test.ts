// Regression tests for quality gap fixes — Phase 25.
//
// Phase 25 covers one targeted hardening improvement:
//
//   Authority review status reset on re-generation:
//     When a generated document is updated with new content (regenerated),
//     the previous reviewStatus (which may be AUTHORITY_READY) was NOT reset.
//     This meant a document could keep an AUTHORITY_READY status after new
//     content was written, bypassing the need to re-run authority review.
//
//     Fix: all update() calls in generate-elite.ts that write fileContent to
//     a generatedDocument now also set reviewStatus: "PENDING", ensuring the
//     authority review gate fires on the new content before export.
//
//     Applies to:
//     - Primary technical proposal slot update (exact file name matched)
//     - Fallback Technical-Proposal.docx update (no slot found)
//     - Expert CV document update (re-generated CV)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// ── Authority review reset on re-generation ───────────────────────────────────

describe("phase 25 — reviewStatus reset to PENDING on document re-generation", () => {
  const src = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("primary technical proposal slot update resets reviewStatus to PENDING", () => {
    // Find all update blocks that set generationStatus: "GENERATED" and check
    // that reviewStatus: "PENDING" appears in the same block.
    const updates: number[] = [];
    let pos = 0;
    while (true) {
      const idx = src.indexOf('generationStatus: "GENERATED"', pos);
      if (idx === -1) break;
      updates.push(idx);
      pos = idx + 1;
    }
    assert.ok(updates.length >= 2, "at least two GENERATED update sites must exist in generate-elite.ts");

    // For each update site, check that reviewStatus: "PENDING" appears within 600 chars
    let resetCount = 0;
    for (const updateIdx of updates) {
      const window = src.slice(Math.max(0, updateIdx - 50), updateIdx + 600);
      if (window.includes('reviewStatus: "PENDING"')) resetCount++;
    }
    assert.ok(
      resetCount >= 2,
      `At least 2 GENERATED update sites must also set reviewStatus: "PENDING" (found ${resetCount})`,
    );
  });

  it("no update block writes fileContent without reviewStatus reset (static audit)", () => {
    // Every prisma.generatedDocument.update() call that includes fileContent
    // must also include reviewStatus: "PENDING". Use 800-char window to cover
    // update blocks that include inline comments between fields.
    let searchPos = 0;
    let violationCount = 0;
    while (true) {
      const updateIdx = src.indexOf("prisma.generatedDocument.update(", searchPos);
      if (updateIdx === -1) break;
      const snippet = src.slice(updateIdx, updateIdx + 800);
      if (snippet.includes("fileContent") && !snippet.includes('reviewStatus: "PENDING"')) {
        violationCount++;
      }
      searchPos = updateIdx + 1;
    }
    assert.equal(
      violationCount,
      0,
      `${violationCount} prisma.generatedDocument.update() call(s) write fileContent without resetting reviewStatus to PENDING`,
    );
  });

  it("CV document update also resets reviewStatus to PENDING", () => {
    // #1058 added verifiedIntegrityDataFromBase64 which wraps cvContent.
    // The reviewStatus: "PENDING" is in the data object alongside fileContent: cvContent.
    // Search for any occurrence of fileContent: cvContent and verify PENDING is nearby.
    const allOccurrences: number[] = [];
    let idx = 0;
    while ((idx = src.indexOf("fileContent: cvContent", idx)) !== -1) {
      allOccurrences.push(idx);
      idx += 10;
    }
    assert.ok(allOccurrences.length > 0, "CV content update must exist in generate-elite.ts");
    // Check that at least one occurrence has reviewStatus: "PENDING" within 300 chars
    const hasPending = allOccurrences.some((i) => {
      const snippet = src.slice(i - 20, i + 300);
      return snippet.includes('reviewStatus: "PENDING"');
    });
    assert.ok(hasPending, "CV document update must reset reviewStatus to PENDING");
  });
});

// ── Download route already enforces envelope mismatch ─────────────────────────

describe("phase 25 — envelope mismatch enforcement in download route (regression)", () => {
  it("download route blocks ZIP on QUALITY_VALIDATION_BLOCKED including envelope mismatches", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.ok(src.includes("validateDocumentQuality"), "download route must call validateDocumentQuality");
    assert.ok(src.includes("QUALITY_VALIDATION_BLOCKED"), "download route must emit QUALITY_VALIDATION_BLOCKED code");
    assert.ok(
      src.includes("envelope mismatches"),
      "download route error message must mention envelope mismatches",
    );
  });
});

// ── Regression ─────────────────────────────────────────────────────────────────

describe("phase 25 — regression: support doc generation already resets reviewStatus", () => {
  it("fillPlannedSupportDocuments resets reviewStatus to PENDING (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    // Locate the DECLARATION, not the first mention of the name. Slicing from
    // `indexOf("fillPlannedSupportDocuments")` matched whichever line mentioned
    // the function first — a doc comment above it counted — and the fixed
    // 4000-character window then measured comment length rather than behaviour,
    // so adding a comment failed this test while the function was unchanged.
    const declaration = "async function fillPlannedSupportDocuments(";
    const start = src.indexOf(declaration);
    assert.ok(start !== -1, "fillPlannedSupportDocuments must exist in generate route");
    // Read to the end of the function by matching braces from its opening one.
    const bodyStart = src.indexOf("{", start);
    let depth = 0;
    let end = bodyStart;
    for (let i = bodyStart; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    assert.ok(end > bodyStart, "could not determine the end of fillPlannedSupportDocuments");
    const funcBody = src.slice(start, end + 1);
    assert.ok(
      funcBody.includes('reviewStatus: "PENDING"'),
      "fillPlannedSupportDocuments must reset reviewStatus to PENDING",
    );
  });
});
