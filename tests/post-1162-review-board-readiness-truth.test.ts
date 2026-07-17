import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/company/review-board/page.tsx", "utf8");

describe("post-1162 knowledge review-board readiness truth", () => {
  it("uses a tri-state presentation instead of showing green Ready beside warnings", () => {
    assert.match(source, /getReviewBoardReadinessPresentation/);
    assert.match(source, /label: "Review required"/);
    assert.match(source, /summary\.warnings\.length > 0/);
    assert.match(source, /textClass: "text-amber-700"/);
    assert.doesNotMatch(source, /summary\?\.readyForFinalGeneration \? "text-green-700" : "text-red-700"/);
  });

  it("keeps blocked and fully ready states distinct", () => {
    assert.match(source, /if \(!summary\.readyForFinalGeneration\)/);
    assert.match(source, /label: "Blocked"/);
    assert.match(source, /label: "Ready"/);
    assert.match(source, /detail: "No readiness warnings"/);
  });

  it("exposes the final-generation state accessibly", () => {
    assert.match(source, /aria-label=\{`Final generation readiness: \$\{readinessPresentation\.label\}`\}/);
    assert.match(source, /readinessPresentation\.detail/);
    assert.match(source, /role="alert"/);
    assert.match(source, /role="status"/);
  });

  it("keeps long review-board records and warning filenames mobile-safe", () => {
    assert.match(source, /flex flex-wrap items-center justify-between gap-2/);
    assert.match(source, /break-words font-semibold text-slate-900/);
    assert.match(source, /break-words rounded-lg bg-white/);
  });
});
