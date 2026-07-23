import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/company/review-board/page.tsx", "utf8");
// getReviewBoardReadinessPresentation was extracted out of page.tsx into its own
// module — Next.js App Router page.tsx files may only export `default` and a
// small set of reserved names (generateMetadata, generateStaticParams, ...);
// exporting an arbitrary helper function from a page file fails the build
// ("is not a valid Page export field"). The presentation logic itself now
// lives in readiness-presentation.ts and is imported (not re-exported) here.
const presentationSource = readFileSync("app/dashboard/company/review-board/readiness-presentation.ts", "utf8");

describe("post-1162 knowledge review-board readiness truth", () => {
  it("page.tsx imports the tri-state presentation helper rather than defining it inline", () => {
    assert.match(source, /import \{ getReviewBoardReadinessPresentation, type ReviewSummary \} from "\.\/readiness-presentation"/);
    assert.match(source, /const readinessPresentation = getReviewBoardReadinessPresentation\(summary\)/);
  });

  it("uses a tri-state presentation instead of showing green Ready beside warnings", () => {
    assert.match(presentationSource, /export function getReviewBoardReadinessPresentation/);
    assert.match(presentationSource, /label: "Review required"/);
    assert.match(presentationSource, /summary\.warnings\.length > 0/);
    assert.match(presentationSource, /textClass: "text-amber-700"/);
    assert.doesNotMatch(source, /summary\?\.readyForFinalGeneration \? "text-green-700" : "text-red-700"/);
  });

  it("keeps blocked and fully ready states distinct", () => {
    assert.match(presentationSource, /if \(!summary\.readyForFinalGeneration\)/);
    assert.match(presentationSource, /label: "Blocked"/);
    assert.match(presentationSource, /label: "Ready"/);
    assert.match(presentationSource, /detail: "No readiness warnings"/);
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

  it("page.tsx does not export a named export other than the page component (Next.js Page contract)", () => {
    assert.ok(
      !/^export function getReviewBoardReadinessPresentation/m.test(source),
      "page.tsx must not export arbitrary named functions — Next.js App Router rejects the build otherwise",
    );
  });
});
